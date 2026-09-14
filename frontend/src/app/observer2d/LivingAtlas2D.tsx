import type { CSSProperties } from "react";
import { Info } from "lucide-react";

import type { ObserverAtlasView } from "./publicViewModels";

export interface LivingAtlas2DProps {
  readonly view: ObserverAtlasView;
  readonly onObserveRegion: (regionKey: string) => void;
  readonly onInspectRegion: (regionKey: string) => void;
}

export interface AtlasPoint {
  readonly x: number;
  readonly y: number;
}

const ATLAS_WIDTH = 320;
const ATLAS_HEIGHT = 210;

/** Compact, directed observer map built only from public Atlas records. */
export function LivingAtlas2D({ view, onObserveRegion, onInspectRegion }: LivingAtlas2DProps) {
  const positions = layoutAtlasRegions(view.regions.map((region) => region.key));
  const atlasRows = Math.max(1, Math.ceil(view.regions.length / (view.regions.length <= 4 ? 2 : 4)));
  const regionsByKey = new Map(view.regions.map((region) => [region.key, region]));
  const detailedRegion = view.regions.find((region) => region.observed)
    ?? view.regions.find((region) => region.active)
    ?? view.regions[0];

  return (
    <nav className="observer-panel living-atlas-2d" aria-label="Living Atlas">
      <header>
        <span className="observer-kicker">Living Atlas</span>
        <span>{view.regions.length} regions</span>
      </header>
      <div className="living-atlas-2d__map" data-roomy={view.regions.length <= 4 || undefined}
        style={{ "--atlas-rows": atlasRows } as CSSProperties}>
        <svg className="living-atlas-2d__paths" viewBox={`0 0 ${ATLAS_WIDTH} ${ATLAS_HEIGHT}`}
          role="group" aria-label="Directed region paths" preserveAspectRatio="none">
          <defs>
            <marker id="living-atlas-arrowhead" viewBox="0 0 8 8" refX="7" refY="4"
              markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 8 4 L 0 8 z" />
            </marker>
          </defs>
          {view.regions.flatMap((region) => region.connections.flatMap((connection) => {
            const source = positions.get(region.key);
            const target = positions.get(connection.key);
            const targetRegion = regionsByKey.get(connection.key);
            if (source === undefined || target === undefined || targetRegion === undefined) return [];
            return <path key={`${region.key}>${connection.key}`} data-atlas-edge
              className="living-atlas-2d__path" d={edgePath(source, target)}
              markerEnd="url(#living-atlas-arrowhead)"
              role="img"
              aria-label={`${region.displayName} leads to ${targetRegion.displayName}`} />;
          }))}
        </svg>

        {view.regions.map((region) => {
          const point = positions.get(region.key) ?? { x: ATLAS_WIDTH / 2, y: ATLAS_HEIGHT / 2 };
          const style: CSSProperties = {
            left: `${(point.x / ATLAS_WIDTH) * 100}%`,
            top: `${(point.y / ATLAS_HEIGHT) * 100}%`,
          };
          return <article key={region.key} className="living-atlas-2d__node" style={style}
            data-active={region.active || undefined} data-observed={region.observed || undefined}>
            <button type="button" className="living-atlas-2d__observe"
              data-region-key={region.key}
              aria-pressed={region.observed}
              aria-current={region.active ? "true" : undefined}
              onClick={() => onObserveRegion(region.key)}>
              <span className="observer-visually-hidden">Observe </span>
              <strong>{region.displayName}</strong>
              {region.active && <span>Current story region</span>}
              {region.observed && <span>Observed</span>}
              <RegionCounts region={region} />
              <ImportancePips counts={region.queuedImportance} />
            </button>
            <span className="observer-visually-hidden">{region.description}</span>
          </article>;
        })}
      </div>
      {detailedRegion !== undefined && <section className="living-atlas-2d__detail"
        data-region-key={detailedRegion.key}>
        <div className="living-atlas-2d__detail-copy">
          <strong>{detailedRegion.displayName}</strong>
          <span>{detailedRegion.description}</span>
          <RegionCounts region={detailedRegion} />
        </div>
        <button type="button" className="living-atlas-2d__inspect"
          aria-label={`Inspect ${detailedRegion.displayName}`}
          onClick={() => onInspectRegion(detailedRegion.key)}><Info size={18} aria-hidden="true" /></button>
      </section>}
    </nav>
  );
}

function RegionCounts({ region }: {
  readonly region: ObserverAtlasView["regions"][number];
}) {
  if (region.countsComplete) {
    return <span>{region.livingAgents} living · {region.homes} homes · {region.ruins} ruins</span>;
  }
  return <>
    <span>{region.livingAgents} known living · {region.unresolvedAgentStatuses} unresolved · at least {region.homes} homes · at least {region.ruins} ruins</span>
    <span className="living-atlas-2d__awaiting">Awaiting exact checkpoint</span>
  </>;
}

/** Place up to twelve configured regions on stable, collision-free graph slots. */
export function layoutAtlasRegions(keys: readonly string[]): ReadonlyMap<string, AtlasPoint> {
  const positions = new Map<string, AtlasPoint>();
  const stableKeys = [...keys].sort((left, right) => left.localeCompare(right));
  if (stableKeys.length === 0) return positions;
  if (stableKeys.length === 1) {
    positions.set(stableKeys[0]!, Object.freeze({ x: ATLAS_WIDTH / 2, y: ATLAS_HEIGHT / 2 }));
    return positions;
  }
  const columnCount = stableKeys.length <= 4 ? 2 : 4;
  const rowCount = Math.ceil(stableKeys.length / columnCount);
  const horizontalInset = stableKeys.length <= 4 ? 85 : 40;
  const verticalInset = rowCount === 2 ? 55 : 35;
  stableKeys.forEach((key, index) => {
    const row = Math.floor(index / columnCount);
    const rowStart = row * columnCount;
    const rowSize = Math.min(columnCount, stableKeys.length - rowStart);
    const column = index - rowStart;
    const xStep = rowSize === 1 ? 0 : (ATLAS_WIDTH - (horizontalInset * 2)) / (rowSize - 1);
    const x = rowSize === 1 ? ATLAS_WIDTH / 2 : horizontalInset + (column * xStep);
    const yStep = rowCount === 1 ? 0 : (ATLAS_HEIGHT - (verticalInset * 2)) / (rowCount - 1);
    const y = rowCount === 1 ? ATLAS_HEIGHT / 2 : verticalInset + (row * yStep);
    positions.set(key, Object.freeze({ x: Math.round(x), y: Math.round(y) }));
  });
  return positions;
}

function edgePath(source: AtlasPoint, target: AtlasPoint): string {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const inset = Math.min(34, length / 3);
  const startX = source.x + ((dx / length) * inset);
  const startY = source.y + ((dy / length) * inset);
  const endX = target.x - ((dx / length) * inset);
  const endY = target.y - ((dy / length) * inset);
  const bend = ((source.x + source.y + target.x + target.y) % 2 === 0 ? 1 : -1) * 8;
  const middleX = ((startX + endX) / 2) - ((dy / length) * bend);
  const middleY = ((startY + endY) / 2) + ((dx / length) * bend);
  return `M ${round(startX)} ${round(startY)} Q ${round(middleX)} ${round(middleY)} ${round(endX)} ${round(endY)}`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function ImportancePips({ counts }: {
  readonly counts: Readonly<{ ambient: number; featured: number; drama: number }>;
}) {
  const values = [counts.ambient, counts.featured, counts.drama] as const;
  const total = values.reduce((sum, count) => sum + count, 0);
  return (
    <span className="living-atlas-2d__importance"
      aria-label={total === 0 ? "No gathering moments" : `${total} gathering moments`}>
      {values.map((count, index) => <i key={index} className="living-atlas-2d__pip"
        data-filled={count > 0 || undefined} aria-hidden="true" />)}
    </span>
  );
}
