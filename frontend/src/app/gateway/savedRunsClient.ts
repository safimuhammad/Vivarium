/** Local recording catalogue; browsing and replay never start inference. */
export interface SavedBeing {
  readonly id: string;
  readonly name: string;
  readonly persona: string | null;
  readonly region: string | null;
  readonly status: string | null;
}

export interface SavedRunSummary {
  readonly id: string;
  readonly name: string;
  readonly started_at: number | null;
  readonly duration_seconds: number;
  readonly event_count: number;
  readonly status: string;
  readonly model: string | null;
  readonly base_url: string;
  readonly agent_count: number;
  readonly living_count: number;
  readonly region_count: number;
  readonly agents: readonly SavedBeing[];
  readonly regions: readonly Readonly<{ id: string; name: string }>[];
}

/** Read the durable local catalogue without downloading replay logs. */
export async function fetchSavedRuns(): Promise<readonly SavedRunSummary[]> {
  const response = await fetch("/api/recordings", { cache: "no-store" });
  if (!response.ok) throw new Error(`Saved runs could not be read (HTTP ${response.status}).`);
  return parseSavedRuns(await response.json());
}

/** Validate the narrow server contract before any file URL is opened. */
export function parseSavedRuns(value: unknown): readonly SavedRunSummary[] {
  if (!isObject(value) || !Array.isArray(value.runs)) throw new Error("Invalid saved-run catalogue.");
  return value.runs.map((run: unknown) => {
    if (!isObject(run) || !isString(run.id) || !isString(run.name)
      || !isString(run.status) || !nullableString(run.model)
      || !(run.started_at === null || finiteNonnegative(run.started_at))
      || !finiteNonnegative(run.duration_seconds) || !finiteNonnegative(run.event_count)
      || !finiteNonnegative(run.agent_count) || !finiteNonnegative(run.living_count)
      || !finiteNonnegative(run.region_count)
      || run.base_url !== `/api/recordings/${encodeURIComponent(run.id)}`
      || !Array.isArray(run.agents) || !Array.isArray(run.regions)
      || !run.agents.every((agent: unknown) => isObject(agent)
        && isString(agent.id) && isString(agent.name) && nullableString(agent.persona)
        && nullableString(agent.region) && nullableString(agent.status))
      || !run.regions.every((region: unknown) => isObject(region) && isString(region.id) && isString(region.name))) {
      throw new Error("Invalid saved-run entry.");
    }
    return run as unknown as SavedRunSummary;
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isString(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function nullableString(value: unknown): value is string | null { return value === null || typeof value === "string"; }
function finiteNonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
