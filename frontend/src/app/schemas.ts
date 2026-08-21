/**
 * A run's lifecycle, exactly as the server reports it on the run-metadata
 * endpoint and on the SSE heartbeat.
 *
 * `ready` is the pre-lifecycle word a process-launched run still uses. The other
 * five are the run-lifecycle contract's own vocabulary: a start answers
 * `starting`, the first breath makes it `running`, a stop (or a replacing start)
 * makes it `stopping`, its single `finally` makes it `stopped`, and a run that
 * raises is marked `failed` by its watcher. All six arrive on the ordinary path,
 * so all six must parse.
 *
 * (The endpoint paths are deliberately not written out here: this module is
 * inside the production scenery entry's import closure, which is guarded against
 * naming the backend at all.)
 */
export type RunStatus =
  | "ready"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

/** Every `RunStatus`, in lifecycle order, for validation at the boundary. */
export const RUN_STATUSES: readonly RunStatus[] = [
  "ready",
  "starting",
  "running",
  "stopping",
  "stopped",
  "failed",
];
export type AgentStatus = "alive" | "paralyzed" | "dead";
export type HomeStatus = "standing" | "ruin";

export interface RunMetadata {
  schema: 1;
  run_id: string;
  seed: number;
  started_at: number;
  status: RunStatus;
  event_cursor: number;
  world_time: number;
  config_hash: string;
  constants: Record<string, number>;
  /**
   * The words this run's beings are born from unless one was written for them.
   *
   * A run constant, declared once here rather than repeated on every being in
   * every checkpoint. `null` when the server did not state it. The snapshot
   * carries its own copy of the same constant, and that is the one a being's
   * absent persona is resolved against — a recorded run is watched with no run
   * metadata at all, so the snapshot has to be able to answer for itself.
   */
  seed_persona: string | null;
  provider: string;
  model: string;
  context_window: number | null;
  timing: Record<string, number>;
  artifacts: {
    events: string;
    usage: string;
    snapshots: string;
    memory_root: string;
    [key: string]: string;
  };
}

export interface AgentSnapshot {
  id: string;
  name: string;
  /**
   * The words this being was born from — always a string here.
   *
   * On the wire it is present only when it *differs* from the run's own
   * `seed_persona`, because the shared genesis words were byte-identical on every
   * being and made up half of every checkpoint. It is resolved back at the parse
   * boundary, so nothing downstream can tell the difference: the same string
   * reaches the being inspector and the same string feeds the appearance hash,
   * which decides a being's colour.
   */
  persona: string;
  position: string;
  energy: number;
  materials: number;
  status: AgentStatus;
  last_mated_at: number | null;
  offspring_count: number;
  died_at: number | null;
  home_id: string | null;
  is_hoarding: boolean;
}

export interface RegionSnapshot {
  name: string;
  description: string;
  connections: string[];
  energy_rate: number;
  materials_rate: number;
  current_energy: number;
  current_materials: number;
  max_energy: number;
  max_materials: number;
}

export interface HomeSnapshot {
  home_id: string;
  owner_id: string;
  region: string;
  integrity: number;
  max_integrity: number;
  built_at: number;
  last_upkeep_at: number;
  last_integrity_at: number;
  stakeholders: string[];
  vault_materials: number;
  status: HomeStatus;
  ruined_at: number | null;
  remnant_materials: number;
  breachers: string[];
  is_hoarding: boolean;
}

export interface PendingProposalSnapshot {
  initiator_id: string;
  target_id: string;
  timestamp: number | null;
  resources: Record<string, number>;
}

export interface RegionPressureHighWater {
  region: string;
  population_high_water: number;
  built_footprint_high_water: number;
}

export interface WorldSnapshot {
  schema: 1;
  run_id: string;
  world_time: number;
  event_cursor: number;
  /**
   * The run's default birth words, stated once instead of once per being.
   *
   * A being that omits its own `persona` is born from exactly these, and the
   * parse resolves it there and then. Absent on a legacy archive, where every
   * being still carries its own copy — which parses to the same result.
   */
  seed_persona?: string | null;
  agents: AgentSnapshot[];
  regions: RegionSnapshot[];
  homes: HomeSnapshot[];
  ruins: HomeSnapshot[];
  pending_proposals: PendingProposalSnapshot[];
  /** Additive observer truth; absent only on legacy schema-1 archives. */
  region_pressure?: RegionPressureHighWater[];
}

export interface SerializedEvent {
  type: string;
  source: string;
  payload: Record<string, unknown>;
  scope: "local" | "global" | "targeted" | "private";
  region: string | null;
  target: string | null;
  timestamp: number;
}

export interface ResolvedEventHints {
  actor_id?: string;
  target_id?: string;
  region?: string;
  home_id?: string;
  amount?: number;
  resource_type?: string;
  [key: string]: string | number | undefined;
}

export interface EventEnvelopeEntry {
  cursor: number;
  event: SerializedEvent;
  resolved: ResolvedEventHints;
  snapshot_after: string | null;
}

export interface EventEnvelope {
  schema: 1;
  cursor: number;
  oldest_cursor: number;
  next_cursor: number;
  events: EventEnvelopeEntry[];
  overflow: boolean;
  snapshot_required: boolean;
}

export function parseRunMetadata(value: unknown): RunMetadata {
  const input = objectOf(value, "run metadata");
  expectSchema(input, "run metadata");
  return {
    schema: 1,
    run_id: stringOf(input.run_id, "run_id"),
    seed: numberOf(input.seed, "seed"),
    started_at: numberOf(input.started_at, "started_at"),
    status: enumOf(input.status, RUN_STATUSES, "status"),
    event_cursor: numberOf(input.event_cursor, "event_cursor"),
    world_time: numberOf(input.world_time, "world_time"),
    config_hash: stringOf(input.config_hash, "config_hash"),
    constants: optionalNumberRecordOf(input.constants),
    seed_persona: input.seed_persona === undefined
      ? null
      : nullableStringOf(input.seed_persona, "seed_persona"),
    provider: stringOf(input.provider, "provider"),
    model: stringOf(input.model, "model"),
    context_window: nullableNumberOf(input.context_window, "context_window"),
    timing: numberRecordOf(input.timing, "timing"),
    artifacts: stringRecordOf(input.artifacts, "artifacts") as RunMetadata["artifacts"],
  };
}

export function parseWorldSnapshot(value: unknown): WorldSnapshot {
  const input = objectOf(value, "world snapshot");
  expectSchema(input, "world snapshot");
  // Absent on a legacy archive, `null` from a run that declares no default: both
  // mean "ask each being for its own words", which a legacy archive can answer.
  const seedPersona = input.seed_persona === undefined
    ? null
    : nullableStringOf(input.seed_persona, "seed_persona");
  const agents = arrayOf(input.agents, (item) => parseAgentSnapshot(item, seedPersona), "agents");
  const regions = arrayOf(input.regions, parseRegionSnapshot, "regions");
  const homes = arrayOf(input.homes, parseHomeSnapshot, "homes");
  const ruins = arrayOf(input.ruins, parseHomeSnapshot, "ruins");
  const pendingProposals = arrayOf(
    input.pending_proposals,
    parsePendingProposal,
    "pending_proposals",
  );
  const snapshot = {
    schema: 1 as const,
    run_id: stringOf(input.run_id, "run_id"),
    world_time: numberOf(input.world_time, "world_time"),
    event_cursor: numberOf(input.event_cursor, "event_cursor"),
    seed_persona: seedPersona,
    agents,
    regions,
    homes,
    ruins,
    pending_proposals: pendingProposals,
  };
  return {
    ...snapshot,
    region_pressure: normalizeRegionPressure(input.region_pressure, snapshot),
  };
}

/** Return strict supplied pressure or a deterministic legacy-record fallback. */
export function normalizeRegionPressure(
  value: unknown,
  snapshot: Pick<WorldSnapshot, "agents" | "regions" | "homes" | "ruins">,
): RegionPressureHighWater[] {
  if (value === undefined) {
    return deriveLegacyRegionPressure(snapshot);
  }
  const knownRegions = new Set(snapshot.regions.map(({ name }) => name));
  const seen = new Set<string>();
  const pressure = arrayOf(
    value,
    (item) => {
      const input = objectOf(item, "region_pressure entry");
      const region = stringOf(input.region, "region_pressure.region");
      if (!knownRegions.has(region)) {
        throw new Error(`region_pressure.region ${region} must name a known exact region`);
      }
      if (seen.has(region)) {
        throw new Error(`region_pressure contains duplicate region ${region}`);
      }
      seen.add(region);
      return {
        region,
        population_high_water: nonNegativeSafeIntegerOf(
          input.population_high_water,
          "region_pressure.population_high_water",
        ),
        built_footprint_high_water: nonNegativeSafeIntegerOf(
          input.built_footprint_high_water,
          "region_pressure.built_footprint_high_water",
        ),
      };
    },
    "region_pressure",
  );
  if (seen.size !== knownRegions.size) {
    const missing = [...knownRegions]
      .filter((region) => !seen.has(region))
      .sort((left, right) => left.localeCompare(right));
    throw new Error(
      `region_pressure must exactly cover known regions; missing ${missing.join(", ")}`,
    );
  }
  return pressure.sort((left, right) => left.region.localeCompare(right.region));
}

function deriveLegacyRegionPressure(
  snapshot: Pick<WorldSnapshot, "agents" | "regions" | "homes" | "ruins">,
): RegionPressureHighWater[] {
  const counts = new Map(
    snapshot.regions.map(({ name }) => [
      name,
      {
        region: name,
        population_high_water: 0,
        built_footprint_high_water: 0,
      },
    ]),
  );
  for (const agent of snapshot.agents) {
    const pressure = counts.get(agent.position);
    if (pressure !== undefined && agent.status !== "dead") {
      pressure.population_high_water += 1;
    }
  }
  for (const home of [...snapshot.homes, ...snapshot.ruins]) {
    const pressure = counts.get(home.region);
    if (pressure !== undefined) {
      pressure.built_footprint_high_water += 1;
    }
  }
  return [...counts.values()].sort((left, right) => left.region.localeCompare(right.region));
}

export function parseEventEnvelope(value: unknown): EventEnvelope {
  const input = objectOf(value, "event envelope");
  expectSchema(input, "event envelope");
  return {
    schema: 1,
    cursor: numberOf(input.cursor, "cursor"),
    oldest_cursor: numberOf(input.oldest_cursor, "oldest_cursor"),
    next_cursor: numberOf(input.next_cursor, "next_cursor"),
    events: arrayOf(input.events, parseEventEnvelopeEntry, "events"),
    overflow: booleanOf(input.overflow, "overflow"),
    snapshot_required: booleanOf(input.snapshot_required, "snapshot_required"),
  };
}

/**
 * Reads one being, resolving an omitted persona against the run's own default.
 *
 * `seedPersona` is the snapshot's `seed_persona`. A being omits its persona when
 * it is exactly those words, so restoring them here keeps every consumer —
 * inspector, appearance hash, chronicle ledger — reading the same string it read
 * when the words were repeated on every being. A being whose persona *differs*
 * still carries its own, and that one wins.
 *
 * @param value - The wire record.
 * @param seedPersona - The run's default birth words, where the snapshot stated
 *   them. Omitted for a record parsed outside a snapshot envelope.
 * @returns The parsed being.
 * @throws Error - When a being publishes no persona and no default was stated,
 *   which is the same refusal this parser has always made rather than guessing.
 */
export function parseAgentSnapshot(
  value: unknown,
  seedPersona?: string | null,
): AgentSnapshot {
  const input = objectOf(value, "agent");
  return {
    id: stringOf(input.id, "agent.id"),
    name: stringOf(input.name, "agent.name"),
    persona: resolvePersona(input.persona, seedPersona),
    position: stringOf(input.position, "agent.position"),
    energy: numberOf(input.energy, "agent.energy"),
    materials: numberOf(input.materials, "agent.materials"),
    status: enumOf(input.status, ["alive", "paralyzed", "dead"], "agent.status"),
    last_mated_at: nullableNumberOf(input.last_mated_at, "agent.last_mated_at"),
    offspring_count: numberOf(input.offspring_count, "agent.offspring_count"),
    died_at: nullableNumberOf(input.died_at, "agent.died_at"),
    home_id: nullableStringOf(input.home_id, "agent.home_id"),
    is_hoarding: booleanOf(input.is_hoarding, "agent.is_hoarding"),
  };
}

/** Returns a being's own words, or the run's default when it published none. */
function resolvePersona(value: unknown, seedPersona: string | null | undefined): string {
  if (value === undefined || value === null) {
    if (typeof seedPersona !== "string") {
      throw new Error("agent.persona is absent and no seed_persona was published");
    }
    return seedPersona;
  }
  return stringOf(value, "agent.persona");
}

function parseRegionSnapshot(value: unknown): RegionSnapshot {
  const input = objectOf(value, "region");
  return {
    name: stringOf(input.name, "region.name"),
    description: stringOf(input.description, "region.description"),
    connections: arrayOf(input.connections, (item) => stringOf(item, "connection"), "connections"),
    energy_rate: numberOf(input.energy_rate, "region.energy_rate"),
    materials_rate: numberOf(input.materials_rate, "region.materials_rate"),
    current_energy: numberOf(input.current_energy, "region.current_energy"),
    current_materials: numberOf(input.current_materials, "region.current_materials"),
    max_energy: numberOf(input.max_energy, "region.max_energy"),
    max_materials: numberOf(input.max_materials, "region.max_materials"),
  };
}

function parseHomeSnapshot(value: unknown): HomeSnapshot {
  const input = objectOf(value, "home");
  return {
    home_id: stringOf(input.home_id, "home.home_id"),
    owner_id: stringOf(input.owner_id, "home.owner_id"),
    region: stringOf(input.region, "home.region"),
    integrity: numberOf(input.integrity, "home.integrity"),
    max_integrity: numberOf(input.max_integrity, "home.max_integrity"),
    built_at: numberOf(input.built_at, "home.built_at"),
    last_upkeep_at: numberOf(input.last_upkeep_at, "home.last_upkeep_at"),
    last_integrity_at: numberOf(input.last_integrity_at, "home.last_integrity_at"),
    stakeholders: arrayOf(
      input.stakeholders,
      (item) => stringOf(item, "home.stakeholder"),
      "home.stakeholders",
    ),
    vault_materials: numberOf(input.vault_materials, "home.vault_materials"),
    status: enumOf(input.status, ["standing", "ruin"], "home.status"),
    ruined_at: nullableNumberOf(input.ruined_at, "home.ruined_at"),
    remnant_materials: nonNegativeNumberOf(input.remnant_materials, "home.remnant_materials"),
    breachers: arrayOf(
      input.breachers,
      (item) => stringOf(item, "home.breacher"),
      "home.breachers",
    ),
    is_hoarding: booleanOf(input.is_hoarding, "home.is_hoarding"),
  };
}

function parsePendingProposal(value: unknown): PendingProposalSnapshot {
  const input = objectOf(value, "pending proposal");
  return {
    initiator_id: stringOf(input.initiator_id, "proposal.initiator_id"),
    target_id: stringOf(input.target_id, "proposal.target_id"),
    timestamp: nullableNumberOf(input.timestamp, "proposal.timestamp"),
    resources: numberRecordOf(input.resources, "proposal.resources"),
  };
}

function parseEventEnvelopeEntry(value: unknown): EventEnvelopeEntry {
  const input = objectOf(value, "event entry");
  return {
    cursor: numberOf(input.cursor, "entry.cursor"),
    event: parseSerializedEvent(input.event),
    resolved: parseResolvedHints(input.resolved),
    snapshot_after: nullableStringOf(input.snapshot_after, "entry.snapshot_after"),
  };
}

function parseSerializedEvent(value: unknown): SerializedEvent {
  const input = objectOf(value, "event");
  return {
    type: stringOf(input.type, "event.type"),
    source: stringOf(input.source, "event.source"),
    payload: objectOf(input.payload, "event.payload"),
    scope: enumOf(input.scope, ["local", "global", "targeted", "private"], "event.scope"),
    region: nullableStringOf(input.region, "event.region"),
    target: nullableStringOf(input.target, "event.target"),
    timestamp: numberOf(input.timestamp, "event.timestamp"),
  };
}

function parseResolvedHints(value: unknown): ResolvedEventHints {
  const input = objectOf(value, "resolved");
  const resolved: ResolvedEventHints = {};
  for (const [key, item] of Object.entries(input)) {
    if (typeof item === "string" || typeof item === "number") {
      resolved[key] = item;
    }
  }
  return resolved;
}

function expectSchema(input: Record<string, unknown>, label: string): void {
  if (input.schema !== 1) {
    throw new Error(`${label} must use schema 1`);
  }
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringOf(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function nullableStringOf(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  return stringOf(value, label);
}

function numberOf(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function nonNegativeNumberOf(value: unknown, label: string): number {
  const parsed = numberOf(value, label);
  if (parsed < 0) throw new Error(`${label} must be non-negative`);
  return parsed;
}

function nonNegativeSafeIntegerOf(value: unknown, label: string): number {
  const parsed = numberOf(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return parsed;
}

function nullableNumberOf(value: unknown, label: string): number | null {
  if (value === null) {
    return null;
  }
  return numberOf(value, label);
}

function booleanOf(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function enumOf<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`${label} must be one of ${allowed.join(", ")}`);
}

function arrayOf<T>(
  value: unknown,
  parser: (item: unknown) => T,
  label: string,
): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map(parser);
}

function numberRecordOf(value: unknown, label: string): Record<string, number> {
  const input = objectOf(value, label);
  const output: Record<string, number> = {};
  for (const [key, item] of Object.entries(input)) {
    output[key] = numberOf(item, `${label}.${key}`);
  }
  return output;
}

function optionalNumberRecordOf(value: unknown): Record<string, number> {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const output: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isFinite(item)) {
      output[key] = item;
    }
  }
  return output;
}

function stringRecordOf(value: unknown, label: string): Record<string, string> {
  const input = objectOf(value, label);
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(input)) {
    output[key] = stringOf(item, `${label}.${key}`);
  }
  return output;
}
