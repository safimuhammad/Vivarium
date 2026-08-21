import { describe, expect, it } from "vitest";

import { makeWorld } from "../test/fixtures";
import { parseRunMetadata, parseWorldSnapshot } from "./schemas";

/**
 * `RunMetadata.status` must survive the whole lifecycle the server reports.
 *
 * `POST /api/run/start` answers `starting`, `POST /api/run/stop` answers
 * `stopping`, and a run that raises marks itself `failed` — all three land on
 * `GET /api/run`, which the observer parses at join and the SSE heartbeat
 * re-reports every 15s. A closed three-value enum threw on the ordinary path,
 * immediately after a viewer pressed "Let's go live".
 */
function runMetadata(status: string): Record<string, unknown> {
  return {
    schema: 1,
    run_id: "run-1",
    seed: 7,
    started_at: 1_700_000_000,
    status,
    event_cursor: 0,
    world_time: 0,
    config_hash: "abc",
    constants: {},
    provider: "gemini",
    model: "gemini-2.5-flash",
    context_window: null,
    timing: {},
    artifacts: {
      events: "events.jsonl",
      usage: "usage.jsonl",
      snapshots: "snapshots",
      memory_root: "memory",
    },
  };
}

describe("parseRunMetadata", () => {
  it.each([
    "ready",
    "starting",
    "running",
    "stopping",
    "stopped",
    "failed",
  ])("accepts the server's %s status", (status) => {
    expect(parseRunMetadata(runMetadata(status)).status).toBe(status);
  });

  it("still refuses a status no server reports", () => {
    expect(() => parseRunMetadata(runMetadata("warming"))).toThrow(/status/);
  });
});

describe("parseWorldSnapshot", () => {
  it("derives deterministic pressure for legacy snapshots from exact current records", () => {
    const { region_pressure: _omitted, ...legacy } = makeWorld();

    expect(parseWorldSnapshot(legacy).region_pressure).toEqual([
      {
        region: "grove",
        population_high_water: 1,
        built_footprint_high_water: 1,
      },
      {
        region: "meadow",
        population_high_water: 1,
        built_footprint_high_water: 1,
      },
    ]);
  });

  it("parses supplied pressure as sorted unique known non-negative integer truth", () => {
    const parsed = parseWorldSnapshot(makeWorld({
      region_pressure: [
        {
          region: "meadow",
          population_high_water: 9,
          built_footprint_high_water: 7,
        },
        {
          region: "grove",
          population_high_water: 4,
          built_footprint_high_water: 3,
        },
      ],
    }));

    expect(parsed.region_pressure?.map(({ region }) => region)).toEqual(["grove", "meadow"]);
  });

  it.each([
    [
      "negative population",
      [
        {
          region: "grove",
          population_high_water: 1,
          built_footprint_high_water: 0,
        },
        {
          region: "meadow",
          population_high_water: -1,
          built_footprint_high_water: 0,
        },
      ],
    ],
    [
      "fractional footprint",
      [
        {
          region: "grove",
          population_high_water: 1,
          built_footprint_high_water: 0,
        },
        {
          region: "meadow",
          population_high_water: 1,
          built_footprint_high_water: 0.5,
        },
      ],
    ],
    [
      "duplicate region",
      [
        {
          region: "meadow",
          population_high_water: 1,
          built_footprint_high_water: 0,
        },
        {
          region: "meadow",
          population_high_water: 2,
          built_footprint_high_water: 1,
        },
      ],
    ],
    [
      "unknown exact region",
      [{
        region: "Meadow",
        population_high_water: 1,
        built_footprint_high_water: 0,
      }],
    ],
    [
      "empty coverage",
      [],
    ],
    [
      "missing known region",
      [{
        region: "meadow",
        population_high_water: 1,
        built_footprint_high_water: 0,
      }],
    ],
  ])("rejects malformed supplied pressure: %s", (_label, region_pressure) => {
    expect(() => parseWorldSnapshot(makeWorld({ region_pressure }))).toThrow(
      /region_pressure/,
    );
  });

  it("rejects negative ruin remnant material truth at the transport boundary", () => {
    const world = makeWorld();
    const malformed = {
      ...world,
      ruins: world.ruins.map((ruin) => ({ ...ruin, remnant_materials: -1 })),
    };

    expect(() => parseWorldSnapshot(malformed)).toThrow(
      "home.remnant_materials must be non-negative",
    );
  });
});

/**
 * A being's persona is now published only when it differs from the run's own
 * default, because the shared genesis words were byte-identical on every being
 * and made up more than half of every checkpoint. What must not change is the
 * string every consumer reads: it feeds `deriveHumanAppearance`, which decides a
 * being's colour, so a persona that resolved differently would repaint the world.
 */
describe("parseWorldSnapshot personas", () => {
  const seed = "You have just awoken into this world.";

  /** One being exactly as the server now publishes it: no persona of its own. */
  function bornFromTheSeed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const { persona: _omitted, ...rest } = makeWorld().agents[0];
    return { ...rest, ...overrides };
  }

  function snapshotWithAgents(
    agents: readonly Record<string, unknown>[],
    seedPersona?: string | null,
  ): Record<string, unknown> {
    const { agents: _replaced, ...rest } = makeWorld();
    return {
      ...rest,
      ...(seedPersona === undefined ? {} : { seed_persona: seedPersona }),
      agents: [...agents],
    };
  }

  it("resolves a being that omits its persona to the run's own default", () => {
    const parsed = parseWorldSnapshot(snapshotWithAgents([bornFromTheSeed()], seed));

    expect(parsed.seed_persona).toBe(seed);
    expect(parsed.agents[0].persona).toBe(seed);
  });

  it("keeps an authored persona rather than flattening it into the default", () => {
    const parsed = parseWorldSnapshot(snapshotWithAgents(
      [
        bornFromTheSeed({ id: "a", persona: "I keep what I find." }),
        bornFromTheSeed({ id: "b" }),
      ],
      seed,
    ));

    expect(parsed.agents[0].persona).toBe("I keep what I find.");
    expect(parsed.agents[1].persona).toBe(seed);
  });

  it("reads a legacy snapshot, which states no default and repeats every persona", () => {
    const legacy = makeWorld();

    const parsed = parseWorldSnapshot(legacy);

    expect(parsed.seed_persona).toBeNull();
    expect(parsed.agents.map((agent) => agent.persona))
      .toEqual(legacy.agents.map((agent) => agent.persona));
  });

  it("refuses a being with no persona and no default, rather than guessing one", () => {
    // Guessing here would silently repaint a being: the empty string yields a
    // null accent, and any invented string yields a different one.
    expect(() => parseWorldSnapshot(snapshotWithAgents([bornFromTheSeed()])))
      .toThrow(/agent.persona is absent/);
  });
});
