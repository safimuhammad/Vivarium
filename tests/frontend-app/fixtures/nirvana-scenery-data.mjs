/** Canonical provider-free data for the exact Nirvana scenery review route. */

export const NIRVANA_SCENERY_RUN_ID = "nirvana-scenery-seed-401";

export const NIRVANA_SCENERY_REGIONS = deepFreeze([
  {
    name: "nirvana",
    description: "a once-heavenly landscape, now thinning and picked-over",
    connections: ["warm_springs", "nirvana_east", "nirvana_west"],
    energy_rate: 0.2,
    materials_rate: 0.2,
    current_energy: 60,
    current_materials: 60,
    max_energy: 120,
    max_materials: 120,
  },
  {
    name: "nirvana_east",
    description: "a struggling, near-barren stretch",
    connections: ["warm_springs", "nirvana"],
    energy_rate: 0.1,
    materials_rate: 0.1,
    current_energy: 20,
    current_materials: 15,
    max_energy: 70,
    max_materials: 70,
  },
  {
    name: "warm_springs",
    description: "hot spring lakes — the least-poor refuge, but no longer plentiful",
    connections: ["nirvana_west", "nirvana_east", "nirvana"],
    energy_rate: 0.25,
    materials_rate: 0.2,
    current_energy: 90,
    current_materials: 80,
    max_energy: 130,
    max_materials: 130,
  },
  {
    name: "nirvana_west",
    description: "a nuclear wasteland, all but dead",
    connections: ["warm_springs", "nirvana"],
    energy_rate: 0.05,
    materials_rate: 0,
    current_energy: 15,
    current_materials: 0,
    max_energy: 50,
    max_materials: 10,
  },
]);

export const NIRVANA_SCENERY_RUN = deepFreeze({
  schema: 1,
  run_id: NIRVANA_SCENERY_RUN_ID,
  seed: 401,
  started_at: 0,
  status: "running",
  event_cursor: 0,
  world_time: 0,
  config_hash: "nirvana-scenery-config-v1",
  constants: {
    paralysis_energy_threshold: 5,
    home_build_materials_cost: 80,
    home_upkeep_materials_per_second: 0.1,
    hoarding_energy_threshold: 500,
    hoarding_materials_threshold: 300,
    mating_cooldown_seconds: 300,
    ruins_persist_seconds: 120,
  },
  provider: "none",
  model: "none",
  context_window: null,
  timing: {
    pace: 0,
    duration: 0,
    world_tick_interval: 1,
    refresh_interval: 1,
  },
  artifacts: {
    events: "fixture://nirvana-scenery/events.jsonl",
    usage: "fixture://nirvana-scenery/usage.jsonl",
    snapshots: "fixture://nirvana-scenery/snapshots.jsonl",
    memory_root: "fixture://nirvana-scenery/memory",
  },
});

export const NIRVANA_SCENERY_WORLD = deepFreeze({
  schema: 1,
  run_id: NIRVANA_SCENERY_RUN_ID,
  world_time: 0,
  event_cursor: 0,
  agents: [],
  regions: NIRVANA_SCENERY_REGIONS,
  homes: [],
  ruins: [],
  pending_proposals: [],
});

export const NIRVANA_SCENERY_CHECKPOINT = deepFreeze({
  schema: 1,
  type: "world_snapshot_checkpoint",
  reason: "nirvana-scenery-review",
  run_id: NIRVANA_SCENERY_RUN_ID,
  world_time: 0,
  event_cursor: 0,
  snapshot: NIRVANA_SCENERY_WORLD,
});

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    return Object.freeze(value);
  }
  return value;
}
