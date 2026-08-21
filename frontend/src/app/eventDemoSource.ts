import {
  EVENT_VISUAL_EVENT_TYPES,
  type EventVisualEventType,
} from "../events/eventVisualCatalog";
import type {
  EventEnvelope,
  EventEnvelopeEntry,
  RunMetadata,
  SerializedEvent,
  WorldSnapshot,
} from "./schemas";
import type { EventStream, EventStreamHandlers, LiveApiClient } from "./client";

export const EVENT_DEMO_SOURCE_QUERY_VALUE = "event-demo";

export interface EventDemoClientOptions {
  intervalMs?: number;
  runId?: string;
  startedAt?: number;
}

const DEFAULT_INTERVAL_MS = 450;
const DEMO_STARTED_AT = 1_783_408_400;
const DEMO_SEED = 707;

export function createEventDemoClient(options: EventDemoClientOptions = {}): LiveApiClient {
  return new EventDemoClient(options);
}

export function isEventDemoSource(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get("source") === EVENT_DEMO_SOURCE_QUERY_VALUE;
}

class EventDemoClient implements LiveApiClient {
  private readonly intervalMs: number;
  private readonly runId: string;
  private readonly startedAt: number;
  private latestCursor = 0;

  constructor(options: EventDemoClientOptions) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.startedAt = options.startedAt ?? DEMO_STARTED_AT;
    this.runId = options.runId ?? `event-demo-${DEMO_SEED}`;
  }

  async getRun(): Promise<RunMetadata> {
    return clone({
      ...demoRun(this.runId, this.startedAt),
      event_cursor: this.latestCursor,
      world_time: demoWorldTime(this.startedAt, this.latestCursor),
    });
  }

  async getWorld(): Promise<WorldSnapshot> {
    return clone({
      ...demoWorld(this.runId),
      event_cursor: this.latestCursor,
      world_time: demoWorldTime(this.startedAt, this.latestCursor),
    });
  }

  async getEvents(cursor: number): Promise<EventEnvelope> {
    const fromCursor = normalizedCursor(cursor);
    const entries = EVENT_VISUAL_EVENT_TYPES
      .map((type, index) => demoEventEntry(index + 1, type, this.runId, this.startedAt))
      .filter((entry) => entry.cursor > fromCursor);
    this.latestCursor = Math.max(this.latestCursor, entries.at(-1)?.cursor ?? fromCursor);
    return clone(demoEnvelope(fromCursor, entries));
  }

  openEventStream(cursor: number, handlers: EventStreamHandlers): EventStream {
    let nextCursor = normalizedCursor(cursor);
    let closed = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const schedule = () => {
      if (closed) {
        return;
      }
      timer = globalThis.setTimeout(() => {
        void tick();
      }, this.intervalMs);
    };
    const tick = async () => {
      if (closed) {
        return;
      }
      const previousCursor = nextCursor;
      nextCursor += 1;
      this.latestCursor = Math.max(this.latestCursor, nextCursor);
      const type = EVENT_VISUAL_EVENT_TYPES[(nextCursor - 1) % EVENT_VISUAL_EVENT_TYPES.length];
      const envelope = demoEnvelope(previousCursor, [
        demoEventEntry(nextCursor, type, this.runId, this.startedAt),
      ]);
      await Promise.resolve(handlers.onEnvelope(clone(envelope))).catch((error: unknown) => {
        handlers.onError?.(error);
      });
      schedule();
    };
    schedule();

    return {
      url: `event-demo://events/stream?cursor=${nextCursor}`,
      close(): void {
        closed = true;
        if (timer !== undefined) {
          globalThis.clearTimeout(timer);
        }
      },
    };
  }
}

function demoRun(runId: string, startedAt: number): RunMetadata {
  return {
    schema: 1,
    run_id: runId,
    seed: DEMO_SEED,
    started_at: startedAt,
    status: "running",
    event_cursor: 0,
    world_time: demoWorldTime(startedAt, 0),
    config_hash: "event-demo",
    // Every demo being is written with its own words, so this run declares no default.
    seed_persona: null,
    constants: {
      paralysis_energy_threshold: 5,
      home_build_materials_cost: 80,
      home_upkeep_materials_per_second: 0.1,
      hoarding_energy_threshold: 500,
      hoarding_materials_threshold: 300,
      mating_cooldown_seconds: 300,
      ruins_persist_seconds: 120,
    },
    provider: "demo",
    model: "event-tour",
    context_window: null,
    timing: {
      pace: 0,
      duration: 0,
      world_tick_interval: 5,
      refresh_interval: 2,
    },
    artifacts: {
      events: "event-demo://events",
      usage: "event-demo://usage",
      snapshots: "event-demo://snapshots",
      memory_root: "event-demo://memory",
    },
  };
}

function demoWorld(runId: string): WorldSnapshot {
  return {
    schema: 1,
    run_id: runId,
    world_time: demoWorldTime(DEMO_STARTED_AT, 0),
    event_cursor: 0,
    agents: [
      {
        id: "agent_001",
        name: "Aster",
        persona: "builder",
        position: "warm_springs",
        energy: 92,
        materials: 88,
        status: "alive",
        last_mated_at: null,
        offspring_count: 1,
        died_at: null,
        home_id: "home_001",
        is_hoarding: false,
      },
      {
        id: "agent_002",
        name: "Briar",
        persona: "scout",
        position: "warm_springs",
        energy: 38,
        materials: 16,
        status: "paralyzed",
        last_mated_at: 1_783_408_390,
        offspring_count: 1,
        died_at: null,
        home_id: "home_001",
        is_hoarding: false,
      },
      {
        id: "agent_003",
        name: "Cinder",
        persona: "raider",
        position: "nirvana_west",
        energy: 68,
        materials: 22,
        status: "alive",
        last_mated_at: null,
        offspring_count: 0,
        died_at: null,
        home_id: null,
        is_hoarding: false,
      },
      {
        id: "agent_004",
        name: "Dawn",
        persona: "keeper",
        position: "nirvana",
        energy: 74,
        materials: 44,
        status: "alive",
        last_mated_at: null,
        offspring_count: 0,
        died_at: null,
        home_id: null,
        is_hoarding: false,
      },
      {
        id: "agent_005",
        name: "Ember",
        persona: "newborn",
        position: "warm_springs",
        energy: 80,
        materials: 48,
        status: "alive",
        last_mated_at: null,
        offspring_count: 0,
        died_at: null,
        home_id: null,
        is_hoarding: false,
      },
    ],
    regions: [
      {
        name: "nirvana",
        description: "a once-heavenly landscape, now thinning and picked-over",
        connections: ["warm_springs", "nirvana_east", "nirvana_west"],
        energy_rate: 0.2,
        materials_rate: 0.2,
        current_energy: 74,
        current_materials: 72,
        max_energy: 120,
        max_materials: 120,
      },
      {
        name: "nirvana_east",
        description: "a struggling, near-barren stretch",
        connections: ["warm_springs", "nirvana"],
        energy_rate: 0.1,
        materials_rate: 0.1,
        current_energy: 26,
        current_materials: 24,
        max_energy: 70,
        max_materials: 70,
      },
      {
        name: "nirvana_west",
        description: "a nuclear wasteland, all but dead",
        connections: ["warm_springs", "nirvana"],
        energy_rate: 0.05,
        materials_rate: 0,
        current_energy: 14,
        current_materials: 0,
        max_energy: 50,
        max_materials: 10,
      },
      {
        name: "warm_springs",
        description: "hot spring lakes, still warm enough to gather around",
        connections: ["nirvana_west", "nirvana_east", "nirvana"],
        energy_rate: 0.25,
        materials_rate: 0.2,
        current_energy: 112,
        current_materials: 95,
        max_energy: 130,
        max_materials: 130,
      },
    ],
    homes: [
      {
        home_id: "home_001",
        owner_id: "agent_001",
        region: "warm_springs",
        integrity: 112,
        max_integrity: 140,
        built_at: 1_783_408_210,
        last_upkeep_at: 1_783_408_390,
        last_integrity_at: 1_783_408_390,
        stakeholders: ["agent_001", "agent_002"],
        vault_materials: 92,
        status: "standing",
        ruined_at: null,
        remnant_materials: 0,
        breachers: ["agent_003"],
        is_hoarding: false,
      },
      {
        home_id: "home_002",
        owner_id: "agent_004",
        region: "nirvana",
        integrity: 46,
        max_integrity: 120,
        built_at: 1_783_408_240,
        last_upkeep_at: 1_783_408_360,
        last_integrity_at: 1_783_408_360,
        stakeholders: ["agent_004"],
        vault_materials: 360,
        status: "standing",
        ruined_at: null,
        remnant_materials: 0,
        breachers: [],
        is_hoarding: true,
      },
    ],
    ruins: [
      {
        home_id: "home_old",
        owner_id: "agent_009",
        region: "nirvana_west",
        integrity: 0,
        max_integrity: 120,
        built_at: 1_783_407_900,
        last_upkeep_at: 1_783_408_100,
        last_integrity_at: 1_783_408_100,
        stakeholders: ["agent_009"],
        vault_materials: 0,
        status: "ruin",
        ruined_at: 1_783_408_300,
        remnant_materials: 64,
        breachers: ["agent_003"],
        is_hoarding: false,
      },
    ],
    pending_proposals: [
      {
        initiator_id: "agent_001",
        target_id: "agent_002",
        timestamp: 1_783_408_380,
        resources: {
          energy: 50,
          materials: 30,
        },
      },
    ],
  };
}

function demoEventEntry(
  cursor: number,
  type: EventVisualEventType,
  runId: string,
  startedAt: number,
): EventEnvelopeEntry {
  const timestamp = demoWorldTime(startedAt, cursor);
  const event = demoEvent(type, runId, timestamp);
  return {
    cursor,
    event,
    resolved: {
      actor_id: resolvedActor(type, event),
      target_id: resolvedTarget(type, event),
      region: event.region ?? payloadString(event, "region") ?? undefined,
      home_id: payloadString(event, "home_id", "target_home"),
      amount: payloadNumber(event, "amount") ?? payloadNumber(event, "energy_gained"),
      resource_type: payloadString(event, "resource_type") ?? (
        type === "home_thieved" || type === "ruins_scavenged" ? "materials" : undefined
      ),
    },
    snapshot_after: null,
  };
}

function demoEvent(type: EventVisualEventType, runId: string, timestamp: number): SerializedEvent {
  const base = {
    type,
    timestamp,
  };
  switch (type) {
    case "simulation_started":
      return {
        ...base,
        source: "world",
        payload: {
          run_id: runId,
          agent_count: 5,
          world_time: timestamp,
          message: "The world woke with five beings.",
        },
        scope: "global",
        region: null,
        target: null,
      };
    case "agent_left_region":
      return localEvent(base, "agent_001", "warm_springs", {
        agent_id: "agent_001",
        from_region: "warm_springs",
        to_region: "nirvana",
        move_energy_cost: 5,
        agent_energy: 87,
      });
    case "agent_entered_region":
      return localEvent(base, "agent_001", "nirvana", {
        agent_id: "agent_001",
        from_region: "warm_springs",
        to_region: "nirvana",
        move_energy_cost: 5,
        agent_energy: 87,
      });
    case "speak":
      return targetedEvent(base, "agent_001", "agent_002", "warm_springs", {
        speaker_id: "agent_001",
        target_id: "agent_002",
        message: "Briar, keep close to the hearth; I can see Cinder moving near the west path.",
        speak_energy_cost: 0.5,
      });
    case "self_talk":
      return {
        ...base,
        source: "agent_004",
        payload: {
          agent_id: "agent_004",
          message: "The vault is too full and the threshold feels watched.",
        },
        scope: "private",
        region: null,
        target: null,
      };
    case "resource_changed":
      return localEvent(base, "agent_001", "warm_springs", {
        agent_id: "agent_001",
        region: "warm_springs",
        resource_type: "materials",
        amount: 20,
        agent_energy: 92,
        agent_materials: 108,
        region_energy: 112,
        region_materials: 75,
      });
    case "resource_transferred":
      return targetedEvent(base, "agent_001", "agent_002", "warm_springs", {
        sender_id: "agent_001",
        receiver_id: "agent_002",
        resource_type: "energy",
        amount: 16,
        sender_energy: 76,
        receiver_energy: 54,
      });
    case "agent_recovered":
      return targetedEvent(base, "agent_001", "agent_002", "warm_springs", {
        giver_id: "agent_001",
        revived_id: "agent_002",
        resource_type: "energy",
        amount: 16,
      });
    case "agent_paralyzed":
      return localEvent(base, "system", "warm_springs", {
        agent_id: "agent_002",
        victim_id: "agent_002",
        attacker_id: "agent_003",
        region: "warm_springs",
      }, "agent_002");
    case "agent_died":
      return localEvent(base, "agent_002", "warm_springs", {
        victim_id: "agent_002",
        killer_id: "agent_003",
        region: "warm_springs",
      }, "agent_002");
    case "agent_decayed":
      return localEvent(base, "world", "warm_springs", {
        agent_id: "agent_002",
        agent_name: "Briar",
        region: "warm_springs",
      });
    case "agent_born":
      return localEvent(base, "agent_005", "warm_springs", {
        child_id: "agent_005",
        child_name: "Ember",
        parent_ids: ["agent_001", "agent_002"],
        initiator_id: "agent_001",
        acceptor_id: "agent_002",
        region: "warm_springs",
        committed_resources: { energy: 100, materials: 60 },
        child_resources: { energy: 80, materials: 48 },
        offspring_multiplier: 1.6,
      });
    case "agent_started_hoarding":
      return localEvent(base, "agent_003", "nirvana_west", {
        agent_id: "agent_003",
        region: "nirvana_west",
        resource_type: "materials",
        amount: 325,
      });
    case "mating_initiated":
      return targetedEvent(base, "agent_001", "agent_002", "warm_springs", {
        initiator_id: "agent_001",
        target_id: "agent_002",
        resources: { energy: 50, materials: 30 },
        proposal_timestamp: timestamp,
        initiator_energy: 42,
        initiator_materials: 58,
      });
    case "mating_rejected":
      return targetedEvent(base, "agent_002", "agent_001", "warm_springs", {
        rejecter_id: "agent_002",
        initiator_id: "agent_001",
        target_id: "agent_002",
        resources_refunded: { energy: 50, materials: 30 },
      });
    case "mating_proposal_invalidated":
      return targetedEvent(base, "agent_001", "agent_001", "warm_springs", {
        initiator_id: "agent_001",
        target_id: "agent_002",
        reason: "target no longer eligible",
        resources_refunded: { energy: 50, materials: 30 },
      });
    case "mating_proposal_timeout":
      return targetedEvent(base, "agent_001", "agent_001", "warm_springs", {
        initiator_id: "agent_001",
        target_id: "agent_002",
        reason: "proposal expired",
        resources_refunded: { energy: 50, materials: 30 },
      });
    case "attack":
      return targetedEvent(base, "agent_003", "agent_002", "warm_springs", {
        attacker_id: "agent_003",
        victim_id: "agent_002",
        region: "warm_springs",
        damage: 30,
        attack_energy_cost: 10,
      });
    case "home_built":
      return localEvent(base, "agent_001", "warm_springs", {
        builder_id: "agent_001",
        owner_id: "agent_001",
        home_id: "home_001",
        target_home: "home_001",
        region: "warm_springs",
        materials_cost: 80,
      });
    case "hearth_used":
      return localEvent(base, "agent_001", "warm_springs", {
        agent_id: "agent_001",
        home_id: "home_001",
        target_home: "home_001",
        region: "warm_springs",
        materials_burned: 12,
        energy_gained: 12,
        agent_energy: 104,
        agent_materials: 76,
      });
    case "home_joined":
      return localEvent(base, "agent_002", "warm_springs", {
        agent_id: "agent_002",
        home_id: "home_001",
        target_home: "home_001",
        region: "warm_springs",
        stakeholders: ["agent_001", "agent_002"],
      });
    case "home_left":
      return localEvent(base, "agent_002", "warm_springs", {
        agent_id: "agent_002",
        home_id: "home_001",
        target_home: "home_001",
        region: "warm_springs",
      });
    case "home_started_hoarding":
      return localEvent(base, "agent_004", "nirvana", {
        home_id: "home_002",
        target_home: "home_002",
        region: "nirvana",
        vault_materials: 360,
      });
    case "home_collapsed":
      return localEvent(base, "agent_004", "nirvana", {
        home_id: "home_002",
        target_home: "home_002",
        region: "nirvana",
        ruined_at: timestamp,
      });
    case "home_breached":
      return localEvent(base, "agent_003", "warm_springs", {
        home_id: "home_001",
        target_home: "home_001",
        breacher_id: "agent_003",
        intent: "thieve",
        region: "warm_springs",
        breachers: ["agent_003"],
        energy_cost: 15,
        materials_cost: 10,
        integrity_damage: 25,
        integrity: 0,
      });
    case "home_thieved":
      return localEvent(base, "agent_003", "warm_springs", {
        home_id: "home_001",
        target_home: "home_001",
        breacher_id: "agent_003",
        intent: "thieve",
        region: "warm_springs",
        recipients: ["agent_003"],
        loot: { materials: 64 },
        loot_shares: { agent_003: 64 },
        vault_materials: 0,
        integrity: 0,
      });
    case "home_colonized":
      return localEvent(base, "agent_003", "warm_springs", {
        home_id: "home_001",
        target_home: "home_001",
        breacher_id: "agent_003",
        intent: "colonize",
        region: "warm_springs",
        new_owner_id: "agent_003",
        new_stakeholders: ["agent_003"],
        evicted_stakeholders: ["agent_001", "agent_002"],
      });
    case "ruins_scavenged":
      return localEvent(base, "agent_004", "nirvana_west", {
        agent_id: "agent_004",
        home_id: "home_old",
        target_home: "home_old",
        region: "nirvana_west",
        resource_type: "materials",
        amount: 18,
      });
  }
}

function localEvent(
  base: Pick<SerializedEvent, "type" | "timestamp">,
  source: string,
  region: string,
  payload: Record<string, unknown>,
  target: string | null = null,
): SerializedEvent {
  return {
    ...base,
    source,
    payload,
    scope: "local",
    region,
    target,
  };
}

function targetedEvent(
  base: Pick<SerializedEvent, "type" | "timestamp">,
  source: string,
  target: string,
  region: string,
  payload: Record<string, unknown>,
): SerializedEvent {
  return {
    ...base,
    source,
    payload,
    scope: "targeted",
    region,
    target,
  };
}

function demoEnvelope(cursor: number, events: EventEnvelopeEntry[]): EventEnvelope {
  return {
    schema: 1,
    cursor,
    oldest_cursor: 0,
    next_cursor: events.at(-1)?.cursor ?? cursor,
    events,
    overflow: false,
    snapshot_required: false,
  };
}

function demoWorldTime(startedAt: number, cursor: number): number {
  return startedAt + cursor * 7.5;
}

function normalizedCursor(cursor: number): number {
  return Number.isFinite(cursor) && cursor > 0 ? Math.floor(cursor) : 0;
}

function resolvedActor(type: EventVisualEventType, event: SerializedEvent): string | undefined {
  switch (type) {
    case "agent_died":
    case "agent_paralyzed":
    case "attack":
    case "home_breached":
    case "home_thieved":
    case "home_colonized":
      return payloadString(event, "attacker_id", "killer_id", "breacher_id") ?? event.source;
    case "agent_decayed":
      return payloadString(event, "agent_id");
    case "simulation_started":
      return undefined;
    default:
      return payloadString(
        event,
        "agent_id",
        "speaker_id",
        "sender_id",
        "giver_id",
        "builder_id",
        "owner_id",
        "initiator_id",
        "rejecter_id",
        "child_id",
      ) ?? event.source;
  }
}

function resolvedTarget(type: EventVisualEventType, event: SerializedEvent): string | undefined {
  switch (type) {
    case "agent_died":
    case "agent_paralyzed":
    case "attack":
      return payloadString(event, "victim_id", "agent_id") ?? event.target ?? undefined;
    default:
      return payloadString(event, "target_id", "receiver_id", "revived_id") ?? event.target ?? undefined;
  }
}

function payloadString(event: SerializedEvent, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = event.payload[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function payloadNumber(event: SerializedEvent, key: string): number | undefined {
  const value = event.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
