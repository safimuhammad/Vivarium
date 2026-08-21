import type {
  EventEnvelope,
  RunMetadata,
  SerializedEvent,
  WorldSnapshot,
} from "../app/schemas";

export function makeRun(overrides: Partial<RunMetadata> = {}): RunMetadata {
  return {
    schema: 1,
    run_id: "seed-7-test",
    seed: 7,
    started_at: 1_782_948_044.1,
    status: "running",
    event_cursor: 4,
    world_time: 12.5,
    config_hash: "abc123",
    constants: {
      paralysis_energy_threshold: 5,
      home_build_materials_cost: 80,
      home_upkeep_materials_per_second: 0.1,
      hoarding_energy_threshold: 500,
      hoarding_materials_threshold: 300,
      mating_cooldown_seconds: 300,
      ruins_persist_seconds: 120,
    },
    // The fixture beings each carry their own words, so no run default is declared.
    seed_persona: null,
    provider: "ollama",
    model: "llama-test",
    context_window: null,
    timing: {
      pace: 0,
      duration: 10,
      world_tick_interval: 0.05,
      refresh_interval: 0.05,
    },
    artifacts: {
      events: "runs/run_7.jsonl",
      usage: "runs/usage_7.jsonl",
      snapshots: "runs/snapshots_7.jsonl",
      memory_root: "memory",
    },
    ...overrides,
  };
}

export function makeWorld(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    schema: 1,
    run_id: "seed-7-test",
    world_time: 12.5,
    event_cursor: 4,
    // Each being below writes its own words, so this world declares no default —
    // stated explicitly because `parseWorldSnapshot` always resolves the field.
    seed_persona: null,
    agents: [
      {
        id: "agent_001",
        name: "Aster",
        persona: "builder",
        position: "meadow",
        energy: 84,
        materials: 22,
        status: "alive",
        last_mated_at: null,
        offspring_count: 0,
        died_at: null,
        home_id: "home_001",
        is_hoarding: false,
      },
      {
        id: "agent_002",
        name: "Briar",
        persona: "scout",
        position: "grove",
        energy: 4,
        materials: 3,
        status: "paralyzed",
        last_mated_at: 4,
        offspring_count: 1,
        died_at: null,
        home_id: null,
        is_hoarding: false,
      },
    ],
    regions: [
      {
        name: "meadow",
        description: "Open grass and bright seed heads.",
        connections: ["grove"],
        energy_rate: 2,
        materials_rate: 1,
        current_energy: 63,
        current_materials: 21,
        max_energy: 100,
        max_materials: 80,
      },
      {
        name: "grove",
        description: "Thick trunks and shaded roots.",
        connections: ["meadow"],
        energy_rate: 1,
        materials_rate: 2,
        current_energy: 42,
        current_materials: 55,
        max_energy: 90,
        max_materials: 100,
      },
    ],
    homes: [
      {
        home_id: "home_001",
        owner_id: "agent_001",
        region: "meadow",
        integrity: 120,
        max_integrity: 120,
        built_at: 8,
        last_upkeep_at: 11,
        last_integrity_at: 11,
        stakeholders: ["agent_001"],
        vault_materials: 14,
        status: "standing",
        ruined_at: null,
        remnant_materials: 0,
        breachers: [],
        is_hoarding: false,
      },
    ],
    ruins: [
      {
        home_id: "home_old",
        owner_id: "agent_009",
        region: "grove",
        integrity: 0,
        max_integrity: 120,
        built_at: 1,
        last_upkeep_at: 9,
        last_integrity_at: 9,
        stakeholders: ["agent_009"],
        vault_materials: 0,
        status: "ruin",
        ruined_at: 10,
        remnant_materials: 12,
        breachers: ["agent_003"],
        is_hoarding: false,
      },
    ],
    region_pressure: [
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
    ],
    pending_proposals: [
      {
        initiator_id: "agent_001",
        target_id: "agent_002",
        timestamp: 12,
        resources: {
          energy: 8,
          materials: 2,
        },
      },
    ],
    ...overrides,
  };
}

export function makeEventEnvelope(
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  const event: SerializedEvent = {
    type: "speak",
    source: "agent_001",
    payload: {
      message: "Aster calls across the meadow.",
    },
    scope: "local",
    region: "meadow",
    target: null,
    timestamp: 13,
  };
  return {
    schema: 1,
    cursor: 4,
    oldest_cursor: 0,
    next_cursor: 5,
    events: [
      {
        cursor: 5,
        event,
        resolved: {
          actor_id: "agent_001",
          region: "meadow",
        },
        snapshot_after: null,
      },
    ],
    overflow: false,
    snapshot_required: false,
    ...overrides,
  };
}
