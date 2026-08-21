import type { WorldSnapshot } from "./schemas";

export const EVENT_CONTEXT_FALLBACK_SNAPSHOT_LIMIT = 4;

export function rememberEventContextFallbackSnapshot(
  previous: readonly WorldSnapshot[],
  snapshot: WorldSnapshot,
  limit = EVENT_CONTEXT_FALLBACK_SNAPSHOT_LIMIT,
): WorldSnapshot[] {
  return [
    snapshot,
    ...previous.filter((candidate) => candidate !== snapshot),
  ].slice(0, limit);
}
