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
  it("keeps a fully specified Nirvana spatial pilot while old fixtures remain spatially absent", () => {
    const legacy = parseWorldSnapshot(makeWorld());
    expect(legacy.agents.every((agent) => agent.spatial === undefined)).toBe(true);
    expect(legacy.regions.every((region) => region.spatial === undefined)).toBe(true);

    const input = spatialNirvanaWorld();
    const parsed = parseWorldSnapshot(input);

    expect(parsed.regions[0]?.spatial).toMatchObject({
      map_id: "nirvana:pilot-layout",
      layout_fingerprint: "pilot-layout",
      initial_pressure: { populationHighWater: 2, builtFootprintHighWater: 1 },
    });
    expect(parsed.agents[0]?.spatial).toMatchObject({
      x: 16,
      y: 48,
      travel: { id: "travel-1", destination_id: "quiet-spring" },
    });
    expect(parsed.homes[0]?.spatial).toEqual({
      version: 1,
      region_id: "nirvana",
      map_id: "nirvana:pilot-layout",
      plot_id: "district-0-plot-1",
      x: 48,
      y: 80,
      door: { x: 48, y: 112 },
    });
  });

  it("accepts each v1 spatial shape for another region only when its map identity is exact", () => {
    const input = spatialNirvanaWorld();
    const region = (input.regions as Record<string, unknown>[])[0]!;
    const agent = (input.agents as Record<string, unknown>[])[0]!;
    const home = (input.homes as Record<string, unknown>[])[0]!;
    region.name = "warm_springs";
    (region.spatial as Record<string, unknown>).region_id = "warm_springs";
    (region.spatial as Record<string, unknown>).map_id = "warm_springs:pilot-layout";
    agent.position = "warm_springs";
    (agent.spatial as Record<string, unknown>).region_id = "warm_springs";
    (agent.spatial as Record<string, unknown>).map_id = "warm_springs:pilot-layout";
    const travel = (agent.spatial as Record<string, unknown>).travel as Record<string, unknown>;
    travel.id = "warm_springs:agent_001:travel:7";
    travel.destination_region = "nirvana";
    home.region = "warm_springs";
    (home.spatial as Record<string, unknown>).region_id = "warm_springs";
    (home.spatial as Record<string, unknown>).map_id = "warm_springs:pilot-layout";
    ((input.region_pressure as Record<string, unknown>[])[0]!).region = "warm_springs";

    expect(parseWorldSnapshot(input)).toMatchObject({
      regions: [{ name: "warm_springs", spatial: { region_id: "warm_springs", map_id: "warm_springs:pilot-layout" } }],
      agents: [{ position: "warm_springs", spatial: { region_id: "warm_springs", map_id: "warm_springs:pilot-layout", travel: { id: "warm_springs:agent_001:travel:7", destination_region: "nirvana" } } }],
      homes: [{ region: "warm_springs", spatial: { region_id: "warm_springs", map_id: "warm_springs:pilot-layout" } }],
    });

    (agent.spatial as Record<string, unknown>).map_id = "nirvana:pilot-layout";
    expect(() => parseWorldSnapshot(input)).toThrow(/matching current region/);
  });

  it.each([
    ["a missing route", (world: Record<string, unknown>) => {
      const agent = (world.agents as Record<string, unknown>[])[0]!;
      (agent.spatial as Record<string, unknown>).travel = {
        ...(agent.spatial as Record<string, unknown>).travel as Record<string, unknown>,
        route: [],
      };
    }],
    ["an unknown landmark", (world: Record<string, unknown>) => {
      const agent = (world.agents as Record<string, unknown>[])[0]!;
      (agent.spatial as Record<string, unknown>).at_landmark = "invented-place";
    }],
    ["a forged map identity", (world: Record<string, unknown>) => {
      const region = (world.regions as Record<string, unknown>[])[0]!;
      (region.spatial as Record<string, unknown>).map_id = "nirvana:forged";
    }],
    ["a duplicate reserved home plot", (world: Record<string, unknown>) => {
      const home = (world.homes as Record<string, unknown>[])[0]!;
      (world.ruins as Record<string, unknown>[]).push({
        ...structuredClone(home),
        home_id: "ruined-copy",
        status: "ruin",
      });
    }],
  ])("rejects malformed spatial truth: %s", (_label, mutate) => {
    const malformed = spatialNirvanaWorld();
    mutate(malformed);
    expect(() => parseWorldSnapshot(malformed)).toThrow(/spatial/);
  });

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

function spatialNirvanaWorld(): Record<string, unknown> {
  const base = structuredClone(makeWorld()) as unknown as Record<string, unknown>;
  base.region_pressure = [{
    region: "nirvana",
    population_high_water: 2,
    built_footprint_high_water: 1,
  }];
  base.regions = [{
    name: "nirvana",
    description: "The first map-backed region.",
    connections: [],
    energy_rate: 1,
    materials_rate: 1,
    current_energy: 10,
    current_materials: 10,
    max_energy: 20,
    max_materials: 20,
    spatial: {
      version: 1,
      region_id: "nirvana",
      map_id: "nirvana:pilot-layout",
      layout_fingerprint: "pilot-layout",
      tile_size: 32,
      landmarks: [{
        id: "quiet-spring",
        name: "Quiet Spring",
        x: 144,
        y: 48,
        affordances: ["energy"],
      }],
      initial_pressure: { populationHighWater: 2, builtFootprintHighWater: 1 },
    },
  }];
  base.agents = [{
    ...(base.agents as Record<string, unknown>[])[0],
    position: "nirvana",
    spatial: {
      version: 1,
      region_id: "nirvana",
      map_id: "nirvana:pilot-layout",
      layout_fingerprint: "pilot-layout",
      x: 16,
      y: 48,
      observed_at: 10,
      at_landmark: null,
      travel: {
        id: "travel-1",
        destination_id: "quiet-spring",
        route: [{ x: 16, y: 48 }, { x: 144, y: 48 }],
        started_at: 10,
        arrives_at: 20,
      },
    },
  }];
  base.homes = [{
    ...(base.homes as Record<string, unknown>[])[0],
    region: "nirvana",
    spatial: {
      version: 1,
      region_id: "nirvana",
      map_id: "nirvana:pilot-layout",
      plot_id: "district-0-plot-1",
      x: 48,
      y: 80,
      door: { x: 48, y: 112 },
    },
  }];
  base.ruins = [];
  base.pending_proposals = [];
  return base;
}

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
