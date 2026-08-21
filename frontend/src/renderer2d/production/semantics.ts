import type {
  FrameIdentity,
  ObserverSelection,
  Vec2,
} from "../../presentation/contracts";

export type SemanticSubjectKind = "region" | "agent" | "home" | "ruin";

export interface RendererSemanticSubject {
  readonly selection: Exclude<ObserverSelection, null>;
  readonly stableSelectionKey: string;
  readonly kind: SemanticSubjectKind;
  readonly regionId: string;
  readonly position: Vec2 | null;
  readonly status: string;
  readonly action: string | null;
}

export interface RendererSemanticSnapshot {
  readonly frameIdentity: FrameIdentity;
  readonly subjects: readonly RendererSemanticSubject[];
}

export interface RendererSemanticPublisherOptions {
  readonly onSnapshot: (snapshot: RendererSemanticSnapshot) => void;
  readonly now?: () => number;
  readonly minimumPositionIntervalMs?: number;
}

export interface RendererSemanticPublisher {
  accept(snapshot: RendererSemanticSnapshot): void;
  reset(): void;
}

const KIND_RANK: Readonly<Record<SemanticSubjectKind, number>> = Object.freeze({
  region: 0,
  agent: 1,
  home: 2,
  ruin: 3,
});
const TILE_SIZE = 32;

/** Creates the immutable non-display semantic truth emitted by a production scene graph. */
export function createRendererSemanticSnapshot(
  frameIdentity: FrameIdentity,
  subjects: readonly RendererSemanticSubject[],
): RendererSemanticSnapshot {
  const ordered = subjects.map(copySubject).sort((left, right) => (
    KIND_RANK[left.kind] - KIND_RANK[right.kind]
      || left.stableSelectionKey.localeCompare(right.stableSelectionKey)
  ));
  return deepFreeze({ frameIdentity: { ...frameIdentity }, subjects: ordered });
}

/** Publishes semantic changes immediately except tile position changes, which are capped at 4Hz. */
export function createRendererSemanticPublisher(
  options: RendererSemanticPublisherOptions,
): RendererSemanticPublisher {
  const now = options.now ?? (() => performance.now());
  const minimumPositionIntervalMs = options.minimumPositionIntervalMs ?? 250;
  let priorStructural = "";
  let priorTiles = "";
  let lastPositionPublicationMs = Number.NEGATIVE_INFINITY;

  return {
    accept(snapshot): void {
      const structural = structuralFingerprint(snapshot);
      const tiles = tileFingerprint(snapshot);
      const structuralChanged = structural !== priorStructural;
      const positionChanged = tiles !== priorTiles;
      const timestamp = now();
      if (!structuralChanged && (!positionChanged
        || timestamp - lastPositionPublicationMs < minimumPositionIntervalMs)) return;
      options.onSnapshot(snapshot);
      priorStructural = structural;
      priorTiles = tiles;
      if (positionChanged) lastPositionPublicationMs = timestamp;
    },
    reset(): void {
      priorStructural = "";
      priorTiles = "";
      lastPositionPublicationMs = Number.NEGATIVE_INFINITY;
    },
  };
}

function copySubject(subject: RendererSemanticSubject): RendererSemanticSubject {
  return {
    selection: { ...subject.selection },
    stableSelectionKey: subject.stableSelectionKey,
    kind: subject.kind,
    regionId: subject.regionId,
    position: subject.position === null ? null : { ...subject.position },
    status: subject.status,
    action: subject.action,
  };
}

function structuralFingerprint(snapshot: RendererSemanticSnapshot): string {
  return JSON.stringify([
    identityKey(snapshot.frameIdentity),
    snapshot.subjects.map((subject) => [
      subject.kind,
      subject.stableSelectionKey,
      subject.regionId,
      subject.status,
      subject.action,
    ]),
  ]);
}

function tileFingerprint(snapshot: RendererSemanticSnapshot): string {
  return JSON.stringify(snapshot.subjects.map((subject) => [
    subject.stableSelectionKey,
    subject.position === null ? null : [
      Math.floor(subject.position.x / TILE_SIZE),
      Math.floor(subject.position.y / TILE_SIZE),
    ],
  ]));
}

function identityKey(identity: FrameIdentity): readonly unknown[] {
  return [
    identity.runId,
    identity.sourceKey,
    identity.revision,
    identity.firstCursor,
    identity.lastCursor,
  ];
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
