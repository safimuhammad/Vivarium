import { useMemo } from "react";

import type { AgentSnapshot, WorldSnapshot } from "../schemas";
import {
  summarizeWorldCondition,
  type WorldConditionMetric as WorldConditionMetricModel,
  type WorldConditionSummary,
} from "../worldConditionPulse";
import { cleanVisibleText } from "../../shared/visibleText";

export { WorldPresencePanelFallback } from "./WorldPresencePanelFallback";

export interface WorldPresencePanelProps {
  agents: AgentSnapshot[];
  snapshot: WorldSnapshot | null;
  onSelect(id: string): void;
}

export function WorldPresencePanel({
  agents,
  snapshot,
  onSelect,
}: WorldPresencePanelProps) {
  const condition = useMemo(() => summarizeWorldCondition(snapshot), [snapshot]);
  return (
    <aside className="presence-rail world-presence-frame">
      <div className="panel-title">
        <span>Beings</span>
        <b>{agents.length}</b>
      </div>
      <div className="agent-list">
        {agents.slice(0, 12).map((agent) => (
          <button key={agent.id} className="agent-row" onClick={() => onSelect(agent.id)}>
            <span className={`status-light ${agent.status}`} />
            <span className="agent-main">
              <span className="agent-name">{visibleBackendText(agent.name)}</span>
              <span className="agent-place">{visibleIdentifier(agent.position)}</span>
            </span>
            <span className="agent-resources">
              {Math.round(agent.energy)}e · {Math.round(agent.materials)}m
            </span>
          </button>
        ))}
      </div>
      <WorldConditionPulse summary={condition} />
    </aside>
  );
}

function WorldConditionPulse({ summary }: { summary: WorldConditionSummary }) {
  const land = summary.land;
  return (
    <section
      className="world-condition"
      data-testid="world-condition"
      data-condition-state={summary.state}
      data-condition-living-count={summary.livingCount}
      data-condition-fallen-count={summary.fallenCount}
      data-condition-returned-count={summary.returnedCount}
      data-condition-hoarding-being-count={summary.hoardingBeingCount}
      data-condition-care-state={summary.care.state}
      data-condition-care-near={summary.care.fallenNearLivingCount}
      data-condition-care-alone={summary.care.fallenAloneCount}
      data-condition-care-label={summary.care.label}
      data-condition-land-region={land?.regionName ?? "none"}
      data-condition-land-label={land?.regionLabel ?? "none"}
      data-condition-land-state={land?.state ?? "none"}
      data-condition-land-percent={land?.percent ?? "none"}
      data-condition-contested-homes={summary.homes.contestedCount}
      data-condition-worn-homes={summary.homes.wornCount}
      data-condition-ruins={summary.homes.ruinCount}
      data-condition-home-state={summary.homes.state}
      data-condition-home-kept={summary.homes.keptHomeCount}
      data-condition-home-standing={summary.homes.standingCount}
      data-condition-home-contested={summary.homes.contestedCount}
      data-condition-home-worn={summary.homes.wornCount}
      data-condition-home-heavy-vaults={summary.homes.hoardingVaultCount}
      data-condition-home-ruins={summary.homes.ruinCount}
      data-condition-home-with-hearth={summary.homes.livingWithStandingHomeCount}
      data-condition-home-without-hearth={summary.homes.livingWithoutStandingHomeCount}
      data-condition-pending-offers={summary.bonds.pendingCount}
      data-condition-bond-state={summary.bonds.state}
      data-condition-bond-living-pairs={summary.bonds.livingPairCount}
      data-condition-bond-held-fallen={summary.bonds.heldByFallenCount}
      data-condition-bond-held-returned={summary.bonds.heldByReturnedCount}
      data-condition-bond-missing={summary.bonds.missingParticipantCount}
      data-condition-bond-oldest-age={summary.bonds.oldestAgeSeconds ?? "none"}
      data-condition-bond-oldest-label={summary.bonds.oldestAgeLabel}
    >
      <div className="world-condition-head">
        <span>World condition</span>
        <b>{summary.headline}</b>
        <em>{summary.detail}</em>
      </div>
      {summary.metrics.length > 0 ? (
        <div className="world-condition-metrics">
          {summary.metrics.map((metric) => (
            <WorldConditionMetric key={metric.key} metric={metric} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function WorldConditionMetric({ metric }: { metric: WorldConditionMetricModel }) {
  return (
    <span
      className="world-condition-metric"
      data-condition-key={metric.key}
      data-condition-tone={metric.tone}
      data-condition-label={metric.label}
      data-condition-value={metric.value}
    >
      <span className="world-condition-dot" aria-hidden="true" />
      <span className="world-condition-label">{metric.label}</span>
      <b>{metric.value}</b>
      <em>{metric.detail}</em>
    </span>
  );
}

function visibleBackendText(
  value: string | null | undefined,
  fallback = "unknown",
): string {
  const text = typeof value === "string" && value.trim().length > 0
    ? value
    : fallback;
  return cleanVisibleText(text);
}

function visibleIdentifier(
  value: string | null | undefined,
  fallback = "unknown",
): string {
  const text = typeof value === "string" && value.trim().length > 0
    ? value.replaceAll("_", " ")
    : fallback;
  return cleanVisibleText(text);
}
