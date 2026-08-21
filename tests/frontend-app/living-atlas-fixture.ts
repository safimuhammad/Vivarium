import type { Page } from "@playwright/test";

export const LIVING_ATLAS_CAPTURE_CURSOR = 40;
export const LIVING_ATLAS_RUN_ID = "living-atlas-task8-seed-704";

export const livingAtlasRun = {
  schema: 1,
  run_id: LIVING_ATLAS_RUN_ID,
  seed: 704,
  started_at: 1_783_408_044.1,
  status: "running",
  event_cursor: LIVING_ATLAS_CAPTURE_CURSOR,
  world_time: 84,
  config_hash: "living-atlas-task8-config-v1",
  constants: {
    paralysis_energy_threshold: 5,
    home_build_materials_cost: 80,
    home_upkeep_materials_per_second: 0.1,
    hoarding_energy_threshold: 500,
    hoarding_materials_threshold: 300,
    mating_cooldown_seconds: 300,
    ruins_persist_seconds: 120,
  },
  provider: "capture-fixture",
  model: "observer-only",
  context_window: null,
  timing: { pace: 0, duration: 10, world_tick_interval: 0.05, refresh_interval: 0.05 },
  artifacts: {
    events: "runs/task8-events.jsonl",
    usage: "runs/task8-usage.jsonl",
    snapshots: "runs/task8-snapshots.jsonl",
    memory_root: "memory",
  },
};

const canonicalRegions = [
  {
    name: "nirvana",
    description: "A once-heavenly landscape, now thinning and picked-over.",
    connections: [
      "nirvana_east",
      "nirvana_west",
      "warm_springs",
      "mossward",
      "quiet_coast",
      "ember_reach",
      "salt_scrub",
    ],
    energy_rate: 0.2,
    materials_rate: 0.2,
    current_energy: 60,
    current_materials: 60,
    max_energy: 120,
    max_materials: 120,
  },
  {
    name: "nirvana_east",
    description: "A struggling, near-barren stretch.",
    connections: ["nirvana", "warm_springs", "quiet_coast"],
    energy_rate: 0.1,
    materials_rate: 0.1,
    current_energy: 20,
    current_materials: 15,
    max_energy: 70,
    max_materials: 70,
  },
  {
    name: "nirvana_west",
    description: "A nuclear wasteland, all but dead.",
    connections: ["nirvana"],
    energy_rate: 0.05,
    materials_rate: 0,
    current_energy: 15,
    current_materials: 0,
    max_energy: 50,
    max_materials: 10,
  },
  {
    name: "warm_springs",
    description: "Hot spring lakes and green terraces form the least-poor refuge.",
    connections: ["nirvana", "nirvana_east", "quiet_coast"],
    energy_rate: 0.25,
    materials_rate: 0.2,
    current_energy: 90,
    current_materials: 80,
    max_energy: 130,
    max_materials: 130,
  },
  {
    name: "mossward",
    description: "A thinning, picked-over heartland of moss and old pines.",
    connections: ["nirvana"],
    energy_rate: 0.15,
    materials_rate: 0.18,
    current_energy: 44,
    current_materials: 39,
    max_energy: 100,
    max_materials: 95,
  },
  {
    name: "quiet_coast",
    description: "An unfamiliar temperate coast with low woodland and meadow.",
    connections: ["nirvana", "nirvana_east", "warm_springs"],
    energy_rate: 0.14,
    materials_rate: 0.12,
    current_energy: 52,
    current_materials: 34,
    max_energy: 100,
    max_materials: 90,
  },
  {
    name: "ember_reach",
    description: "A blasted nuclear wasteland, black stone and all but dead.",
    connections: ["nirvana"],
    energy_rate: 0.04,
    materials_rate: 0.06,
    current_energy: 8,
    current_materials: 18,
    max_energy: 45,
    max_materials: 60,
  },
  {
    name: "salt_scrub",
    description: "A struggling barren salt flat with thorn scrub and dry gullies.",
    connections: ["nirvana"],
    energy_rate: 0.08,
    materials_rate: 0.11,
    current_energy: 18,
    current_materials: 32,
    max_energy: 75,
    max_materials: 80,
  },
];

const agent = (
  id: string,
  name: string,
  position: string,
  energy: number,
  status: "alive" | "paralyzed" | "dead",
  homeId: string | null = null,
) => ({
  id,
  name,
  persona: "observer-facing mystic",
  position,
  energy,
  materials: 0,
  status,
  last_mated_at: null,
  offspring_count: 0,
  died_at: status === "dead" ? 72 : null,
  home_id: homeId,
  is_hoarding: false,
});

export const livingAtlasWorld = {
  schema: 1,
  run_id: LIVING_ATLAS_RUN_ID,
  world_time: 84,
  event_cursor: LIVING_ATLAS_CAPTURE_CURSOR,
  agents: [
    agent("agent_healthy", "Aster", "warm_springs", 84, "alive", "home_001"),
    agent("agent_weary", "Briar", "nirvana", 12, "alive"),
    agent("agent_fallen", "Cinder", "nirvana_east", 4, "paralyzed"),
    agent("agent_dead", "Dusk", "nirvana_west", 0, "dead"),
    agent("agent_moss", "Eira", "mossward", 47, "alive"),
    agent("agent_coast", "Fenn", "quiet_coast", 61, "alive"),
    agent("agent_ember", "Galen", "ember_reach", 28, "alive"),
    agent("agent_salt", "Hale", "salt_scrub", 33, "alive", "home_002"),
  ],
  regions: canonicalRegions,
  homes: [
    {
      home_id: "home_001",
      owner_id: "agent_healthy",
      region: "warm_springs",
      integrity: 120,
      max_integrity: 120,
      built_at: 8,
      last_upkeep_at: 80,
      last_integrity_at: 80,
      stakeholders: ["agent_healthy"],
      vault_materials: 14,
      status: "standing",
      ruined_at: null,
      remnant_materials: 0,
      breachers: [],
      is_hoarding: false,
    },
    {
      home_id: "home_002",
      owner_id: "agent_salt",
      region: "salt_scrub",
      integrity: 82,
      max_integrity: 120,
      built_at: 35,
      last_upkeep_at: 79,
      last_integrity_at: 79,
      stakeholders: ["agent_salt"],
      vault_materials: 26,
      status: "standing",
      ruined_at: null,
      remnant_materials: 0,
      breachers: ["agent_ember"],
      is_hoarding: false,
    },
  ],
  ruins: [
    {
      home_id: "home_old",
      owner_id: "agent_dead",
      region: "nirvana_west",
      integrity: 0,
      max_integrity: 120,
      built_at: 1,
      last_upkeep_at: 48,
      last_integrity_at: 48,
      stakeholders: ["agent_dead"],
      vault_materials: 0,
      status: "ruin",
      ruined_at: 52,
      remnant_materials: 64,
      breachers: ["agent_ember"],
      is_hoarding: false,
    },
  ],
  pending_proposals: [],
};

export const livingAtlasStoryEnvelope = {
  schema: 1,
  cursor: LIVING_ATLAS_CAPTURE_CURSOR,
  oldest_cursor: 0,
  next_cursor: LIVING_ATLAS_CAPTURE_CURSOR + 4,
  events: [
    {
      cursor: LIVING_ATLAS_CAPTURE_CURSOR + 1,
      event: {
        type: "speak",
        source: "agent_healthy",
        payload: { speaker_id: "agent_healthy", message: "Aster calls across the spring terraces." },
        scope: "local",
        region: "warm_springs",
        target: null,
        timestamp: 84.1,
      },
      resolved: { actor_id: "agent_healthy", region: "warm_springs" },
      snapshot_after: null,
    },
    {
      cursor: LIVING_ATLAS_CAPTURE_CURSOR + 2,
      event: {
        type: "attack",
        source: "agent_ember",
        payload: {
          attacker_id: "agent_ember",
          victim_id: "agent_salt",
          target_id: "agent_salt",
          region: "salt_scrub",
          damage: 9,
        },
        scope: "local",
        region: "salt_scrub",
        target: "agent_salt",
        timestamp: 84.2,
      },
      resolved: { actor_id: "agent_ember", target_id: "agent_salt", region: "salt_scrub" },
      snapshot_after: null,
    },
    {
      cursor: LIVING_ATLAS_CAPTURE_CURSOR + 3,
      event: {
        type: "hearth_used",
        source: "agent_healthy",
        payload: {
          agent_id: "agent_healthy",
          home_id: "home_001",
          target_home: "home_001",
          region: "warm_springs",
          materials_burned: 8,
          energy_gained: 8,
        },
        scope: "local",
        region: "warm_springs",
        target: null,
        timestamp: 84.3,
      },
      resolved: { actor_id: "agent_healthy", home_id: "home_001", region: "warm_springs" },
      snapshot_after: null,
    },
  ],
  overflow: false,
  snapshot_required: false,
};

export const livingAtlasRecoveryEnvelope = {
  schema: 1,
  cursor: LIVING_ATLAS_CAPTURE_CURSOR,
  oldest_cursor: 0,
  next_cursor: LIVING_ATLAS_CAPTURE_CURSOR + 2,
  events: [
    {
      cursor: LIVING_ATLAS_CAPTURE_CURSOR + 1,
      event: {
        type: "agent_recovered",
        source: "agent_healthy",
        payload: {
          giver_id: "agent_healthy",
          recipient_id: "agent_fallen",
          revived_id: "agent_fallen",
          region: "nirvana_east",
          resource_type: "energy",
          amount: 4,
          giver_energy: 80,
          revived_energy: 8,
        },
        scope: "local",
        region: "nirvana_east",
        target: "agent_fallen",
        timestamp: 84.1,
      },
      resolved: {
        actor_id: "agent_healthy",
        target_id: "agent_fallen",
        region: "nirvana_east",
        resource_type: "energy",
        amount: 4,
      },
      snapshot_after: null,
    },
  ],
  overflow: false,
  snapshot_required: false,
};

export interface LivingAtlasFixtureOptions {
  viewport: { width: number; height: number };
  reducedMotion?: "reduce" | "no-preference";
  world?: typeof livingAtlasWorld;
  routePath?: string;
}

export async function installLivingAtlasFixture(
  page: Page,
  options: LivingAtlasFixtureOptions,
): Promise<void> {
  await page.setViewportSize(options.viewport);
  await page.emulateMedia({ reducedMotion: options.reducedMotion ?? "no-preference" });
  await page.addInitScript(() => {
    const sources: Array<{ dispatch: (type: string, body: unknown) => void }> = [];
    window.__vivariumDispatchCaptureEvent = (body: unknown) => {
      for (const source of sources) source.dispatch("events", body);
    };
    class QuietCaptureEventSource {
      readonly url: string;
      readonly readyState = 1;
      private readonly listeners = new Map<string, EventListener[]>();

      constructor(url: string) {
        this.url = url;
        sources.push(this);
      }

      addEventListener(type: string, listener: EventListener): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
      }

      dispatch(type: string, body: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) {
          listener({ data: JSON.stringify(body) } as MessageEvent);
        }
      }

      close(): void {
        // The fixture is page-scoped; Playwright owns final disposal.
      }
    }
    window.EventSource = QuietCaptureEventSource as unknown as typeof EventSource;
  });

  const fixtureWorld = options.world ?? livingAtlasWorld;
  const checkpoint = {
    schema: 1,
    type: "world_snapshot_checkpoint",
    reason: "manual",
    run_id: LIVING_ATLAS_RUN_ID,
    world_time: fixtureWorld.world_time,
    event_cursor: fixtureWorld.event_cursor,
    snapshot: fixtureWorld,
  };
  const archiveEvent = livingAtlasStoryEnvelope.events[0];

  await page.route("**/api/run", (route) => route.fulfill({ json: livingAtlasRun }));
  await page.route("**/api/world", (route) => route.fulfill({ json: fixtureWorld }));
  await page.route("**/api/replay/manifest", (route) => route.fulfill({
    json: {
      schema: 1,
      run_id: LIVING_ATLAS_RUN_ID,
      events: { count: 1, first_cursor: 1, last_cursor: 1 },
      checkpoints: {
        count: 1,
        first_line: 1,
        last_line: 1,
        first_event_cursor: fixtureWorld.event_cursor,
        last_event_cursor: fixtureWorld.event_cursor,
      },
      bootstrap: { event_after: 0, event_limit: 512 },
    },
  }));
  await page.route("**/api/replay/events?*", (route) => {
    const url = new URL(route.request().url());
    const after = Number(url.searchParams.get("after") ?? 0);
    const events = after < 1 ? [archiveEvent] : [];
    return route.fulfill({
      json: {
        schema: 1,
        run_id: LIVING_ATLAS_RUN_ID,
        after,
        next_after: events.length > 0 ? 1 : after,
        has_more: false,
        events,
      },
    });
  });
  await page.route("**/api/replay/checkpoints/latest", (route) => route.fulfill({
    json: { schema: 1, run_id: LIVING_ATLAS_RUN_ID, line: 1, checkpoint },
  }));
  await page.route("**/api/replay/checkpoints?*", (route) => route.fulfill({
    json: {
      schema: 1,
      run_id: LIVING_ATLAS_RUN_ID,
      before: 2,
      next_before: 1,
      has_more: false,
      checkpoints: [{ line: 1, checkpoint }],
    },
  }));
  await page.route("**/api/replay/artifacts/events", (route) => route.fulfill({
    contentType: "application/x-ndjson",
    body: `${JSON.stringify(archiveEvent.event)}\n`,
  }));
  await page.route("**/api/replay/artifacts/snapshots", (route) => route.fulfill({
    contentType: "application/x-ndjson",
    body: `${JSON.stringify(checkpoint)}\n`,
  }));

  const routePath = options.routePath ?? "/";
  await page.goto(routePath);
  if (new URL(routePath, "http://127.0.0.1").searchParams.get("renderer") === "2d") {
    await page.waitForFunction((cursor) => {
      const app = document.querySelector(".vivarium-2d-app");
      const stage = document.querySelector(".presentation-world-stage");
      return app?.getAttribute("data-presented-cursor") === String(cursor)
        && stage?.getAttribute("data-ready") === "true";
    }, fixtureWorld.event_cursor);
  } else {
    await page.waitForFunction((cursor) => (
      window.__vivariumWorld?.isReady === true
      && window.__vivariumLiveRun?.diagnostics().lastAcceptedSnapshotCursor === cursor
    ), fixtureWorld.event_cursor);
  }
}
