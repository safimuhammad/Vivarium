import type {
  AgentSnapshot,
  HomeSnapshot,
  RegionSnapshot,
  WorldSnapshot,
} from "./schemas";
import { cleanVisibleText } from "../shared/visibleText";

export type WorldConditionState = "waiting" | "steady" | "strained";
export type WorldConditionTone = "quiet" | "steady" | "warn" | "danger" | "gold";
export type WorldConditionLandState = "unknown" | "depleted" | "thin" | "steady";
export type WorldConditionMetricKey = "life" | "land" | "homes" | "bonds";
export type WorldConditionCareState = "none" | "near_life" | "alone" | "mixed";
export type WorldConditionBondState = "none" | "ready" | "fallen" | "returned" | "missing" | "mixed";
export type WorldConditionHomeState = "none" | "contested" | "without_hearth" | "worn" | "heavy_vault" | "kept";

export interface WorldConditionMetric {
  key: WorldConditionMetricKey;
  label: string;
  value: string;
  detail: string;
  tone: WorldConditionTone;
}

export interface WorldConditionLandPressure {
  regionName: string;
  regionLabel: string;
  ratio: number | null;
  percent: number | null;
  energyRatio: number | null;
  materialsRatio: number | null;
  state: WorldConditionLandState;
  label: string;
  detail: string;
}

export interface WorldConditionHomePressure {
  state: WorldConditionHomeState;
  keptHomeCount: number;
  standingCount: number;
  contestedCount: number;
  wornCount: number;
  ruinCount: number;
  hoardingVaultCount: number;
  livingWithStandingHomeCount: number;
  livingWithoutStandingHomeCount: number;
}

export interface WorldConditionBondPressure {
  state: WorldConditionBondState;
  livingPairCount: number;
  heldByFallenCount: number;
  heldByReturnedCount: number;
  missingParticipantCount: number;
  pendingCount: number;
  oldestAgeSeconds: number | null;
  oldestAgeLabel: string;
}

export interface WorldConditionCareSummary {
  state: WorldConditionCareState;
  fallenNearLivingCount: number;
  fallenAloneCount: number;
  label: string;
}

export interface WorldConditionSummary {
  state: WorldConditionState;
  headline: string;
  detail: string;
  worldTime: number | null;
  eventCursor: number | null;
  totalBeingCount: number;
  livingCount: number;
  fallenCount: number;
  returnedCount: number;
  hoardingBeingCount: number;
  care: WorldConditionCareSummary;
  land: WorldConditionLandPressure | null;
  homes: WorldConditionHomePressure;
  bonds: WorldConditionBondPressure;
  metrics: WorldConditionMetric[];
}

const WORN_HOME_RATIO = 0.5;
const DEPLETED_LAND_RATIO = 0.25;
const THIN_LAND_RATIO = 0.5;

export function summarizeWorldCondition(
  snapshot: WorldSnapshot | null | undefined,
): WorldConditionSummary {
  if (!snapshot) {
    return {
      state: "waiting",
      headline: "Waiting for world",
      detail: "Current condition will appear with the first world view.",
      worldTime: null,
      eventCursor: null,
      totalBeingCount: 0,
      livingCount: 0,
      fallenCount: 0,
      returnedCount: 0,
      hoardingBeingCount: 0,
      care: emptyCareSummary(),
      land: null,
      homes: emptyHomePressure(),
      bonds: {
        state: "none",
        livingPairCount: 0,
        heldByFallenCount: 0,
        heldByReturnedCount: 0,
        missingParticipantCount: 0,
        pendingCount: 0,
        oldestAgeSeconds: null,
        oldestAgeLabel: "none",
      },
      metrics: [],
    };
  }

  const livingCount = snapshot.agents.filter((agent) => agent.status === "alive").length;
  const fallenCount = snapshot.agents.filter((agent) => agent.status === "paralyzed").length;
  const returnedCount = snapshot.agents.filter((agent) => agent.status === "dead").length;
  const hoardingBeingCount = snapshot.agents.filter((agent) => agent.is_hoarding).length;
  const care = summarizeCare(snapshot);
  const land = mostDepletedLand(snapshot.regions);
  const homes = summarizeHomePressure(snapshot);
  const bonds = summarizeBondPressure(snapshot);
  const state = conditionState({
    fallenCount,
    returnedCount,
    hoardingBeingCount,
    land,
    homes,
    bonds,
  });
  const headline = conditionHeadline(state, land);
  const metrics = conditionMetrics({
    totalBeingCount: snapshot.agents.length,
    livingCount,
    fallenCount,
    returnedCount,
    hoardingBeingCount,
    care,
    land,
    homes,
    bonds,
  });

  return {
    state,
    headline,
    detail: conditionDetail(metrics),
    worldTime: finiteOrNull(snapshot.world_time),
    eventCursor: finiteOrNull(snapshot.event_cursor),
    totalBeingCount: snapshot.agents.length,
    livingCount,
    fallenCount,
    returnedCount,
    hoardingBeingCount,
    care,
    land,
    homes,
    bonds,
    metrics,
  };
}

function emptyCareSummary(): WorldConditionCareSummary {
  return {
    state: "none",
    fallenNearLivingCount: 0,
    fallenAloneCount: 0,
    label: "no fallen",
  };
}

function emptyHomePressure(): WorldConditionHomePressure {
  return {
    state: "none",
    keptHomeCount: 0,
    standingCount: 0,
    contestedCount: 0,
    wornCount: 0,
    ruinCount: 0,
    hoardingVaultCount: 0,
    livingWithStandingHomeCount: 0,
    livingWithoutStandingHomeCount: 0,
  };
}

function summarizeCare(snapshot: WorldSnapshot): WorldConditionCareSummary {
  const livingPositions = new Set(
    snapshot.agents
      .filter((agent) => agent.status === "alive")
      .map((agent) => normalizedPosition(agent.position))
      .filter((position): position is string => position !== null),
  );
  let fallenNearLivingCount = 0;
  let fallenAloneCount = 0;

  for (const agent of snapshot.agents) {
    if (agent.status !== "paralyzed") {
      continue;
    }
    const position = normalizedPosition(agent.position);
    if (position !== null && livingPositions.has(position)) {
      fallenNearLivingCount += 1;
    } else {
      fallenAloneCount += 1;
    }
  }

  return {
    state: careState(fallenNearLivingCount, fallenAloneCount),
    fallenNearLivingCount,
    fallenAloneCount,
    label: careLabel(fallenNearLivingCount, fallenAloneCount),
  };
}

function careState(
  fallenNearLivingCount: number,
  fallenAloneCount: number,
): WorldConditionCareState {
  if (fallenNearLivingCount <= 0 && fallenAloneCount <= 0) {
    return "none";
  }
  if (fallenNearLivingCount > 0 && fallenAloneCount > 0) {
    return "mixed";
  }
  if (fallenNearLivingCount > 0) {
    return "near_life";
  }
  return "alone";
}

function careLabel(
  fallenNearLivingCount: number,
  fallenAloneCount: number,
): string {
  if (fallenNearLivingCount > 0 && fallenAloneCount > 0) {
    return `${fallenNearLivingCount} near life · ${fallenAloneCount} alone`;
  }
  if (fallenNearLivingCount > 0) {
    return `${fallenNearLivingCount} fallen near life`;
  }
  if (fallenAloneCount > 0) {
    return `${fallenAloneCount} fallen alone`;
  }
  return "no fallen";
}

function mostDepletedLand(regions: readonly RegionSnapshot[]): WorldConditionLandPressure | null {
  if (regions.length === 0) {
    return null;
  }

  const pressures = regions
    .map(regionLandPressure)
    .sort((left, right) => {
      const leftRatio = left.ratio ?? Number.POSITIVE_INFINITY;
      const rightRatio = right.ratio ?? Number.POSITIVE_INFINITY;
      if (leftRatio !== rightRatio) {
        return leftRatio - rightRatio;
      }
      return left.regionLabel.localeCompare(right.regionLabel);
    });

  return pressures[0] ?? null;
}

function regionLandPressure(region: RegionSnapshot): WorldConditionLandPressure {
  const energyRatio = safeRatio(region.current_energy, region.max_energy);
  const materialsRatio = safeRatio(region.current_materials, region.max_materials);
  const ratio = combinedRatio(region);
  const percent = ratio === null ? null : Math.round(ratio * 100);
  const state = landState(ratio);
  const regionLabel = visibleIdentifier(region.name);
  return {
    regionName: region.name,
    regionLabel,
    ratio,
    percent,
    energyRatio,
    materialsRatio,
    state,
    label: percent === null ? regionLabel : `${regionLabel} ${percent}%`,
    detail: landDetail(state),
  };
}

function combinedRatio(region: RegionSnapshot): number | null {
  const current = finiteNumber(region.current_energy) + finiteNumber(region.current_materials);
  const maximum = finiteNumber(region.max_energy) + finiteNumber(region.max_materials);
  return safeRatio(current, maximum);
}

function landState(ratio: number | null): WorldConditionLandState {
  if (ratio === null) {
    return "unknown";
  }
  if (ratio <= DEPLETED_LAND_RATIO) {
    return "depleted";
  }
  if (ratio <= THIN_LAND_RATIO) {
    return "thin";
  }
  return "steady";
}

function landDetail(state: WorldConditionLandState): string {
  switch (state) {
    case "depleted":
      return "depleted pools";
    case "thin":
      return "thin pools";
    case "steady":
      return "steady pools";
    case "unknown":
      return "unknown pools";
  }
}

function summarizeHomePressure(snapshot: WorldSnapshot): WorldConditionHomePressure {
  const standingHomes = snapshot.homes.filter(isStandingHome);
  const livingHomeReadiness = summarizeLivingHomeReadiness(snapshot.agents, standingHomes);
  const contestedCount = standingHomes.filter((home) => home.breachers.length > 0).length;
  const wornCount = standingHomes.filter(isWornHome).length;
  const hoardingVaultCount = standingHomes.filter((home) => home.is_hoarding).length;
  const keptHomeCount = standingHomes.filter(
    (home) => home.breachers.length === 0 && !isWornHome(home) && !home.is_hoarding,
  ).length;

  return {
    state: homeState({
      standingCount: standingHomes.length,
      contestedCount,
      wornCount,
      hoardingVaultCount,
      livingWithoutStandingHomeCount: livingHomeReadiness.withoutStandingHomeCount,
    }),
    keptHomeCount,
    standingCount: standingHomes.length,
    contestedCount,
    wornCount,
    ruinCount: snapshot.ruins.length,
    hoardingVaultCount,
    livingWithStandingHomeCount: livingHomeReadiness.withStandingHomeCount,
    livingWithoutStandingHomeCount: livingHomeReadiness.withoutStandingHomeCount,
  };
}

function isStandingHome(home: HomeSnapshot): boolean {
  return home.status === "standing";
}

function summarizeLivingHomeReadiness(
  agents: readonly AgentSnapshot[],
  standingHomes: readonly HomeSnapshot[],
): { withStandingHomeCount: number; withoutStandingHomeCount: number } {
  const standingHomesById = new Map(standingHomes.map((home) => [home.home_id, home]));
  const standingStakeholders = new Set(standingHomes.flatMap((home) => home.stakeholders));
  let withStandingHomeCount = 0;
  let withoutStandingHomeCount = 0;

  for (const agent of agents) {
    if (agent.status !== "alive") {
      continue;
    }

    const hasStandingHome = (
      (agent.home_id !== null && standingHomesById.has(agent.home_id)) ||
      standingStakeholders.has(agent.id)
    );
    if (hasStandingHome) {
      withStandingHomeCount += 1;
    } else {
      withoutStandingHomeCount += 1;
    }
  }

  return { withStandingHomeCount, withoutStandingHomeCount };
}

function homeState({
  standingCount,
  contestedCount,
  wornCount,
  hoardingVaultCount,
  livingWithoutStandingHomeCount,
}: Pick<
  WorldConditionHomePressure,
  "standingCount" | "contestedCount" | "wornCount" | "hoardingVaultCount" | "livingWithoutStandingHomeCount"
>): WorldConditionHomeState {
  if (contestedCount > 0) {
    return "contested";
  }
  if (livingWithoutStandingHomeCount > 0) {
    return "without_hearth";
  }
  if (wornCount > 0) {
    return "worn";
  }
  if (hoardingVaultCount > 0) {
    return "heavy_vault";
  }
  if (standingCount > 0) {
    return "kept";
  }
  return "none";
}

function isWornHome(home: HomeSnapshot): boolean {
  const ratio = safeRatio(home.integrity, home.max_integrity);
  return ratio !== null && ratio <= WORN_HOME_RATIO;
}

function summarizeBondPressure(snapshot: WorldSnapshot): WorldConditionBondPressure {
  const agentsById = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  let livingPairCount = 0;
  let heldByFallenCount = 0;
  let heldByReturnedCount = 0;
  let missingParticipantCount = 0;

  for (const proposal of snapshot.pending_proposals) {
    const initiator = agentsById.get(proposal.initiator_id);
    const target = agentsById.get(proposal.target_id);

    if (!initiator || !target) {
      missingParticipantCount += 1;
    } else if (initiator.status === "dead" || target.status === "dead") {
      heldByReturnedCount += 1;
    } else if (initiator.status === "paralyzed" || target.status === "paralyzed") {
      heldByFallenCount += 1;
    } else {
      livingPairCount += 1;
    }
  }

  const ages = snapshot.pending_proposals
    .map((proposal) => (
      proposal.timestamp === null ? null : finiteOrNull(snapshot.world_time - proposal.timestamp)
    ))
    .filter((age): age is number => age !== null && age >= 0)
    .sort((left, right) => right - left);
  const oldestAgeSeconds = ages[0] ?? null;
  return {
    state: bondState({
      livingPairCount,
      heldByFallenCount,
      heldByReturnedCount,
      missingParticipantCount,
    }),
    livingPairCount,
    heldByFallenCount,
    heldByReturnedCount,
    missingParticipantCount,
    pendingCount: snapshot.pending_proposals.length,
    oldestAgeSeconds,
    oldestAgeLabel: oldestAgeSeconds === null ? "new" : formatAge(oldestAgeSeconds),
  };
}

function bondState({
  livingPairCount,
  heldByFallenCount,
  heldByReturnedCount,
  missingParticipantCount,
}: Pick<
  WorldConditionBondPressure,
  "livingPairCount" | "heldByFallenCount" | "heldByReturnedCount" | "missingParticipantCount"
>): WorldConditionBondState {
  const categoryCount = [
    livingPairCount,
    heldByFallenCount,
    heldByReturnedCount,
    missingParticipantCount,
  ].filter((count) => count > 0).length;

  if (categoryCount === 0) {
    return "none";
  }
  if (categoryCount > 1) {
    return "mixed";
  }
  if (missingParticipantCount > 0) {
    return "missing";
  }
  if (heldByReturnedCount > 0) {
    return "returned";
  }
  if (heldByFallenCount > 0) {
    return "fallen";
  }
  return "ready";
}

function conditionState({
  fallenCount,
  returnedCount,
  hoardingBeingCount,
  land,
  homes,
  bonds,
}: {
  fallenCount: number;
  returnedCount: number;
  hoardingBeingCount: number;
  land: WorldConditionLandPressure | null;
  homes: WorldConditionHomePressure;
  bonds: WorldConditionBondPressure;
}): WorldConditionState {
  if (
    fallenCount > 0 ||
    returnedCount > 0 ||
    hoardingBeingCount > 0 ||
    land?.state === "depleted" ||
    homes.contestedCount > 0 ||
    homes.livingWithoutStandingHomeCount > 0 ||
    homes.wornCount > 0 ||
    homes.ruinCount > 0 ||
    homes.hoardingVaultCount > 0 ||
    bonds.pendingCount > 0
  ) {
    return "strained";
  }
  return "steady";
}

function conditionHeadline(
  state: WorldConditionState,
  land: WorldConditionLandPressure | null,
): string {
  if (state === "waiting") {
    return "Waiting for world";
  }
  if (land?.state === "depleted") {
    return "Land under strain";
  }
  if (state === "strained") {
    return "World under strain";
  }
  return "World steady";
}

function conditionMetrics({
  totalBeingCount,
  livingCount,
  fallenCount,
  returnedCount,
  hoardingBeingCount,
  care,
  land,
  homes,
  bonds,
}: {
  totalBeingCount: number;
  livingCount: number;
  fallenCount: number;
  returnedCount: number;
  hoardingBeingCount: number;
  care: WorldConditionCareSummary;
  land: WorldConditionLandPressure | null;
  homes: WorldConditionHomePressure;
  bonds: WorldConditionBondPressure;
}): WorldConditionMetric[] {
  return [
    {
      key: "life",
      label: "Life",
      value: lifeValue(fallenCount, returnedCount, care),
      detail: [
        `${livingCount}/${totalBeingCount} living`,
        care.state === "none" ? null : care.label,
        hoardingBeingCount > 0 ? `${hoardingBeingCount} hoarding` : null,
      ].filter((part): part is string => part !== null).join(" · "),
      tone: returnedCount > 0 ? "danger" : fallenCount > 0 ? "warn" : hoardingBeingCount > 0 ? "gold" : "steady",
    },
    {
      key: "land",
      label: "Land",
      value: land?.label ?? "unknown",
      detail: land?.detail ?? "no regions",
      tone: landTone(land),
    },
    {
      key: "homes",
      label: "Homes",
      value: homeValue(homes),
      detail: [
        homes.livingWithoutStandingHomeCount > 0 ? `${homes.livingWithoutStandingHomeCount} without hearth` : null,
        homes.ruinCount > 0 ? `${homes.ruinCount} ${pluralize("ruin", homes.ruinCount)}` : null,
        homes.hoardingVaultCount > 0 ? `${homes.hoardingVaultCount} heavy ${pluralize("vault", homes.hoardingVaultCount)}` : null,
      ].filter((part): part is string => part !== null).join(" · ") || `${homes.livingWithStandingHomeCount} with hearth`,
      tone: homes.contestedCount > 0 ? "danger" : homes.livingWithoutStandingHomeCount > 0 || homes.wornCount > 0 || homes.ruinCount > 0 ? "warn" : homes.hoardingVaultCount > 0 ? "gold" : "steady",
    },
    {
      key: "bonds",
      label: "Bonds",
      value: bondValue(bonds),
      detail: bondDetail(bonds),
      tone: bonds.pendingCount > 0 ? "gold" : "steady",
    },
  ];
}

function conditionDetail(metrics: readonly WorldConditionMetric[]): string {
  return metrics.map((metric) => `${metric.label}: ${metric.value}`).join(" · ");
}

function lifeValue(
  fallenCount: number,
  returnedCount: number,
  care: WorldConditionCareSummary,
): string {
  if (returnedCount > 0) {
    return `${returnedCount} returned`;
  }
  if (fallenCount > 0 && care.state !== "none") {
    return care.label;
  }
  if (fallenCount > 0) {
    return `${fallenCount} fallen`;
  }
  return "all standing";
}

function landTone(land: WorldConditionLandPressure | null): WorldConditionTone {
  if (!land || land.state === "unknown") {
    return "quiet";
  }
  if (land.state === "depleted") {
    return "danger";
  }
  if (land.state === "thin") {
    return "warn";
  }
  return "steady";
}

function homeValue(homes: WorldConditionHomePressure): string {
  switch (homes.state) {
    case "contested":
      return `${homes.contestedCount} contested`;
    case "without_hearth":
      return `${homes.livingWithoutStandingHomeCount} without hearth`;
    case "worn":
      return `${homes.wornCount} worn`;
    case "heavy_vault":
      return `${homes.hoardingVaultCount} heavy ${pluralize("vault", homes.hoardingVaultCount)}`;
    case "kept":
      return `${homes.keptHomeCount} kept ${pluralize("home", homes.keptHomeCount)}`;
    case "none":
      return `${homes.standingCount} standing`;
  }
}

function bondValue(bonds: WorldConditionBondPressure): string {
  switch (bonds.state) {
    case "mixed":
      return `${bonds.pendingCount} ${pluralize("offer", bonds.pendingCount)} mixed`;
    case "missing":
      return `${bonds.missingParticipantCount} missing ${pluralize("offer", bonds.missingParticipantCount)}`;
    case "returned":
      return `${bonds.heldByReturnedCount} returned ${pluralize("offer", bonds.heldByReturnedCount)}`;
    case "fallen":
      return `${bonds.heldByFallenCount} fallen ${pluralize("offer", bonds.heldByFallenCount)}`;
    case "ready":
      return `${bonds.livingPairCount} living ${pluralize("offer", bonds.livingPairCount)}`;
    case "none":
      return "quiet";
  }
}

function bondDetail(bonds: WorldConditionBondPressure): string {
  if (bonds.pendingCount <= 0) {
    return "no open offers";
  }

  const parts = [
    bonds.livingPairCount > 0 ? `${offerCount(bonds.livingPairCount)} between living beings` : null,
    bonds.heldByFallenCount > 0 ? `${offerCount(bonds.heldByFallenCount)} waits on fallen` : null,
    bonds.heldByReturnedCount > 0 ? `${offerCount(bonds.heldByReturnedCount)} waits on returned` : null,
    bonds.missingParticipantCount > 0 ? `${offerCount(bonds.missingParticipantCount)} missing ${pluralize("participant", bonds.missingParticipantCount)}` : null,
    `oldest ${bonds.oldestAgeLabel}`,
  ];

  return parts.filter((part): part is string => part !== null).join(" · ");
}

function offerCount(count: number): string {
  return `${count} ${pluralize("offer", count)}`;
}

function safeRatio(value: number, maximum: number): number | null {
  const safeMaximum = finiteNumber(maximum);
  if (safeMaximum <= 0) {
    return null;
  }
  return clamp01(finiteNumber(value) / safeMaximum);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function normalizedPosition(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function visibleIdentifier(value: string): string {
  return cleanVisibleText(value.replace(/_/g, " ")).trim() || "unknown";
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

function formatAge(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) {
    return `${rounded}s`;
  }
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}
