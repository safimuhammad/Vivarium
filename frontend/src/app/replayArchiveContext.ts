import {
  eventPresentationContextFromSnapshots,
  type EventPresentationContext,
  type RelatedEventIds,
} from "./eventPresentation";
import type { SnapshotCheckpoint } from "./replayArtifacts";
import type { WorldSnapshot } from "./schemas";

export interface ArchivePresentationContextIndexOptions {
  checkpoints: readonly SnapshotCheckpoint[];
  previewSnapshot?: WorldSnapshot | null;
}

export interface ArchivePresentationContextIndex {
  contextForCursor(cursor: number): EventPresentationContext;
  provenanceForEvent(
    cursor: number,
    related: RelatedEventIds,
  ): ArchivePresentationProvenance;
}

export type ArchiveContextSourceKind = "checkpoint" | "preview_snapshot";

export interface ArchiveContextSourceProvenance {
  sourceKind: ArchiveContextSourceKind;
  checkpointIndex: number | null;
  lineNumber: number | null;
  eventCursor: number;
  worldTime: number;
  reason: string;
  runId: string;
}

export interface ArchivePresentationProvenance {
  primary: ArchiveContextSourceProvenance | null;
  fallbacks: ArchiveContextSourceProvenance[];
  presentationSource: ArchiveContextSourceProvenance | null;
}

interface ArchiveContextSource {
  eventCursor: number;
  sourceOrder: number;
  snapshot: WorldSnapshot;
  provenance: ArchiveContextSourceProvenance;
}

export function createArchivePresentationContextIndex({
  checkpoints,
  previewSnapshot = null,
}: ArchivePresentationContextIndexOptions): ArchivePresentationContextIndex {
  const sources = buildSortedContextSources(checkpoints, previewSnapshot);
  const contextsByCursor = new Map<number, EventPresentationContext>();

  return {
    contextForCursor(cursor: number): EventPresentationContext {
      const cached = contextsByCursor.get(cursor);
      if (cached) {
        return cached;
      }
      const eligible = eligibleSourcesForCursor(sources, cursor)
        .map((source) => source.snapshot);
      const [primary = null, ...fallbacks] = eligible;
      const context = eventPresentationContextFromSnapshots(primary, fallbacks);
      contextsByCursor.set(cursor, context);
      return context;
    },
    provenanceForEvent(
      cursor: number,
      related: RelatedEventIds,
    ): ArchivePresentationProvenance {
      const eligible = eligibleSourcesForCursor(sources, cursor);
      const [primarySource = null, ...fallbackSources] = eligible;
      const presentationSource = sourceForRelatedIds(eligible, related);
      return {
        primary: primarySource ? primarySource.provenance : null,
        fallbacks: fallbackSources.map((source) => source.provenance),
        presentationSource: presentationSource ? presentationSource.provenance : null,
      };
    },
  };
}

function buildSortedContextSources(
  checkpoints: readonly SnapshotCheckpoint[],
  previewSnapshot: WorldSnapshot | null,
): ArchiveContextSource[] {
  const checkpointSources = checkpoints.map((checkpoint, index): ArchiveContextSource => ({
    eventCursor: checkpoint.event_cursor,
    sourceOrder: index,
    snapshot: checkpoint.snapshot,
    provenance: {
      sourceKind: "checkpoint",
      checkpointIndex: index,
      lineNumber: checkpoint.lineNumber ?? null,
      eventCursor: checkpoint.event_cursor,
      worldTime: checkpoint.world_time,
      reason: checkpoint.reason,
      runId: checkpoint.run_id,
    },
  }));
  const previewSource: ArchiveContextSource[] = previewSnapshot
    ? [{
        eventCursor: previewSnapshot.event_cursor,
        sourceOrder: checkpoints.length,
        snapshot: previewSnapshot,
        provenance: {
          sourceKind: "preview_snapshot",
          checkpointIndex: null,
          lineNumber: null,
          eventCursor: previewSnapshot.event_cursor,
          worldTime: previewSnapshot.world_time,
          reason: "preview_snapshot",
          runId: previewSnapshot.run_id,
        },
      }]
    : [];

  return [...checkpointSources, ...previewSource].sort((left, right) => (
    right.eventCursor - left.eventCursor ||
    right.sourceOrder - left.sourceOrder
  ));
}

function eligibleSourcesForCursor(
  sources: readonly ArchiveContextSource[],
  cursor: number,
): ArchiveContextSource[] {
  return sources.filter((source) => source.eventCursor <= cursor);
}

function sourceForRelatedIds(
  sources: readonly ArchiveContextSource[],
  related: RelatedEventIds,
): ArchiveContextSource | null {
  if (!hasRelatedIds(related)) {
    return sources[0] ?? null;
  }
  return sources.find((source) => sourceContainsRelatedId(source, related)) ?? sources[0] ?? null;
}

function hasRelatedIds(related: RelatedEventIds): boolean {
  return (
    related.agentIds.length > 0 ||
    related.homeIds.length > 0 ||
    related.regionNames.length > 0
  );
}

function sourceContainsRelatedId(
  source: ArchiveContextSource,
  related: RelatedEventIds,
): boolean {
  const hasAgent = related.agentIds.some((id) =>
    hasByKey(source.snapshot.agents, id, (agent) => agent.id),
  );
  const hasHome = related.homeIds.some((id) => (
      hasByKey(source.snapshot.homes, id, (home) => home.home_id) ||
      hasByKey(source.snapshot.ruins, id, (home) => home.home_id)
  ));
  if (related.agentIds.length > 0 || related.homeIds.length > 0) {
    return hasAgent || hasHome;
  }
  return related.regionNames.some((name) =>
    hasByKey(source.snapshot.regions, name, (region) => region.name),
  );
}

function hasByKey<T>(
  values: readonly T[] | undefined,
  key: string,
  keyFor: (value: T) => string,
): boolean {
  return arrayOrEmpty(values).some((value) => keyFor(value) === key);
}

function arrayOrEmpty<T>(
  values: readonly T[] | undefined,
): readonly T[] {
  return Array.isArray(values) ? values : [];
}
