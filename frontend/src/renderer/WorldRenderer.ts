import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";

import type {
  AgentSnapshot,
  EventEnvelopeEntry,
  HomeSnapshot,
  PendingProposalSnapshot,
  RegionSnapshot,
  WorldSnapshot,
} from "../app/schemas";
import {
  eventPresentationContextFromSnapshot,
  presentEvent,
  presentEventBubbleDetail,
  type EventBubbleDetailPresentation,
  type EventChainDetailPresentation,
} from "../app/eventPresentation";
import { focusTargetForBeat } from "../app/livingAtlas/narrativeBeat";
import {
  getEventVisualMetadata,
  type EventVisualIconKey,
} from "../events/eventVisualCatalog";
import {
  createEventVisualIconSvgElement,
  FALLBACK_EVENT_VISUAL_ICON_KEY,
} from "../events/eventVisualIcons";
import { cleanVisibleText } from "../shared/visibleText";
import {
  atlasLayoutHash,
  classifyCrossings,
  deriveAtlasLayout,
  type AtlasCrossing,
  type AtlasLayout,
  type AtlasRegionLayout,
} from "./regions/atlasLayout";
import {
  buildAtlasCrossings,
  buildRegionScenery,
  type SceneryDynamicClearance,
  type RegionSceneryLayer,
} from "./regions/scenery";
import {
  placeRegionScenery,
  type SceneryQuality,
} from "./regions/sceneryPlacement";
import {
  deriveRegionVisualRecipe,
  REGION_VISUAL_RECIPE_VERSION,
  type RegionArchetype,
  type RegionVisualRecipeV1,
} from "./regions/visualRecipe";

export type RendererSelection =
  | { kind: "region"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "home"; id: string };

export type WorldRendererRenderMode = "live" | "demand";

export interface AnimationFrameDriver {
  request(callback: FrameRequestCallback): number;
  cancel(handle: number): void;
}

export interface WorldFrameSchedulerOptions {
  driver?: AnimationFrameDriver;
  maximumFramesPerSecond?: number;
}

const BROWSER_ANIMATION_FRAME_DRIVER: AnimationFrameDriver = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** Schedules bounded live frames or one-shot demand renders. */
export class WorldFrameScheduler {
  private readonly driver: AnimationFrameDriver;
  private readonly minimumFrameIntervalMs: number;
  private frameHandle: number | null = null;
  private lastRenderedAt: number | null = null;
  private disposed = false;

  constructor(
    private readonly mode: WorldRendererRenderMode,
    private readonly renderFrame: (timestamp: number) => void,
    options: WorldFrameSchedulerOptions = {},
  ) {
    this.driver = options.driver ?? BROWSER_ANIMATION_FRAME_DRIVER;
    const maximumFramesPerSecond = options.maximumFramesPerSecond ?? 60;
    if (!Number.isFinite(maximumFramesPerSecond) || maximumFramesPerSecond <= 0) {
      throw new Error("maximumFramesPerSecond must be a positive finite number");
    }
    this.minimumFrameIntervalMs = 1_000 / maximumFramesPerSecond;
  }

  start(): void {
    this.requestRender();
  }

  requestRender(): void {
    if (this.disposed || this.frameHandle !== null) {
      return;
    }
    this.frameHandle = this.driver.request(this.onAnimationFrame);
  }

  isFrameScheduled(): boolean {
    return this.frameHandle !== null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.frameHandle !== null) {
      this.driver.cancel(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private readonly onAnimationFrame = (timestamp: number): void => {
    this.frameHandle = null;
    if (this.disposed) {
      return;
    }
    const shouldRender =
      this.mode === "demand" ||
      this.lastRenderedAt === null ||
      timestamp - this.lastRenderedAt >= this.minimumFrameIntervalMs - 1;
    if (shouldRender) {
      this.lastRenderedAt = timestamp;
      this.renderFrame(timestamp);
    }
    if (this.mode === "live") {
      this.requestRender();
    }
  };
}

export interface WorldRendererOptions {
  effectDetail?: "full" | "tour";
  interactive?: boolean;
  reducedMotion?: boolean | "auto";
  renderMode?: WorldRendererRenderMode;
  onBeatSelect?(cursor: number): void;
  onSelect?(selection: RendererSelection): void;
}

export interface SafeFrameInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

type MotionMode = "full" | "reduced";
type ReducedMotionSource = "default" | "media" | "option";

interface MotionDebugState {
  mode: MotionMode;
  reduced: boolean;
  source: ReducedMotionSource;
}

interface MotionSettings {
  mode: MotionMode;
  waterAmplitude: number;
  waterTimeScale: number;
  focusDuration: number;
  controlsDampingFactor: number;
  defaultRiseSpeed: number;
  defaultGrow: number;
  defaultLabelLift: number;
  defaultTravelPulse: number;
  arcLiftScale: number;
  arcSegments: number;
  pathSegments: number;
  particleDensity: number;
  jitterScale: number;
  pulseScale: number;
  driftScale: number;
  rotationScale: number;
}

interface EffectLifecycleDiagnostics {
  activeEffectCount: number;
  activeEffectCountByGroup: Record<string, number>;
  activeEffectCountByType: Record<string, number>;
  pendingProposalVisualCount: number;
  maxActiveEffectCount: number;
  culledEffectCount: number;
  disposedEffectGeometryCount: number;
  disposedEffectMaterialCount: number;
  disposedProposalGeometryCount: number;
  disposedProposalMaterialCount: number;
  appliedEventCursorCount: number;
  reducedMotion: MotionDebugState;
}

interface EffectLifecycleCounters {
  culledEffectCount: number;
  disposedEffectGeometryCount: number;
  disposedEffectMaterialCount: number;
  disposedProposalGeometryCount: number;
  disposedProposalMaterialCount: number;
}

interface RenderBudgetDiagnostics {
  renderMode: WorldRendererRenderMode;
  frameScheduled: boolean;
  frameCount: number;
  lastFrameDeltaMs: number;
  averageFrameDeltaMs: number;
  maxFrameDeltaMs: number;
  lastRenderMs: number;
  averageRenderMs: number;
  maxRenderMs: number;
  sceneObjectCount: number;
  sceneMeshCount: number;
  sceneLineCount: number;
  sceneLightCount: number;
  globalLightCount: number;
  stateOwnedPointLightCount: number;
  stateOwnedPointLightOwners: string[];
  stateOwnedPointLightCountByOwnerKind: Record<StateOwnedPointLightOwnerKind, number>;
  maxStateOwnedPointLights: number;
  css2DObjectCount: number;
  entityObjectCount: number;
  effectRootChildCount: number;
  proposalRootChildCount: number;
  labelRootChildCount: number;
  regionLabelCount: number;
  staticRebuildCount: number;
  dynamicSnapshotUpdateCount: number;
  resourceColorRebuildCount: number;
  resourceAbundanceRebuildCount: number;
  entityRebuildCount: number;
  proposalRebuildCount: number;
  activeBubbleCount: number;
  activeEffectCount: number;
  activeEffectCountByGroup: Record<string, number>;
  activeEffectCountByType: Record<string, number>;
  activeEffectObjectCount: number;
  activeEffectMeshCount: number;
  activeEffectLineCount: number;
  activeEffectParticleCount: number;
  detailScaleParticleThreshold: number;
  detailBudgetPressure: number;
  adaptiveDetailScale: number;
  pendingProposalVisualCount: number;
  pendingProposalObjectCount: number;
  maxActiveEffectCount: number;
  culledEffectCount: number;
  disposedEffectGeometryCount: number;
  disposedEffectMaterialCount: number;
  disposedProposalGeometryCount: number;
  disposedProposalMaterialCount: number;
  rendererInfo: {
    calls: number;
    triangles: number;
    points: number;
    lines: number;
    geometries: number;
    textures: number;
  };
  reducedMotion: MotionDebugState;
}

interface SceneryDiagnostics {
  recipeVersion: number;
  recipeHash: string | null;
  rebuildCount: number;
  instanceCount: number;
  visibleInstanceCount: number;
  maskedInstanceCount: number;
  dynamicClearanceCount: number;
  dynamicClearanceApplyCount: number;
  objectCount: number;
  crossingKinds: string[];
  regionArchetypes: Record<string, RegionArchetype>;
  quality: SceneryQuality;
}

interface AtlasRegion {
  key: string;
  display: string;
  snapshot: RegionSnapshot;
  cx: number;
  cz: number;
  baseR: number;
  relief: number;
  dome: number;
  seed: number;
  recipe: RegionVisualRecipeV1;
  energyRatio: number;
  materialRatio: number;
}

interface FocusFlight {
  t: number;
  duration: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromCamera: THREE.Vector3;
  toCamera: THREE.Vector3;
}

type HitKind = "region" | "agent" | "home";
type AnchorRole = "actor" | "target" | "home" | "region" | "fromRegion" | "toRegion";
type BuildAnchorSource = "home" | "planned" | "actor" | "region" | "primary";
type EffectGroup =
  | "movement"
  | "speech"
  | "resource"
  | "bond"
  | "combat"
  | "home"
  | "contest"
  | "life"
  | "system";
type BubblePriority = "ambient" | "featured" | "drama";
type BubbleArrivalPhase = "arriving" | "held" | "fading";
type BondLifecycleKind = "initiated" | "rejected" | "invalidated" | "timeout" | "birth";
type LifeTransitionKind = "paralyzed" | "died" | "decayed";

export const RENDERER_VISUAL_SPEC_EVENT_TYPES = [
  "agent_born",
  "agent_decayed",
  "agent_died",
  "agent_entered_region",
  "agent_left_region",
  "agent_paralyzed",
  "agent_recovered",
  "agent_started_hoarding",
  "attack",
  "hearth_used",
  "home_breached",
  "home_built",
  "home_collapsed",
  "home_colonized",
  "home_joined",
  "home_left",
  "home_started_hoarding",
  "home_thieved",
  "mating_initiated",
  "mating_proposal_invalidated",
  "mating_proposal_timeout",
  "mating_rejected",
  "resource_changed",
  "resource_transferred",
  "ruins_scavenged",
  "self_talk",
  "simulation_started",
  "speak",
] as const;

export const RENDERER_SPECIAL_GRAMMAR_EVENT_TYPES = [
  "agent_born",
  "agent_decayed",
  "agent_died",
  "agent_paralyzed",
  "agent_recovered",
  "agent_started_hoarding",
  "hearth_used",
  "home_breached",
  "home_built",
  "home_collapsed",
  "home_colonized",
  "home_joined",
  "home_left",
  "home_started_hoarding",
  "home_thieved",
  "mating_initiated",
  "mating_proposal_invalidated",
  "mating_proposal_timeout",
  "mating_rejected",
  "resource_changed",
  "ruins_scavenged",
] as const;

export const RENDERER_BUBBLE_GRAMMAR_EVENT_TYPES = [
  "agent_entered_region",
  "agent_left_region",
  "attack",
  "resource_transferred",
  "self_talk",
  "speak",
] as const;

export const RENDERER_PASSIVE_GRAMMAR_EVENT_TYPES = [
  "simulation_started",
] as const;

export const RENDERER_SPECIAL_EFFECT_EVENT_TYPES = [
  "agent_born",
  "agent_recovered",
  "agent_started_hoarding",
  "attack",
  "hearth_used",
  "home_breached",
  "home_built",
  "home_collapsed",
  "home_colonized",
  "home_joined",
  "home_left",
  "home_started_hoarding",
  "home_thieved",
  "mating_initiated",
  "mating_proposal_invalidated",
  "mating_proposal_timeout",
  "mating_rejected",
  "resource_changed",
  "ruins_scavenged",
  "self_talk",
] as const;

export const RENDERER_LIFE_TRANSITION_EVENT_TYPES = [
  "agent_decayed",
  "agent_died",
  "agent_paralyzed",
] as const;

export const RENDERER_BESPOKE_BUBBLE_SUMMARY_EVENT_TYPES = [
  "agent_entered_region",
  "agent_started_hoarding",
  "attack",
  "home_breached",
  "resource_transferred",
  "self_talk",
  "simulation_started",
  "speak",
] as const;

export const RENDERER_DEBUG_SUMMARY_KINDS = [
  "agent-hoard-bubble",
  "agent-hoard-shimmer",
  "agent-recovered-relight",
  "bond-lifecycle",
  "combat-bubble",
  "combat-impact",
  "generic-event-arc",
  "generic-event-bubble",
  "generic-event-pulse",
  "hearth-ember",
  "home-breach-bubble",
  "home-breach-shock",
  "home-build",
  "home-collapse",
  "home-colonize-raid",
  "home-membership-join",
  "home-membership-leave",
  "home-theft-raid",
  "home-vault-hoard",
  "life-transition",
  "movement-arrival",
  "private-thought",
  "private-thought-wisp",
  "resource-harvest",
  "resource-transfer",
  "ruin-scavenge",
  "shelter-use",
  "simulation-started",
  "speech-bubble",
] as const;

export const RENDERER_MOTION_MODE_SUMMARY_KINDS = [
  "agent-hoard-bubble",
  "agent-hoard-shimmer",
  "combat-bubble",
  "combat-impact",
  "generic-event-arc",
  "generic-event-bubble",
  "generic-event-pulse",
  "hearth-ember",
  "home-breach-bubble",
  "home-breach-shock",
  "home-build",
  "home-collapse",
  "home-colonize-raid",
  "home-membership-join",
  "home-membership-leave",
  "home-theft-raid",
  "home-vault-hoard",
  "movement-arrival",
  "private-thought",
  "private-thought-wisp",
  "resource-transfer",
  "ruin-scavenge",
  "shelter-use",
  "simulation-started",
  "speech-bubble",
] as const;

interface EffectDebugSummary {
  kind: string;
  raidKind?: HomeRaidKind;
  homeEventKind?: HomeLifecycleKind;
  bondEventKind?: BondLifecycleKind;
  lifeEventKind?: LifeTransitionKind;
  actorId?: string;
  targetId?: string;
  participantIds?: string[];
  initiatorId?: string;
  rejecterId?: string;
  acceptorId?: string;
  childId?: string;
  parentIds?: string[];
  homeId?: string;
  regionName?: string;
  fromRegionName?: string;
  toRegionName?: string;
  previousOwnerId?: string;
  newOwnerId?: string;
  previousStakeholderIds?: string[];
  newStakeholderIds?: string[];
  stakeholderIds?: string[];
  recipientIds?: string[];
  visibleEvicteeIds?: string[];
  vaultMaterials?: number;
  remnantMaterials?: number;
  agentMaterials?: number;
  resourceType?: string;
  amount?: number;
  energy?: number;
  materialsBurned?: number;
  energyGained?: number;
  agentEnergy?: number;
  diedAt?: number;
  decayedAt?: number;
  trigger?: string;
  lootMaterials?: number;
  breachIntent?: string;
  breacherIds?: string[];
  energyCost?: number;
  materialsCost?: number;
  integrityDamage?: number;
  integrity?: number;
  phase?: string;
  progress?: number;
  bubbleEventType?: string;
  pulseEventType?: string;
  arcEventType?: string;
  eventGroup?: EffectGroup;
  effectCarrier?: "bubble" | "pulse" | "arc";
  anchorRole?: AnchorRole | "system" | "primary";
  fromAnchorRole?: AnchorRole | "primary";
  toAnchorRole?: AnchorRole | "primary";
  motionCue?: string;
  streamDirection?: string;
  anchorSource?: BuildAnchorSource;
  anchorMode?: BuildAnchorSource;
  homeAnchored?: boolean;
  anchorWorld?: [number, number, number];
  homeWorld?: [number, number, number];
  buildSiteWorld?: [number, number, number];
  thresholdWorld?: [number, number, number];
  vaultWorld?: [number, number, number];
  streamFromWorld?: [number, number, number];
  streamToWorld?: [number, number, number];
  proxyFlameWorld?: [number, number, number];
  relightLightWorld?: [number, number, number];
  actorWorld?: [number, number, number];
  targetWorld?: [number, number, number];
  childWorld?: [number, number, number];
  parentWorlds?: Array<[number, number, number]>;
  relationshipThreadWorld?: Array<[number, number, number]>;
  actorPathWorld?: Array<[number, number, number]>;
  targetPathWorld?: Array<[number, number, number]>;
  actorVisible?: boolean;
  targetVisible?: boolean;
  childVisible?: boolean;
  durableHomePresent?: boolean;
  persistentHomeCreated?: boolean;
  proxyFigure?: boolean;
  scaffold?: boolean;
  scaffoldPoles?: number;
  scaffoldCrossbars?: number;
  buildRise?: boolean;
  buildDust?: boolean;
  warmRise?: boolean;
  risingHome?: boolean;
  buildSiteOnly?: boolean;
  durableHomeCreated?: boolean;
  durableChildCreated?: boolean;
  thresholdGlow?: boolean;
  thresholdSmoke?: boolean;
  thresholdLight?: boolean;
  thresholdTravel?: boolean;
  swallowCue?: boolean;
  proxyVisible?: boolean;
  proxyOpacity?: number;
  motionMode?: MotionMode;
  doorCue?: boolean;
  doorOpen?: boolean;
  doorStatic?: boolean;
  windowGlow?: boolean;
  smokeRateCue?: boolean;
  reducedMotionShelterCue?: boolean;
  breachCue?: boolean;
  crackCue?: boolean;
  membershipCue?: boolean;
  pledgeCue?: boolean;
  departureCue?: boolean;
  growthPreview?: boolean;
  shrinkPreview?: boolean;
  vaultStream?: boolean;
  vaultShimmer?: boolean;
  hoardThresholdCue?: boolean;
  goldMotes?: number;
  collapseCue?: boolean;
  ruinPreview?: boolean;
  remnantStream?: boolean;
  scavengeStream?: boolean;
  resourceStream?: boolean;
  resourceMotes?: number;
  relationshipThreadCue?: string;
  offerCue?: boolean;
  declineCue?: boolean;
  refundCue?: boolean;
  lapsedCue?: boolean;
  brokenCue?: boolean;
  birthCue?: boolean;
  paralysisCue?: boolean;
  deathCue?: boolean;
  decayCue?: boolean;
  flameDropCue?: boolean;
  bodyDissolveCue?: boolean;
  regionEnergyRatio?: number;
  regionMaterialRatio?: number;
  flameState?: AgentFlameState;
  flameLevel?: number;
  sourceFlameLevel?: number;
  targetFlameLevel?: number;
  relightCue?: boolean;
  communicationKind?: "speech" | "thought";
  worldBubbleCue?: boolean;
  passiveBubbleCue?: boolean;
  genericBubbleCue?: boolean;
  pulseCue?: boolean;
  passivePulseCue?: boolean;
  genericPulseCue?: boolean;
  arcCue?: boolean;
  passiveArcCue?: boolean;
  genericArcCue?: boolean;
  leaderLineCue?: boolean;
  thoughtWispCue?: boolean;
  interiorityCue?: boolean;
  heardByOthers?: boolean;
  thoughtMotes?: number;
  movementCue?: boolean;
  pathCue?: boolean;
  arrivalCue?: boolean;
  transferCue?: boolean;
  giftThreadCue?: boolean;
  beingHoardCue?: boolean;
  hoardShimmerCue?: boolean;
  systemEventKind?: "startup";
  systemCue?: boolean;
  startupCue?: boolean;
  worldAwakeningCue?: boolean;
  startupPulseCue?: boolean;
  passiveChronicleCue?: boolean;
  systemWorld?: [number, number, number];
  combatCue?: boolean;
  impactCue?: boolean;
  hitLineCue?: boolean;
  impactMotes?: number;
  breachShockCue?: boolean;
  terminalRaidCue?: boolean;
  breachMotes?: number;
  hearthEmberCue?: boolean;
  emberMotes?: number;
  targetStateMutated?: boolean;
  standingHomeCue?: boolean;
  lowIntegrityHomeCue?: boolean;
  bannerCue?: boolean;
  pennantCue?: boolean;
  ownerFlipCue?: boolean;
  evictionHints?: boolean;
  evictionHintCount?: number;
  persistentOccupancy?: boolean;
  actualActorMutated?: boolean;
  durableAgentMutated?: boolean;
  regionStateMutated?: boolean;
  durableHomeMutated?: boolean;
  homeStateMutated?: boolean;
  ruinStateMutated?: boolean;
  remnantStateMutated?: boolean;
  ownerStateMutated?: boolean;
  stakeholderStateMutated?: boolean;
  vaultStateMutated?: boolean;
  occupancyStateMutated?: boolean;
  liveStatusMutated?: boolean;
  runMetadataMutated?: boolean;
  replayArchiveMutated?: boolean;
  controlsMutated?: boolean;
  inspectorMutated?: boolean;
  selectionMutated?: boolean;
}

interface EffectDebugEntry {
  id: string;
  eventType: string;
  group: string;
  bubble?: {
    cursor: number;
    lane: number;
    priority: BubblePriority;
    catalogPriority: BubblePriority;
    glyph: string;
    iconKey: EventVisualIconKey;
    iconLabel: string;
    medallionLabel: string;
    accent: string;
    arrivalPhase: BubbleArrivalPhase;
    arrivalProgress: number;
    arrivalOpacity: number;
    offset: [number, number];
    anchorWorld: [number, number, number];
    screen: { x: number; y: number } | null;
    chainDetail?: {
      kind: string;
      text: string;
      count: number;
      window: string;
    };
  };
  summary?: EffectDebugSummary;
}

interface RecentRenderedEventBeatDebugEntry {
  cursor: number;
  eventType: string;
  group: string;
  summaryKinds: string[];
  hasBubble: boolean;
  hasPulse: boolean;
  hasArc: boolean;
  hasSpecial: boolean;
  effectCountDelta: number;
  summaryCount: number;
}

interface EventBeatRenderOptions {
  chainDetail?: EventChainDetailPresentation;
}

interface AgentVisualDebugState {
  visible: boolean;
  world: { x: number; y: number; z: number };
  screen: { x: number; y: number } | null;
  screenHeight: number;
  semanticWorldPoints: Partial<Record<AgentSemanticPartName, { x: number; y: number; z: number }>>;
  visual?: AgentVisualState;
}

interface AgentIdentityColors {
  identitySeed: number;
  paletteId: string;
  robeColor: string;
  underRobeColor: string;
  trimColor: string;
  pennantColor: string;
}

export type AgentSemanticPartName =
  | "under-robe"
  | "open-cloak-left"
  | "open-cloak-right"
  | "shoulder-cape"
  | "deep-cowl"
  | "shadow-face"
  | "open-palm"
  | "hand-flame";

interface AgentVisualState {
  id: string;
  status: string;
  energy: number;
  materials: number;
  identitySeed: number;
  paletteId: string;
  robeColor: string;
  underRobeColor: string;
  trimColor: string;
  accessory: AgentAccessoryKind;
  flameState: AgentFlameState;
  flameLevel: number;
  flameVisible: boolean;
  flameLightIntensity: number;
  flameSmokeCue: boolean;
  materialLoadRatio: number;
  carriedGoodsVisible: boolean;
  satchelCount: number;
  hoarding: boolean;
  renderedParts: number;
  semanticParts: AgentSemanticPartName[];
  objectCount: number;
  meshCount: number;
  lightCount: number;
  flameLightActive: boolean;
  visualHeight: number;
}

type AgentFlameState = "healthy" | "weary" | "fallen" | "dead";
type AgentAccessoryKind = "staff" | "pouch" | "none";

interface RegionAbundanceDebugState {
  regionName: string;
  displayName: string;
  currentEnergy: number;
  maxEnergy: number;
  currentMaterials: number;
  maxMaterials: number;
  energyRatio: number;
  materialRatio: number;
  energyMoteCount: number;
  materialScatterCount: number;
  terrainTint: "lush" | "material" | "scarce" | "mixed";
  sampleWorld: Array<{ x: number; y: number; z: number; kind: "energy" | "materials" }>;
}

interface HomeLayoutDebugState {
  id: string;
  regionName?: string;
  world: { x: number; y: number; z: number };
  screen: { x: number; y: number } | null;
  footprintRadius: number;
  nearestHomeId?: string;
  nearestDistance?: number;
  terrainHeight: number;
  islandMask?: number;
  onLand: boolean;
}

interface PendingProposalVisualDebugState {
  initiatorId: string;
  targetId: string;
  resources: Record<string, number>;
  source: "snapshot";
  eventOwned: false;
  openTimestamp: number | null;
  ageSeconds: number | null;
  initiatorWorld?: [number, number, number];
  targetWorld?: [number, number, number];
  medallionWorld?: [number, number, number];
  relationshipThreadWorld?: Array<[number, number, number]>;
  initiatorScreen: { x: number; y: number } | null;
  targetScreen: { x: number; y: number } | null;
  medallionScreen: { x: number; y: number } | null;
  selectionMutated: false;
  inspectorMutated: false;
}

interface ShelterEffectState {
  actorId: string;
  homeId: string;
  motionMode: MotionMode;
  actorStart: THREE.Vector3;
  actorMid: THREE.Vector3;
  homeWorld: THREE.Vector3;
  thresholdBase: THREE.Vector3;
  thresholdMid: THREE.Vector3;
  proxy: THREE.Group;
  proxyMaterials: THREE.Material[];
  proxyOpacity: number;
  doorPivot: THREE.Group;
  doorOpenAmount: number;
  doorMaterial: THREE.MeshBasicMaterial;
  doorGlowMaterial: THREE.MeshBasicMaterial;
  windowGlowMaterial: THREE.MeshBasicMaterial;
  thresholdSillMaterial: THREE.MeshBasicMaterial;
  thresholdMaterial: THREE.MeshBasicMaterial;
  pathMaterial: THREE.LineBasicMaterial;
  smokeMaterial: THREE.MeshBasicMaterial;
  glowMaterial: THREE.MeshBasicMaterial;
  light: THREE.PointLight;
  smoke: THREE.Mesh[];
}

interface HomeBuildEffectState {
  actorId?: string;
  homeId?: string;
  regionName?: string;
  anchorSource: BuildAnchorSource;
  anchorWorld: THREE.Vector3;
  homeWorld?: THREE.Vector3;
  durableHomePresentAtStart: boolean;
  frame: THREE.Group;
  frameMaterials: THREE.Material[];
  scaffoldMaterial: THREE.MeshBasicMaterial;
  crossbarMaterial: THREE.MeshBasicMaterial;
  dustMaterial: THREE.MeshBasicMaterial;
  glowMaterial: THREE.MeshBasicMaterial;
  light: THREE.PointLight;
  scaffoldPoles: THREE.Mesh[];
  scaffoldCrossbars: THREE.Mesh[];
  dust: THREE.Mesh[];
}

type HomeRaidKind = "theft" | "colonize";
type HomeLifecycleKind = "join" | "left" | "hoard" | "collapse" | "scavenge";

interface RaidMote {
  mesh: THREE.Mesh;
  points: THREE.Vector3[];
  offset: number;
}

interface RaidEvictionHint {
  agentId: string;
  proxy: THREE.Group;
  proxyMaterials: THREE.Material[];
  points: THREE.Vector3[];
  lineMaterial: THREE.LineBasicMaterial;
}

interface HomeRaidEffectState {
  raidKind: HomeRaidKind;
  actorId?: string;
  targetId?: string;
  homeId?: string;
  regionName?: string;
  previousOwnerId?: string;
  newOwnerId?: string;
  previousStakeholderIds: string[];
  newStakeholderIds: string[];
  recipientIds: string[];
  visibleEvicteeIds: string[];
  lootMaterials?: number;
  anchorSource: BuildAnchorSource;
  homeWorld: THREE.Vector3;
  thresholdWorld: THREE.Vector3;
  vaultWorld: THREE.Vector3;
  actorWorld?: THREE.Vector3;
  targetWorld?: THREE.Vector3;
  streamEndWorld?: THREE.Vector3;
  streamDirection?: string;
  standingHomeAtStart: boolean;
  lowIntegrityCue: boolean;
  durableHomePresentAtStart: boolean;
  shock: THREE.Mesh;
  lowCue: THREE.Mesh;
  cracks: THREE.Mesh[];
  motes: RaidMote[];
  evictionHints: RaidEvictionHint[];
  light: THREE.PointLight;
  shockMaterial: THREE.MeshBasicMaterial;
  crackMaterial: THREE.MeshBasicMaterial;
  lowCueMaterial: THREE.MeshBasicMaterial;
  streamMaterial?: THREE.MeshBasicMaterial;
  streamLineMaterial?: THREE.LineBasicMaterial;
  banner?: THREE.Group;
  bannerMaterial?: THREE.MeshBasicMaterial;
  pennantMaterial?: THREE.MeshBasicMaterial;
}

interface HomeLifecycleEffectState {
  lifecycleKind: HomeLifecycleKind;
  actorId?: string;
  homeId?: string;
  regionName?: string;
  previousOwnerId?: string;
  newOwnerId?: string;
  previousStakeholderIds: string[];
  stakeholderIds: string[];
  vaultMaterials?: number;
  remnantMaterials?: number;
  agentMaterials?: number;
  resourceType?: string;
  amount?: number;
  anchorSource: BuildAnchorSource;
  homeWorld: THREE.Vector3;
  thresholdWorld: THREE.Vector3;
  vaultWorld: THREE.Vector3;
  actorWorld?: THREE.Vector3;
  streamStartWorld?: THREE.Vector3;
  streamEndWorld?: THREE.Vector3;
  streamDirection?: string;
  durableHomePresentAtStart: boolean;
  standingHomeAtStart: boolean;
  ruinAtStart: boolean;
  cue: THREE.Mesh;
  cueMaterial: THREE.MeshBasicMaterial;
  pathLine?: THREE.Line;
  pathMaterial?: THREE.LineBasicMaterial;
  pathPoints?: THREE.Vector3[];
  proxy?: THREE.Group;
  proxyMaterials: THREE.Material[];
  motes: RaidMote[];
  fallParts: THREE.Mesh[];
  previewGroup?: THREE.Group;
  previewMaterials: THREE.Material[];
  light: THREE.PointLight;
}

interface ResourceHarvestEffectState {
  actorId?: string;
  regionName?: string;
  resourceType?: string;
  amount?: number;
  streamStartWorld: THREE.Vector3;
  streamEndWorld: THREE.Vector3;
  regionEnergyRatio?: number;
  regionMaterialRatio?: number;
  motes: RaidMote[];
  pathMaterial: THREE.LineBasicMaterial;
  moteMaterial: THREE.MeshBasicMaterial;
}

interface RecoveryRelightEffectState {
  actorId?: string;
  targetId?: string;
  regionName?: string;
  resourceType?: string;
  amount?: number;
  actorWorld?: THREE.Vector3;
  targetWorld: THREE.Vector3;
  sourceFlameLevel?: number;
  targetFlameLevel?: number;
  proxyFlame: THREE.Group;
  proxyMaterials: THREE.Material[];
  motes: RaidMote[];
  pathMaterial: THREE.LineBasicMaterial;
  moteMaterial: THREE.MeshBasicMaterial;
  light: THREE.PointLight;
}

interface BondLifecycleEffectState {
  bondEventKind: BondLifecycleKind;
  actorId?: string;
  targetId?: string;
  initiatorId?: string;
  rejecterId?: string;
  acceptorId?: string;
  childId?: string;
  parentIds: string[];
  participantIds: string[];
  regionName?: string;
  relationshipThreadCue: string;
  anchorWorld: THREE.Vector3;
  actorWorld?: THREE.Vector3;
  targetWorld?: THREE.Vector3;
  childWorld?: THREE.Vector3;
  parentWorlds: THREE.Vector3[];
  relationshipThreadWorld: THREE.Vector3[];
  threadLines: THREE.Line[];
  threadMaterial?: THREE.LineBasicMaterial;
  cueMaterial: THREE.MeshBasicMaterial;
  secondaryMaterial?: THREE.MeshBasicMaterial;
  moteMaterial?: THREE.MeshBasicMaterial;
  cueMeshes: THREE.Mesh[];
  proxy?: THREE.Group;
  proxyMaterials: THREE.Material[];
  motes: RaidMote[];
  light: THREE.PointLight;
}

interface LifeTransitionEffectState {
  transitionKind: LifeTransitionKind;
  actorId?: string;
  targetId?: string;
  regionName?: string;
  trigger?: string;
  energy?: number;
  diedAt?: number;
  decayedAt?: number;
  anchorWorld: THREE.Vector3;
  actorWorld?: THREE.Vector3;
  targetWorld?: THREE.Vector3;
  flameState: AgentFlameState;
}

interface BubbleEffectState {
  cursor: number;
  anchor: THREE.Vector3;
  screen: { x: number; y: number } | null;
  lane: number;
  priority: BubblePriority;
  catalogPriority: BubblePriority;
  glyph: string;
  iconKey: EventVisualIconKey;
  iconLabel: string;
  medallionLabel: string;
  accent: string;
  arrivalPhase: BubbleArrivalPhase;
  arrivalProgress: number;
  arrivalOpacity: number;
  offsetX: number;
  offsetY: number;
  chainDetail?: EventChainDetailPresentation;
}

interface BubbleLayoutMeasurement {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  screen: { x: number; y: number } | null;
  offsetX: number;
  offsetY: number;
}

interface BubbleLayoutRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface BubbleLayoutPass {
  compact: boolean;
  viewport: DOMRect;
  chromeRects: BubbleLayoutRect[];
  measurements: ReadonlyMap<VisualEffect, BubbleLayoutMeasurement>;
  screens: ReadonlyMap<VisualEffect, { x: number; y: number } | null>;
  placedBubbles: Array<{
    bubble: BubbleEffectState;
    screen: { x: number; y: number };
    rect: BubbleLayoutRect;
  }>;
}

interface VisualEffect {
  id: string;
  eventType: string;
  group: EffectGroup;
  root: THREE.Group;
  materials: THREE.Material[];
  label?: CSS2DObject;
  bubble?: BubbleEffectState;
  travel?: {
    object: THREE.Object3D;
    points: THREE.Vector3[];
  };
  shelter?: ShelterEffectState;
  homeBuild?: HomeBuildEffectState;
  homeRaid?: HomeRaidEffectState;
  homeLifecycle?: HomeLifecycleEffectState;
  resourceHarvest?: ResourceHarvestEffectState;
  recoveryRelight?: RecoveryRelightEffectState;
  bondLifecycle?: BondLifecycleEffectState;
  lifeTransition?: LifeTransitionEffectState;
  summary?: EffectDebugSummary;
  particleCount?: number;
  age: number;
  duration: number;
}

interface PendingProposalVisual {
  id: string;
  initiatorId: string;
  targetId: string;
  resources: Record<string, number>;
  timestamp: number | null;
  ageSeconds: number | null;
  root: THREE.Group;
  materials: THREE.Material[];
  initiatorWorld?: THREE.Vector3;
  targetWorld?: THREE.Vector3;
  medallionWorld?: THREE.Vector3;
  relationshipThreadWorld: THREE.Vector3[];
}

interface HomeVisualState {
  id: string;
  ruined: boolean;
  health: number;
  ownerId: string | null;
  stakeholderIds: string[];
  stakeholderCount: number;
  growth: number;
  vaultRatio: number;
  hoarding: boolean;
  breached: boolean;
  remnantRatio: number;
  leanToCount: number;
  pennantCount: number;
  ownerPaletteId: string | null;
  ownerPennantColor: string | null;
  stakeholderPennantColors: string[];
  pennantColors: string[];
  pennantSource: HomePennantSource[];
  identityDerivedPennants: boolean;
  renderedParts: number;
  visualHeight: number;
  windowEmissive: boolean;
  ownedLightCount: number;
  hearthLightActive: boolean;
  lightSource: "standing-home" | "hearth-event" | "vault" | null;
}

export type AtmosphereKey = "day" | "golden-hour" | "night";
export type AtmospherePhaseSource = "snapshot" | "test-override" | "reduced-motion";

export interface AtmosphereDebugState {
  key: AtmosphereKey;
  phase: number;
  progress: number;
  phaseSource: AtmospherePhaseSource;
  skyTopColor: string;
  skyHorizonColor: string;
  fogColor: string;
  directionalColor: string;
  hemisphereSkyColor: string;
  hemisphereGroundColor: string;
  waterTint: string;
  directionalIntensity: number;
  hemisphereIntensity: number;
  exposure: number;
}

interface TerrainContinuityDiagnostics {
  centralSize: number;
  centralSegments: number;
  continuationSize: number;
  continuationWorldY: number;
  continuationFadeStart: number;
  continuationFadeEnd: number;
  centralAlpha: number;
  edgeAlpha: number;
  maxBoundaryHeightDelta: number;
  boundaryTriangleCount: number;
  terrainMaterialTransparent: boolean;
  sourceTriangleCount: number;
  sourceLandCoastTriangleCount: number;
  retainedTriangleCount: number;
  retainedLandCoastTriangleCount: number;
  retainedFullyUnderwaterTriangleCount: number;
  continuationBelowWater: boolean;
}

type HomePennantRole = "owner" | "stakeholder";

interface HomePennantSource {
  index: number;
  id: string;
  role: HomePennantRole;
  paletteId: string;
  color: string;
  source: "agent-id";
}

type HomeIdentityPennantState = Pick<
  HomeVisualState,
  | "ownerId"
  | "stakeholderIds"
  | "ownerPaletteId"
  | "ownerPennantColor"
  | "stakeholderPennantColors"
  | "pennantColors"
  | "pennantSource"
  | "identityDerivedPennants"
>;

interface EventVisualSpec {
  group: EffectGroup;
  actorId?: string;
  targetId?: string;
  initiatorId?: string;
  rejecterId?: string;
  acceptorId?: string;
  childId?: string;
  parentIds?: string[];
  homeId?: string;
  regionName?: string;
  fromRegionName?: string;
  toRegionName?: string;
  label?: string;
  bubbleClass: string;
  color: string;
  pulseScale: number;
  primaryAnchor?: AnchorRole;
  pulseAnchor?: AnchorRole;
  arc?: {
    from: AnchorRole;
    to: AnchorRole;
  };
  suppressDefaultArc?: boolean;
  suppressDefaultPulse?: boolean;
  previousOwnerId?: string;
  newOwnerId?: string;
  previousStakeholderIds?: string[];
  newStakeholderIds?: string[];
  recipientIds?: string[];
  vaultMaterials?: number;
  remnantMaterials?: number;
  agentMaterials?: number;
  resourceType?: string;
  amount?: number;
  lootMaterials?: number;
  materialsBurned?: number;
  energyGained?: number;
  agentEnergy?: number;
  breachIntent?: string;
  breacherIds?: string[];
  energyCost?: number;
  materialsCost?: number;
  integrityDamage?: number;
  integrity?: number;
  lifeTransitionKind?: LifeTransitionKind;
  trigger?: string;
  energy?: number;
  diedAt?: number;
  decayedAt?: number;
}

interface VivariumWorldDebugHandle {
  isReady: boolean;
  atlasLayoutHash: () => string;
  atlasTopologyDiagnostics: () => AtlasLayout["diagnostics"];
  cameraState: () => {
    distance: number;
    target: number[];
    zoomSpeed: number;
    minDistance: number;
    zoomToCursor: boolean;
  };
  screenPointForRegion: (regionName: string) => { x: number; y: number } | null;
  screenPointForAgent: (agentId: string) => { x: number; y: number } | null;
  worldPointForRegion: (regionName: string) => { x: number; z: number } | null;
  screenPointForHome: (homeId: string) => { x: number; y: number } | null;
  worldPointForHome: (homeId: string) => { x: number; y: number; z: number } | null;
  homeVisualState: (homeId: string) => HomeVisualState | null;
  homeLayoutState: (homeId: string) => HomeLayoutDebugState | null;
  regionAbundanceState: (regionName: string) => RegionAbundanceDebugState | null;
  focusRegion: (regionName: string) => boolean;
  focusHome: (homeId: string) => boolean;
  focusAgent: (agentId: string) => boolean;
  atmosphereState: () => AtmosphereDebugState;
  setObserverVisualPhaseForTest: (phase: number | null) => void;
  sampleCanvasPixels: () => number;
  agentVisualState: (agentId: string) => AgentVisualDebugState | null;
  pendingProposalVisualState: () => PendingProposalVisualDebugState[];
  activeEffects: () => EffectDebugEntry[];
  activeEventEffects: () => EffectDebugEntry[];
  eventEffectCount: () => number;
  activeEffectCounts: () => {
    total: number;
    byGroup: Record<string, number>;
    byType: Record<string, number>;
  };
  effectLifecycleDiagnostics: () => EffectLifecycleDiagnostics;
  renderBudgetDiagnostics: () => RenderBudgetDiagnostics;
  terrainContinuityDiagnostics: () => TerrainContinuityDiagnostics;
  sceneryDiagnostics: () => SceneryDiagnostics;
  motionMode: () => MotionDebugState;
  appliedEventCursors: () => number[];
  renderedEventCursors: () => number[];
  recentRenderedEventBeats: () => RecentRenderedEventBeatDebugEntry[];
  markEventCursorHandled: (cursor: number) => void;
  markSnapshotCursorHandled: (cursor: number) => void;
  applyEventBeat: (entry: EventEnvelopeEntry, options?: EventBeatRenderOptions) => void;
}

export type StateOwnedPointLightOwnerKind = "agent" | "home" | "spring";

export interface StateOwnedPointLightCandidate {
  ownerKind: StateOwnedPointLightOwnerKind;
  ownerId: string;
  intensity: number;
  distanceSquared: number;
}

interface StateOwnedPointLightRecord extends StateOwnedPointLightCandidate {
  light: THREE.PointLight;
  owner: THREE.Object3D;
}

export const STATE_OWNED_POINT_LIGHT_BUDGETS: Readonly<
  Record<SceneryQuality, number>
> = {
  full: 12,
  reduced: 6,
  tour: 4,
};

export const ATLAS_OBSERVER_CYCLE_PERIOD_SECONDS = 600;
export const REDUCED_MOTION_OBSERVER_PHASE = 0.14;

/** Select persistent local-light owners without depending on input order. */
export function allocateStateOwnedPointLightOwners(
  candidates: readonly StateOwnedPointLightCandidate[],
  quality: SceneryQuality,
  selectedOwnerKey?: string | null,
): string[] {
  const unique = new Map<string, StateOwnedPointLightCandidate>();
  for (const candidate of candidates) {
    const key = stateOwnedPointLightOwnerKey(candidate);
    const previous = unique.get(key);
    if (
      !previous
      || stateOwnedPointLightScore(candidate) > stateOwnedPointLightScore(previous)
    ) {
      unique.set(key, candidate);
    }
  }
  const ranked = [...unique.values()].sort((left, right) => {
    const scoreDelta = stateOwnedPointLightScore(right) - stateOwnedPointLightScore(left);
    if (Math.abs(scoreDelta) > 1e-12) {
      return scoreDelta;
    }
    return lexicalCompare(
      stateOwnedPointLightOwnerKey(left),
      stateOwnedPointLightOwnerKey(right),
    );
  });
  const budget = STATE_OWNED_POINT_LIGHT_BUDGETS[quality];
  const selected = selectedOwnerKey ? unique.get(selectedOwnerKey) : undefined;
  const allocation = selected ? [selected] : [];
  for (const candidate of ranked) {
    if (allocation.length >= budget) {
      break;
    }
    if (candidate !== selected) {
      allocation.push(candidate);
    }
  }
  return allocation.map(stateOwnedPointLightOwnerKey);
}

/** Derive the observer-only cycle phase from stable snapshot identity and world time. */
export function observerCyclePhase(
  snapshot: Pick<WorldSnapshot, "run_id" | "world_time">,
): number {
  const seedOffset = stringHash(snapshot.run_id) / 0x1_0000_0000;
  return positiveFraction(
    seedOffset + snapshot.world_time / ATLAS_OBSERVER_CYCLE_PERIOD_SECONDS,
  );
}

/** Project a normalized observer phase into bounded, readable lighting values. */
export function atmosphereStateAt(phase: number): AtmosphereDebugState {
  const normalizedPhase = positiveFraction(Number.isFinite(phase) ? phase : 0);
  const anchors: Array<{
    phase: number;
    palette: Omit<AtmosphereDebugState, "key" | "phase" | "progress" | "phaseSource">;
  }> = [
    { phase: 0, palette: NIGHT_ATMOSPHERE },
    { phase: 0.08, palette: NIGHT_ATMOSPHERE },
    { phase: 0.14, palette: GOLDEN_ATMOSPHERE },
    { phase: 0.2, palette: DAY_ATMOSPHERE },
    { phase: 0.72, palette: DAY_ATMOSPHERE },
    { phase: 0.78, palette: GOLDEN_ATMOSPHERE },
    { phase: 0.86, palette: NIGHT_ATMOSPHERE },
    { phase: 1, palette: NIGHT_ATMOSPHERE },
  ];
  const rightIndex = Math.max(
    1,
    anchors.findIndex((anchor) => anchor.phase >= normalizedPhase),
  );
  const left = anchors[rightIndex - 1];
  const right = anchors[rightIndex];
  const mix = clamp(
    (normalizedPhase - left.phase) / Math.max(1e-9, right.phase - left.phase),
    0,
    1,
  );
  const key: AtmosphereKey =
    normalizedPhase >= 0.2 && normalizedPhase < 0.72
      ? "day"
      : (normalizedPhase >= 0.08 && normalizedPhase < 0.2)
        || (normalizedPhase >= 0.72 && normalizedPhase < 0.86)
        ? "golden-hour"
        : "night";
  const progress = atmosphereKeyProgress(normalizedPhase, key);
  const fogColor = blendHex(left.palette.fogColor, right.palette.fogColor, mix);
  return {
    key,
    phase: normalizedPhase,
    progress,
    phaseSource: "snapshot",
    skyTopColor: blendHex(left.palette.skyTopColor, right.palette.skyTopColor, mix),
    skyHorizonColor: fogColor,
    fogColor,
    directionalColor: blendHex(
      left.palette.directionalColor,
      right.palette.directionalColor,
      mix,
    ),
    hemisphereSkyColor: blendHex(
      left.palette.hemisphereSkyColor,
      right.palette.hemisphereSkyColor,
      mix,
    ),
    hemisphereGroundColor: blendHex(
      left.palette.hemisphereGroundColor,
      right.palette.hemisphereGroundColor,
      mix,
    ),
    waterTint: blendHex(left.palette.waterTint, right.palette.waterTint, mix),
    directionalIntensity: lerp(
      left.palette.directionalIntensity,
      right.palette.directionalIntensity,
      mix,
    ),
    hemisphereIntensity: lerp(
      left.palette.hemisphereIntensity,
      right.palette.hemisphereIntensity,
      mix,
    ),
    exposure: lerp(left.palette.exposure, right.palette.exposure, mix),
  };
}

const DAY_ATMOSPHERE = atmospherePalette({
  skyTopColor: "#7198ad",
  fogColor: "#bfc3b7",
  directionalColor: "#ffd9a0",
  hemisphereSkyColor: "#8fb3c9",
  hemisphereGroundColor: "#5a4f3a",
  waterTint: "#d8f1ec",
  directionalIntensity: 2.1,
  hemisphereIntensity: 0.58,
  exposure: 1.04,
});

const GOLDEN_ATMOSPHERE = atmospherePalette({
  skyTopColor: "#3e6078",
  fogColor: "#b58b6c",
  directionalColor: "#ffd09a",
  hemisphereSkyColor: "#7796a8",
  hemisphereGroundColor: "#594333",
  waterTint: "#829b86",
  directionalIntensity: 1.62,
  hemisphereIntensity: 0.4,
  exposure: 1.06,
});

const NIGHT_ATMOSPHERE = atmospherePalette({
  skyTopColor: "#101d2c",
  fogColor: "#32485a",
  directionalColor: "#a9c4dc",
  hemisphereSkyColor: "#58758c",
  hemisphereGroundColor: "#2f3b38",
  waterTint: "#3f6770",
  directionalIntensity: 0.92,
  hemisphereIntensity: 0.3,
  exposure: 1.03,
});

function atmospherePalette(
  input: Omit<AtmosphereDebugState, "key" | "phase" | "progress" | "phaseSource" | "skyHorizonColor">,
): Omit<AtmosphereDebugState, "key" | "phase" | "progress" | "phaseSource"> {
  return { ...input, skyHorizonColor: input.fogColor };
}

function atmosphereKeyProgress(phase: number, key: AtmosphereKey): number {
  if (key === "day") {
    return clamp((phase - 0.2) / 0.52, 0, 1);
  }
  if (key === "golden-hour") {
    return phase < 0.2
      ? clamp((phase - 0.08) / 0.12, 0, 1)
      : clamp((phase - 0.72) / 0.14, 0, 1);
  }
  return phase < 0.08
    ? clamp(phase / 0.08, 0, 1)
    : clamp((phase - 0.86) / 0.14, 0, 1);
}

function stateOwnedPointLightOwnerKey(
  candidate: Pick<StateOwnedPointLightCandidate, "ownerKind" | "ownerId">,
): string {
  return `${candidate.ownerKind}:${candidate.ownerId}`;
}

function stateOwnedPointLightScore(candidate: StateOwnedPointLightCandidate): number {
  return Math.max(0, candidate.intensity) / (1 + Math.max(0, candidate.distanceSquared) * 0.01);
}

function positiveFraction(value: number): number {
  return ((value % 1) + 1) % 1;
}

const SEA_DEPTH = 3.4;
const TERRAIN_SIZE = 200;
const TERRAIN_SEGMENTS = 132;
const TERRAIN_COAST_HEIGHT = 0;
const WATER_SIZE = 2200;
const FAR_SEABED_Y = -SEA_DEPTH - 0.18;
const TERRAIN_EDGE_FEATHER_START = TERRAIN_SIZE * 0.42;
const OCEAN_FADE_START = TERRAIN_SIZE * 0.76;
const OCEAN_FADE_END = 360;
const OCEAN_ALPHA_MAP_SIZE = 64;
const RIDGE_WIDTH = 2.2;
const RIDGE_HEIGHT = 0.5;
const MATERIAL_CARRY_VISUAL_FULL = 80;
const BUBBLE_CLUSTER_SCREEN_RADIUS = 210;
const BUBBLE_CLUSTER_SCREEN_RADIUS_COMPACT = 152;
const BUBBLE_CLUSTER_WORLD_RADIUS = 7.5;
const BUBBLE_ESTIMATED_WIDTH = 204;
const BUBBLE_ESTIMATED_HEIGHT = 70;
const BUBBLE_ESTIMATED_WIDTH_COMPACT = 158;
const BUBBLE_ESTIMATED_HEIGHT_COMPACT = 72;
const BUBBLE_COLLISION_GAP = 12;
const MAX_ACTIVE_EFFECT_COUNT = 96;
const MAX_ACTIVE_EFFECT_PARTICLE_COUNT = 144;
const MAX_VISIBLE_EVICTION_HINTS = 4;
const MAX_RECENT_RENDERED_EVENT_BEATS = 24;
const MAX_RENDERED_EVENT_BEAT_SUMMARY_KINDS = 8;
const MAX_RENDERED_EVENT_BEAT_STRING_LENGTH = 64;

const FULL_MOTION_SETTINGS: MotionSettings = {
  mode: "full",
  waterAmplitude: 0.09,
  waterTimeScale: 1,
  focusDuration: 0.72,
  controlsDampingFactor: 0.06,
  defaultRiseSpeed: 0.18,
  defaultGrow: 1.45,
  defaultLabelLift: 1.1,
  defaultTravelPulse: 0.7,
  arcLiftScale: 1,
  arcSegments: 36,
  pathSegments: 38,
  particleDensity: 1,
  jitterScale: 1,
  pulseScale: 1,
  driftScale: 1,
  rotationScale: 1,
};

const REDUCED_MOTION_SETTINGS: MotionSettings = {
  mode: "reduced",
  waterAmplitude: 0.035,
  waterTimeScale: 0,
  focusDuration: 0,
  controlsDampingFactor: 0.015,
  defaultRiseSpeed: 0.035,
  defaultGrow: 0.42,
  defaultLabelLift: 0.28,
  defaultTravelPulse: 0.2,
  arcLiftScale: 0.42,
  arcSegments: 20,
  pathSegments: 22,
  particleDensity: 0.55,
  jitterScale: 0.22,
  pulseScale: 0.42,
  driftScale: 0.35,
  rotationScale: 0.2,
};

const BUBBLE_LANE_OFFSETS = [
  { x: 0, y: 0 },
  { x: 176, y: -10 },
  { x: -176, y: -10 },
  { x: 92, y: -82 },
  { x: -92, y: -82 },
  { x: 176, y: -132 },
  { x: -176, y: -132 },
  { x: 0, y: -166 },
  { x: 266, y: -56 },
  { x: -266, y: -56 },
  { x: 120, y: -226 },
  { x: -120, y: -226 },
  { x: 266, y: -206 },
  { x: -266, y: -206 },
  { x: 0, y: -284 },
  { x: 0, y: 72 },
  { x: 154, y: 74 },
  { x: -154, y: 74 },
  { x: 74, y: 142 },
  { x: -74, y: 142 },
] as const;

const BUBBLE_LANE_OFFSETS_COMPACT = [
  { x: 0, y: 0 },
  { x: 114, y: -10 },
  { x: -114, y: -10 },
  { x: 58, y: -76 },
  { x: -58, y: -76 },
  { x: 0, y: -158 },
  { x: 114, y: -158 },
  { x: -114, y: -158 },
  { x: 164, y: -74 },
  { x: -164, y: -74 },
  { x: 154, y: -232 },
  { x: 0, y: -286 },
  { x: 0, y: 64 },
  { x: 98, y: 64 },
  { x: -98, y: 64 },
] as const;

const BUBBLE_LANE_ORDER: Record<BubblePriority, number[]> = {
  drama: [0, 1, 2, 3, 4, 15, 16, 17, 5, 6, 8, 9, 18, 19, 7, 10, 11, 12, 13, 14],
  featured: [1, 2, 3, 4, 8, 9, 15, 16, 17, 0, 5, 6, 18, 19, 10, 11, 7, 12, 13, 14],
  ambient: [3, 4, 5, 6, 10, 11, 15, 16, 17, 1, 2, 8, 9, 18, 19, 7, 0, 12, 13, 14],
};

const DRAMA_BUBBLE_EVENTS = new Set([
  "agent_died",
  "agent_paralyzed",
  "attack",
  "home_breached",
  "home_thieved",
  "home_colonized",
  "home_collapsed",
]);

const FEATURED_BUBBLE_EVENTS = new Set([
  "speak",
  "self_talk",
  "agent_born",
  "agent_recovered",
  "mating_initiated",
  "mating_rejected",
  "mating_proposal_invalidated",
  "mating_proposal_timeout",
  "home_built",
  "hearth_used",
  "simulation_started",
]);

interface LayoutPoint {
  cx: number;
  cz: number;
  baseR: number;
  relief: number;
  dome: number;
}

const CANONICAL_LAYOUT: Record<string, LayoutPoint> = {
  nirvana: { cx: 0, cz: -32.4, baseR: 33.8, relief: 4.2, dome: 3.2 },
  nirvana_east: { cx: 62.1, cz: -13.5, baseR: 25.7, relief: 2.6, dome: 1.2 },
  warm_springs: { cx: 8.1, cz: 29.7, baseR: 35.1, relief: 3.4, dome: 1.6 },
  nirvana_west: { cx: -54, cz: -8.1, baseR: 16.2, relief: 3.0, dome: 1.4 },
};

const CANONICAL_REGION_IDS = Object.keys(CANONICAL_LAYOUT).sort();

const BIOME_GROUND_BASE_COLORS: Readonly<
  Record<RegionArchetype, readonly [string, string]>
> = {
  ash_waste: ["#57504a", "#48413c"],
  spring_terraces: ["#6fae60", "#4f8a5c"],
  dry_scrub: ["#a58e58", "#806a45"],
  worn_heartland: ["#7a8d55", "#8a6f4d"],
  neutral_temperate: ["#7a9a52", "#b0a468"],
};

/** Return the immutable base colors that preserve a region's biome identity. */
export function biomeGroundBaseColors(
  archetype: RegionArchetype,
): readonly [string, string] {
  return BIOME_GROUND_BASE_COLORS[archetype];
}

const BIOME_GROUND_PALETTE: Readonly<
  Record<RegionArchetype, readonly [THREE.Color, THREE.Color]>
> = {
  ash_waste: [new THREE.Color("#57504a"), new THREE.Color("#48413c")],
  spring_terraces: [new THREE.Color("#6fae60"), new THREE.Color("#4f8a5c")],
  dry_scrub: [new THREE.Color("#a58e58"), new THREE.Color("#806a45")],
  worn_heartland: [new THREE.Color("#7a8d55"), new THREE.Color("#8a6f4d")],
  neutral_temperate: [new THREE.Color("#7a9a52"), new THREE.Color("#b0a468")],
};

const ENTITY_OFFSETS = [
  [0, 4.4],
  [3.8, 2.4],
  [-3.8, 2.4],
  [3.6, -2.8],
  [-3.6, -2.8],
  [0, -4.6],
] as const;

const HOME_OFFSETS = [
  [-5.5, 4.2],
  [-8.6, 1.1],
  [-3.1, 6.9],
  [-9.2, 6.5],
  [-2.2, 2.0],
  [-6.4, 8.7],
] as const;

const PALETTE = {
  skyTop: new THREE.Color("#7aa0b8"),
  skyBottom: new THREE.Color("#e8d0a2"),
  fog: new THREE.Color("#cdbb96"),
  lushA: new THREE.Color("#7a9a52"),
  lushB: new THREE.Color("#93b168"),
  springA: new THREE.Color("#6fae60"),
  goldA: new THREE.Color("#c9a24c"),
  goldB: new THREE.Color("#d9b56d"),
  ash: new THREE.Color("#57504a"),
  ashDark: new THREE.Color("#48413c"),
  dryGrass: new THREE.Color("#b0a468"),
  dirt: new THREE.Color("#8a6f4d"),
  sand: new THREE.Color("#c9b488"),
  rock: new THREE.Color("#7d766b"),
  path: new THREE.Color("#b9a179"),
  seabed: new THREE.Color("#3a4c44"),
  waterDeep: new THREE.Color("#1e4750"),
  waterShallow: new THREE.Color("#37827c"),
  foam: new THREE.Color("#d7ecdf"),
};

const AGENT_PALETTES = [
  { id: "slate-blue", robe: "#5b6478", under: "#3e4659", trim: "#b39560" },
  { id: "violet-grey", robe: "#6a5f78", under: "#473f58", trim: "#c0a06c" },
  { id: "moss", robe: "#6f7d5a", under: "#48543c", trim: "#b19b63" },
  { id: "ochre", robe: "#9c7f4e", under: "#665032", trim: "#c0a66f" },
  { id: "bone-grey", robe: "#847e6b", under: "#595448", trim: "#bca875" },
  { id: "spring-slate", robe: "#517476", under: "#334f50", trim: "#b99b5d" },
] as const;

declare global {
  interface Window {
    __vivariumWorld?: VivariumWorldDebugHandle;
    __viv?: {
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      controls: OrbitControls;
      terrain: THREE.Mesh;
      renderer: THREE.WebGLRenderer;
      terrainHeight: (x: number, z: number) => number;
      regionScreenPoint: (regionName: string) => { x: number; y: number } | null;
      ready: boolean;
    };
  }
}

export class WorldRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer = new CSS2DRenderer();
  private sun!: THREE.DirectionalLight;
  private hemisphere!: THREE.HemisphereLight;
  private skyMaterial!: THREE.ShaderMaterial;
  private readonly oceanAlphaMap: THREE.DataTexture;
  private readonly terrain: THREE.Mesh;
  private readonly farSeabed: THREE.Mesh;
  private readonly water: THREE.Mesh;
  private readonly waterBase: Float32Array;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly clock = new THREE.Clock();
  private readonly root = new THREE.Group();
  private readonly sceneryRoot = new THREE.Group();
  private readonly resourceRoot = new THREE.Group();
  private readonly entityRoot = new THREE.Group();
  private readonly proposalRoot = new THREE.Group();
  private readonly effectRoot = new THREE.Group();
  private readonly labelRoot = new THREE.Group();
  private readonly hitMeshes: THREE.Object3D[] = [];
  private readonly entityObjects = new Map<string, THREE.Object3D>();
  private readonly resourceObjects = new Map<string, THREE.Object3D>();
  private readonly regionLabels = new Map<string, CSS2DObject>();
  private readonly selectionRing: THREE.Mesh;
  private readonly options: WorldRendererOptions;
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotionQuery: MediaQueryList | null;
  private readonly frameScheduler: WorldFrameScheduler;
  private motionDebug: MotionDebugState;
  private motionSettings: MotionSettings;
  private readonly lifecycleCounters: EffectLifecycleCounters = {
    culledEffectCount: 0,
    disposedEffectGeometryCount: 0,
    disposedEffectMaterialCount: 0,
    disposedProposalGeometryCount: 0,
    disposedProposalMaterialCount: 0,
  };
  private readonly renderBudget = {
    frameCount: 0,
    lastFrameStartedAt: null as number | null,
    lastFrameDeltaMs: 0,
    totalFrameDeltaMs: 0,
    maxFrameDeltaMs: 0,
    lastRenderMs: 0,
    totalRenderMs: 0,
    maxRenderMs: 0,
  };
  private publishedWorldDebugHandle: VivariumWorldDebugHandle | null = null;
  private readonly focus: FocusFlight = {
    t: 1,
    duration: 0.72,
    fromTarget: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
    fromCamera: new THREE.Vector3(),
    toCamera: new THREE.Vector3(),
  };

  private atlas: AtlasRegion[] = [];
  private atlasLayoutState: AtlasLayout = deriveAtlasLayout([]);
  private currentSceneryRegions: readonly RegionSnapshot[] = [];
  private topologySignature: string | null = null;
  private sceneryRecipeHash: string | null = null;
  private resourceSignature: string | null = null;
  private entitySignature: string | null = null;
  private proposalSignature: string | null = null;
  private selected: RendererSelection | null = null;
  private initialAtlasFitApplied = false;
  private userNavigated = false;
  private safeFrame: SafeFrameInsets = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  private staticRebuildCount = 0;
  private sceneryRebuildCount = 0;
  private sceneryInstanceCount = 0;
  private sceneryObjectCount = 0;
  private sceneryMaskedInstanceCount = 0;
  private sceneryDynamicClearanceCount = 0;
  private sceneryDynamicClearanceApplyCount = 0;
  private sceneryCrossingKinds: string[] = [];
  private sceneryRegionArchetypes: Record<string, RegionArchetype> = {};
  private sceneryQualityState: SceneryQuality = "full";
  private readonly sceneryLayers: RegionSceneryLayer[] = [];
  private readonly activeStateOwnedPointLightOwnerKeys = new Set<string>();
  private currentSnapshot: WorldSnapshot | null = null;
  private observerVisualPhaseOverride: number | null = null;
  private atmosphereDebugState: AtmosphereDebugState = atmosphereStateAt(
    REDUCED_MOTION_OBSERVER_PHASE,
  );
  private appliedAtmosphereSignature: string | null = null;
  private dynamicSnapshotUpdateCount = 0;
  private resourceColorRebuildCount = 0;
  private resourceAbundanceRebuildCount = 0;
  private entityRebuildCount = 0;
  private proposalRebuildCount = 0;
  private readonly effects: VisualEffect[] = [];
  private readonly activeBubbleEffects = new Set<VisualEffect>();
  private activeBubbleLimit = 3;
  private newEffectCapture: VisualEffect[] | null = null;
  private readonly pendingProposalVisuals: PendingProposalVisual[] = [];
  private eventPresentationContext = eventPresentationContextFromSnapshot(null);
  private bubbleLayoutSignature = "";
  private readonly appliedEventCursors = new Set<number>();
  private readonly renderedEventCursors = new Set<number>();
  private readonly appliedEventOrder: number[] = [];
  private readonly recentRenderedEventBeatRing: RecentRenderedEventBeatDebugEntry[] = [];
  private snapshotCursorFloor = 0;
  private downX = 0;
  private downY = 0;
  private lastResizeWidth = 0;
  private lastResizeHeight = 0;
  private lastPixelRatio = 0;
  private needsWebGLRender = true;
  private disposed = false;
  private time = 0;

  private readonly onControlsStart = (): void => {
    this.userNavigated = true;
  };

  private readonly onControlsEnd = (): void => {
    this.enforceStateOwnedPointLightBudget();
    this.publishDebugHandle();
    this.invalidateFrame();
  };

  private readonly onWindowResize = (): void => {
    this.resize();
  };

  private readonly onReducedMotionPreferenceChange = (): void => {
    this.refreshMotionSettings();
    const nextQuality = this.resolveSceneryQuality();
    if (nextQuality !== this.sceneryQualityState) {
      this.sceneryQualityState = nextQuality;
      const recipeHash = worldSceneryRecipeHash(
        this.currentSceneryRegions,
        nextQuality,
      );
      if (recipeHash !== this.sceneryRecipeHash) {
        this.rebuildScenery(this.currentSceneryRegions, recipeHash);
        this.applySceneryEntityClearings(this.currentSnapshot);
      }
      this.invalidateFrame();
    }
    this.updateObserverAtmosphere(this.currentSnapshot);
    this.enforceStateOwnedPointLightBudget();
    this.publishDebugHandle();
  };

  constructor(
    private readonly container: HTMLElement,
    options: WorldRendererOptions = {},
  ) {
    this.options = options;
    this.frameScheduler = new WorldFrameScheduler(
      options.renderMode ?? "live",
      this.renderFrame,
      {
        maximumFramesPerSecond: this.isTourEffectDetail() ? 1_000 / 220 : 60,
      },
    );
    this.reducedMotionQuery = reducedMotionQueryFor(options.reducedMotion);
    this.motionDebug = resolveMotionDebug(options.reducedMotion, this.reducedMotionQuery);
    this.motionSettings = motionSettingsFor(this.motionDebug);
    this.sceneryQualityState = this.resolveSceneryQuality();
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isTourEffectDetail(),
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(this.targetPixelRatio());
    this.renderer.debug.checkShaderErrors = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = this.options.effectDetail !== "tour";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.dataset.testid = "vivarium-world-canvas";
    this.container.appendChild(this.renderer.domElement);

    Object.assign(this.labelRenderer.domElement.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2",
    });
    this.labelRenderer.domElement.dataset.testid = "vivarium-world-labels";
    this.container.appendChild(this.labelRenderer.domElement);

    this.scene.fog = new THREE.Fog(PALETTE.fog, 80, 210);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.08, 700);
    const target = new THREE.Vector3(8, 2.2, -1.4);
    this.camera.position
      .setFromSphericalCoords(172, THREE.MathUtils.degToRad(50), THREE.MathUtils.degToRad(-35))
      .add(target);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(target);
    this.controls.enabled = options.interactive ?? true;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = this.motionSettings.controlsDampingFactor;
    this.controls.zoomToCursor = true;
    this.controls.zoomSpeed = 3.4;
    this.controls.panSpeed = 0.92;
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(20);
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(68);
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 215;
    this.controls.autoRotateSpeed = 0.15;
    this.controls.addEventListener("start", this.onControlsStart);
    this.controls.addEventListener("end", this.onControlsEnd);
    this.controls.addEventListener("change", () => {
      this.invalidateFrame();
      const targetVector = this.controls.target;
      const horizontal = Math.hypot(targetVector.x, targetVector.z);
      if (horizontal > 92) {
        targetVector.x *= 92 / horizontal;
        targetVector.z *= 92 / horizontal;
      }
      targetVector.y = clamp(targetVector.y, 0, 12);
    });

    this.scene.add(
      this.root,
      this.sceneryRoot,
      this.resourceRoot,
      this.entityRoot,
      this.proposalRoot,
      this.effectRoot,
      this.labelRoot,
    );
    this.buildLights();
    this.buildSky();
    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(1.8, 2.35, 48),
      new THREE.MeshBasicMaterial({
        color: "#d9b36a",
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);
    this.oceanAlphaMap = this.buildOceanAlphaMap();
    this.farSeabed = this.buildFarSeabed();
    this.terrain = this.buildTerrain();
    this.water = this.buildWater();
    this.waterBase = (this.water.geometry.attributes.position.array as Float32Array).slice();
    this.root.add(this.farSeabed, this.terrain, this.water);

    this.reducedMotionQuery?.addEventListener("change", this.onReducedMotionPreferenceChange);
    if (options.interactive ?? true) {
      this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
      this.renderer.domElement.addEventListener("click", this.onClick);
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(this.container);
    window.addEventListener("resize", this.onWindowResize);
    this.resize();
    this.renderFrame(performance.now());
    this.publishDebugHandle();
    this.frameScheduler.start();
  }

  updateSnapshot(snapshot: WorldSnapshot | null): void {
    this.currentSnapshot = snapshot;
    this.eventPresentationContext = eventPresentationContextFromSnapshot(snapshot);
    this.updateObserverAtmosphere(snapshot);
    const regions = snapshot?.regions ?? [];
    this.currentSceneryRegions = regions;
    const nextTopologySignature = worldTopologySignature(regions);
    const topologyChanged = nextTopologySignature !== this.topologySignature;
    const nextSceneryRecipeHash = worldSceneryRecipeHash(
      regions,
      this.sceneryQualityState,
    );
    const sceneryChanged = nextSceneryRecipeHash !== this.sceneryRecipeHash;
    if (topologyChanged) {
      this.atlasLayoutState = atlasLayoutForRenderer(regions);
    }
    this.atlas = buildAtlas(regions, this.atlasLayoutState);
    if (topologyChanged) {
      this.topologySignature = nextTopologySignature;
      this.rebuildTerrainGeometry();
      this.rebuildWaterColor();
      this.rebuildFoam();
      this.rebuildRegionLabels();
      this.staticRebuildCount += 1;
    }
    if (!this.initialAtlasFitApplied && !this.userNavigated && this.atlas.length > 0) {
      this.fitInitialAtlasView();
    }
    if (sceneryChanged) {
      this.rebuildScenery(regions, nextSceneryRecipeHash);
    }

    const nextResourceSignature = worldResourceSignature(regions);
    if (topologyChanged || nextResourceSignature !== this.resourceSignature) {
      this.resourceSignature = nextResourceSignature;
      this.rebuildTerrainColor();
      this.rebuildRegionAbundance();
      this.resourceColorRebuildCount += 1;
      this.resourceAbundanceRebuildCount += 1;
    }

    const nextEntitySignature = worldEntitySignature(snapshot);
    const entitiesChanged = topologyChanged || nextEntitySignature !== this.entitySignature;
    if (entitiesChanged) {
      this.entitySignature = nextEntitySignature;
      this.rebuildSnapshotObjects(snapshot);
      this.entityRebuildCount += 1;
      this.setSelected(this.selected);
    }
    if (sceneryChanged || entitiesChanged) {
      this.applySceneryEntityClearings(snapshot);
      this.enforceStateOwnedPointLightBudget();
    }

    const nextProposalSignature = worldProposalSignature(snapshot);
    if (
      entitiesChanged ||
      nextProposalSignature !== this.proposalSignature
    ) {
      this.proposalSignature = nextProposalSignature;
      this.rebuildPendingProposalVisuals(snapshot);
      this.proposalRebuildCount += 1;
    }
    this.dynamicSnapshotUpdateCount += 1;
    this.invalidateFrame();
    this.publishDebugHandle();
  }

  requestRender(): void {
    this.invalidateFrame();
  }

  setObserverVisualPhaseForTest(phase: number | null): void {
    this.observerVisualPhaseOverride = phase === null
      ? null
      : positiveFraction(Number.isFinite(phase) ? phase : 0);
    this.updateObserverAtmosphere(this.currentSnapshot);
    this.invalidateFrame();
    this.publishDebugHandle();
  }

  setSafeFrame(insets: SafeFrameInsets): void {
    const normalized = normalizeSafeFrameInsets(insets);
    if (sameSafeFrameInsets(normalized, this.safeFrame)) {
      return;
    }
    this.safeFrame = normalized;
    this.bubbleLayoutSignature = "";
    this.invalidateFrame();
  }

  setSelected(selection: RendererSelection | null): void {
    this.selected = selection;
    this.enforceStateOwnedPointLightBudget();
    if (!selection) {
      this.selectionRing.visible = false;
      this.invalidateFrame();
      return;
    }
    let point: THREE.Vector3 | null = null;
    if (selection.kind === "region") {
      const region = this.regionFor(selection.id);
      if (region) {
        point = new THREE.Vector3(region.cx, this.terrainHeight(region.cx, region.cz) + 0.16, region.cz);
      }
    } else {
      const hit = this.hitMeshes.find((mesh) => {
        const owner = findSelectableOwner(mesh);
        return owner?.kind === selection.kind && owner.id === selection.id;
      });
      if (hit) {
        point = hit.getWorldPosition(new THREE.Vector3());
        point.y = this.terrainHeight(point.x, point.z) + 0.16;
      }
    }
    if (!point) {
      this.selectionRing.visible = false;
      this.invalidateFrame();
      return;
    }
    this.selectionRing.position.copy(point);
    this.selectionRing.scale.setScalar(selection.kind === "region" ? 5 : 1);
    this.selectionRing.visible = true;
    this.invalidateFrame();
  }

  focusSelection(selection: RendererSelection): boolean {
    if (selection.kind === "region") {
      return this.focusRegion(selection.id);
    }
    if (selection.kind === "home") {
      return this.focusHome(selection.id);
    }
    const object = this.entityObjects.get(`agent:${selection.id}`);
    if (!object) {
      return false;
    }
    this.focusCameraOn(object.getWorldPosition(new THREE.Vector3()), 9);
    return true;
  }

  focusRegion(regionName: string): boolean {
    const region = this.regionFor(regionName);
    if (!region) {
      return false;
    }
    this.focusCameraOn(new THREE.Vector3(region.cx, this.terrainHeight(region.cx, region.cz), region.cz));
    return true;
  }

  focusHome(homeId: string): boolean {
    const point = this.homeWorldPoint(homeId);
    if (!point) {
      return false;
    }
    this.focusCameraOn(new THREE.Vector3(point.x, point.y, point.z));
    return true;
  }

  focusAgent(agentId: string): boolean {
    return this.focusSelection({ kind: "agent", id: agentId });
  }

  applyEventBeat(entry: EventEnvelopeEntry, options: EventBeatRenderOptions = {}): void {
    if (entry.cursor <= this.snapshotCursorFloor || this.appliedEventCursors.has(entry.cursor)) {
      return;
    }
    this.rememberEventCursor(entry.cursor);
    const spec = visualSpecFor(entry);
    const anchors: Record<AnchorRole, THREE.Vector3 | null> = {
      actor: this.anchorForAgent(spec.actorId),
      target: this.anchorForAgent(spec.targetId),
      home: this.anchorForHome(spec.homeId),
      region: this.anchorForRegion(spec.regionName),
      fromRegion: this.anchorForRegion(spec.fromRegionName),
      toRegion: this.anchorForRegion(spec.toRegionName),
    };
    const primary =
      (spec.primaryAnchor ? anchors[spec.primaryAnchor] : null) ??
      anchors.actor ??
      anchors.home ??
      anchors.target ??
      anchors.region ??
      anchors.toRegion ??
      anchors.fromRegion ??
      this.systemEventAnchor(entry.event.type);
    if (!primary) {
      return;
    }

    const effectsBefore = this.newEffectCapture === undefined
      ? new Set(this.effects)
      : null;
    const newEffects: VisualEffect[] = [];
    this.newEffectCapture = newEffects;
    let hasBubble = false;
    let hasPulse = false;
    let hasArc = false;
    let hasSpecial = false;

    if (spec.label) {
      const summary = this.bubbleEventDebugSummary(entry.event.type, spec, anchors, primary);
      const focus = focusTargetForBeat(
        presentEvent(entry, this.eventPresentationContext),
      );
      const detail = presentEventBubbleDetail(entry, this.eventPresentationContext);
      this.addBubbleEffect({
        cursor: entry.cursor,
        anchor: primary,
        eventType: entry.event.type,
        group: spec.group,
        text: spec.label,
        detail,
        chainDetail: options.chainDetail,
        className: spec.bubbleClass,
        color: spec.color,
        focus,
        summary,
      });
      hasBubble = newEffects.some((effect) => Boolean(effect.bubble));
    }
    if (spec.arc && !spec.suppressDefaultArc && this.shouldRenderDefaultArc(spec.group)) {
      const from = anchors[spec.arc.from];
      const to = anchors[spec.arc.to];
      if (from && to) {
        const beforeArc = newEffects.length;
        this.addArcEffect({
          from,
          to,
          eventType: entry.event.type,
          group: spec.group,
          color: spec.color,
          summary: this.genericArcDebugSummary(entry.event.type, spec, anchors, spec.arc.from, spec.arc.to, from, to),
        });
        hasArc = newEffects.length > beforeArc;
      }
    }
    if (!spec.suppressDefaultPulse && this.shouldRenderDefaultPulse()) {
      const pulseAnchor = (spec.pulseAnchor ? anchors[spec.pulseAnchor] : null) ?? primary;
      const pulseAnchorRole = spec.pulseAnchor && anchors[spec.pulseAnchor]
        ? spec.pulseAnchor
        : bubbleAnchorRole(anchors, primary);
      const lifeTransition = this.lifeTransitionState(spec, anchors, pulseAnchor);
      const beforePulse = newEffects.length;
      this.addPulseEffect({
        anchor: pulseAnchor,
        eventType: entry.event.type,
        group: spec.group,
        color: spec.color,
        scale: spec.pulseScale,
        lifeTransition,
        summary: lifeTransition
          ? undefined
          : this.genericPulseDebugSummary(entry.event.type, spec, anchors, pulseAnchorRole, pulseAnchor),
      });
      hasPulse = newEffects.length > beforePulse;
    }
    if (this.shouldRenderSpecialEffects()) {
      const beforeSpecial = newEffects.length;
      this.addSpecialEventEffects(entry.event.type, spec, anchors, primary);
      hasSpecial = newEffects.length > beforeSpecial;
    }

    this.newEffectCapture = null;
    const renderedEffects = effectsBefore
      ? this.effects.filter((effect) => !effectsBefore.has(effect))
      : newEffects.filter((effect) => this.effects.includes(effect));
    hasBubble ||= renderedEffects.some((effect) => Boolean(effect.bubble));
    if (renderedEffects.length > 0) {
      this.renderedEventCursors.add(entry.cursor);
      this.rememberRenderedEventBeat(entry, spec, renderedEffects, {
        hasBubble,
        hasPulse,
        hasArc,
        hasSpecial,
      });
    }
    this.enforceActiveBubbleLimit();
  }

  markEventCursorHandled(cursor: number): void {
    if (cursor <= 0) {
      return;
    }
    this.rememberEventCursor(cursor);
  }

  markSnapshotCursorHandled(cursor: number): void {
    if (cursor <= 0) {
      return;
    }
    this.snapshotCursorFloor = Math.max(this.snapshotCursorFloor, cursor);
    this.rememberEventCursor(cursor);
  }

  eventEffectCount(): number {
    return this.effects.length;
  }

  appliedEventCursorList(): number[] {
    return [...this.appliedEventOrder];
  }

  renderedEventCursorList(): number[] {
    return this.appliedEventOrder.filter((cursor) => this.renderedEventCursors.has(cursor));
  }

  recentRenderedEventBeatList(): RecentRenderedEventBeatDebugEntry[] {
    return this.recentRenderedEventBeatRing.map((beat) => ({
      ...beat,
      summaryKinds: [...beat.summaryKinds],
    }));
  }

  private refreshMotionSettings(): void {
    this.motionDebug = resolveMotionDebug(this.options.reducedMotion, this.reducedMotionQuery);
    this.motionSettings = motionSettingsFor(this.motionDebug);
    this.controls.dampingFactor = this.motionSettings.controlsDampingFactor;
    this.resize();
  }

  dispose(): void {
    this.disposed = true;
    this.frameScheduler.dispose();
    this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.onWindowResize);
    this.reducedMotionQuery?.removeEventListener("change", this.onReducedMotionPreferenceChange);
    if (this.options.interactive ?? true) {
      this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
      this.renderer.domElement.removeEventListener("click", this.onClick);
    }
    this.controls.removeEventListener("start", this.onControlsStart);
    this.controls.removeEventListener("end", this.onControlsEnd);
    this.controls.dispose();
    this.container.removeChild(this.renderer.domElement);
    this.container.removeChild(this.labelRenderer.domElement);
    this.disposeScenery();
    this.clearEffects();
    this.clearPendingProposalVisuals();
    this.oceanAlphaMap.dispose();
    this.scene.traverse((object: THREE.Object3D) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        disposeMaterial(object.material);
      }
    });
    this.renderer.dispose();
    if (window.__viv?.renderer === this.renderer) {
      window.__viv = undefined;
    }
    if (
      window.__vivariumWorld === this.publishedWorldDebugHandle
    ) {
      window.__vivariumWorld = undefined;
    }
    this.publishedWorldDebugHandle = null;
  }

  private buildLights(): void {
    this.sun = new THREE.DirectionalLight("#ffd9a0", 2.2);
    this.sun.name = "observer-directional-key";
    this.sun.position.set(-36, 92, 44);
    this.sun.castShadow = this.options.effectDetail !== "tour";
    this.sun.shadow.mapSize.set(this.options.effectDetail === "tour" ? 512 : 1024, this.options.effectDetail === "tour" ? 512 : 1024);
    this.sun.shadow.camera.left = -108;
    this.sun.shadow.camera.right = 108;
    this.sun.shadow.camera.top = 108;
    this.sun.shadow.camera.bottom = -108;
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 300;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.hemisphere = new THREE.HemisphereLight("#8fb3c9", "#5a4f3a", 0.55);
    this.hemisphere.name = "observer-hemisphere-fill";
    this.scene.add(this.sun, this.sun.target, this.hemisphere);
  }

  private buildSky(): void {
    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(PALETTE.skyTop) },
        bottom: { value: new THREE.Color(PALETTE.skyBottom) },
        fogc: { value: new THREE.Color(PALETTE.fog) },
        expo: { value: 1.35 },
      },
      vertexShader:
        "varying vec3 vW; void main(){ vW=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }",
      fragmentShader:
        "uniform vec3 top; uniform vec3 bottom; uniform vec3 fogc; uniform float expo; varying vec3 vW; void main(){ float h=normalize(vW+vec3(0.,40.,0.)).y; vec3 base=mix(fogc,bottom,smoothstep(0.0,0.22,h)); gl_FragColor=vec4(mix(base,top,pow(max(h,0.0),expo)),1.0); }",
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 24, 12), this.skyMaterial);
    sky.name = "observer-sky";
    this.scene.add(sky);
  }

  private updateObserverAtmosphere(snapshot: WorldSnapshot | null): void {
    const phaseSource: AtmospherePhaseSource = this.motionDebug.reduced
      ? "reduced-motion"
      : this.observerVisualPhaseOverride !== null
        ? "test-override"
        : "snapshot";
    const phase = this.motionDebug.reduced
      ? REDUCED_MOTION_OBSERVER_PHASE
      : this.observerVisualPhaseOverride
        ?? (snapshot ? observerCyclePhase(snapshot) : REDUCED_MOTION_OBSERVER_PHASE);
    const state = {
      ...atmosphereStateAt(phase),
      phaseSource,
    };
    const signature = [
      state.key,
      state.phase.toFixed(6),
      state.phaseSource,
    ].join(":");
    this.atmosphereDebugState = state;
    if (signature === this.appliedAtmosphereSignature) {
      return;
    }
    this.appliedAtmosphereSignature = signature;
    this.sun.color.set(state.directionalColor);
    this.sun.intensity = state.directionalIntensity;
    this.hemisphere.color.set(state.hemisphereSkyColor);
    this.hemisphere.groundColor.set(state.hemisphereGroundColor);
    this.hemisphere.intensity = state.hemisphereIntensity;
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      fog.color.set(state.fogColor);
    }
    this.skyMaterial.uniforms.top.value.set(state.skyTopColor);
    this.skyMaterial.uniforms.bottom.value.set(state.skyHorizonColor);
    this.skyMaterial.uniforms.fogc.value.set(state.fogColor);
    const waterMaterial = this.water.material;
    if (waterMaterial instanceof THREE.MeshBasicMaterial) {
      waterMaterial.color.set(state.waterTint);
    }
    this.renderer.toneMappingExposure = state.exposure;
    this.needsWebGLRender = true;
  }

  private atmosphereState(): AtmosphereDebugState {
    return { ...this.atmosphereDebugState };
  }

  private buildOceanAlphaMap(): THREE.DataTexture {
    const size = OCEAN_ALPHA_MAP_SIZE;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const worldX = (x / (size - 1) - 0.5) * WATER_SIZE;
        const worldZ = (y / (size - 1) - 0.5) * WATER_SIZE;
        const alpha = oceanAlphaAtRadius(Math.hypot(worldX, worldZ));
        const value = Math.round(alpha * 255);
        const offset = (y * size + x) * 4;
        data[offset] = value;
        data[offset + 1] = value;
        data[offset + 2] = value;
        data[offset + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    texture.name = "observer-ocean-radial-alpha";
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  private buildFarSeabed(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const seabed = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: PALETTE.seabed,
        fog: true,
        transparent: true,
        opacity: 1,
        alphaMap: this.oceanAlphaMap,
        depthWrite: false,
      }),
    );
    seabed.name = "observer-seabed-continuation";
    seabed.position.y = FAR_SEABED_Y;
    seabed.receiveShadow = false;
    return seabed;
  }

  private renderedTerrainHeight(x: number, z: number): number {
    const terrainHeight = this.terrainHeight(x, z);
    const edgeDistance = Math.max(Math.abs(x), Math.abs(z));
    const edgeBlend = sstep(
      TERRAIN_EDGE_FEATHER_START,
      TERRAIN_SIZE / 2,
      edgeDistance,
    );
    return THREE.MathUtils.lerp(terrainHeight, FAR_SEABED_Y, edgeBlend);
  }

  private buildTerrain(): THREE.Mesh {
    const terrain = new THREE.Mesh(
      this.buildTerrainGeometry(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.92,
        metalness: 0,
      }),
    );
    terrain.receiveShadow = true;
    terrain.userData = { kind: "terrain" };
    return terrain;
  }

  private buildTerrainGeometry(): THREE.BufferGeometry {
    const indexedGeometry = new THREE.PlaneGeometry(
      TERRAIN_SIZE,
      TERRAIN_SIZE,
      TERRAIN_SEGMENTS,
      TERRAIN_SEGMENTS,
    );
    indexedGeometry.rotateX(-Math.PI / 2);
    const indexedPosition = indexedGeometry.attributes.position;
    for (let index = 0; index < indexedPosition.count; index += 1) {
      indexedPosition.setY(
        index,
        this.renderedTerrainHeight(indexedPosition.getX(index), indexedPosition.getZ(index)),
      );
    }
    const expandedGeometry = indexedGeometry.toNonIndexed();
    indexedGeometry.dispose();
    const expandedPosition = expandedGeometry.attributes.position;
    const sourceTriangleCount = expandedPosition.count / 3;
    const retainedPositions: number[] = [];
    let sourceLandCoastTriangleCount = 0;
    for (let index = 0; index < expandedPosition.count; index += 3) {
      let containsLandOrCoast = false;
      for (let corner = 0; corner < 3; corner += 1) {
        const vertexIndex = index + corner;
        containsLandOrCoast ||= expandedPosition.getY(vertexIndex) >= TERRAIN_COAST_HEIGHT;
      }
      sourceLandCoastTriangleCount += Number(containsLandOrCoast);
      if (!containsLandOrCoast) {
        continue;
      }
      for (let corner = 0; corner < 3; corner += 1) {
        const vertexIndex = index + corner;
        retainedPositions.push(
          expandedPosition.getX(vertexIndex),
          expandedPosition.getY(vertexIndex),
          expandedPosition.getZ(vertexIndex),
        );
      }
    }
    expandedGeometry.dispose();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(retainedPositions, 3),
    );
    geometry.computeVertexNormals();
    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3),
    );
    geometry.userData.terrainSplit = {
      sourceTriangleCount,
      sourceLandCoastTriangleCount,
    };
    return geometry;
  }

  private rebuildTerrainColor(): void {
    const geometry = this.terrain.geometry;
    const position = geometry.attributes.position;
    const colors = geometry.attributes.color as THREE.BufferAttribute;
    const normal = geometry.attributes.normal;
    const color = new THREE.Color();
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const z = position.getZ(index);
      this.groundColor(x, z, position.getY(index), Math.abs(normal.getY(index)), color);
      const edgeBlend = sstep(
        TERRAIN_EDGE_FEATHER_START,
        TERRAIN_SIZE / 2,
        Math.max(Math.abs(x), Math.abs(z)),
      );
      const jitter = 1 + (hash2(index * 0.618, x + z) - 0.5) * 0.09 * (1 - edgeBlend);
      color.multiplyScalar(jitter);
      colors.setXYZ(index, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
  }

  private rebuildTerrainGeometry(): void {
    const previousGeometry = this.terrain.geometry;
    this.terrain.geometry = this.buildTerrainGeometry();
    previousGeometry.dispose();
  }

  private terrainContinuityDiagnostics(): TerrainContinuityDiagnostics {
    const position = this.terrain.geometry.attributes.position;
    const terrainSplit = this.terrain.geometry.userData.terrainSplit as Pick<
      TerrainContinuityDiagnostics,
      | "sourceTriangleCount"
      | "sourceLandCoastTriangleCount"
    >;
    const boundary = TERRAIN_SIZE / 2;
    let maxBoundaryHeightDelta = 0;
    let boundaryTriangleCount = 0;
    let retainedLandCoastTriangleCount = 0;
    let retainedFullyUnderwaterTriangleCount = 0;
    for (let index = 0; index < position.count; index += 3) {
      let touchesBoundary = false;
      let containsLandOrCoast = false;
      for (let corner = 0; corner < 3; corner += 1) {
        const vertexIndex = index + corner;
        const x = position.getX(vertexIndex);
        const z = position.getZ(vertexIndex);
        containsLandOrCoast ||= position.getY(vertexIndex) >= TERRAIN_COAST_HEIGHT;
        if (Math.abs(Math.abs(x) - boundary) <= 0.001
          || Math.abs(Math.abs(z) - boundary) <= 0.001) {
          touchesBoundary = true;
          maxBoundaryHeightDelta = Math.max(
            maxBoundaryHeightDelta,
            Math.abs(position.getY(vertexIndex) - FAR_SEABED_Y),
          );
        }
      }
      boundaryTriangleCount += Number(touchesBoundary);
      retainedLandCoastTriangleCount += Number(containsLandOrCoast);
      retainedFullyUnderwaterTriangleCount += Number(!containsLandOrCoast);
    }
    const terrainMaterial = this.terrain.material;
    const terrainMaterialTransparent = Array.isArray(terrainMaterial)
      ? terrainMaterial.some((material) => material.transparent)
      : terrainMaterial.transparent;
    return {
      centralSize: TERRAIN_SIZE,
      centralSegments: TERRAIN_SEGMENTS,
      continuationSize: WATER_SIZE,
      continuationWorldY: this.farSeabed.position.y,
      continuationFadeStart: OCEAN_FADE_START,
      continuationFadeEnd: OCEAN_FADE_END,
      centralAlpha: oceanAlphaAtRadius(0),
      edgeAlpha: oceanAlphaAtRadius(WATER_SIZE / 2),
      maxBoundaryHeightDelta,
      boundaryTriangleCount,
      terrainMaterialTransparent,
      ...terrainSplit,
      retainedTriangleCount: position.count / 3,
      retainedLandCoastTriangleCount,
      retainedFullyUnderwaterTriangleCount,
      continuationBelowWater: this.farSeabed.position.y < 0,
    };
  }

  private buildWater(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, 76, 76);
    geometry.rotateX(-Math.PI / 2);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const water = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.78,
        alphaMap: this.oceanAlphaMap,
        depthWrite: false,
      }),
    );
    water.name = "observer-water";
    water.renderOrder = 1;
    return water;
  }

  private rebuildWaterColor(): void {
    const position = this.water.geometry.attributes.position;
    const colors = this.water.geometry.attributes.color as THREE.BufferAttribute;
    const color = new THREE.Color();
    for (let index = 0; index < position.count; index += 1) {
      const h = this.terrainHeight(position.getX(index), position.getZ(index));
      color.copy(PALETTE.waterDeep).lerp(PALETTE.waterShallow, clamp((h + 2.6) / 2.8, 0, 1));
      colors.setXYZ(index, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
  }

  private rebuildFoam(): void {
    for (const child of [...this.root.children]) {
      if (child.userData.kind === "foam") {
        this.root.remove(child);
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          disposeMaterial(child.material);
        }
      }
    }
    const foamMat = new THREE.MeshBasicMaterial({
      color: PALETTE.foam,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    for (const region of this.atlas) {
      const geometry = buildFoamGeometry(region);
      const foam = new THREE.Mesh(geometry, foamMat.clone());
      foam.userData = { kind: "foam" };
      foam.renderOrder = 2;
      this.root.add(foam);
    }
  }

  private rebuildRegionLabels(): void {
    clearGroup(this.labelRoot);
    this.regionLabels.clear();
    for (const region of this.atlas) {
      const label = new CSS2DObject(makeRegionLabel(region));
      label.position.set(
        region.cx,
        this.terrainHeight(region.cx, region.cz) + 2.1,
        region.cz,
      );
      this.labelRoot.add(label);
      this.regionLabels.set(region.key, label);
    }
  }

  private rebuildScenery(
    regions: readonly RegionSnapshot[],
    recipeHash: string,
  ): void {
    this.disposeScenery();
    const layoutsById = new Map(
      this.atlasLayoutState.regions.map((region) => [region.id, region]),
    );
    const crossings = classifyCrossings(this.atlasLayoutState, regions);

    for (const region of this.atlas) {
      const layout = layoutsById.get(region.key);
      if (!layout) {
        continue;
      }
      const exclusions = sceneryExclusionsForRegion(
        layout,
        crossings,
        layoutsById,
      );
      const placements = placeRegionScenery({
        regionId: region.key,
        visualSeed: region.recipe.visualSeed,
        archetype: region.recipe.archetype,
        radius: layout.radius,
        quality: this.sceneryQualityState,
        maskAt: (x, z) => islandMask(region, layout.x + x, layout.z + z),
        heightAt: (x, z) => this.terrainHeight(layout.x + x, layout.z + z),
        exclusions,
      });
      const layer = buildRegionScenery({
        recipe: region.recipe,
        layout,
        placements,
        quality: this.sceneryQualityState,
        terrainHeight: (x, z) => this.terrainHeight(x, z),
      });
      this.sceneryRoot.add(layer.root);
      this.sceneryLayers.push(layer);
    }

    const crossingLayer = buildAtlasCrossings({
      crossings,
      regionsById: layoutsById,
      quality: this.sceneryQualityState,
      terrainHeight: (x, z) => this.terrainHeight(x, z),
      coastMask: (layout, x, z) => {
        const region = this.regionFor(layout.id);
        return region ? islandMask(region, x, z) : 0;
      },
    });
    this.sceneryRoot.add(crossingLayer.root);
    this.sceneryLayers.push(crossingLayer);
    this.sceneryInstanceCount = this.sceneryLayers.reduce(
      (count, layer) => count + layer.instanceCount,
      0,
    );
    this.sceneryObjectCount = this.sceneryLayers.reduce(
      (count, layer) => count + layer.objectCount,
      0,
    );
    this.sceneryCrossingKinds = [...crossingLayer.landmarkKinds];
    this.sceneryRegionArchetypes = Object.fromEntries(
      [...this.atlas]
        .sort((left, right) => lexicalCompare(left.key, right.key))
        .map((region) => [region.key, region.recipe.archetype]),
    );
    this.sceneryRecipeHash = recipeHash;
    this.sceneryRebuildCount += 1;
  }

  private disposeScenery(): void {
    for (const layer of this.sceneryLayers.splice(0)) {
      layer.dispose();
    }
    this.sceneryRoot.clear();
    this.sceneryInstanceCount = 0;
    this.sceneryObjectCount = 0;
    this.sceneryMaskedInstanceCount = 0;
    this.sceneryDynamicClearanceCount = 0;
    this.sceneryCrossingKinds = [];
    this.sceneryRegionArchetypes = {};
  }

  private applySceneryEntityClearings(snapshot: WorldSnapshot | null): void {
    const clearings = sceneryDynamicClearings(
      snapshot,
      this.atlasLayoutState.regions,
    );
    const byRegion = new Map<string, SceneryDynamicClearanceEntry[]>();
    for (const clearing of clearings) {
      const regionClearings = byRegion.get(clearing.regionName) ?? [];
      regionClearings.push(clearing);
      byRegion.set(clearing.regionName, regionClearings);
    }
    let maskedInstanceCount = 0;
    for (const layer of this.sceneryLayers) {
      const regionId = (layer.root.userData as { regionId?: string }).regionId;
      const state = layer.updateClearings(
        regionId ? byRegion.get(regionId) ?? [] : [],
      );
      maskedInstanceCount += state.maskedInstanceCount;
    }
    this.sceneryMaskedInstanceCount = maskedInstanceCount;
    this.sceneryDynamicClearanceCount = clearings.length;
    this.sceneryDynamicClearanceApplyCount += 1;
    this.needsWebGLRender = true;
  }

  private stateOwnedPointLightRecords(): StateOwnedPointLightRecord[] {
    const owners = [
      ...this.sceneryLayers.map((layer) => layer.root),
      ...this.entityObjects.values(),
    ];
    const records: StateOwnedPointLightRecord[] = [];
    for (const owner of owners) {
      const candidates = (
        owner.userData as {
          stateOwnedPointLightCandidates?: Array<{
            ownerKind: StateOwnedPointLightOwnerKind;
            ownerId: string;
            intensity: number;
            light: THREE.PointLight;
            mount?: THREE.Object3D;
          }>;
        }
      ).stateOwnedPointLightCandidates ?? [];
      for (const candidate of candidates) {
        const mount = candidate.mount ?? owner;
        mount.updateWorldMatrix(true, false);
        const lightWorld = candidate.light.position.clone().applyMatrix4(mount.matrixWorld);
        records.push({
          ...candidate,
          owner: mount,
          distanceSquared: lightWorld.distanceToSquared(this.camera.position),
        });
      }
    }
    return records;
  }

  private enforceStateOwnedPointLightBudget(): void {
    const records = this.stateOwnedPointLightRecords();
    for (const record of records) {
      record.light.removeFromParent();
      record.light.visible = false;
      record.light.intensity = 0;
    }
    const selectedOwnerKey = this.selected
      ? `${this.selected.kind === "region" ? "spring" : this.selected.kind}:${this.selected.id}`
      : null;
    const allocated = new Set(allocateStateOwnedPointLightOwners(
      records,
      this.sceneryQualityState,
      selectedOwnerKey,
    ));
    this.activeStateOwnedPointLightOwnerKeys.clear();
    for (const record of records) {
      const key = stateOwnedPointLightOwnerKey(record);
      if (!allocated.has(key)) {
        continue;
      }
      record.light.visible = true;
      record.light.intensity = record.intensity;
      record.owner.add(record.light);
      this.activeStateOwnedPointLightOwnerKeys.add(key);
    }
    this.needsWebGLRender = true;
  }

  private stateOwnedPointLightCountByOwnerKind(): Record<StateOwnedPointLightOwnerKind, number> {
    const counts: Record<StateOwnedPointLightOwnerKind, number> = {
      agent: 0,
      home: 0,
      spring: 0,
    };
    for (const key of this.activeStateOwnedPointLightOwnerKeys) {
      const ownerKind = key.slice(0, key.indexOf(":")) as StateOwnedPointLightOwnerKind;
      counts[ownerKind] += 1;
    }
    return counts;
  }

  private resolveSceneryQuality(): SceneryQuality {
    if (this.options.effectDetail === "tour") {
      return "tour";
    }
    return this.motionDebug.reduced ? "reduced" : "full";
  }

  private rebuildSnapshotObjects(snapshot: WorldSnapshot | null): void {
    clearGroup(this.entityRoot);
    this.hitMeshes.length = 0;
    this.entityObjects.clear();
    if (!snapshot) {
      return;
    }

    const agentsByRegion = groupAgents(snapshot.agents);
    for (const [regionName, agents] of agentsByRegion) {
      const anchor = this.regionFor(regionName);
      if (!anchor) {
        continue;
      }
      agents
        .slice()
        .sort((left, right) => left.id.localeCompare(right.id))
        .forEach((agent, index) => {
          const [offsetX, offsetZ] = agentPlacementOffset(agent.id, anchor.baseR);
          const x = anchor.cx + offsetX;
          const z = anchor.cz + offsetZ;
          const being = makeBeing(agent);
          being.position.set(x, this.terrainHeight(x, z), z);
          const beingData = being.userData as {
            visual?: AgentVisualState;
            stateOwnedPointLightCandidates?: StateOwnedPointLightRecord[];
          };
          const visual = beingData.visual ?? deriveAgentVisualState(agent);
          being.userData = {
            ...beingData,
            kind: "agent" satisfies HitKind,
            id: agent.id,
            visual: {
              ...visual,
              renderedParts: Math.max(0, this.objectCountsFor(being).objectCount - 1),
            },
          };
          this.entityRoot.add(being);
          this.hitMeshes.push(being);
          this.entityObjects.set(`agent:${agent.id}`, being);
        });
    }

    for (const home of snapshot.homes.slice().sort((left, right) => left.home_id.localeCompare(right.home_id))) {
      this.addHome(home, false);
    }
    for (const ruin of snapshot.ruins.slice().sort((left, right) => left.home_id.localeCompare(right.home_id))) {
      this.addHome(ruin, true);
    }
  }

  private rebuildRegionAbundance(): void {
    clearGroup(this.resourceRoot);
    this.resourceObjects.clear();
    for (const region of this.atlas) {
      this.addRegionAbundance(region);
    }
  }

  private addHome(home: HomeSnapshot, ruined: boolean): void {
    const anchor = this.regionFor(home.region);
    if (!anchor) {
      return;
    }
    const [offsetX, offsetZ] = homePlacementOffset(home.home_id, anchor.baseR);
    const x = anchor.cx + offsetX;
    const z = anchor.cz + offsetZ;
    const house = ruined ? makeRuin(home) : makeHome(home);
    house.position.set(x, this.terrainHeight(x, z), z);
    const houseData = house.userData as {
      visual?: HomeVisualState;
      stateOwnedPointLightCandidates?: StateOwnedPointLightRecord[];
    };
    const visual = houseData.visual ?? deriveHomeVisualState(home, ruined);
    house.userData = {
      ...houseData,
      kind: "home" satisfies HitKind,
      id: home.home_id,
      regionName: home.region,
      visual: cloneHomeVisualState({ ...visual, renderedParts: house.children.length }),
    };
    this.entityRoot.add(house);
    this.hitMeshes.push(house);
    this.entityObjects.set(`home:${home.home_id}`, house);
  }

  private addRegionAbundance(region: AtlasRegion): void {
    const group = new THREE.Group();
    const energyPoints = this.abundanceSamplePoints(region, "energy", abundanceCount(region.energyRatio, region.baseR));
    const materialPoints = this.abundanceSamplePoints(region, "materials", abundanceCount(region.materialRatio, region.baseR));
    for (const [index, point] of energyPoints.entries()) {
      const mote = new THREE.Mesh(
        new THREE.SphereGeometry(0.08 + (index % 3) * 0.025, 8, 6),
        new THREE.MeshBasicMaterial({
          color: "#d6b96f",
          transparent: true,
          opacity: 0.34 + region.energyRatio * 0.36,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      mote.position.copy(point);
      group.add(mote);
    }
    for (const [index, point] of materialPoints.entries()) {
      const scatter = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.18 + (index % 2) * 0.05, 0),
        new THREE.MeshStandardMaterial({
          color: index % 3 === 0 ? "#9b8054" : "#7d766b",
          roughness: 0.95,
          flatShading: true,
        }),
      );
      scatter.position.copy(point);
      scatter.rotation.set(index * 0.8, index * 1.3, index * 0.5);
      group.add(scatter);
    }
    const visual: RegionAbundanceDebugState = {
      regionName: region.key,
      displayName: region.display,
      currentEnergy: region.snapshot.current_energy,
      maxEnergy: region.snapshot.max_energy,
      currentMaterials: region.snapshot.current_materials,
      maxMaterials: region.snapshot.max_materials,
      energyRatio: region.energyRatio,
      materialRatio: region.materialRatio,
      energyMoteCount: energyPoints.length,
      materialScatterCount: materialPoints.length,
      terrainTint: regionTerrainTint(region),
      sampleWorld: [
        ...energyPoints.slice(0, 4).map((point) => ({ x: point.x, y: point.y, z: point.z, kind: "energy" as const })),
        ...materialPoints.slice(0, 4).map((point) => ({ x: point.x, y: point.y, z: point.z, kind: "materials" as const })),
      ],
    };
    group.userData = {
      kind: "region-abundance",
      id: region.key,
      visual,
    };
    this.resourceRoot.add(group);
    this.resourceObjects.set(`region-abundance:${region.key}`, group);
  }

  private rebuildPendingProposalVisuals(snapshot: WorldSnapshot | null): void {
    this.clearPendingProposalVisuals();
    if (!snapshot) {
      return;
    }
    for (const proposal of snapshot.pending_proposals.slice().sort((left, right) => {
      const pair = left.initiator_id.localeCompare(right.initiator_id);
      return pair !== 0 ? pair : left.target_id.localeCompare(right.target_id);
    })) {
      const visual = this.makePendingProposalVisual(proposal, snapshot.world_time);
      this.pendingProposalVisuals.push(visual);
      this.proposalRoot.add(visual.root);
    }
  }

  private makePendingProposalVisual(proposal: PendingProposalSnapshot, worldTime: number): PendingProposalVisual {
    const root = new THREE.Group();
    root.userData = {
      kind: "pendingProposalVisual",
      source: "snapshot",
      eventOwned: false,
    };
    const materials: THREE.Material[] = [];
    const initiatorWorld = this.anchorForAgent(proposal.initiator_id) ?? undefined;
    const targetWorld = this.anchorForAgent(proposal.target_id) ?? undefined;
    const relationshipThreadWorld: THREE.Vector3[] = [];
    let medallionWorld: THREE.Vector3 | undefined;

    const totalResources = Object.values(proposal.resources).reduce((total, value) => total + value, 0);
    const medallionScale = clamp(totalResources / 120, 0.72, 1.28);
    const threadMaterial = new THREE.LineBasicMaterial({
      color: EFFECT_COLORS.bond,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
    });
    const medallionMaterial = new THREE.MeshBasicMaterial({
      color: EFFECT_COLORS.bond,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: "#ede4d2",
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    materials.push(threadMaterial, medallionMaterial, coreMaterial);

    if (initiatorWorld && targetWorld) {
      const points = this.relationshipThreadPoints(initiatorWorld, targetWorld, 1.25);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), threadMaterial);
      root.add(line);
      medallionWorld = points[Math.floor(points.length / 2)]?.clone();
      relationshipThreadWorld.push(
        initiatorWorld.clone(),
        medallionWorld ?? initiatorWorld.clone().lerp(targetWorld, 0.5),
        targetWorld.clone(),
      );
    } else {
      medallionWorld = (initiatorWorld ?? targetWorld)?.clone();
      if (medallionWorld) {
        medallionWorld.y += 0.18;
        relationshipThreadWorld.push(medallionWorld.clone());
      }
    }

    if (medallionWorld) {
      const medallion = new THREE.Mesh(
        new THREE.RingGeometry(0.28 * medallionScale, 0.46 * medallionScale, 42),
        medallionMaterial,
      );
      medallion.position.copy(medallionWorld);
      medallion.rotation.x = -Math.PI / 2;
      const core = new THREE.Mesh(new THREE.CircleGeometry(0.18 * medallionScale, 28), coreMaterial);
      core.position.copy(medallionWorld);
      core.position.y += 0.02;
      core.rotation.x = -Math.PI / 2;
      root.add(medallion, core);
    }

    for (const [index, point] of [initiatorWorld, targetWorld].entries()) {
      if (!point) {
        continue;
      }
      const endpoint = new THREE.Mesh(
        new THREE.SphereGeometry(0.09 + index * 0.015, 8, 6),
        coreMaterial,
      );
      endpoint.position.copy(point);
      root.add(endpoint);
    }

    const ageSeconds = proposal.timestamp === null
      ? null
      : Math.max(0, worldTime - proposal.timestamp);
    return {
      id: `${proposal.initiator_id}->${proposal.target_id}:${proposal.timestamp ?? "open"}`,
      initiatorId: proposal.initiator_id,
      targetId: proposal.target_id,
      resources: { ...proposal.resources },
      timestamp: proposal.timestamp,
      ageSeconds,
      root,
      materials,
      initiatorWorld,
      targetWorld,
      medallionWorld,
      relationshipThreadWorld,
    };
  }

  private pendingProposalVisualState(): PendingProposalVisualDebugState[] {
    return this.pendingProposalVisuals.map((visual) => {
      const initiatorWorld = this.anchorForAgent(visual.initiatorId) ?? visual.initiatorWorld;
      const targetWorld = this.anchorForAgent(visual.targetId) ?? visual.targetWorld;
      const points = initiatorWorld && targetWorld
        ? this.relationshipThreadPoints(initiatorWorld, targetWorld, 1.25)
        : [];
      const medallionWorld = points.length > 0
        ? points[Math.floor(points.length / 2)]?.clone()
        : visual.medallionWorld;
      const relationshipThreadWorld = points.length > 0 && initiatorWorld && targetWorld
        ? [
            initiatorWorld.clone(),
            medallionWorld ?? initiatorWorld.clone().lerp(targetWorld, 0.5),
            targetWorld.clone(),
          ]
        : visual.relationshipThreadWorld;
      return {
        initiatorId: visual.initiatorId,
        targetId: visual.targetId,
        resources: { ...visual.resources },
        source: "snapshot",
        eventOwned: false,
        openTimestamp: visual.timestamp,
        ageSeconds: visual.ageSeconds,
        initiatorWorld: initiatorWorld ? vectorTuple(initiatorWorld) : undefined,
        targetWorld: targetWorld ? vectorTuple(targetWorld) : undefined,
        medallionWorld: medallionWorld ? vectorTuple(medallionWorld) : undefined,
        relationshipThreadWorld: relationshipThreadWorld.length > 0
          ? relationshipThreadWorld.map((point) => vectorTuple(point))
          : undefined,
        initiatorScreen: initiatorWorld ? this.screenPointForWorld(initiatorWorld) : null,
        targetScreen: targetWorld ? this.screenPointForWorld(targetWorld) : null,
        medallionScreen: medallionWorld ? this.screenPointForWorld(medallionWorld) : null,
        selectionMutated: false,
        inspectorMutated: false,
      };
    });
  }

  private activeEffectCounts(): {
    total: number;
    byGroup: Record<string, number>;
    byType: Record<string, number>;
  } {
    const byGroup: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const effect of this.effects) {
      byGroup[effect.group] = (byGroup[effect.group] ?? 0) + 1;
      byType[effect.eventType] = (byType[effect.eventType] ?? 0) + 1;
    }
    return {
      total: this.effects.length,
      byGroup,
      byType,
    };
  }

  private effectLifecycleDiagnostics(): EffectLifecycleDiagnostics {
    const counts = this.activeEffectCounts();
    return {
      activeEffectCount: counts.total,
      activeEffectCountByGroup: counts.byGroup,
      activeEffectCountByType: counts.byType,
      pendingProposalVisualCount: this.pendingProposalVisuals.length,
      maxActiveEffectCount: this.activeEffectLimit(),
      culledEffectCount: this.lifecycleCounters.culledEffectCount,
      disposedEffectGeometryCount: this.lifecycleCounters.disposedEffectGeometryCount,
      disposedEffectMaterialCount: this.lifecycleCounters.disposedEffectMaterialCount,
      disposedProposalGeometryCount: this.lifecycleCounters.disposedProposalGeometryCount,
      disposedProposalMaterialCount: this.lifecycleCounters.disposedProposalMaterialCount,
      appliedEventCursorCount: this.appliedEventCursors.size,
      reducedMotion: { ...this.motionDebug },
    };
  }

  private objectCountsFor(root: THREE.Object3D): {
    objectCount: number;
    meshCount: number;
    lineCount: number;
    lightCount: number;
    css2DObjectCount: number;
  } {
    const counts = {
      objectCount: 0,
      meshCount: 0,
      lineCount: 0,
      lightCount: 0,
      css2DObjectCount: 0,
    };
    root.traverse((object: THREE.Object3D) => {
      counts.objectCount += 1;
      if (object instanceof THREE.Mesh) {
        counts.meshCount += 1;
      }
      if (object instanceof THREE.Line) {
        counts.lineCount += 1;
      }
      if (object instanceof THREE.Light) {
        counts.lightCount += 1;
      }
      if (object instanceof CSS2DObject) {
        counts.css2DObjectCount += 1;
      }
    });
    return counts;
  }

  private activeEffectParticleCount(): number {
    return this.effects.reduce((total, effect) => total + (effect.particleCount ?? 0), 0);
  }

  private detailBudgetState(): {
    activeEffectParticleCount: number;
    detailBudgetPressure: number;
    adaptiveDetailScale: number;
  } {
    const activeEffectParticleCount = this.activeEffectParticleCount();
    const activeEffectLimit = this.activeEffectLimit();
    const activeParticleLimit = this.activeEffectParticleLimit();
    const effectPressure = clamp(
      (this.effects.length - activeEffectLimit * 0.5) / (activeEffectLimit * 0.35),
      0,
      1,
    );
    const particlePressure = clamp(
      (activeEffectParticleCount - activeParticleLimit * 0.5) /
        (activeParticleLimit * 0.35),
      0,
      1,
    );
    const detailBudgetPressure = Math.max(effectPressure, particlePressure);
    return {
      activeEffectParticleCount,
      detailBudgetPressure,
      adaptiveDetailScale: 1 - detailBudgetPressure * 0.55,
    };
  }

  private renderBudgetDiagnostics(): RenderBudgetDiagnostics {
    const effectCounts = this.activeEffectCounts();
    const detailBudget = this.detailBudgetState();
    const sceneCounts = this.objectCountsFor(this.scene);
    const effectObjectCounts = this.objectCountsFor(this.effectRoot);
    const proposalObjectCounts = this.objectCountsFor(this.proposalRoot);
    const renderInfo = this.renderer.info.render;
    const memoryInfo = this.renderer.info.memory;
    const stateOwnedPointLightCountByOwnerKind = this.stateOwnedPointLightCountByOwnerKind();
    return {
      renderMode: this.options.renderMode ?? "live",
      frameScheduled: this.frameScheduler.isFrameScheduled(),
      frameCount: this.renderBudget.frameCount,
      lastFrameDeltaMs: this.renderBudget.lastFrameDeltaMs,
      averageFrameDeltaMs: this.renderBudget.frameCount > 0
        ? this.renderBudget.totalFrameDeltaMs / this.renderBudget.frameCount
        : 0,
      maxFrameDeltaMs: this.renderBudget.maxFrameDeltaMs,
      lastRenderMs: this.renderBudget.lastRenderMs,
      averageRenderMs: this.renderBudget.frameCount > 0
        ? this.renderBudget.totalRenderMs / this.renderBudget.frameCount
        : 0,
      maxRenderMs: this.renderBudget.maxRenderMs,
      sceneObjectCount: sceneCounts.objectCount,
      sceneMeshCount: sceneCounts.meshCount,
      sceneLineCount: sceneCounts.lineCount,
      sceneLightCount: sceneCounts.lightCount,
      globalLightCount: 2,
      stateOwnedPointLightCount: this.activeStateOwnedPointLightOwnerKeys.size,
      stateOwnedPointLightOwners: [...this.activeStateOwnedPointLightOwnerKeys].sort(lexicalCompare),
      stateOwnedPointLightCountByOwnerKind,
      maxStateOwnedPointLights: STATE_OWNED_POINT_LIGHT_BUDGETS[this.sceneryQualityState],
      css2DObjectCount: sceneCounts.css2DObjectCount,
      entityObjectCount: this.entityObjects.size + this.resourceObjects.size,
      effectRootChildCount: this.effectRoot.children.length,
      proposalRootChildCount: this.proposalRoot.children.length,
      labelRootChildCount: this.labelRoot.children.length,
      regionLabelCount: this.regionLabels.size,
      staticRebuildCount: this.staticRebuildCount,
      dynamicSnapshotUpdateCount: this.dynamicSnapshotUpdateCount,
      resourceColorRebuildCount: this.resourceColorRebuildCount,
      resourceAbundanceRebuildCount: this.resourceAbundanceRebuildCount,
      entityRebuildCount: this.entityRebuildCount,
      proposalRebuildCount: this.proposalRebuildCount,
      activeBubbleCount: this.effects.filter((effect) => effect.bubble).length,
      activeEffectCount: effectCounts.total,
      activeEffectCountByGroup: effectCounts.byGroup,
      activeEffectCountByType: effectCounts.byType,
      activeEffectObjectCount: Math.max(0, effectObjectCounts.objectCount - 1),
      activeEffectMeshCount: effectObjectCounts.meshCount,
      activeEffectLineCount: effectObjectCounts.lineCount,
      activeEffectParticleCount: detailBudget.activeEffectParticleCount,
      detailScaleParticleThreshold: this.activeEffectParticleLimit(),
      detailBudgetPressure: detailBudget.detailBudgetPressure,
      adaptiveDetailScale: detailBudget.adaptiveDetailScale,
      pendingProposalVisualCount: this.pendingProposalVisuals.length,
      pendingProposalObjectCount: Math.max(0, proposalObjectCounts.objectCount - 1),
      maxActiveEffectCount: this.activeEffectLimit(),
      culledEffectCount: this.lifecycleCounters.culledEffectCount,
      disposedEffectGeometryCount: this.lifecycleCounters.disposedEffectGeometryCount,
      disposedEffectMaterialCount: this.lifecycleCounters.disposedEffectMaterialCount,
      disposedProposalGeometryCount: this.lifecycleCounters.disposedProposalGeometryCount,
      disposedProposalMaterialCount: this.lifecycleCounters.disposedProposalMaterialCount,
      rendererInfo: {
        calls: renderInfo.calls,
        triangles: renderInfo.triangles,
        points: renderInfo.points,
        lines: renderInfo.lines,
        geometries: memoryInfo.geometries,
        textures: memoryInfo.textures,
      },
      reducedMotion: { ...this.motionDebug },
    };
  }

  private sceneryDiagnostics(): SceneryDiagnostics {
    return {
      recipeVersion: REGION_VISUAL_RECIPE_VERSION,
      recipeHash: this.sceneryRecipeHash,
      rebuildCount: this.sceneryRebuildCount,
      instanceCount: this.sceneryInstanceCount,
      visibleInstanceCount: Math.max(
        0,
        this.sceneryInstanceCount - this.sceneryMaskedInstanceCount,
      ),
      maskedInstanceCount: this.sceneryMaskedInstanceCount,
      dynamicClearanceCount: this.sceneryDynamicClearanceCount,
      dynamicClearanceApplyCount: this.sceneryDynamicClearanceApplyCount,
      objectCount: this.sceneryObjectCount,
      crossingKinds: [...this.sceneryCrossingKinds],
      regionArchetypes: { ...this.sceneryRegionArchetypes },
      quality: this.sceneryQualityState,
    };
  }

  private motionParticleCount(count: number, minimum = 1): number {
    const motionScaled = this.motionSettings.particleDensity >= 1
      ? count
      : Math.max(minimum, Math.round(count * this.motionSettings.particleDensity));
    const { adaptiveDetailScale } = this.detailBudgetState();
    return Math.max(minimum, Math.round(motionScaled * adaptiveDetailScale));
  }

  private motionLift(lift: number): number {
    return lift * this.motionSettings.arcLiftScale;
  }

  private motionPathPoints(
    from: THREE.Vector3,
    to: THREE.Vector3,
    lift: number,
    distanceScale: number,
    segments = this.motionSettings.pathSegments,
  ): THREE.Vector3[] {
    const mid = from.clone().lerp(to, 0.5);
    mid.y += Math.max(
      this.motionLift(lift),
      from.distanceTo(to) * distanceScale * this.motionSettings.arcLiftScale,
    );
    return new THREE.QuadraticBezierCurve3(from, mid, to).getPoints(segments);
  }

  private abundanceSamplePoints(
    region: AtlasRegion,
    kind: "energy" | "materials",
    count: number,
  ): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const seed = region.seed + (kind === "energy" ? 113 : 887);
    const maxAttempts = Math.max(12, count * 8);
    for (let attempt = 0; points.length < count && attempt < maxAttempts; attempt += 1) {
      const angle = hash2(seed * 0.0001 + attempt * 0.37, attempt * 1.91) * Math.PI * 2;
      const radial = 0.22 + hash2(seed * 0.0003 + attempt * 1.71, attempt * 0.67) * 0.56;
      const radius = Math.max(2, Math.min(region.baseR * radial, islandRadius(region, angle) - 2.2));
      const x = region.cx + Math.cos(angle) * radius;
      const z = region.cz + Math.sin(angle) * radius;
      const height = this.terrainHeight(x, z);
      if (height <= 0.08 || islandMask(region, x, z) <= 0.18) {
        continue;
      }
      const lift = kind === "energy" ? 0.35 + (points.length % 3) * 0.08 : 0.09;
      points.push(new THREE.Vector3(x, height + lift, z));
    }
    if (points.length === 0 && count > 0) {
      points.push(new THREE.Vector3(region.cx, this.terrainHeight(region.cx, region.cz) + 0.25, region.cz));
    }
    return points;
  }

  private readonly renderFrame = (frameStartedAt: number): void => {
    if (this.disposed) {
      return;
    }
    const dt = Math.min(this.clock.getDelta(), this.isTourEffectDetail() ? 0.24 : 0.05);
    const frameDeltaMs = this.renderBudget.lastFrameStartedAt === null
      ? 0
      : frameStartedAt - this.renderBudget.lastFrameStartedAt;
    this.renderBudget.lastFrameStartedAt = frameStartedAt;
    this.time += dt;
    this.animateWater(dt);
    this.updateFocusFlight(dt);
    this.updateEffects(dt);
    for (const label of this.regionLabels.values()) {
      const distance = this.camera.position.distanceTo(label.position);
      label.element.style.opacity = String(clamp((distance - 26) / 30, 0, 1) * 0.9);
    }
    if (this.controls.update()) {
      this.invalidateFrame();
    }
    this.relayoutBubbleEffects();
    const renderStartedAt = performance.now();
    this.labelRenderer.render(this.scene, this.camera);
    if (this.shouldRenderWebGLFrame()) {
      this.renderer.render(this.scene, this.camera);
      this.needsWebGLRender = false;
    }
    const renderMs = performance.now() - renderStartedAt;
    this.recordFrameBudget(frameDeltaMs, renderMs);
    if (this.selectionRing.visible) {
      const material = this.selectionRing.material as THREE.MeshBasicMaterial;
      material.opacity = 0.5 + Math.sin(this.time * 3.6) * 0.18;
    }
  };

  private invalidateFrame(): void {
    this.needsWebGLRender = true;
    this.frameScheduler.requestRender();
  }

  private recordFrameBudget(frameDeltaMs: number, renderMs: number): void {
    this.renderBudget.frameCount += 1;
    this.renderBudget.lastFrameDeltaMs = frameDeltaMs;
    this.renderBudget.totalFrameDeltaMs += frameDeltaMs;
    this.renderBudget.maxFrameDeltaMs = Math.max(this.renderBudget.maxFrameDeltaMs, frameDeltaMs);
    this.renderBudget.lastRenderMs = renderMs;
    this.renderBudget.totalRenderMs += renderMs;
    this.renderBudget.maxRenderMs = Math.max(this.renderBudget.maxRenderMs, renderMs);
  }

  private animateWater(_dt: number): void {
    if (this.motionSettings.waterTimeScale <= 0 || this.motionSettings.waterAmplitude <= 0) {
      return;
    }
    const position = this.water.geometry.attributes.position as THREE.BufferAttribute;
    const waveTime = this.time * this.motionSettings.waterTimeScale;
    const amplitude = this.motionSettings.waterAmplitude;
    for (let index = 0; index < position.count; index += 1) {
      const x = this.waterBase[index * 3];
      const z = this.waterBase[index * 3 + 2];
      position.setY(index, Math.sin(x * 0.28 + waveTime * 1.1) * amplitude + Math.cos(z * 0.24 - waveTime * 0.85) * amplitude);
    }
    position.needsUpdate = true;
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.downX = event.clientX;
    this.downY = event.clientY;
  };

  private onClick = (event: MouseEvent): void => {
    if (Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > 6) {
      return;
    }
    this.setPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const entityHit = this.raycaster.intersectObjects(this.hitMeshes, true)[0];
    const owner = entityHit ? findSelectableOwner(entityHit.object) : null;
    if (owner) {
      this.options.onSelect?.({ kind: owner.kind, id: owner.id });
      return;
    }
    const terrainHit = this.raycaster.intersectObject(this.terrain, false)[0];
    if (terrainHit && this.isFocusableLand(terrainHit.point.x, terrainHit.point.z)) {
      this.focusCameraOn(terrainHit.point);
      const region = this.dominantRegion(terrainHit.point.x, terrainHit.point.z);
      if (region) {
        this.options.onSelect?.({ kind: "region", id: region.key });
      }
    }
  };

  private setPointer(event: MouseEvent | PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private focusCameraOn(point: THREE.Vector3, maximumDistance = 16): void {
    const height = this.terrainHeight(point.x, point.z);
    this.focus.fromTarget.copy(this.controls.target);
    this.focus.fromCamera.copy(this.camera.position);
    const subjectTarget = new THREE.Vector3(
      point.x,
      clamp(height + 0.85, 0.85, 12),
      point.z,
    );
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(Math.min(offset.length(), maximumDistance));
    this.focus.toTarget.copy(safeFrameCameraTarget({
      subjectTarget,
      cameraOffset: offset,
      camera: this.camera,
      viewport: this.renderer.domElement.getBoundingClientRect(),
      insets: this.safeFrame,
    }));
    this.focus.toCamera.copy(this.focus.toTarget).add(offset);
    if (this.motionSettings.focusDuration <= 0) {
      this.controls.target.copy(this.focus.toTarget);
      this.camera.position.copy(this.focus.toCamera);
      this.focus.t = 1;
      this.invalidateFrame();
      this.controls.update();
      this.enforceStateOwnedPointLightBudget();
      this.publishDebugHandle();
      return;
    }
    this.focus.duration = this.motionSettings.focusDuration;
    this.focus.t = 0;
    this.invalidateFrame();
  }

  private fitInitialAtlasView(): void {
    this.initialAtlasFitApplied = true;
    const viewport = this.renderer.domElement.getBoundingClientRect();
    if (viewport.width <= 0 || viewport.height <= 0 || this.atlas.length === 0) {
      return;
    }
    const points = this.atlas.map((region) => new THREE.Vector3(
      region.cx,
      this.terrainHeight(region.cx, region.cz) + 0.8,
      region.cz,
    ));
    const bounds = new THREE.Box3().setFromPoints(points);
    const subjectTarget = bounds.getCenter(new THREE.Vector3());
    const atlasRadius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
    const cameraOffsetDirection = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    const viewDirection = cameraOffsetDirection.clone().multiplyScalar(-1);
    const screenRight = new THREE.Vector3().crossVectors(viewDirection, this.camera.up).normalize();
    const screenUp = new THREE.Vector3().crossVectors(screenRight, viewDirection).normalize();
    const insets = this.initialAtlasChromeInsets(viewport);
    const usableWidth = Math.max(1, viewport.width - insets.left - insets.right);
    const usableHeight = Math.max(1, viewport.height - insets.top - insets.bottom);
    const verticalTangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const usableVerticalTangent = verticalTangent * usableHeight / viewport.height;
    const usableHorizontalTangent = verticalTangent
      * this.camera.aspect
      * usableWidth / viewport.width;
    const padding = 1.95;
    let distance = this.controls.minDistance;
    for (const point of points) {
      const relative = point.clone().sub(subjectTarget);
      const depth = relative.dot(cameraOffsetDirection);
      distance = Math.max(
        distance,
        depth + Math.abs(relative.dot(screenRight)) * padding / usableHorizontalTangent,
        depth + Math.abs(relative.dot(screenUp)) * padding / usableVerticalTangent,
      );
    }
    distance = clamp(distance, 24, 620);
    const cameraOffset = cameraOffsetDirection.multiplyScalar(distance);
    const fittedTarget = safeFrameCameraTarget({
      subjectTarget,
      cameraOffset,
      camera: this.camera,
      viewport,
      insets,
    });
    this.controls.maxDistance = Math.max(this.controls.maxDistance, distance * 1.25);
    this.camera.far = Math.max(this.camera.far, distance * 2.1, distance + atlasRadius * 3);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = Math.max(80, distance * 0.75);
      this.scene.fog.far = Math.max(210, distance + atlasRadius * 2.5);
    }
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(fittedTarget);
    this.camera.position.copy(fittedTarget).add(cameraOffset);
    this.controls.update();
    this.invalidateFrame();
  }

  private initialAtlasChromeInsets(viewport: DOMRect): SafeFrameInsets {
    const rectFor = (selector: string): DOMRect | null => {
      const element = this.container.ownerDocument.querySelector(selector);
      if (!element) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? rect : null;
    };
    const hud = rectFor(".top-hud");
    const edge = rectFor(".atlas-edge-controls");
    const ribbon = rectFor(".story-ribbon");
    return normalizeSafeFrameInsets({
      top: Math.max(8, hud ? hud.bottom - viewport.top + 8 : 8),
      right: Math.max(8, edge ? viewport.right - edge.left + 8 : 8),
      bottom: Math.max(8, ribbon ? viewport.bottom - ribbon.top + 8 : 8),
      left: 8,
    });
  }

  private updateFocusFlight(dt: number): void {
    if (this.focus.t >= 1) {
      return;
    }
    const wasInFlight = this.focus.t < 1;
    this.focus.t = Math.min(1, this.focus.t + dt / this.focus.duration);
    const t = this.focus.t * this.focus.t * (3 - 2 * this.focus.t);
    this.controls.target.lerpVectors(this.focus.fromTarget, this.focus.toTarget, t);
    this.camera.position.lerpVectors(this.focus.fromCamera, this.focus.toCamera, t);
    this.invalidateFrame();
    if (wasInFlight && this.focus.t >= 1) {
      this.enforceStateOwnedPointLightBudget();
      this.publishDebugHandle();
    }
  }

  private isFocusableLand(x: number, z: number): boolean {
    const region = this.dominantRegion(x, z);
    return !!region && islandMask(region, x, z) > 0.12 && this.terrainHeight(x, z) > 0.05;
  }

  private terrainHeight(x: number, z: number): number {
    let height = -SEA_DEPTH + fbm(x * 0.025, z * 0.025) * 0.28;
    for (const region of this.atlas) {
      const mask = islandMask(region, x, z);
      if (mask <= 0) {
        continue;
      }
      const dx = x - region.cx;
      const dz = z - region.cz;
      const radial = Math.hypot(dx, dz) / region.baseR;
      const dome = Math.max(0, 1 - radial * radial) * region.dome;
      const relief = (fbm(x * 0.075 + region.seed * 0.0001, z * 0.075) - 0.35) * region.relief;
      height = Math.max(height, mask * (0.25 + dome + relief));
    }
    for (const region of this.atlas) {
      for (const connection of region.snapshot.connections) {
        const other = this.regionFor(connection);
        if (!other || other.key < region.key) {
          continue;
        }
        const distance = segmentDistance(x, z, region.cx, region.cz, other.cx, other.cz);
        if (distance < RIDGE_WIDTH) {
          const ridge = RIDGE_HEIGHT * (1 - distance / RIDGE_WIDTH);
          height = Math.max(height, ridge);
        }
      }
    }
    return height;
  }

  private dominantRegion(x: number, z: number): AtlasRegion | null {
    let best: AtlasRegion | null = null;
    let bestMask = 0;
    for (const region of this.atlas) {
      const mask = islandMask(region, x, z);
      if (mask > bestMask) {
        best = region;
        bestMask = mask;
      }
    }
    return best;
  }

  private regionFor(name: string): AtlasRegion | undefined {
    return this.atlas.find((region) => region.key === name || region.display === name);
  }

  private groundColor(
    x: number,
    z: number,
    height: number,
    normalY: number,
    out: THREE.Color,
  ): THREE.Color {
    const region = this.dominantRegion(x, z);
    if (height < 0.06) {
      return out.copy(PALETTE.sand).lerp(PALETTE.seabed, clamp(-height / 2.8 + 0.35, 0, 1));
    }
    const variation = fbm(x * 0.09 + 3, z * 0.09 + 8);
    if (!region) {
      out.copy(PALETTE.sand);
    } else {
      const [base, accent] = BIOME_GROUND_PALETTE[region.recipe.archetype];
      const condition = (region.energyRatio + region.materialRatio) / 2;
      out.copy(base).lerp(accent, variation * 0.72);
      out.offsetHSL(
        0,
        clamp((condition - 0.5) * 0.08, -0.04, 0.04),
        clamp((condition - 0.5) * 0.1, -0.05, 0.05),
      );
    }
    out.lerp(PALETTE.sand, 1 - sstep(0.06, 0.85, height));
    out.lerp(PALETTE.rock, sstep(0.86, 0.62, normalY) * 0.7);
    return out;
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const nextActiveBubbleLimit = (
      width <= 700 ||
      height <= 420 ||
      window.innerWidth <= 700 ||
      window.innerHeight <= 420
    ) ? 1 : 3;
    const activeBubbleLimitChanged = nextActiveBubbleLimit !== this.activeBubbleLimit;
    this.activeBubbleLimit = nextActiveBubbleLimit;
    const pixelRatio = this.targetPixelRatio();
    if (
      width === this.lastResizeWidth &&
      height === this.lastResizeHeight &&
      pixelRatio === this.lastPixelRatio
    ) {
      if (activeBubbleLimitChanged) {
        this.enforceActiveBubbleLimit();
        this.enforceEffectBudget();
        this.invalidateFrame();
      }
      return;
    }
    this.lastResizeWidth = width;
    this.lastResizeHeight = height;
    this.lastPixelRatio = pixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.labelRenderer.setSize(width, height);
    this.enforceActiveBubbleLimit();
    this.enforceEffectBudget();
    this.invalidateFrame();
  }

  private targetPixelRatio(): number {
    const cap = this.motionSettings.mode === "reduced" ? 1 : 1.5;
    return Math.max(1, Math.min(window.devicePixelRatio || 1, cap));
  }

  private regionScreenPoint(regionName: string): { x: number; y: number } | null {
    const region = this.regionFor(regionName);
    if (!region) {
      return null;
    }
    const point = new THREE.Vector3(region.cx, this.terrainHeight(region.cx, region.cz), region.cz);
    point.project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((point.x + 1) / 2) * rect.width,
      y: rect.top + ((-point.y + 1) / 2) * rect.height,
    };
  }

  private entityScreenPoint(kind: "agent" | "home", id: string): { x: number; y: number } | null {
    const object = this.entityObjects.get(`${kind}:${id}`);
    if (!object) {
      return null;
    }
    object.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(object);
    const point = bounds.isEmpty()
      ? object.getWorldPosition(new THREE.Vector3())
      : bounds.getCenter(new THREE.Vector3());
    point.project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((point.x + 1) / 2) * rect.width,
      y: rect.top + ((-point.y + 1) / 2) * rect.height,
    };
  }

  private homeWorldPoint(homeId: string): { x: number; y: number; z: number } | null {
    const object = this.entityObjects.get(`home:${homeId}`);
    if (!object) {
      return null;
    }
    const point = object.getWorldPosition(new THREE.Vector3());
    return { x: point.x, y: point.y, z: point.z };
  }

  private homeVisualState(homeId: string): HomeVisualState | null {
    const object = this.entityObjects.get(`home:${homeId}`);
    const visual = (object?.userData as { visual?: HomeVisualState } | undefined)?.visual;
    if (!object || !visual) {
      return null;
    }
    object.updateWorldMatrix(true, true);
    const visualBounds = visibleRenderedMeshBounds(object);
    const counts = this.objectCountsFor(object);
    return cloneHomeVisualState({
      ...visual,
      visualHeight: visualBounds.isEmpty()
        ? 0
        : visualBounds.max.y - visualBounds.min.y,
      ownedLightCount: counts.lightCount,
      hearthLightActive: false,
    });
  }

  private homeLayoutState(homeId: string): HomeLayoutDebugState | null {
    const object = this.entityObjects.get(`home:${homeId}`);
    if (!object) {
      return null;
    }
    const point = object.getWorldPosition(new THREE.Vector3());
    const data = object.userData as {
      regionName?: string;
      visual?: HomeVisualState;
    };
    const visual = data.visual;
    const footprintRadius = visual?.ruined
      ? 1.34 + (visual.remnantRatio ?? 0) * 0.22
      : 1.55 * (visual?.growth ?? 1);
    let nearestHomeId: string | undefined;
    let nearestDistance: number | undefined;
    for (const [key, other] of this.entityObjects.entries()) {
      if (!key.startsWith("home:") || key === `home:${homeId}`) {
        continue;
      }
      const otherPoint = other.getWorldPosition(new THREE.Vector3());
      const distance = Math.hypot(point.x - otherPoint.x, point.z - otherPoint.z);
      if (nearestDistance === undefined || distance < nearestDistance) {
        nearestDistance = distance;
        nearestHomeId = key.slice("home:".length);
      }
    }
    const region = data.regionName ? this.regionFor(data.regionName) : null;
    const mask = region ? islandMask(region, point.x, point.z) : undefined;
    const height = this.terrainHeight(point.x, point.z);
    return {
      id: homeId,
      regionName: data.regionName,
      world: { x: point.x, y: point.y, z: point.z },
      screen: this.entityScreenPoint("home", homeId),
      footprintRadius,
      nearestHomeId,
      nearestDistance,
      terrainHeight: height,
      islandMask: mask,
      onLand: height > 0.05 && (mask === undefined || mask > 0.12),
    };
  }

  private agentVisualState(agentId: string): AgentVisualDebugState | null {
    const object = this.entityObjects.get(`agent:${agentId}`);
    if (!object) {
      return null;
    }
    const point = object.getWorldPosition(new THREE.Vector3());
    const visual = (object.userData as { visual?: AgentVisualState }).visual;
    const counts = this.objectCountsFor(object);
    const semanticParts = new Set<AgentSemanticPartName>();
    const semanticWorldPoints: Partial<
      Record<AgentSemanticPartName, { x: number; y: number; z: number }>
    > = {};
    object.updateWorldMatrix(true, true);
    object.traverse((part: THREE.Object3D) => {
      const semanticPart = (
        part.userData as { semanticPart?: AgentSemanticPartName }
      ).semanticPart;
      if (semanticPart) {
        semanticParts.add(semanticPart);
        const semanticWorld = part.getWorldPosition(new THREE.Vector3());
        semanticWorldPoints[semanticPart] = {
          x: semanticWorld.x,
          y: semanticWorld.y,
          z: semanticWorld.z,
        };
      }
    });
    const visualRoot = object.getObjectByName("mystic-visual");
    const visualBounds = visualRoot
      ? new THREE.Box3().setFromObject(visualRoot)
      : new THREE.Box3();
    const screenHeight = this.projectedBoundsScreenHeight(visualBounds);
    return {
      visible: isVisibleInHierarchy(object),
      world: { x: point.x, y: point.y, z: point.z },
      screen: this.entityScreenPoint("agent", agentId),
      screenHeight,
      semanticWorldPoints,
      visual: visual
        ? {
            ...visual,
            semanticParts: [...semanticParts],
            objectCount: counts.objectCount,
            meshCount: counts.meshCount,
            lightCount: counts.lightCount,
            flameLightActive: this.activeStateOwnedPointLightOwnerKeys.has(`agent:${agentId}`),
            visualHeight: visualBounds.isEmpty()
              ? 0
              : visualBounds.max.y - visualBounds.min.y,
          }
        : undefined,
    };
  }

  private projectedBoundsScreenHeight(bounds: THREE.Box3): number {
    if (bounds.isEmpty()) {
      return 0;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const projected = new THREE.Vector3(x, y, z).project(this.camera);
          const screenY = rect.top + ((-projected.y + 1) / 2) * rect.height;
          minimum = Math.min(minimum, screenY);
          maximum = Math.max(maximum, screenY);
        }
      }
    }
    return Number.isFinite(minimum) && Number.isFinite(maximum)
      ? Math.max(0, maximum - minimum)
      : 0;
  }

  private regionAbundanceState(regionName: string): RegionAbundanceDebugState | null {
    const object = this.resourceObjects.get(`region-abundance:${regionName}`);
    const visual = (object?.userData as { visual?: RegionAbundanceDebugState } | undefined)?.visual;
    return visual
      ? {
          ...visual,
          sampleWorld: visual.sampleWorld.map((point) => ({ ...point })),
        }
      : null;
  }

  private regionWorldPoint(regionName: string): { x: number; z: number } | null {
    const region = this.regionFor(regionName);
    return region ? { x: region.cx, z: region.cz } : null;
  }

  private systemEventAnchor(eventType: string): THREE.Vector3 | null {
    if (eventType !== "simulation_started" || this.atlas.length === 0) {
      return null;
    }
    const region = this.atlas[0];
    return new THREE.Vector3(
      region.cx,
      this.terrainHeight(region.cx, region.cz) + 1.4,
      region.cz,
    );
  }

  private publishDebugHandle(): void {
    const cameraState = () => ({
      distance: this.camera.position.distanceTo(this.controls.target),
      target: this.controls.target.toArray(),
      zoomSpeed: this.controls.zoomSpeed,
      minDistance: this.controls.minDistance,
      zoomToCursor: this.controls.zoomToCursor,
    });
    const worldHandle: VivariumWorldDebugHandle = {
      isReady: true,
      atlasLayoutHash: () => atlasLayoutHash(this.atlasLayoutState),
      atlasTopologyDiagnostics: () => ({
        asymmetricEdges: [...this.atlasLayoutState.diagnostics.asymmetricEdges],
        fallback: this.atlasLayoutState.diagnostics.fallback,
      }),
      cameraState,
      screenPointForRegion: (regionName: string) => this.regionScreenPoint(regionName),
      screenPointForAgent: (agentId: string) => this.entityScreenPoint("agent", agentId),
      screenPointForHome: (homeId: string) => this.entityScreenPoint("home", homeId),
      worldPointForHome: (homeId: string) => this.homeWorldPoint(homeId),
      homeVisualState: (homeId: string) => this.homeVisualState(homeId),
      homeLayoutState: (homeId: string) => this.homeLayoutState(homeId),
      regionAbundanceState: (regionName: string) => this.regionAbundanceState(regionName),
      worldPointForRegion: (regionName: string) => this.regionWorldPoint(regionName),
      focusRegion: (regionName: string) => this.focusRegion(regionName),
      focusHome: (homeId: string) => this.focusHome(homeId),
      focusAgent: (agentId: string) => this.focusAgent(agentId),
      atmosphereState: () => this.atmosphereState(),
      setObserverVisualPhaseForTest: (phase: number | null) => this.setObserverVisualPhaseForTest(phase),
      sampleCanvasPixels: () => this.sampleRenderedCanvasPixels(),
      agentVisualState: (agentId: string) => this.agentVisualState(agentId),
      pendingProposalVisualState: () => this.pendingProposalVisualState(),
      activeEffects: () => this.effects.map((effect) => this.effectDebugEntry(effect)),
      activeEventEffects: () => this.effects.map((effect) => this.effectDebugEntry(effect)),
      eventEffectCount: () => this.eventEffectCount(),
      activeEffectCounts: () => this.activeEffectCounts(),
      effectLifecycleDiagnostics: () => this.effectLifecycleDiagnostics(),
      renderBudgetDiagnostics: () => this.renderBudgetDiagnostics(),
      terrainContinuityDiagnostics: () => this.terrainContinuityDiagnostics(),
      sceneryDiagnostics: () => this.sceneryDiagnostics(),
      motionMode: () => ({ ...this.motionDebug }),
      appliedEventCursors: () => this.appliedEventCursorList(),
      renderedEventCursors: () => this.renderedEventCursorList(),
      recentRenderedEventBeats: () => this.recentRenderedEventBeatList(),
      markEventCursorHandled: (cursor: number) => this.markEventCursorHandled(cursor),
      markSnapshotCursorHandled: (cursor: number) => this.markSnapshotCursorHandled(cursor),
      applyEventBeat: (entry: EventEnvelopeEntry, options?: EventBeatRenderOptions) => this.applyEventBeat(entry, options),
    };
    this.publishedWorldDebugHandle = worldHandle;

    window.__viv = {
      scene: this.scene,
      camera: this.camera,
      controls: this.controls,
      terrain: this.terrain,
      renderer: this.renderer,
      terrainHeight: (x: number, z: number) => this.terrainHeight(x, z),
      regionScreenPoint: (regionName: string) => this.regionScreenPoint(regionName),
      ready: true,
    };
    window.__vivariumWorld = worldHandle;
  }

  private sampleRenderedCanvasPixels(): number {
    this.labelRenderer.render(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
    this.needsWebGLRender = false;
    return sampleCanvasPixels(this.renderer.domElement);
  }

  private rememberEventCursor(cursor: number): void {
    if (this.appliedEventCursors.has(cursor)) {
      return;
    }
    this.appliedEventCursors.add(cursor);
    this.appliedEventOrder.push(cursor);
    while (this.appliedEventOrder.length > 512) {
      const oldest = this.appliedEventOrder.shift();
      if (oldest !== undefined) {
        this.appliedEventCursors.delete(oldest);
        this.renderedEventCursors.delete(oldest);
      }
    }
  }

  private rememberRenderedEventBeat(
    entry: EventEnvelopeEntry,
    spec: EventVisualSpec,
    effects: VisualEffect[],
    flags: {
      hasBubble: boolean;
      hasPulse: boolean;
      hasArc: boolean;
      hasSpecial: boolean;
    },
  ): void {
    const summaryKinds = Array.from(new Set(
      effects
        .map((effect) => this.effectDebugSummary(effect)?.kind)
        .filter((kind): kind is string => typeof kind === "string" && kind.trim().length > 0)
        .map((kind) => boundedDebugString(kind)),
    )).slice(0, MAX_RENDERED_EVENT_BEAT_SUMMARY_KINDS);

    this.recentRenderedEventBeatRing.push({
      cursor: entry.cursor,
      eventType: boundedDebugString(entry.event.type),
      group: boundedDebugString(spec.group),
      summaryKinds,
      hasBubble: flags.hasBubble,
      hasPulse: flags.hasPulse,
      hasArc: flags.hasArc,
      hasSpecial: flags.hasSpecial,
      effectCountDelta: effects.length,
      summaryCount: summaryKinds.length,
    });

    while (this.recentRenderedEventBeatRing.length > MAX_RECENT_RENDERED_EVENT_BEATS) {
      this.recentRenderedEventBeatRing.shift();
    }
  }

  private anchorForAgent(agentId?: string): THREE.Vector3 | null {
    if (!agentId) {
      return null;
    }
    const object = this.entityObjects.get(`agent:${agentId}`);
    if (!object) {
      return null;
    }
    const point = object.getWorldPosition(new THREE.Vector3());
    point.y += 1.7;
    return point;
  }

  private semanticAgentPartWorld(
    agentId: string | undefined,
    semanticPart: AgentSemanticPartName,
  ): THREE.Vector3 | null {
    if (!agentId) {
      return null;
    }
    const object = this.entityObjects.get(`agent:${agentId}`);
    if (!object) {
      return null;
    }
    object.updateWorldMatrix(true, true);
    const matches: THREE.Object3D[] = [];
    object.traverse((part: THREE.Object3D) => {
      if (matches.length > 0) {
        return;
      }
      const candidate = (
        part.userData as { semanticPart?: AgentSemanticPartName }
      ).semanticPart;
      if (candidate === semanticPart) {
        matches.push(part);
      }
    });
    return matches[0]?.getWorldPosition(new THREE.Vector3()) ?? null;
  }

  private anchorForHome(homeId?: string): THREE.Vector3 | null {
    if (!homeId) {
      return null;
    }
    const object = this.entityObjects.get(`home:${homeId}`);
    if (!object) {
      return null;
    }
    const point = object.getWorldPosition(new THREE.Vector3());
    point.y += 1.5;
    return point;
  }

  private anchorForRegion(regionName?: string): THREE.Vector3 | null {
    if (!regionName) {
      return null;
    }
    const region = this.regionFor(regionName);
    if (!region) {
      return null;
    }
    return new THREE.Vector3(region.cx, this.terrainHeight(region.cx, region.cz) + 1.1, region.cz);
  }

  private screenPointForWorld(point: THREE.Vector3): { x: number; y: number } | null {
    return this.screenPointForWorldInRect(
      point,
      this.renderer.domElement.getBoundingClientRect(),
    );
  }

  private screenPointForWorldInRect(
    point: THREE.Vector3,
    rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  ): { x: number; y: number } | null {
    const projected = point.clone().project(this.camera);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
      return null;
    }
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((-projected.y + 1) / 2) * rect.height,
    };
  }

  private bubbleLaneFor(
    effect: VisualEffect & { bubble: BubbleEffectState; label: CSS2DObject },
    layout: BubbleLayoutPass,
  ): {
    lane: number;
    offsetX: number;
    offsetY: number;
    screen: { x: number; y: number } | null;
  } {
    const { compact, viewport } = layout;
    const { anchor, priority } = effect.bubble;
    const preferredOffsets = compact ? BUBBLE_LANE_OFFSETS_COMPACT : BUBBLE_LANE_OFFSETS;
    const screen = layout.screens.get(effect) ?? null;
    const candidateMeasurement = layout.measurements.get(effect);
    const offsets = screen
      ? [
          ...preferredOffsets,
          ...bubbleViewportLaneOffsets(screen, viewport, compact, candidateMeasurement),
        ]
      : preferredOffsets;
    const candidateRect = (offsetX: number, offsetY: number) => (
      screen
        ? this.bubbleRectForEffect(
            effect,
            screen,
            offsetX,
            offsetY,
            compact,
            candidateMeasurement,
          )
        : null
    );
    const laneCounts = new Array(offsets.length).fill(0) as number[];
    const avoidRects = [
      ...layout.placedBubbles.map((bubble) => bubble.rect),
      ...layout.chromeRects,
    ];

    for (const active of layout.placedBubbles) {
      if (!compact && !this.sameBubbleCluster(anchor, screen, active.bubble, active.screen, compact)) {
        continue;
      }
      laneCounts[active.bubble.lane] = (laneCounts[active.bubble.lane] ?? 0) + 1;
    }

    const preferredLanes = BUBBLE_LANE_ORDER[priority];
    const laneOrder = [
      ...preferredLanes,
      ...offsets.map((_, lane) => lane).filter((lane) => !preferredLanes.includes(lane)),
    ].filter((lane) => lane < offsets.length);
    const candidateBounds = new Map<number, { left: number; right: number; top: number; bottom: number }>();
    for (const lane of laneOrder) {
      const offset = offsets[lane] ?? offsets[0];
      const bounds = candidateRect(offset.x, offset.y);
      if (bounds) {
        candidateBounds.set(lane, bounds);
      }
    }
    const lane = laneOrder.find((candidate) => {
      const bounds = candidateBounds.get(candidate);
      return bounds ? bubbleRectFits(bounds, viewport, avoidRects) : false;
    });
    if (lane !== undefined) {
      const offset = offsets[lane] ?? offsets[0];
      return { lane, offsetX: offset.x, offsetY: offset.y, screen };
    }

    const originBounds = candidateRect(0, 0);
    const packed = originBounds
      ? packedBubbleOffset(originBounds, viewport, avoidRects)
      : null;
    if (packed) {
      return {
        lane: offsets.length + packed.index,
        offsetX: packed.offsetX,
        offsetY: packed.offsetY,
        screen,
      };
    }

    const fallbackLane = laneOrder.reduce((best, candidate) => {
      const bounds = candidateBounds.get(candidate);
      const bestBounds = candidateBounds.get(best);
      if (!bounds || !bestBounds) {
        return laneCounts[candidate] < laneCounts[best] ? candidate : best;
      }
      return bubbleLaneScore(bounds, avoidRects, laneCounts[candidate], viewport)
        < bubbleLaneScore(bestBounds, avoidRects, laneCounts[best], viewport)
        ? candidate
        : best;
    }, laneOrder[0] ?? 0);
    const offset = offsets[fallbackLane] ?? offsets[0];
    return { lane: fallbackLane, offsetX: offset.x, offsetY: offset.y, screen };
  }

  private bubbleRectForEffect(
    effect: VisualEffect,
    screen: { x: number; y: number },
    offsetX: number,
    offsetY: number,
    compact: boolean,
    measurement?: BubbleLayoutMeasurement,
  ): { left: number; right: number; top: number; bottom: number } {
    const bubble = effect.bubble;
    if (!bubble) {
      return bubbleEstimatedRect(screen, offsetX, offsetY, compact);
    }
    const rect = measurement;
    if (rect && rect.width > 0 && rect.height > 0) {
      const previousScreen = measurement.screen ?? bubble.screen ?? screen;
      const previousOffsetX = measurement.offsetX;
      const previousOffsetY = measurement.offsetY;
      const deltaX = screen.x - previousScreen.x + offsetX - previousOffsetX;
      const deltaY = screen.y - previousScreen.y + offsetY - previousOffsetY;
      return {
        left: rect.left + deltaX,
        right: rect.right + deltaX,
        top: rect.top + deltaY,
        bottom: rect.bottom + deltaY,
      };
    }
    return bubbleEstimatedRect(screen, offsetX, offsetY, compact);
  }

  private createBubbleLayoutPass(
    effects: readonly (VisualEffect & { bubble: BubbleEffectState; label: CSS2DObject })[],
    measurements: ReadonlyMap<VisualEffect, BubbleLayoutMeasurement>,
  ): BubbleLayoutPass {
    const canvasViewport = this.renderer.domElement.getBoundingClientRect();
    const viewport = safeFrameViewportRect(canvasViewport, this.safeFrame);
    const compact = viewport.width < 520;
    const screens = new Map<VisualEffect, { x: number; y: number } | null>();
    for (const effect of effects) {
      screens.set(
        effect,
        this.screenPointForWorldInRect(
          effect.label.getWorldPosition(new THREE.Vector3()),
          canvasViewport,
        ),
      );
    }
    return {
      compact,
      viewport,
      chromeRects: this.appChromeAvoidRects(),
      measurements,
      screens,
      placedBubbles: [],
    };
  }

  private relayoutBubbleEffects(): void {
    if (!this.effects.some((effect) => effect.bubble && effect.label)) {
      this.bubbleLayoutSignature = this.currentBubbleLayoutSignature();
      return;
    }
    const signature = this.currentBubbleLayoutSignature();
    if (signature === this.bubbleLayoutSignature) {
      return;
    }
    this.bubbleLayoutSignature = signature;

    const priorityRank: Record<BubblePriority, number> = { drama: 0, featured: 1, ambient: 2 };
    const bubbleEffects = this.effects
      .filter((effect): effect is VisualEffect & { bubble: BubbleEffectState; label: CSS2DObject } => (
        Boolean(effect.bubble && effect.label)
      ))
      .sort((left, right) => (
        priorityRank[left.bubble.priority] - priorityRank[right.bubble.priority]
        || left.bubble.cursor - right.bubble.cursor
      ));
    let measurementsComplete = false;
    for (let pass = 0; pass < 2; pass += 1) {
      let passMeasurementsComplete = true;
      const measurements = new Map<VisualEffect, BubbleLayoutMeasurement>();
      for (const effect of bubbleEffects) {
        const element = effect.label.element.querySelector<HTMLElement>(".viv-event-bubble");
        const rect = element?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          passMeasurementsComplete = false;
          continue;
        }
        measurements.set(effect, {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          screen: effect.bubble.screen,
          offsetX: effect.bubble.offsetX,
          offsetY: effect.bubble.offsetY,
        });
      }
      const layout = this.createBubbleLayoutPass(bubbleEffects, measurements);

      for (const effect of bubbleEffects) {
        const lane = this.bubbleLaneFor(effect, layout);
        effect.bubble.screen = lane.screen;
        effect.bubble.lane = lane.lane;
        effect.bubble.offsetX = lane.offsetX;
        effect.bubble.offsetY = lane.offsetY;
        effect.label.element.style.setProperty("--bubble-lane-x", `${lane.offsetX}px`);
        effect.label.element.style.setProperty("--bubble-lane-y", `${lane.offsetY}px`);
        const bubbleElement = effect.label.element.querySelector<HTMLElement>(".viv-event-bubble");
        if (bubbleElement) {
          bubbleElement.dataset.eventLane = String(lane.lane);
        }
        if (lane.screen) {
          layout.placedBubbles.push({
            bubble: effect.bubble,
            screen: lane.screen,
            rect: this.bubbleRectForEffect(
              effect,
              lane.screen,
              lane.offsetX,
              lane.offsetY,
              layout.compact,
              measurements.get(effect),
            ),
          });
        }
      }
      measurementsComplete = passMeasurementsComplete;
      if (pass === 0) {
        this.labelRenderer.render(this.scene, this.camera);
      }
    }
    if (!measurementsComplete) {
      this.bubbleLayoutSignature = "";
    }
  }

  private currentBubbleLayoutSignature(): string {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const position = this.camera.position;
    const target = this.controls.target;
    const parts = [
      rect.width,
      rect.height,
      rect.left,
      rect.top,
      position.x,
      position.y,
      position.z,
      target.x,
      target.y,
      target.z,
      this.safeFrame.top,
      this.safeFrame.right,
      this.safeFrame.bottom,
      this.safeFrame.left,
    ];
    const bubblePositions = this.effects.flatMap((effect) => {
      if (!effect.bubble || !effect.label) {
        return [];
      }
      const point = effect.label.getWorldPosition(new THREE.Vector3());
      return [`${effect.id}:${point.x.toFixed(2)}:${point.y.toFixed(2)}:${point.z.toFixed(2)}`];
    });
    return `${parts.map((value) => value.toFixed(2)).join(":")}|${bubblePositions.join("|")}`;
  }

  private sameBubbleCluster(
    anchor: THREE.Vector3,
    screen: { x: number; y: number } | null,
    bubble: BubbleEffectState,
    bubbleScreen: { x: number; y: number } | null,
    compact: boolean,
  ): boolean {
    const worldDistance = Math.hypot(anchor.x - bubble.anchor.x, anchor.z - bubble.anchor.z);
    if (worldDistance <= BUBBLE_CLUSTER_WORLD_RADIUS) {
      return true;
    }
    if (!screen || !bubbleScreen) {
      return false;
    }
    const screenDistance = Math.hypot(screen.x - bubbleScreen.x, screen.y - bubbleScreen.y);
    return screenDistance <= (compact ? BUBBLE_CLUSTER_SCREEN_RADIUS_COMPACT : BUBBLE_CLUSTER_SCREEN_RADIUS);
  }

  private initialBubbleLane(priority: BubblePriority): {
    lane: number;
    offsetX: number;
    offsetY: number;
    screen: null;
  } {
    const lane = BUBBLE_LANE_ORDER[priority][0] ?? 0;
    const offset = BUBBLE_LANE_OFFSETS[lane] ?? BUBBLE_LANE_OFFSETS[0];
    return { lane, offsetX: offset.x, offsetY: offset.y, screen: null };
  }

  private appChromeAvoidRects(): Array<{ left: number; right: number; top: number; bottom: number }> {
    return [
      ".top-hud",
      ".replay-preview",
      ".archive-chronicle",
      ".presence-rail",
      ".chronicle",
      ".inspector",
      ".story-ribbon",
      ".atlas-edge-controls",
    ].flatMap((selector) => {
      const element = this.container.ownerDocument.querySelector(selector);
      if (!element) {
        return [];
      }
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return [];
      }
      return [{
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      }];
    });
  }

  private addBubbleEffect({
    cursor,
    anchor,
    eventType,
    group,
    text,
    detail,
    chainDetail,
    className,
    color,
    focus,
    summary,
  }: {
    cursor: number;
    anchor: THREE.Vector3;
    eventType: string;
    group: EffectGroup;
    text: string;
    detail?: EventBubbleDetailPresentation;
    chainDetail?: EventChainDetailPresentation;
    className: string;
    color: string;
    focus: RendererSelection | null;
    summary?: EffectDebugSummary;
  }): void {
    const visualMetadata = getEventVisualMetadata(eventType);
    const fallbackPriority = bubblePriorityFor(eventType, group);
    const catalogPriority = visualMetadata?.priority ?? fallbackPriority;
    const priority = strongestBubblePriority(catalogPriority, fallbackPriority);
    const accent = visualMetadata?.accent ?? color;
    const glyph = visualMetadata?.glyph ?? fallbackEventGlyph(eventType);
    const iconKey = visualMetadata?.iconKey ?? FALLBACK_EVENT_VISUAL_ICON_KEY;
    const iconLabel = visualMetadata?.iconLabel ?? "Event";
    const medallionLabel = visualMetadata?.medallionLabel ?? "Event";
    const lane = this.initialBubbleLane(priority);
    const root = new THREE.Group();
    root.position.copy(anchor);
    const ownerDocument = this.container.ownerDocument;
    const wrapper = ownerDocument.createElement("div");
    wrapper.className = "viv-event-bubble-anchor";
    wrapper.style.setProperty("--event-color", accent);
    wrapper.style.setProperty("--bubble-lane-x", `${lane.offsetX}px`);
    wrapper.style.setProperty("--bubble-lane-y", `${lane.offsetY}px`);
    const element = ownerDocument.createElement(focus ? "button" : "div");
    if (focus) {
      element.setAttribute("type", "button");
      element.setAttribute("aria-label", `Focus ${medallionLabel}: ${text}`);
      element.dataset.eventFocusKind = focus.kind;
      element.dataset.eventFocusId = focus.id;
      element.style.pointerEvents = "auto";
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        this.focusSelection(focus);
        this.options.onBeatSelect?.(cursor);
      });
    }
    element.className = `viv-event-bubble ${className} viv-event-bubble-priority-${priority}`;
    element.dataset.eventCursor = String(cursor);
    element.dataset.eventType = eventType;
    element.dataset.eventGroup = group;
    element.dataset.eventLane = String(lane.lane);
    element.dataset.eventPriority = priority;
    element.dataset.eventCatalogPriority = catalogPriority;
    element.dataset.eventGlyph = glyph;
    element.dataset.eventIcon = iconKey;
    element.dataset.eventIconLabel = iconLabel;
    element.dataset.eventMedallionLabel = medallionLabel;
    element.dataset.eventAccent = accent;
    applyBubbleArrivalVisualState(element, bubbleArrivalVisualState(0, priority, this.motionSettings.mode));
    if (detail) {
      element.dataset.eventDetailKind = detail.kind;
    }
    if (chainDetail) {
      element.dataset.eventChainKind = chainDetail.kind;
      element.dataset.eventChainCount = String(chainDetail.count);
      element.dataset.eventChainWindow = chainDetail.window;
      element.dataset.eventChainText = chainDetail.text;
    }
    element.style.setProperty("--event-color", accent);
    const medallion = ownerDocument.createElement("span");
    medallion.className = "event-medallion viv-event-bubble-medallion";
    medallion.dataset.eventIcon = iconKey;
    medallion.dataset.eventIconLabel = iconLabel;
    medallion.dataset.eventMedallionLabel = medallionLabel;
    medallion.setAttribute("aria-hidden", "true");
    medallion.append(createEventVisualIconSvgElement(iconKey, ownerDocument));
    const textElement = ownerDocument.createElement("span");
    textElement.className = "viv-event-bubble-text";
    textElement.textContent = text;
    const copyElement = ownerDocument.createElement("span");
    copyElement.className = "viv-event-bubble-copy";
    copyElement.append(textElement);
    const metaElement = detail || chainDetail ? ownerDocument.createElement("span") : null;
    if (metaElement) {
      metaElement.className = "viv-event-bubble-meta";
    }
    if (detail) {
      element.classList.add("viv-event-bubble-with-detail");
      const detailElement = ownerDocument.createElement("span");
      detailElement.className = "viv-event-bubble-detail";
      detailElement.textContent = detail.text;
      metaElement?.append(detailElement);
    }
    if (chainDetail) {
      element.classList.add("viv-event-bubble-with-chain");
      const chainElement = ownerDocument.createElement("span");
      chainElement.className = "viv-event-bubble-chain";
      chainElement.textContent = chainDetail.text;
      metaElement?.append(chainElement);
    }
    if (metaElement) {
      copyElement.append(metaElement);
    }
    element.append(medallion, copyElement);
    wrapper.append(element);
    const label = new CSS2DObject(wrapper);
    label.position.set(0, 0.8, 0);
    root.add(label);
    this.effectRoot.add(root);
    this.registerEffect({
      id: `${eventType}:${this.time}:${this.effects.length}`,
      eventType,
      group,
      root,
      materials: [],
      label,
      bubble: {
        cursor,
        anchor: anchor.clone(),
        screen: lane.screen,
        lane: lane.lane,
        priority,
        catalogPriority,
        glyph,
        iconKey,
        iconLabel,
        medallionLabel,
        accent,
        arrivalPhase: "arriving",
        arrivalProgress: 0,
        arrivalOpacity: 0.72,
        offsetX: lane.offsetX,
        offsetY: lane.offsetY,
        ...(chainDetail ? { chainDetail } : {}),
      },
      ...(summary ? { summary } : {}),
      age: 0,
      duration: priority === "drama" ? 3.8 : priority === "featured" ? 3.45 : 3.1,
    });
    this.bubbleLayoutSignature = "";
  }

  private lifeTransitionState(
    spec: EventVisualSpec,
    anchors: Record<AnchorRole, THREE.Vector3 | null>,
    anchor: THREE.Vector3,
  ): LifeTransitionEffectState | undefined {
    if (!spec.lifeTransitionKind) {
      return undefined;
    }
    const targetWorld = anchors.target?.clone() ?? anchors.actor?.clone() ?? undefined;
    return {
      transitionKind: spec.lifeTransitionKind,
      actorId: spec.actorId,
      targetId: spec.targetId ?? spec.actorId,
      regionName: spec.regionName,
      trigger: spec.trigger,
      energy: spec.energy,
      diedAt: spec.diedAt,
      decayedAt: spec.decayedAt,
      anchorWorld: anchor.clone(),
      actorWorld: anchors.actor?.clone() ?? undefined,
      targetWorld,
      flameState: spec.lifeTransitionKind === "paralyzed" ? "fallen" : "dead",
    };
  }

  private addPulseEffect({
    anchor,
    eventType,
    group,
    color,
    scale,
    lifeTransition,
    summary,
  }: {
    anchor: THREE.Vector3;
    eventType: string;
    group: EffectGroup;
    color: string;
    scale: number;
    lifeTransition?: LifeTransitionEffectState;
    summary?: EffectDebugSummary;
  }): void {
    const root = new THREE.Group();
    root.position.set(anchor.x, this.terrainHeight(anchor.x, anchor.z) + 0.18, anchor.z);
    const visualScale = scale * (0.72 + this.motionSettings.pulseScale * 0.28);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55 * visualScale, 0.82 * visualScale, 44), material);
    ring.rotation.x = -Math.PI / 2;
    root.add(ring);
    const light = new THREE.PointLight(color, 0.45 + 0.75 * this.motionSettings.pulseScale, 7 * visualScale, 2);
    light.position.y = 1.2;
    root.add(light);
    this.effectRoot.add(root);
    this.registerEffect({
      id: `${eventType}:${this.time}:${this.effects.length}`,
      eventType,
      group,
      root,
      materials: [material],
      ...(lifeTransition ? { lifeTransition } : {}),
      ...(summary ? { summary } : {}),
      age: 0,
      duration: 1.8,
    });
  }

  private addArcEffect({
    from,
    to,
    eventType,
    group,
    color,
    summary,
  }: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    eventType: string;
    group: EffectGroup;
    color: string;
    summary?: EffectDebugSummary;
  }): void {
    const root = new THREE.Group();
    const mid = from.clone().lerp(to, 0.5);
    mid.y += Math.max(this.motionLift(2.8), from.distanceTo(to) * 0.08 * this.motionSettings.arcLiftScale);
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(Math.max(12, this.motionSettings.arcSegments - 8)));
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    const travelMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const travel = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), travelMaterial);
    const points = curve.getPoints(this.motionSettings.arcSegments);
    travel.position.copy(points[0]);
    root.add(line, travel);
    this.effectRoot.add(root);
    this.registerEffect({
      id: `${eventType}:${this.time}:${this.effects.length}`,
      eventType,
      group,
      root,
      materials: [material, travelMaterial],
      travel: { object: travel, points },
      particleCount: 1,
      ...(summary ? { summary } : {}),
      age: 0,
      duration: 2.25,
    });
  }

  private addResourceHarvestEffect({
    spec,
    eventType,
    group,
    color,
    anchors,
    primary,
  }: {
    spec: EventVisualSpec;
    eventType: string;
    group: EffectGroup;
    color: string;
    anchors: Record<AnchorRole, THREE.Vector3 | null>;
    primary: THREE.Vector3;
  }): void {
    const actor = anchors.actor;
    const region = anchors.region ?? primary;
    if (!actor) {
      return;
    }
    const root = new THREE.Group();
    const points = this.motionPathPoints(region, actor, 1.6, 0.05, Math.max(18, this.motionSettings.pathSegments - 4));
    const pathMaterial = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), pathMaterial);
    const moteMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const amount = spec.amount ?? 0;
    const moteCount = this.motionParticleCount(clamp(Math.round(amount / 2), 4, 12), 3);
    const motes: RaidMote[] = [];
    for (let index = 0; index < moteCount; index += 1) {
      const mote = new THREE.Mesh(
        new THREE.SphereGeometry(0.09 + (index % 3) * 0.025, 8, 6),
        moteMaterial,
      );
      mote.position.copy(points[0]);
      motes.push({ mesh: mote, points, offset: index / moteCount });
      root.add(mote);
    }
    root.add(line);
    this.effectRoot.add(root);

    const atlasRegion = spec.regionName ? this.regionFor(spec.regionName) : undefined;
    this.registerEffect({
      id: `${eventType}:harvest:${this.time}:${this.effects.length}`,
      eventType,
      group,
      root,
      materials: [pathMaterial, moteMaterial],
      resourceHarvest: {
        actorId: spec.actorId,
        regionName: spec.regionName,
        resourceType: spec.resourceType,
        amount: spec.amount,
        streamStartWorld: region.clone(),
        streamEndWorld: actor.clone(),
        regionEnergyRatio: atlasRegion?.energyRatio,
        regionMaterialRatio: atlasRegion?.materialRatio,
        motes,
        pathMaterial,
        moteMaterial,
      },
      particleCount: motes.length,
      age: 0,
      duration: 2.35,
    });
  }

  private addRecoveryRelightEffect({
    spec,
    eventType,
    group,
    color,
    anchors,
    primary,
  }: {
    spec: EventVisualSpec;
    eventType: string;
    group: EffectGroup;
    color: string;
    anchors: Record<AnchorRole, THREE.Vector3 | null>;
    primary: THREE.Vector3;
  }): void {
    const target = this.semanticAgentPartWorld(spec.targetId, "open-palm")
      ?? anchors.target
      ?? primary;
    const actor = anchors.actor ?? null;
    const root = new THREE.Group();
    const proxyMaterials: THREE.Material[] = [];
    const proxyFlame = makeRelightFlame(proxyMaterials);
    proxyFlame.position.copy(target);
    root.add(proxyFlame);

    const from = actor ?? target.clone().add(new THREE.Vector3(-0.8, 0.8, 0.2));
    const points = this.motionPathPoints(from, target, 1.4, 0.08, this.motionSettings.arcSegments);
    const pathMaterial = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), pathMaterial);
    const moteMaterial = new THREE.MeshBasicMaterial({
      color: "#f0c66f",
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const moteCount = this.motionParticleCount(clamp(Math.round((spec.amount ?? 4) * 1.5), 5, 12), 3);
    const motes: RaidMote[] = [];
    for (let index = 0; index < moteCount; index += 1) {
      const mote = new THREE.Mesh(
        new THREE.SphereGeometry(0.075 + (index % 2) * 0.025, 8, 6),
        moteMaterial,
      );
      mote.position.copy(points[0]);
      motes.push({ mesh: mote, points, offset: index / moteCount });
      root.add(mote);
    }
    const light = new THREE.PointLight("#f0c66f", 1.4, 3.8, 2);
    light.position.copy(target);
    root.add(path, light);
    this.effectRoot.add(root);

    const actorVisual = spec.actorId
      ? (this.entityObjects.get(`agent:${spec.actorId}`)?.userData as { visual?: AgentVisualState } | undefined)?.visual
      : undefined;
    const targetVisual = spec.targetId
      ? (this.entityObjects.get(`agent:${spec.targetId}`)?.userData as { visual?: AgentVisualState } | undefined)?.visual
      : undefined;
    this.registerEffect({
      id: `${eventType}:relight:${this.time}:${this.effects.length}`,
      eventType,
      group,
      root,
      materials: [pathMaterial, moteMaterial, ...proxyMaterials],
      recoveryRelight: {
        actorId: spec.actorId,
        targetId: spec.targetId,
        regionName: spec.regionName,
        resourceType: spec.resourceType,
        amount: spec.amount,
        actorWorld: actor?.clone(),
        targetWorld: target.clone(),
        sourceFlameLevel: actorVisual?.flameLevel,
        targetFlameLevel: targetVisual?.flameLevel,
        proxyFlame,
        proxyMaterials,
        motes,
        pathMaterial,
        moteMaterial,
        light,
      },
      particleCount: motes.length,
      age: 0,
      duration: 2.7,
    });
  }

  private fallbackRelationshipEndpoint(base: THREE.Vector3, index: number, total: number, radius = 1.35): THREE.Vector3 {
    const angle = -Math.PI / 2 + (index / Math.max(1, total)) * Math.PI * 2;
    const x = base.x + Math.cos(angle) * radius;
    const z = base.z + Math.sin(angle) * radius;
    return new THREE.Vector3(x, this.terrainHeight(x, z) + 1.35, z);
  }

  private addBondLifecycleEffect({
    bondEventKind,
    spec,
    eventType,
    group,
    color,
    anchors,
    primary,
  }: {
    bondEventKind: BondLifecycleKind;
    spec: EventVisualSpec;
    eventType: string;
    group: EffectGroup;
    color: string;
    anchors: Record<AnchorRole, THREE.Vector3 | null>;
    primary: THREE.Vector3;
  }): void {
    const root = new THREE.Group();
    const materials: THREE.Material[] = [];
    const threadLines: THREE.Line[] = [];
    const cueMeshes: THREE.Mesh[] = [];
    const motes: RaidMote[] = [];
    const proxyMaterials: THREE.Material[] = [];
    const parentIds = uniqueStrings(spec.parentIds ?? []);
    const participantIds = bondEventKind === "birth"
      ? uniqueStrings([spec.childId ?? spec.actorId, ...parentIds, spec.initiatorId, spec.acceptorId])
      : uniqueStrings([spec.initiatorId ?? spec.actorId, spec.rejecterId, spec.targetId]);
    const cueMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const secondaryMaterial = new THREE.MeshBasicMaterial({
      color: bondEventKind === "initiated" || bondEventKind === "birth" ? "#ede4d2" : "#d8cdb6",
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const moteMaterial = new THREE.MeshBasicMaterial({
      color: bondEventKind === "birth" ? EFFECT_COLORS.life : EFFECT_COLORS.material,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    materials.push(cueMaterial, secondaryMaterial, moteMaterial);

    const addMotes = (points: THREE.Vector3[], count: number, radius = 0.065): void => {
      const moteCount = this.motionParticleCount(count, Math.min(2, count));
      for (let index = 0; index < moteCount; index += 1) {
        const mote = new THREE.Mesh(
          new THREE.SphereGeometry(radius + (index % 3) * 0.016, 8, 6),
          moteMaterial,
        );
        mote.position.copy(points[0]);
        motes.push({ mesh: mote, points, offset: index / Math.max(1, moteCount) });
        root.add(mote);
      }
    };

    let threadMaterial: THREE.LineBasicMaterial | undefined;
    const addThread = (from: THREE.Vector3, to: THREE.Vector3, opacity = 0.6): THREE.Vector3[] => {
      if (!threadMaterial) {
        threadMaterial = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
        });
        materials.push(threadMaterial);
      }
      const points = this.relationshipThreadPoints(from, to, 1.35);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), threadMaterial);
      threadLines.push(line);
      root.add(line);
      return points;
    };

    if (bondEventKind === "birth") {
      const childId = spec.childId ?? spec.actorId;
      const childWorld = (childId ? this.anchorForAgent(childId) : null) ?? anchors.actor ?? anchors.region ?? primary;
      const cueGround = new THREE.Vector3(
        childWorld.x,
        this.terrainHeight(childWorld.x, childWorld.z) + 0.2,
        childWorld.z,
      );
      const parentWorlds = parentIds.map((parentId, index) => (
        this.anchorForAgent(parentId) ??
        this.fallbackRelationshipEndpoint(anchors.region ?? primary, index, Math.max(2, parentIds.length), 2.0)
      ));
      const relationshipThreadWorld = parentWorlds.length > 0
        ? [parentWorlds[0].clone(), childWorld.clone(), ...parentWorlds.slice(1).map((point) => point.clone())]
        : [childWorld.clone()];
      for (const parentWorld of parentWorlds) {
        const points = addThread(parentWorld, childWorld, 0.52);
        addMotes(points, 3, 0.06);
      }
      if (parentWorlds.length === 0) {
        const fallbackBurstCount = this.motionParticleCount(7, 3);
        for (let index = 0; index < fallbackBurstCount; index += 1) {
          const angle = (index / fallbackBurstCount) * Math.PI * 2;
          const start = cueGround.clone().add(new THREE.Vector3(Math.cos(angle) * 0.48, 0.02, Math.sin(angle) * 0.48));
          const end = childWorld.clone().add(new THREE.Vector3(0, 0.2 + (index % 2) * 0.08, 0));
          addMotes(this.relationshipThreadPoints(start, end, 0.72), 1, 0.064);
        }
      }

      const arrivalRing = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.82, 48), cueMaterial);
      arrivalRing.position.copy(cueGround);
      arrivalRing.rotation.x = -Math.PI / 2;
      const arrivalCore = new THREE.Mesh(new THREE.CircleGeometry(0.24, 32), secondaryMaterial);
      arrivalCore.position.copy(cueGround);
      arrivalCore.position.y += 0.025;
      arrivalCore.rotation.x = -Math.PI / 2;
      const proxy = makeBirthArrivalProxy(proxyMaterials);
      proxy.position.copy(cueGround);
      proxy.position.y += 0.08;
      cueMeshes.push(arrivalRing, arrivalCore);
      root.add(arrivalRing, arrivalCore, proxy);
      materials.push(...proxyMaterials);

      const light = new THREE.PointLight(EFFECT_COLORS.life, 1.6, 5.8, 2);
      light.position.copy(childWorld);
      root.add(light);
      this.effectRoot.add(root);
      this.registerEffect({
        id: `${eventType}:bond-lifecycle:${this.time}:${this.effects.length}`,
        eventType,
        group,
        root,
        materials,
        bondLifecycle: {
          bondEventKind,
          actorId: spec.actorId,
          targetId: spec.targetId,
          initiatorId: spec.initiatorId,
          acceptorId: spec.acceptorId,
          childId,
          parentIds,
          participantIds,
          regionName: spec.regionName,
          relationshipThreadCue: bondRelationshipThreadCue(bondEventKind, parentWorlds.length > 0),
          anchorWorld: cueGround.clone(),
          actorWorld: childWorld.clone(),
          targetWorld: spec.targetId ? this.anchorForAgent(spec.targetId) ?? undefined : undefined,
          childWorld: childWorld.clone(),
          parentWorlds: parentWorlds.map((point) => point.clone()),
          relationshipThreadWorld,
          threadLines,
          threadMaterial,
          cueMaterial,
          secondaryMaterial,
          moteMaterial,
          cueMeshes,
          proxy,
          proxyMaterials,
          motes,
          light,
        },
        particleCount: motes.length,
        age: 0,
        duration: 3.05,
      });
      return;
    }

    const initiatorId = spec.initiatorId ?? spec.actorId;
    const threadTargetId = bondEventKind === "rejected"
      ? spec.rejecterId ?? spec.actorId
      : spec.targetId;
    const fallbackBase = anchors.region ?? primary;
    const threadStart = (initiatorId ? this.anchorForAgent(initiatorId) : null) ??
      this.fallbackRelationshipEndpoint(fallbackBase, 0, 2);
    let threadEnd = (threadTargetId ? this.anchorForAgent(threadTargetId) : null) ??
      this.fallbackRelationshipEndpoint(fallbackBase, 1, 2);
    if (threadStart.distanceToSquared(threadEnd) < 0.01) {
      threadEnd = threadEnd.clone().add(new THREE.Vector3(1.1, 0, 0.7));
    }
    const threadPoints = addThread(threadStart, threadEnd, 0.62);
    const threadMid = threadPoints[Math.floor(threadPoints.length / 2)]?.clone() ?? threadStart.clone().lerp(threadEnd, 0.5);
    const relationshipThreadWorld = [threadStart.clone(), threadMid.clone(), threadEnd.clone()];
    const cuePoint = bondEventKind === "rejected" ? threadEnd.clone().lerp(threadStart, 0.14) : threadMid;

    if (bondEventKind === "initiated") {
      for (const offset of [-0.15, 0.15]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 8, 28), cueMaterial);
        ring.position.copy(cuePoint);
        ring.position.x += offset;
        ring.rotation.x = Math.PI / 2;
        ring.rotation.y = offset < 0 ? -0.28 : 0.28;
        cueMeshes.push(ring);
        root.add(ring);
      }
    } else if (bondEventKind === "timeout") {
      for (const [index, direction] of [1, -1].entries()) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.3, 4), secondaryMaterial);
        cone.position.copy(cuePoint);
        cone.position.y += direction * 0.12;
        cone.rotation.z = index === 0 ? 0 : Math.PI;
        cueMeshes.push(cone);
        root.add(cone);
      }
      addMotes(this.relationshipThreadPoints(threadEnd, threadStart, 1.15), 7, 0.064);
    } else {
      const barA = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.055, 0.055), secondaryMaterial);
      const barB = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.055, 0.055), secondaryMaterial);
      barA.position.copy(cuePoint);
      barB.position.copy(cuePoint);
      barA.rotation.z = 0.72;
      barB.rotation.z = -0.72;
      cueMeshes.push(barA, barB);
      root.add(barA, barB);
      addMotes(this.relationshipThreadPoints(threadEnd, threadStart, 1.15), 8, 0.066);
    }

    const pulse = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.56, 42), cueMaterial);
    pulse.position.copy(cuePoint);
    pulse.rotation.x = -Math.PI / 2;
    cueMeshes.push(pulse);
    root.add(pulse);
    const light = new THREE.PointLight(color, 1.25, 4.8, 2);
    light.position.copy(cuePoint);
    root.add(light);

    const actorWorld = spec.actorId === initiatorId
      ? threadStart.clone()
      : spec.actorId === threadTargetId
        ? threadEnd.clone()
        : anchors.actor?.clone();
    const targetWorld = spec.targetId === initiatorId
      ? threadStart.clone()
      : spec.targetId === threadTargetId
        ? threadEnd.clone()
        : anchors.target?.clone();
    this.effectRoot.add(root);
    this.registerEffect({
      id: `${eventType}:bond-lifecycle:${this.time}:${this.effects.length}`,
      eventType,
      group,
      root,
      materials,
      bondLifecycle: {
        bondEventKind,
        actorId: spec.actorId,
        targetId: spec.targetId,
        initiatorId,
        rejecterId: spec.rejecterId,
        acceptorId: spec.acceptorId,
        childId: spec.childId,
        parentIds,
        participantIds,
        regionName: spec.regionName,
        relationshipThreadCue: bondRelationshipThreadCue(bondEventKind, false),
        anchorWorld: cuePoint.clone(),
        actorWorld,
        targetWorld,
        parentWorlds: [],
        relationshipThreadWorld,
        threadLines,
        threadMaterial,
        cueMaterial,
        secondaryMaterial,
        moteMaterial,
        cueMeshes,
        proxyMaterials,
        motes,
        light,
      },
      particleCount: motes.length,
      age: 0,
      duration: bondEventKind === "initiated" ? 2.75 : 2.95,
    });
  }

  private addMoteBurstEffect({
    anchor,
    eventType,
    group,
    color,
    count,
    radius,
    lift = 0.42,
    summary,
  }: {
    anchor: THREE.Vector3;
    eventType: string;
    group: EffectGroup;
    color: string;
    count: number;
    radius: number;
    lift?: number;
    summary?: EffectDebugSummary;
  }): void {
    const root = new THREE.Group();
    root.position.set(anchor.x, this.terrainHeight(anchor.x, anchor.z) + lift, anchor.z);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const moteCount = this.motionParticleCount(count, Math.min(3, count));
    const countedSummary = summary
      ? {
          ...summary,
          ...(summary.kind === "combat-impact" ? { impactMotes: moteCount } : {}),
          ...(summary.kind === "private-thought-wisp" ? { thoughtMotes: moteCount } : {}),
          ...(summary.kind === "agent-hoard-shimmer" ? { resourceMotes: moteCount } : {}),
          ...(summary.kind === "home-breach-shock" ? { breachMotes: moteCount } : {}),
          ...(summary.kind === "hearth-ember" ? { emberMotes: moteCount } : {}),
        }
      : undefined;
    for (let index = 0; index < moteCount; index += 1) {
      const angle = (index / Math.max(1, moteCount)) * Math.PI * 2;
      const spread = radius * (0.35 + (index % 3) * 0.22);
      const mote = new THREE.Mesh(new THREE.SphereGeometry(0.08 + (index % 2) * 0.035, 8, 6), material);
      mote.position.set(Math.cos(angle) * spread, 0.12 + index * 0.055, Math.sin(angle) * spread);
      root.add(mote);
    }
    const light = new THREE.PointLight(color, 1.15, 5.6, 2);
    light.position.y = 0.8;
    root.add(light);
    this.effectRoot.add(root);
    this.registerEffect({
      id: `${eventType}:motes:${this.time}:${this.effects.length}`,
      eventType,
      group,
      root,
      materials: [material],
      particleCount: moteCount,
      ...(countedSummary ? { summary: countedSummary } : {}),
      age: 0,
      duration: 2.15,
    });
  }

  private addShelterUseEffect({
    actorId,
    homeId,
    eventType,
    group,
    color,
  }: {
    actorId: string;
    homeId: string;
    eventType: string;
    group: EffectGroup;
    color: string;
  }): void {
    const actor = this.entityObjects.get(`agent:${actorId}`);
    const home = this.entityObjects.get(`home:${homeId}`);
    if (!actor || !home) {
      return;
    }

    const actorStart = actor.getWorldPosition(new THREE.Vector3());
    actorStart.y = this.terrainHeight(actorStart.x, actorStart.z) + 0.12;
    const actorMid = actorStart.clone();
    actorMid.y += 0.82;
    const homeWorld = home.getWorldPosition(new THREE.Vector3());
    const visual = (home.userData as { visual?: HomeVisualState }).visual;
    const growth = visual?.growth ?? 1;
    const thresholdBase = new THREE.Vector3(
      homeWorld.x,
      this.terrainHeight(homeWorld.x, homeWorld.z) + 0.18,
      homeWorld.z + 0.98 * growth,
    );
    const thresholdMid = thresholdBase.clone();
    thresholdMid.y += 0.58 * growth;
    const motionMode = this.motionSettings.mode;
    const reducedShelterMotion = motionMode === "reduced";
    const homeWear = 1 - (visual?.health ?? 1);
    const wallHeight = 1.52 - homeWear * 0.16;
    const doorwayWorld = new THREE.Vector3(
      homeWorld.x,
      homeWorld.y + (0.24 + 0.46) * growth,
      homeWorld.z + 0.94 * growth,
    );
    const windowWorld = new THREE.Vector3(
      homeWorld.x + 0.64 * growth,
      homeWorld.y + (0.24 + wallHeight * 0.64) * growth,
      homeWorld.z + 0.945 * growth,
    );

    const root = new THREE.Group();
    const pathPoints = reducedShelterMotion
      ? [actorMid.clone(), actorMid.clone().add(new THREE.Vector3(0, 0.18, 0))]
      : this.motionPathPoints(actorMid, thresholdMid, 0.9, 0.05, Math.max(16, this.motionSettings.pathSegments - 10));
    const pathMaterial = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: reducedShelterMotion ? 0.16 : 0.64,
      depthWrite: false,
    });
    const path = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pathPoints),
      pathMaterial,
    );

    const thresholdMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const threshold = new THREE.Mesh(
      new THREE.RingGeometry(0.28 * growth, 0.62 * growth, 36),
      thresholdMaterial,
    );
    threshold.position.copy(thresholdMid);

    const glowMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.46 * growth, 28), glowMaterial);
    glow.position.copy(thresholdMid);
    glow.position.z += 0.025;

    const thresholdSillMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const thresholdSill = new THREE.Mesh(
      new THREE.BoxGeometry(0.88 * growth, 0.035 * growth, 0.12 * growth),
      thresholdSillMaterial,
    );
    thresholdSill.position.copy(thresholdBase);
    thresholdSill.position.y += 0.025 * growth;
    thresholdSill.position.z += 0.055 * growth;

    const doorMaterial = new THREE.MeshBasicMaterial({
      color: "#5b3829",
      transparent: true,
      opacity: reducedShelterMotion ? 0.34 : 0.54,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const doorGlowMaterial = new THREE.MeshBasicMaterial({
      color: "#ffbd6f",
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const windowGlowMaterial = new THREE.MeshBasicMaterial({
      color: "#ffd48a",
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const doorPivot = new THREE.Group();
    const doorWidth = 0.54 * growth;
    const doorHeight = 0.96 * growth;
    const doorDepth = 0.04 * growth;
    doorPivot.position.set(
      doorwayWorld.x - doorWidth * 0.5,
      doorwayWorld.y,
      doorwayWorld.z + 0.018 * growth,
    );
    const doorCue = new THREE.Mesh(
      new THREE.BoxGeometry(doorWidth, doorHeight, doorDepth),
      doorMaterial,
    );
    doorCue.position.x = doorWidth * 0.5;
    doorPivot.add(doorCue);
    const doorwayGlow = new THREE.Mesh(new THREE.CircleGeometry(0.52 * growth, 32), doorGlowMaterial);
    doorwayGlow.position.copy(doorwayWorld);
    doorwayGlow.position.z += 0.035 * growth;
    doorwayGlow.scale.set(0.72, 1.16, 1);
    const windowGlow = new THREE.Mesh(new THREE.CircleGeometry(0.24 * growth, 24), windowGlowMaterial);
    windowGlow.position.copy(windowWorld);
    windowGlow.scale.set(1.22, 0.86, 1);

    const proxyMaterials: THREE.Material[] = [];
    const proxy = makeShelterProxy(proxyMaterials);
    proxy.position.copy(actorStart);
    if (reducedShelterMotion) {
      proxy.visible = false;
    }

    const smokeMaterial = new THREE.MeshBasicMaterial({
      color: "#d8cdb6",
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
    });
    const smoke: THREE.Mesh[] = [];
    const smokeCount = this.motionParticleCount(
      reducedShelterMotion ? 5 : 7,
      reducedShelterMotion ? 3 : 4,
    );
    for (let index = 0; index < smokeCount; index += 1) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.11 + index * 0.035, 8, 6),
        smokeMaterial,
      );
      puff.position.set(
        thresholdMid.x - 0.18 + index * 0.11,
        thresholdMid.y + 0.18 + index * 0.16,
        thresholdMid.z + 0.04 - index * 0.035,
      );
      smoke.push(puff);
    }

    const light = new THREE.PointLight(color, reducedShelterMotion ? 1.85 : 3.1, 8.2 * growth, 2);
    light.position.copy(thresholdMid);
    light.position.y += 0.18 * growth;

    root.add(path, thresholdSill, threshold, doorwayGlow, windowGlow, doorPivot, glow, proxy, light, ...smoke);
    this.effectRoot.add(root);
    this.registerEffect({
      id: `${eventType}:shelter:${this.time}:${this.effects.length}`,
      eventType,
      group,
      root,
      materials: [
        pathMaterial,
        thresholdMaterial,
        thresholdSillMaterial,
        glowMaterial,
        doorMaterial,
        doorGlowMaterial,
        windowGlowMaterial,
        smokeMaterial,
        ...proxyMaterials,
      ],
      shelter: {
        actorId,
        homeId,
        motionMode,
        actorStart,
        actorMid,
        homeWorld,
        thresholdBase,
        thresholdMid,
        proxy,
        proxyMaterials,
        proxyOpacity: reducedShelterMotion ? 0 : 0.92,
        doorPivot,
        doorOpenAmount: 0,
        doorMaterial,
        doorGlowMaterial,
        windowGlowMaterial,
        thresholdSillMaterial,
        thresholdMaterial,
        pathMaterial,
        smokeMaterial,
        glowMaterial,
        light,
        smoke,
      },
      particleCount: smoke.length,
      age: 0,
      duration: 2.8,
    });
  }

  private resolveHomeBuildAnchor({
    homeId,
    regionName,
    actorAnchor,
    regionAnchor,
    primary,
  }: {
    homeId?: string;
    regionName?: string;
    actorAnchor: THREE.Vector3 | null;
    regionAnchor: THREE.Vector3 | null;
    primary: THREE.Vector3;
  }): { anchorSource: BuildAnchorSource; anchorWorld: THREE.Vector3; homeWorld?: THREE.Vector3 } {
    if (homeId) {
      const home = this.entityObjects.get(`home:${homeId}`);
      if (home) {
        const homeWorld = home.getWorldPosition(new THREE.Vector3());
        return {
          anchorSource: "home",
          anchorWorld: homeWorld.clone(),
          homeWorld,
        };
      }
      const region = regionName ? this.regionFor(regionName) : null;
      if (region) {
        const [offsetX, offsetZ] = homePlacementOffset(homeId, region.baseR);
        const x = region.cx + offsetX;
        const z = region.cz + offsetZ;
        return {
          anchorSource: "planned",
          anchorWorld: new THREE.Vector3(x, this.terrainHeight(x, z), z),
        };
      }
    }

    if (actorAnchor) {
      return {
        anchorSource: "actor",
        anchorWorld: this.terrainAnchor(actorAnchor),
      };
    }

    if (regionAnchor) {
      return {
        anchorSource: "region",
        anchorWorld: this.terrainAnchor(regionAnchor),
      };
    }

    return {
      anchorSource: "primary",
      anchorWorld: this.terrainAnchor(primary),
    };
  }

  private terrainAnchor(point: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(point.x, this.terrainHeight(point.x, point.z), point.z);
  }

  private relationshipThreadPoints(from: THREE.Vector3, to: THREE.Vector3, lift = 1.4): THREE.Vector3[] {
    return this.motionPathPoints(from, to, lift, 0.07);
  }

  private addHomeBuildEffect({
    actorId,
    homeId,
    regionName,
    eventType,
    group,
    color,
    anchors,
    primary,
  }: {
    actorId?: string;
    homeId?: string;
    regionName?: string;
    eventType: string;
    group: EffectGroup;
    color: string;
    anchors: Record<AnchorRole, THREE.Vector3 | null>;
    primary: THREE.Vector3;
  }): void {
    const anchor = this.resolveHomeBuildAnchor({
      homeId,
      regionName,
      actorAnchor: anchors.actor,
      regionAnchor: anchors.region ?? anchors.toRegion ?? anchors.fromRegion,
      primary,
    });

    const root = new THREE.Group();
    root.position.copy(anchor.anchorWorld);

    const scaffoldMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    const crossbarMaterial = new THREE.MeshBasicMaterial({
      color: "#b98d54",
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const dustMaterial = new THREE.MeshBasicMaterial({
      color: "#d8cdb6",
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const scaffoldPoles: THREE.Mesh[] = [];
    const poleOffsets: Array<[number, number]> = [
      [-0.92, -0.72],
      [0.92, -0.72],
      [-0.92, 0.72],
      [0.92, 0.72],
    ];
    for (const [x, z] of poleOffsets) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.72, 6), scaffoldMaterial);
      pole.position.set(x, 0.86, z);
      scaffoldPoles.push(pole);
    }

    const scaffoldCrossbars: THREE.Mesh[] = [];
    const addCrossbar = (x: number, y: number, z: number, length: number, axis: "x" | "z"): void => {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, length, 6), crossbarMaterial);
      bar.position.set(x, y, z);
      if (axis === "x") {
        bar.rotation.z = Math.PI / 2;
      } else {
        bar.rotation.x = Math.PI / 2;
      }
      scaffoldCrossbars.push(bar);
    };
    for (const y of [0.52, 1.26]) {
      addCrossbar(0, y, -0.72, 1.84, "x");
      addCrossbar(0, y, 0.72, 1.84, "x");
      addCrossbar(-0.92, y, 0, 1.44, "z");
      addCrossbar(0.92, y, 0, 1.44, "z");
    }

    const frameMaterials: THREE.Material[] = [];
    const frame = makeHomeBuildFrame(frameMaterials);
    frame.position.y = 0.06;
    frame.scale.set(0.34, 0.18, 0.34);

    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.38, 36), glowMaterial);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;

    const dust: THREE.Mesh[] = [];
    const dustCount = this.motionParticleCount(6, 3);
    for (let index = 0; index < dustCount; index += 1) {
      const angle = (index / dustCount) * Math.PI * 2 + 0.24;
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.1 + (index % 3) * 0.025, 8, 6),
        dustMaterial,
      );
      puff.position.set(Math.cos(angle) * 0.78, 0.1 + index * 0.035, Math.sin(angle) * 0.58);
      dust.push(puff);
    }

    const light = new THREE.PointLight(color, 1.8, 6.4, 2);
    light.position.set(0, 1.1, 0);

    root.add(glow, ...scaffoldPoles, ...scaffoldCrossbars, frame, light, ...dust);
    this.effectRoot.add(root);
    this.registerEffect({
      id: `${eventType}:build:${this.time}:${this.effects.length}`,
      eventType,
      group,
      root,
      materials: [
        scaffoldMaterial,
        crossbarMaterial,
        dustMaterial,
        glowMaterial,
        ...frameMaterials,
      ],
      homeBuild: {
        actorId,
        homeId,
        regionName,
        anchorSource: anchor.anchorSource,
        anchorWorld: anchor.anchorWorld,
        homeWorld: anchor.homeWorld,
        durableHomePresentAtStart: anchor.anchorSource === "home",
        frame,
        frameMaterials,
        scaffoldMaterial,
        crossbarMaterial,
        dustMaterial,
        glowMaterial,
        light,
        scaffoldPoles,
        scaffoldCrossbars,
        dust,
      },
      particleCount: dust.length,
      age: 0,
      duration: 3.05,
    });
  }

  private resolveHomeRaidAnchor({
    homeId,
    regionName,
    primary,
  }: {
    homeId?: string;
    regionName?: string;
    primary: THREE.Vector3;
  }): {
    anchorSource: BuildAnchorSource;
    homeWorld: THREE.Vector3;
    homeVisual?: HomeVisualState;
    durableHomePresentAtStart: boolean;
  } {
    if (homeId) {
      const home = this.entityObjects.get(`home:${homeId}`);
      const visual = (home?.userData as { visual?: HomeVisualState } | undefined)?.visual;
      if (home) {
        return {
          anchorSource: "home",
          homeWorld: home.getWorldPosition(new THREE.Vector3()),
          homeVisual: visual ? { ...visual } : undefined,
          durableHomePresentAtStart: true,
        };
      }
      const region = regionName ? this.regionFor(regionName) : null;
      if (region) {
        const [offsetX, offsetZ] = homePlacementOffset(homeId, region.baseR);
        const x = region.cx + offsetX;
        const z = region.cz + offsetZ;
        return {
          anchorSource: "planned",
          homeWorld: new THREE.Vector3(x, this.terrainHeight(x, z), z),
          durableHomePresentAtStart: false,
        };
      }
    }

    return {
      anchorSource: "primary",
      homeWorld: this.terrainAnchor(primary),
      durableHomePresentAtStart: false,
    };
  }

  private addHomeRaidEffect({
    raidKind,
    spec,
    eventType,
    group,
    color,
    anchors,
    primary,
  }: {
    raidKind: HomeRaidKind;
    spec: EventVisualSpec;
    eventType: string;
    group: EffectGroup;
    color: string;
    anchors: Record<AnchorRole, THREE.Vector3 | null>;
    primary: THREE.Vector3;
  }): void {
    const anchor = this.resolveHomeRaidAnchor({
      homeId: spec.homeId,
      regionName: spec.regionName,
      primary,
    });
    const growth = anchor.homeVisual?.growth ?? 1;
    const terrainY = this.terrainHeight(anchor.homeWorld.x, anchor.homeWorld.z);
    const thresholdWorld = new THREE.Vector3(
      anchor.homeWorld.x,
      terrainY + 0.58 * growth,
      anchor.homeWorld.z + 0.98 * growth,
    );
    const vaultWorld = new THREE.Vector3(
      anchor.homeWorld.x - 0.62 * growth,
      terrainY + 0.5 * growth,
      anchor.homeWorld.z + 1.02 * growth,
    );
    const actorWorld = anchors.actor?.clone();
    const targetWorld = anchors.target?.clone();
    const streamEndWorld = raidKind === "theft"
      ? (targetWorld ?? actorWorld)?.clone()
      : undefined;
    const root = new THREE.Group();

    const shockMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const shock = new THREE.Mesh(new THREE.RingGeometry(0.34 * growth, 0.86 * growth, 48), shockMaterial);
    shock.position.copy(thresholdWorld);

    const crackMaterial = new THREE.MeshBasicMaterial({
      color: raidKind === "theft" ? "#3b2a1b" : "#401d1d",
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const cracks: THREE.Mesh[] = [];
    for (let index = 0; index < 4; index += 1) {
      const crack = new THREE.Mesh(
        new THREE.BoxGeometry(0.032 * growth, (0.36 + index * 0.08) * growth, 0.028 * growth),
        crackMaterial,
      );
      crack.position.set(
        thresholdWorld.x - 0.34 * growth + index * 0.22 * growth,
        thresholdWorld.y + 0.16 * growth + (index % 2) * 0.12 * growth,
        thresholdWorld.z + 0.045 * growth,
      );
      crack.rotation.z = (index % 2 === 0 ? 1 : -1) * (0.46 + index * 0.06);
      cracks.push(crack);
    }

    const lowCueMaterial = new THREE.MeshBasicMaterial({
      color: "#d96e3f",
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const lowCue = new THREE.Mesh(new THREE.RingGeometry(1.0 * growth, 1.42 * growth, 52), lowCueMaterial);
    lowCue.position.set(anchor.homeWorld.x, terrainY + 0.075, anchor.homeWorld.z);
    lowCue.rotation.x = -Math.PI / 2;

    const light = new THREE.PointLight(color, 2.7, 7.4 * growth, 2);
    light.position.copy(thresholdWorld);
    light.position.y += 0.16 * growth;

    const materials: THREE.Material[] = [shockMaterial, crackMaterial, lowCueMaterial];
    let streamMaterial: THREE.MeshBasicMaterial | undefined;
    let streamLineMaterial: THREE.LineBasicMaterial | undefined;
    let streamLine: THREE.Line | undefined;
    const motes: RaidMote[] = [];
    if (raidKind === "theft" && streamEndWorld) {
      streamMaterial = new THREE.MeshBasicMaterial({
        color: EFFECT_COLORS.material,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      streamLineMaterial = new THREE.LineBasicMaterial({
        color: EFFECT_COLORS.material,
        transparent: true,
        opacity: 0.56,
        depthWrite: false,
      });
      materials.push(streamMaterial, streamLineMaterial);
      const points = this.motionPathPoints(vaultWorld, streamEndWorld, 1.8, 0.06, Math.max(20, this.motionSettings.pathSegments + 4));
      streamLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), streamLineMaterial);
      const streamMoteCount = this.motionParticleCount(12, 5);
      for (let index = 0; index < streamMoteCount; index += 1) {
        const mote = new THREE.Mesh(
          new THREE.SphereGeometry(0.08 + (index % 3) * 0.022, 8, 6),
          streamMaterial,
        );
        mote.position.copy(points[0]);
        motes.push({ mesh: mote, points, offset: index / streamMoteCount });
      }
    }

    let banner: THREE.Group | undefined;
    let bannerMaterial: THREE.MeshBasicMaterial | undefined;
    let pennantMaterial: THREE.MeshBasicMaterial | undefined;
    if (raidKind === "colonize") {
      banner = new THREE.Group();
      bannerMaterial = new THREE.MeshBasicMaterial({
        color: "#2f2924",
        transparent: true,
        opacity: 0.86,
        depthWrite: false,
      });
      pennantMaterial = new THREE.MeshBasicMaterial({
        color: EFFECT_COLORS.combat,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      materials.push(bannerMaterial, pennantMaterial);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.045 * growth, 1.35 * growth, 0.045 * growth), bannerMaterial);
      pole.position.y = 0.54 * growth;
      const pennant = new THREE.Mesh(new THREE.ConeGeometry(0.22 * growth, 0.52 * growth, 3), pennantMaterial);
      pennant.position.set(0.18 * growth, 1.04 * growth, 0);
      pennant.rotation.set(0, 0, -Math.PI / 2);
      banner.add(pole, pennant);
      banner.position.copy(thresholdWorld);
      banner.position.y += 0.44 * growth;
      banner.userData = { kind: "raidBanner", persistentOccupancy: false };
    }

    const previousStakeholderIds = spec.previousStakeholderIds ?? [];
    const newStakeholderIds = spec.newStakeholderIds ?? [];
    const recipientIds = spec.recipientIds ?? [];
    const evictionIds = Array.from(new Set([
      spec.previousOwnerId,
      ...previousStakeholderIds,
    ].filter((id): id is string => Boolean(id && id !== spec.newOwnerId))));
    const visibleEvicteeIds: string[] = [];
    const evictionHints: RaidEvictionHint[] = [];
    if (raidKind === "colonize") {
      for (const agentId of evictionIds) {
        if (evictionHints.length >= MAX_VISIBLE_EVICTION_HINTS) {
          break;
        }
        const agent = this.entityObjects.get(`agent:${agentId}`);
        if (!agent || !isVisibleInHierarchy(agent)) {
          continue;
        }
        const hintIndex = evictionHints.length;
        const end = agent.getWorldPosition(new THREE.Vector3());
        end.y += 1.15;
        const start = thresholdWorld.clone();
        start.y += 0.18 + hintIndex * 0.08;
        const points = this.motionPathPoints(start, end, 1.2, 0.04, Math.max(16, this.motionSettings.pathSegments - 10));
        const lineMaterial = new THREE.LineBasicMaterial({
          color: "#d8cdb6",
          transparent: true,
          opacity: 0.58,
          depthWrite: false,
        });
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial);
        const proxyMaterials: THREE.Material[] = [];
        const proxy = makeRaidProxy(proxyMaterials, "#d8cdb6");
        proxy.position.copy(points[0]);
        root.add(line, proxy);
        materials.push(lineMaterial, ...proxyMaterials);
        evictionHints.push({ agentId, proxy, proxyMaterials, points, lineMaterial });
        visibleEvicteeIds.push(agentId);
      }
    }

    root.add(shock, lowCue, ...cracks, light);
    if (streamLine) {
      root.add(streamLine);
    }
    for (const mote of motes) {
      root.add(mote.mesh);
    }
    if (banner) {
      root.add(banner);
    }

    this.effectRoot.add(root);
    this.registerEffect({
      id: `${eventType}:raid:${this.time}:${this.effects.length}`,
      eventType,
      group,
      root,
      materials,
      homeRaid: {
        raidKind,
        actorId: spec.actorId,
        targetId: spec.targetId,
        homeId: spec.homeId,
        regionName: spec.regionName,
        previousOwnerId: spec.previousOwnerId,
        newOwnerId: spec.newOwnerId,
        previousStakeholderIds,
        newStakeholderIds,
        recipientIds,
        visibleEvicteeIds,
        lootMaterials: spec.lootMaterials,
        anchorSource: anchor.anchorSource,
        homeWorld: anchor.homeWorld,
        thresholdWorld,
        vaultWorld,
        actorWorld,
        targetWorld,
        streamEndWorld,
        streamDirection: raidKind === "theft" ? "home-to-recipient" : "actor-to-home",
        standingHomeAtStart: anchor.homeVisual ? !anchor.homeVisual.ruined : false,
        lowIntegrityCue: anchor.homeVisual ? !anchor.homeVisual.ruined : false,
        durableHomePresentAtStart: anchor.durableHomePresentAtStart,
        shock,
        lowCue,
        cracks,
        motes,
        evictionHints,
        light,
        shockMaterial,
        crackMaterial,
        lowCueMaterial,
        streamMaterial,
        streamLineMaterial,
        banner,
        bannerMaterial,
        pennantMaterial,
      },
      particleCount: motes.length,
      age: 0,
      duration: raidKind === "theft" ? 2.95 : 3.15,
    });
  }

  private addHomeLifecycleEffect({
    lifecycleKind,
    spec,
    eventType,
    group,
    color,
    anchors,
    primary,
  }: {
    lifecycleKind: HomeLifecycleKind;
    spec: EventVisualSpec;
    eventType: string;
    group: EffectGroup;
    color: string;
    anchors: Record<AnchorRole, THREE.Vector3 | null>;
    primary: THREE.Vector3;
  }): void {
    const anchor = this.resolveHomeRaidAnchor({
      homeId: spec.homeId,
      regionName: spec.regionName,
      primary,
    });
    const growth = anchor.homeVisual?.growth ?? 1;
    const terrainY = this.terrainHeight(anchor.homeWorld.x, anchor.homeWorld.z);
    const thresholdWorld = new THREE.Vector3(
      anchor.homeWorld.x,
      terrainY + 0.58 * growth,
      anchor.homeWorld.z + 0.98 * growth,
    );
    const vaultWorld = new THREE.Vector3(
      anchor.homeWorld.x - 0.62 * growth,
      terrainY + 0.5 * growth,
      anchor.homeWorld.z + 1.02 * growth,
    );
    const actorWorld = anchors.actor?.clone();
    const actorMidWorld = actorWorld ? actorWorld.clone().add(new THREE.Vector3(0, 1.15, 0)) : undefined;
    const root = new THREE.Group();
    const materials: THREE.Material[] = [];

    const cueMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    materials.push(cueMaterial);
    const cue = new THREE.Mesh(
      lifecycleKind === "hoard"
        ? new THREE.TorusGeometry(0.76 * growth, 0.035 * growth, 8, 44)
        : new THREE.RingGeometry(0.78 * growth, 1.18 * growth, 52),
      cueMaterial,
    );
    cue.position.copy(lifecycleKind === "hoard" ? vaultWorld : anchor.homeWorld);
    cue.position.y += lifecycleKind === "hoard" ? 0.12 * growth : 0.08;
    cue.rotation.x = -Math.PI / 2;

    const light = new THREE.PointLight(color, 1.9, 6.6 * growth, 2);
    light.position.copy(lifecycleKind === "hoard" ? vaultWorld : thresholdWorld);
    light.position.y += lifecycleKind === "hoard" ? 0.32 * growth : 0.2 * growth;

    let pathLine: THREE.Line | undefined;
    let pathMaterial: THREE.LineBasicMaterial | undefined;
    let pathPoints: THREE.Vector3[] | undefined;
    let proxy: THREE.Group | undefined;
    const proxyMaterials: THREE.Material[] = [];
    let streamStartWorld: THREE.Vector3 | undefined;
    let streamEndWorld: THREE.Vector3 | undefined;
    let streamDirection: string | undefined;
    const motes: RaidMote[] = [];
    const fallParts: THREE.Mesh[] = [];
    let previewGroup: THREE.Group | undefined;
    const previewMaterials: THREE.Material[] = [];

    const makePath = (from: THREE.Vector3, to: THREE.Vector3, lift = 1.15): THREE.Vector3[] => {
      return this.motionPathPoints(from, to, lift, 0.045, Math.max(18, this.motionSettings.pathSegments - 4));
    };

    const addPath = (from: THREE.Vector3, to: THREE.Vector3, pathColor: string): void => {
      pathMaterial = new THREE.LineBasicMaterial({
        color: pathColor,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      });
      materials.push(pathMaterial);
      pathPoints = makePath(from, to);
      pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pathPoints), pathMaterial);
      root.add(pathLine);
      proxy = makeLifecycleProxy(proxyMaterials, pathColor);
      proxy.position.copy(pathPoints[0]);
      root.add(proxy);
      materials.push(...proxyMaterials);
    };

    let moteMaterial: THREE.MeshBasicMaterial | undefined;

    const addMotesAlongPath = (
      points: THREE.Vector3[],
      count: number,
      radius = 0.075,
    ): void => {
      if (!moteMaterial) {
        moteMaterial = new THREE.MeshBasicMaterial({
          color: lifecycleKind === "collapse" ? "#cfc5af" : EFFECT_COLORS.material,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        materials.push(moteMaterial);
      }
      const moteCount = this.motionParticleCount(count, Math.min(3, count));
      for (let index = 0; index < moteCount; index += 1) {
        const mote = new THREE.Mesh(
          new THREE.SphereGeometry(radius + (index % 3) * 0.018, 8, 6),
          moteMaterial,
        );
        mote.position.copy(points[0]);
        motes.push({ mesh: mote, points, offset: index / Math.max(1, moteCount) });
        root.add(mote);
      }
    };

    if ((lifecycleKind === "join" || lifecycleKind === "left") && actorMidWorld) {
      if (lifecycleKind === "join") {
        addPath(actorMidWorld, thresholdWorld.clone(), EFFECT_COLORS.speech);
        streamDirection = "actor-to-home";
      } else {
        addPath(thresholdWorld.clone(), actorMidWorld, EFFECT_COLORS.thought);
        streamDirection = "home-to-actor";
      }
      previewGroup = makeMembershipPreview(previewMaterials, lifecycleKind, growth);
      previewGroup.position.copy(anchor.homeWorld);
      previewGroup.position.y += 0.08;
      root.add(previewGroup);
      materials.push(...previewMaterials);
    }

    if (lifecycleKind === "hoard") {
      streamDirection = "vault-shimmer";
      streamStartWorld = vaultWorld.clone();
      streamEndWorld = vaultWorld.clone();
      const hoardMoteCount = this.motionParticleCount(12, 5);
      for (let index = 0; index < hoardMoteCount; index += 1) {
        const angle = (index / hoardMoteCount) * Math.PI * 2;
        const start = vaultWorld.clone();
        start.y += 0.1 + (index % 3) * 0.04;
        const end = vaultWorld.clone().add(new THREE.Vector3(
          Math.cos(angle) * 0.72 * growth,
          0.54 * growth + (index % 2) * 0.16,
          Math.sin(angle) * 0.48 * growth,
        ));
        const points = makePath(start, end, 0.52);
        addMotesAlongPath(points, 1, 0.072);
      }
    }

    if (lifecycleKind === "collapse") {
      streamDirection = "home-to-ruin";
      streamStartWorld = thresholdWorld.clone();
      streamEndWorld = anchor.homeWorld.clone();
      streamEndWorld.y += 0.2;
      const fallMaterial = new THREE.MeshBasicMaterial({
        color: "#5f5145",
        transparent: true,
        opacity: 0.84,
        depthWrite: false,
      });
      materials.push(fallMaterial);
      for (let index = 0; index < 7; index += 1) {
        const part = new THREE.Mesh(
          new THREE.BoxGeometry(0.18 + (index % 3) * 0.08, 0.08, 0.64 - (index % 2) * 0.1),
          fallMaterial,
        );
        part.position.set(
          anchor.homeWorld.x - 0.68 * growth + index * 0.22 * growth,
          terrainY + 1.28 * growth + (index % 2) * 0.24,
          anchor.homeWorld.z - 0.32 * growth + (index % 3) * 0.22 * growth,
        );
        part.rotation.set(0.2 * index, 0.55 * index, -0.32 + index * 0.09);
        fallParts.push(part);
        root.add(part);
      }
      previewGroup = makeRuinPreview(previewMaterials, growth);
      previewGroup.position.copy(anchor.homeWorld);
      root.add(previewGroup);
      materials.push(...previewMaterials);
      const collapseMoteCount = this.motionParticleCount(10, 5);
      for (let index = 0; index < collapseMoteCount; index += 1) {
        const angle = (index / collapseMoteCount) * Math.PI * 2;
        const start = thresholdWorld.clone();
        start.x += Math.cos(angle) * 0.28 * growth;
        start.z += Math.sin(angle) * 0.2 * growth;
        const end = anchor.homeWorld.clone().add(new THREE.Vector3(
          Math.cos(angle) * 0.82 * growth,
          0.22 + (index % 3) * 0.04,
          Math.sin(angle) * 0.62 * growth,
        ));
        addMotesAlongPath(makePath(start, end, 0.62), 1, 0.086);
      }
    }

    if (lifecycleKind === "scavenge" && actorMidWorld) {
      streamDirection = "ruin-to-scavenger";
      streamStartWorld = anchor.homeWorld.clone();
      streamStartWorld.y += 0.62;
      streamEndWorld = actorMidWorld.clone();
      const streamPoints = makePath(streamStartWorld, streamEndWorld, 1.3);
      pathMaterial = new THREE.LineBasicMaterial({
        color: EFFECT_COLORS.material,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      });
      materials.push(pathMaterial);
      pathPoints = streamPoints;
      pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(streamPoints), pathMaterial);
      root.add(pathLine);
      addMotesAlongPath(streamPoints, 11, 0.078);
    }

    root.add(cue, light);
    this.effectRoot.add(root);
    this.registerEffect({
      id: `${eventType}:home-lifecycle:${this.time}:${this.effects.length}`,
      eventType,
      group,
      root,
      materials,
      homeLifecycle: {
        lifecycleKind,
        actorId: spec.actorId,
        homeId: spec.homeId,
        regionName: spec.regionName,
        previousOwnerId: spec.previousOwnerId,
        newOwnerId: spec.newOwnerId,
        previousStakeholderIds: spec.previousStakeholderIds ?? [],
        stakeholderIds: spec.newStakeholderIds ?? [],
        vaultMaterials: spec.vaultMaterials,
        remnantMaterials: spec.remnantMaterials,
        agentMaterials: spec.agentMaterials,
        resourceType: spec.resourceType,
        amount: spec.amount,
        anchorSource: anchor.anchorSource,
        homeWorld: anchor.homeWorld,
        thresholdWorld,
        vaultWorld,
        actorWorld,
        streamStartWorld,
        streamEndWorld,
        streamDirection,
        durableHomePresentAtStart: anchor.durableHomePresentAtStart,
        standingHomeAtStart: anchor.homeVisual ? !anchor.homeVisual.ruined : false,
        ruinAtStart: anchor.homeVisual?.ruined ?? false,
        cue,
        cueMaterial,
        pathLine,
        pathMaterial,
        pathPoints,
        proxy,
        proxyMaterials,
        motes,
        fallParts,
        previewGroup,
        previewMaterials,
        light,
      },
      particleCount: motes.length,
      age: 0,
      duration: lifecycleKind === "collapse" ? 3.25 : lifecycleKind === "scavenge" ? 2.9 : 2.7,
    });
  }

  private addSpecialEventEffects(
    eventType: string,
    spec: EventVisualSpec,
    anchors: Record<AnchorRole, THREE.Vector3 | null>,
    primary: THREE.Vector3,
  ): void {
    switch (eventType) {
      case "resource_changed":
        this.addResourceHarvestEffect({
          spec,
          eventType,
          group: spec.group,
          color: spec.color,
          anchors,
          primary,
        });
        break;
      case "agent_recovered":
        this.addRecoveryRelightEffect({
          spec,
          eventType,
          group: spec.group,
          color: spec.color,
          anchors,
          primary,
        });
        break;
      case "mating_initiated":
        this.addBondLifecycleEffect({
          bondEventKind: "initiated",
          spec,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.bond,
          anchors,
          primary,
        });
        break;
      case "mating_rejected":
        this.addBondLifecycleEffect({
          bondEventKind: "rejected",
          spec,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.thought,
          anchors,
          primary,
        });
        break;
      case "mating_proposal_invalidated":
        this.addBondLifecycleEffect({
          bondEventKind: "invalidated",
          spec,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.contest,
          anchors,
          primary,
        });
        break;
      case "mating_proposal_timeout":
        this.addBondLifecycleEffect({
          bondEventKind: "timeout",
          spec,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.thought,
          anchors,
          primary,
        });
        break;
      case "self_talk":
        this.addMoteBurstEffect({
          anchor: anchors.actor ?? primary,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.thought,
          count: 5,
          radius: 0.38,
          lift: 0.98,
          summary: this.thoughtWispDebugSummary(spec, anchors, anchors.actor ?? primary),
        });
        break;
      case "agent_started_hoarding":
        this.addMoteBurstEffect({
          anchor: anchors.actor ?? primary,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.material,
          count: 7,
          radius: 0.48,
          lift: 0.86,
          summary: this.agentHoardingDebugSummary(spec, anchors, anchors.actor ?? primary),
        });
        break;
      case "attack":
        this.addMoteBurstEffect({
          anchor: anchors.target ?? primary,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.combat,
          count: 6,
          radius: 0.56,
          lift: 0.68,
          summary: this.combatImpactDebugSummary(spec, anchors, anchors.target ?? primary),
        });
        break;
      case "agent_born":
        this.addBondLifecycleEffect({
          bondEventKind: "birth",
          spec,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.life,
          anchors,
          primary,
        });
        break;
      case "home_built":
        this.addHomeBuildEffect({
          actorId: spec.actorId,
          homeId: spec.homeId,
          regionName: spec.regionName,
          eventType,
          group: spec.group,
          color: spec.color,
          anchors,
          primary,
        });
        break;
      case "hearth_used":
        if (spec.actorId && spec.homeId) {
          this.addShelterUseEffect({
            actorId: spec.actorId,
            homeId: spec.homeId,
            eventType,
            group: spec.group,
            color: EFFECT_COLORS.home,
          });
        }
        this.addMoteBurstEffect({
          anchor: anchors.home ?? primary,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.home,
          count: 7,
          radius: 0.74,
          lift: 0.74,
          summary: this.hearthEmberDebugSummary(spec, anchors, anchors.home ?? primary),
        });
        break;
      case "home_joined":
        this.addHomeLifecycleEffect({
          lifecycleKind: "join",
          spec,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.speech,
          anchors,
          primary,
        });
        break;
      case "home_left":
        this.addHomeLifecycleEffect({
          lifecycleKind: "left",
          spec,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.thought,
          anchors,
          primary,
        });
        break;
      case "home_started_hoarding":
        this.addHomeLifecycleEffect({
          lifecycleKind: "hoard",
          spec,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.material,
          anchors,
          primary,
        });
        break;
      case "home_breached":
        this.addMoteBurstEffect({
          anchor: anchors.home ?? primary,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.contest,
          count: 9,
          radius: 0.98,
          lift: 0.46,
          summary: this.homeBreachDebugSummary("home-breach-shock", spec, anchors, anchors.home ?? primary),
        });
        break;
      case "home_thieved":
        this.addHomeRaidEffect({
          raidKind: "theft",
          spec,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.material,
          anchors,
          primary,
        });
        break;
      case "ruins_scavenged":
        this.addHomeLifecycleEffect({
          lifecycleKind: "scavenge",
          spec,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.material,
          anchors,
          primary,
        });
        break;
      case "home_colonized":
        this.addHomeRaidEffect({
          raidKind: "colonize",
          spec,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.combat,
          anchors,
          primary,
        });
        break;
      case "home_collapsed":
        this.addHomeLifecycleEffect({
          lifecycleKind: "collapse",
          spec,
          eventType,
          group: spec.group,
          color: EFFECT_COLORS.contest,
          anchors,
          primary,
        });
        break;
      default:
        break;
    }
  }

  private bubbleEventDebugSummary(
    eventType: string,
    spec: EventVisualSpec,
    anchors: Record<AnchorRole, THREE.Vector3 | null>,
    primary: THREE.Vector3,
  ): EffectDebugSummary | undefined {
    if (eventType === "agent_entered_region") {
      const fromWorld = anchors.fromRegion ?? null;
      const toWorld = anchors.toRegion ?? anchors.region ?? primary;
      const actorWorld = anchors.actor ?? null;
      return {
        kind: "movement-arrival",
        actorId: spec.actorId,
        regionName: spec.toRegionName ?? spec.regionName,
        fromRegionName: spec.fromRegionName,
        toRegionName: spec.toRegionName ?? spec.regionName,
        motionCue: "region-to-region-arrival-path",
        motionMode: this.motionDebug.mode,
        streamDirection: "from-region-to-region",
        movementCue: true,
        pathCue: Boolean(fromWorld && toWorld),
        arrivalCue: true,
        actorWorld: actorWorld ? vectorTuple(actorWorld) : undefined,
        streamFromWorld: fromWorld ? vectorTuple(fromWorld) : undefined,
        streamToWorld: toWorld ? vectorTuple(toWorld) : undefined,
        actorPathWorld: fromWorld && toWorld ? [vectorTuple(fromWorld), vectorTuple(toWorld)] : undefined,
        actorVisible: this.actorVisible(spec.actorId),
        actualActorMutated: false,
        regionStateMutated: false,
        inspectorMutated: false,
        selectionMutated: false,
      };
    }

    if (eventType === "speak") {
      const actorWorld = anchors.actor ?? primary;
      const targetWorld = anchors.target ?? null;
      return {
        kind: "speech-bubble",
        actorId: spec.actorId,
        targetId: spec.targetId,
        regionName: spec.regionName,
        motionCue: targetWorld ? "subject-bound-speech-leader-line" : "subject-bound-speech-bubble",
        motionMode: this.motionDebug.mode,
        communicationKind: "speech",
        worldBubbleCue: true,
        leaderLineCue: Boolean(targetWorld),
        thoughtWispCue: false,
        interiorityCue: false,
        heardByOthers: true,
        actorWorld: vectorTuple(actorWorld),
        targetWorld: targetWorld ? vectorTuple(targetWorld) : undefined,
        actorVisible: this.actorVisible(spec.actorId),
        targetVisible: this.actorVisible(spec.targetId),
        actualActorMutated: false,
        targetStateMutated: false,
        inspectorMutated: false,
        selectionMutated: false,
      };
    }

    if (eventType === "self_talk") {
      const actorWorld = anchors.actor ?? primary;
      return {
        kind: "private-thought",
        actorId: spec.actorId,
        regionName: spec.regionName,
        motionCue: "private-thought-wisp",
        motionMode: this.motionDebug.mode,
        communicationKind: "thought",
        worldBubbleCue: true,
        leaderLineCue: false,
        thoughtWispCue: true,
        interiorityCue: true,
        heardByOthers: false,
        actorWorld: vectorTuple(actorWorld),
        actorVisible: this.actorVisible(spec.actorId),
        actualActorMutated: false,
        targetStateMutated: false,
        inspectorMutated: false,
        selectionMutated: false,
      };
    }

    if (eventType === "resource_transferred") {
      const actorWorld = anchors.actor ?? primary;
      const targetWorld = anchors.target ?? null;
      return {
        kind: "resource-transfer",
        actorId: spec.actorId,
        targetId: spec.targetId,
        regionName: spec.regionName,
        resourceType: spec.resourceType,
        amount: spec.amount,
        motionCue: "actor-to-recipient-gift-thread",
        motionMode: this.motionDebug.mode,
        streamDirection: "actor-to-target",
        transferCue: true,
        giftThreadCue: Boolean(targetWorld),
        resourceStream: Boolean(targetWorld),
        streamFromWorld: vectorTuple(actorWorld),
        streamToWorld: targetWorld ? vectorTuple(targetWorld) : undefined,
        actorWorld: vectorTuple(actorWorld),
        targetWorld: targetWorld ? vectorTuple(targetWorld) : undefined,
        actorVisible: this.actorVisible(spec.actorId),
        targetVisible: this.actorVisible(spec.targetId),
        actualActorMutated: false,
        targetStateMutated: false,
        inspectorMutated: false,
        selectionMutated: false,
      };
    }

    if (eventType === "agent_started_hoarding") {
      return {
        ...this.agentHoardingDebugSummary(spec, anchors, anchors.actor ?? primary),
        kind: "agent-hoard-bubble",
        worldBubbleCue: true,
        hoardShimmerCue: false,
      };
    }

    if (eventType === "attack") {
      return this.combatBubbleDebugSummary(spec, anchors, primary);
    }

    if (eventType === "home_breached") {
      return this.homeBreachDebugSummary("home-breach-bubble", spec, anchors, primary);
    }

    if (eventType === "simulation_started") {
      return this.simulationStartedDebugSummary(primary);
    }

    return this.genericBubbleDebugSummary(eventType, spec, anchors, primary);
  }

  private genericBubbleDebugSummary(
    eventType: string,
    spec: EventVisualSpec,
    anchors: Record<AnchorRole, THREE.Vector3 | null>,
    primary: THREE.Vector3,
  ): EffectDebugSummary {
    const anchorRole = bubbleAnchorRole(anchors, primary);
    const actorWorld = anchors.actor ?? null;
    const targetWorld = anchors.target ?? null;
    const homeWorld = anchors.home ?? null;
    const regionWorld = anchors.region ?? anchors.toRegion ?? anchors.fromRegion ?? null;
    return {
      kind: "generic-event-bubble",
      bubbleEventType: eventType,
      eventGroup: spec.group,
      anchorRole,
      actorId: spec.actorId,
      targetId: spec.targetId,
      homeId: spec.homeId,
      regionName: spec.regionName ?? spec.toRegionName ?? spec.fromRegionName,
      motionCue: "passive-event-bubble",
      motionMode: this.motionDebug.mode,
      worldBubbleCue: true,
      passiveBubbleCue: true,
      genericBubbleCue: true,
      actorWorld: actorWorld ? vectorTuple(actorWorld) : undefined,
      targetWorld: targetWorld ? vectorTuple(targetWorld) : undefined,
      homeWorld: homeWorld ? vectorTuple(homeWorld) : undefined,
      thresholdWorld: regionWorld ? vectorTuple(regionWorld) : undefined,
      actorVisible: this.actorVisible(spec.actorId),
      targetVisible: this.actorVisible(spec.targetId),
      durableHomePresent: Boolean(homeWorld),
      homeAnchored: Boolean(homeWorld),
      actualActorMutated: false,
      durableAgentMutated: false,
      targetStateMutated: false,
      regionStateMutated: false,
      durableHomeMutated: false,
      homeStateMutated: false,
      ownerStateMutated: false,
      stakeholderStateMutated: false,
      vaultStateMutated: false,
      occupancyStateMutated: false,
      controlsMutated: false,
      inspectorMutated: false,
      selectionMutated: false,
    };
  }

  private genericPulseDebugSummary(
    eventType: string,
    spec: EventVisualSpec,
    anchors: Record<AnchorRole, THREE.Vector3 | null>,
    anchorRole: AnchorRole | "primary",
    anchor: THREE.Vector3,
  ): EffectDebugSummary {
    return {
      ...this.genericPassiveCarrierBaseSummary(spec, anchors),
      kind: "generic-event-pulse",
      pulseEventType: eventType,
      effectCarrier: "pulse",
      anchorRole,
      motionCue: "passive-event-pulse",
      anchorWorld: vectorTuple(anchor),
      pulseCue: true,
      passivePulseCue: true,
      genericPulseCue: true,
    };
  }

  private genericArcDebugSummary(
    eventType: string,
    spec: EventVisualSpec,
    anchors: Record<AnchorRole, THREE.Vector3 | null>,
    fromAnchorRole: AnchorRole,
    toAnchorRole: AnchorRole,
    from: THREE.Vector3,
    to: THREE.Vector3,
  ): EffectDebugSummary {
    return {
      ...this.genericPassiveCarrierBaseSummary(spec, anchors),
      kind: "generic-event-arc",
      arcEventType: eventType,
      effectCarrier: "arc",
      fromAnchorRole,
      toAnchorRole,
      motionCue: "passive-event-arc",
      streamDirection: `${fromAnchorRole}-to-${toAnchorRole}`,
      streamFromWorld: vectorTuple(from),
      streamToWorld: vectorTuple(to),
      arcCue: true,
      passiveArcCue: true,
      genericArcCue: true,
    };
  }

  private genericPassiveCarrierBaseSummary(
    spec: EventVisualSpec,
    anchors: Record<AnchorRole, THREE.Vector3 | null>,
  ): Omit<EffectDebugSummary, "kind"> {
    const actorWorld = anchors.actor ?? null;
    const targetWorld = anchors.target ?? null;
    const homeWorld = anchors.home ?? null;
    const regionWorld = anchors.region ?? anchors.toRegion ?? anchors.fromRegion ?? null;
    return {
      eventGroup: spec.group,
      actorId: spec.actorId,
      targetId: spec.targetId,
      homeId: spec.homeId,
      regionName: spec.regionName ?? spec.toRegionName ?? spec.fromRegionName,
      motionMode: this.motionDebug.mode,
      worldBubbleCue: false,
      actorWorld: actorWorld ? vectorTuple(actorWorld) : undefined,
      targetWorld: targetWorld ? vectorTuple(targetWorld) : undefined,
      homeWorld: homeWorld ? vectorTuple(homeWorld) : undefined,
      thresholdWorld: regionWorld ? vectorTuple(regionWorld) : undefined,
      actorVisible: this.actorVisible(spec.actorId),
      targetVisible: this.actorVisible(spec.targetId),
      durableHomePresent: Boolean(homeWorld),
      homeAnchored: Boolean(homeWorld),
      actualActorMutated: false,
      durableAgentMutated: false,
      targetStateMutated: false,
      regionStateMutated: false,
      durableHomeMutated: false,
      homeStateMutated: false,
      ownerStateMutated: false,
      stakeholderStateMutated: false,
      vaultStateMutated: false,
      occupancyStateMutated: false,
      liveStatusMutated: false,
      runMetadataMutated: false,
      replayArchiveMutated: false,
      controlsMutated: false,
      inspectorMutated: false,
      selectionMutated: false,
    };
  }

  private simulationStartedDebugSummary(primary: THREE.Vector3): EffectDebugSummary {
    return {
      kind: "simulation-started",
      motionCue: "world-awakening-system-pulse",
      motionMode: this.motionDebug.mode,
      systemEventKind: "startup",
      systemCue: true,
      startupCue: true,
      worldAwakeningCue: true,
      startupPulseCue: true,
      passiveChronicleCue: true,
      worldBubbleCue: true,
      systemWorld: vectorTuple(primary),
      actualActorMutated: false,
      durableAgentMutated: false,
      targetStateMutated: false,
      regionStateMutated: false,
      durableHomeMutated: false,
      homeStateMutated: false,
      liveStatusMutated: false,
      runMetadataMutated: false,
      replayArchiveMutated: false,
      controlsMutated: false,
      inspectorMutated: false,
      selectionMutated: false,
    };
  }

  private hearthEmberDebugSummary(
    spec: EventVisualSpec,
    anchors: Record<AnchorRole, THREE.Vector3 | null>,
    primary: THREE.Vector3,
  ): EffectDebugSummary {
    const actorWorld = anchors.actor ?? null;
    const homeWorld = anchors.home ?? primary;
    const currentHome = spec.homeId ? this.entityObjects.get(`home:${spec.homeId}`) : null;
    const visual = (currentHome?.userData as { visual?: HomeVisualState } | undefined)?.visual;
    const growth = visual?.growth ?? 1;
    const thresholdWorld = new THREE.Vector3(
      homeWorld.x,
      this.terrainHeight(homeWorld.x, homeWorld.z) + 0.18 + 0.58 * growth,
      homeWorld.z + 0.98 * growth,
    );
    return {
      kind: "hearth-ember",
      actorId: spec.actorId,
      homeId: spec.homeId,
      regionName: spec.regionName,
      materialsBurned: spec.materialsBurned,
      energyGained: spec.energyGained,
      agentEnergy: spec.agentEnergy,
      agentMaterials: spec.agentMaterials,
      motionCue: "hearth-ember-glow-burst",
      motionMode: this.motionDebug.mode,
      streamDirection: "hearth-to-home-threshold",
      homeAnchored: Boolean(anchors.home),
      homeWorld: vectorTuple(homeWorld),
      thresholdWorld: vectorTuple(thresholdWorld),
      actorWorld: actorWorld ? vectorTuple(actorWorld) : undefined,
      actorVisible: this.actorVisible(spec.actorId),
      durableHomePresent: Boolean(anchors.home),
      hearthEmberCue: true,
      thresholdGlow: true,
      thresholdLight: true,
      worldBubbleCue: false,
      persistentOccupancy: false,
      actualActorMutated: false,
      durableAgentMutated: false,
      targetStateMutated: false,
      regionStateMutated: false,
      durableHomeMutated: false,
      homeStateMutated: false,
      occupancyStateMutated: false,
      vaultStateMutated: false,
      controlsMutated: false,
      inspectorMutated: false,
      selectionMutated: false,
    };
  }

  private homeBreachDebugSummary(
    kind: "home-breach-bubble" | "home-breach-shock",
    spec: EventVisualSpec,
    anchors: Record<AnchorRole, THREE.Vector3 | null>,
    primary: THREE.Vector3,
  ): EffectDebugSummary {
    const actorWorld = anchors.actor ?? null;
    const homeWorld = anchors.home ?? primary;
    const participantIds = uniqueStrings([spec.actorId, ...(spec.breacherIds ?? [])]);
    return {
      kind,
      actorId: spec.actorId,
      homeId: spec.homeId,
      regionName: spec.regionName,
      participantIds,
      breachIntent: spec.breachIntent,
      breacherIds: spec.breacherIds,
      energyCost: spec.energyCost,
      materialsCost: spec.materialsCost,
      integrityDamage: spec.integrityDamage,
      integrity: spec.integrity,
      motionCue: "standalone-breach-shock-crack",
      motionMode: this.motionDebug.mode,
      streamDirection: actorWorld ? "actor-to-home" : undefined,
      homeAnchored: Boolean(anchors.home),
      homeWorld: vectorTuple(homeWorld),
      actorWorld: actorWorld ? vectorTuple(actorWorld) : undefined,
      actorPathWorld: actorWorld ? [vectorTuple(actorWorld), vectorTuple(homeWorld)] : undefined,
      actorVisible: this.actorVisible(spec.actorId),
      durableHomePresent: Boolean(anchors.home),
      breachCue: true,
      crackCue: true,
      breachShockCue: kind === "home-breach-shock",
      worldBubbleCue: kind === "home-breach-bubble",
      terminalRaidCue: false,
      vaultStream: false,
      ownerFlipCue: false,
      persistentOccupancy: false,
      actualActorMutated: false,
      durableHomeMutated: false,
      homeStateMutated: false,
      ownerStateMutated: false,
      stakeholderStateMutated: false,
      vaultStateMutated: false,
      inspectorMutated: false,
      selectionMutated: false,
    };
  }

  private combatBubbleDebugSummary(
    spec: EventVisualSpec,
    anchors: Record<AnchorRole, THREE.Vector3 | null>,
    primary: THREE.Vector3,
  ): EffectDebugSummary {
    const actorWorld = anchors.actor ?? null;
    const targetWorld = anchors.target ?? primary;
    return {
      kind: "combat-bubble",
      actorId: spec.actorId,
      targetId: spec.targetId,
      regionName: spec.regionName,
      motionCue: "nonlethal-hit-bubble",
      motionMode: this.motionDebug.mode,
      combatCue: true,
      impactCue: true,
      hitLineCue: Boolean(actorWorld && targetWorld),
      deathCue: false,
      paralysisCue: false,
      flameDropCue: false,
      actorWorld: actorWorld ? vectorTuple(actorWorld) : undefined,
      targetWorld: vectorTuple(targetWorld),
      actorVisible: this.actorVisible(spec.actorId),
      targetVisible: this.actorVisible(spec.targetId),
      durableAgentMutated: false,
      actualActorMutated: false,
      targetStateMutated: false,
      inspectorMutated: false,
      selectionMutated: false,
    };
  }

  private thoughtWispDebugSummary(
    spec: EventVisualSpec,
    anchors: Record<AnchorRole, THREE.Vector3 | null>,
    primary: THREE.Vector3,
  ): EffectDebugSummary {
    const actorWorld = anchors.actor ?? primary;
    return {
      kind: "private-thought-wisp",
      actorId: spec.actorId,
      regionName: spec.regionName,
      motionCue: "private-thought-wisp",
      motionMode: this.motionDebug.mode,
      communicationKind: "thought",
      worldBubbleCue: false,
      leaderLineCue: false,
      thoughtWispCue: true,
      interiorityCue: true,
      heardByOthers: false,
      actorWorld: vectorTuple(actorWorld),
      actorVisible: this.actorVisible(spec.actorId),
      actualActorMutated: false,
      targetStateMutated: false,
      inspectorMutated: false,
      selectionMutated: false,
    };
  }

  private agentHoardingDebugSummary(
    spec: EventVisualSpec,
    anchors: Record<AnchorRole, THREE.Vector3 | null>,
    primary: THREE.Vector3,
  ): EffectDebugSummary {
    const actorWorld = anchors.actor ?? primary;
    return {
      kind: "agent-hoard-shimmer",
      actorId: spec.actorId,
      regionName: spec.regionName,
      resourceType: spec.resourceType,
      amount: spec.amount,
      energy: spec.energy,
      agentMaterials: spec.agentMaterials,
      motionCue: "being-hoard-threshold-shimmer",
      motionMode: this.motionDebug.mode,
      streamDirection: "being-hoard-shimmer",
      worldBubbleCue: false,
      beingHoardCue: true,
      hoardThresholdCue: true,
      hoardShimmerCue: true,
      vaultShimmer: false,
      resourceStream: false,
      actorWorld: vectorTuple(actorWorld),
      actorVisible: this.actorVisible(spec.actorId),
      actualActorMutated: false,
      targetStateMutated: false,
      inspectorMutated: false,
      selectionMutated: false,
    };
  }

  private combatImpactDebugSummary(
    spec: EventVisualSpec,
    anchors: Record<AnchorRole, THREE.Vector3 | null>,
    primary: THREE.Vector3,
  ): EffectDebugSummary {
    return {
      ...this.combatBubbleDebugSummary(spec, anchors, primary),
      kind: "combat-impact",
      motionCue: "nonlethal-hit-line-impact-ring",
      worldBubbleCue: false,
    };
  }

  private actorVisible(agentId: string | undefined): boolean {
    if (!agentId) {
      return false;
    }
    const object = this.entityObjects.get(`agent:${agentId}`);
    return object ? isVisibleInHierarchy(object) : false;
  }

  private updateEffects(dt: number): void {
    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      const effect = this.effects[index];
      effect.age += dt;
      const t = clamp(effect.age / effect.duration, 0, 1);
      const fade = 1 - t;
      if (effect.homeBuild) {
        this.updateHomeBuildEffect(effect.homeBuild, t);
      } else if (effect.shelter) {
        this.updateShelterEffect(effect.shelter, t);
      } else if (effect.homeRaid) {
        this.updateHomeRaidEffect(effect.homeRaid, t);
      } else if (effect.homeLifecycle) {
        this.updateHomeLifecycleEffect(effect.homeLifecycle, t);
      } else if (effect.resourceHarvest) {
        this.updateResourceHarvestEffect(effect.resourceHarvest, t);
      } else if (effect.recoveryRelight) {
        this.updateRecoveryRelightEffect(effect.recoveryRelight, t);
      } else if (effect.bondLifecycle) {
        this.updateBondLifecycleEffect(effect.bondLifecycle, t);
      } else {
        effect.root.position.y += dt * this.motionSettings.defaultRiseSpeed;
        for (const child of effect.root.children) {
          if (child instanceof THREE.Mesh) {
            const grow = 1 + t * this.motionSettings.defaultGrow;
            child.scale.set(grow, grow, grow);
          }
          if (child instanceof THREE.PointLight) {
            child.intensity = (0.45 + 0.75 * this.motionSettings.pulseScale) * fade;
          }
        }
        for (const material of effect.materials) {
          if ("opacity" in material) {
            material.opacity = Math.max(0, fade * 0.82);
          }
        }
        if (effect.label) {
          if (effect.bubble) {
            const arrival = bubbleArrivalVisualState(t, effect.bubble.priority, this.motionSettings.mode);
            effect.bubble.arrivalPhase = arrival.phase;
            effect.bubble.arrivalProgress = arrival.progress;
            effect.bubble.arrivalOpacity = arrival.opacity;
            effect.label.element.style.opacity = formatBubbleArrivalNumber(arrival.opacity);
            const bubbleElement = effect.label.element.querySelector<HTMLElement>(".viv-event-bubble");
            if (bubbleElement) {
              applyBubbleArrivalVisualState(bubbleElement, arrival);
            }
          } else {
            effect.label.element.style.opacity = String(Math.max(0, fade));
          }
          effect.label.position.y = 0.8 + t * this.motionSettings.defaultLabelLift;
        }
        if (effect.travel) {
          const pointIndex = Math.min(
            effect.travel.points.length - 1,
            Math.floor(t * (effect.travel.points.length - 1)),
          );
          effect.travel.object.position.copy(effect.travel.points[pointIndex]);
          effect.travel.object.scale.setScalar(0.72 + Math.sin(t * Math.PI) * this.motionSettings.defaultTravelPulse);
        }
      }
      if (effect.age >= effect.duration) {
        this.disposeEffect(effect);
        this.effects.splice(index, 1);
      }
    }
  }

  private updateResourceHarvestEffect(harvest: ResourceHarvestEffectState, t: number): void {
    const fade = 1 - sstep(0.72, 1, t);
    harvest.pathMaterial.opacity = 0.5 * fade;
    harvest.moteMaterial.opacity = 0.86 * fade;
    const pulse = Math.sin(t * Math.PI);
    const jitter = this.motionSettings.jitterScale;
    for (const [index, mote] of harvest.motes.entries()) {
      const localT = clamp((t - mote.offset * 0.18) / 0.78, 0, 1);
      const eased = sstep(0, 1, localT);
      const pointIndex = Math.min(
        mote.points.length - 1,
        Math.floor(eased * (mote.points.length - 1)),
      );
      const point = mote.points[pointIndex].clone();
      point.x += Math.sin(t * Math.PI * 7 + index) * 0.035 * jitter;
      point.z += Math.cos(t * Math.PI * 5 + index) * 0.026 * jitter;
      mote.mesh.position.copy(point);
      mote.mesh.scale.setScalar(localT <= 0 || localT >= 1 ? 0.18 : 0.58 + pulse * 0.46 * this.motionSettings.pulseScale);
    }
  }

  private updateRecoveryRelightEffect(recovery: RecoveryRelightEffectState, t: number): void {
    const fade = 1 - sstep(0.78, 1, t);
    const relight = sstep(0.08, 0.5, t);
    recovery.pathMaterial.opacity = 0.42 * fade;
    recovery.moteMaterial.opacity = 0.86 * fade;
    recovery.light.intensity = (0.35 + relight * 1.45) * fade;
    recovery.proxyFlame.scale.setScalar(
      0.42 + relight * 0.72 + Math.sin(t * Math.PI * 8) * 0.04 * this.motionSettings.jitterScale,
    );
    for (const material of recovery.proxyMaterials) {
      if ("opacity" in material) {
        material.opacity = (0.2 + relight * 0.72) * fade;
      }
    }
    for (const [index, mote] of recovery.motes.entries()) {
      const localT = clamp((t - mote.offset * 0.16) / 0.76, 0, 1);
      const eased = sstep(0, 1, localT);
      const pointIndex = Math.min(
        mote.points.length - 1,
        Math.floor(eased * (mote.points.length - 1)),
      );
      const point = mote.points[pointIndex].clone();
      point.x += Math.sin(t * Math.PI * 6 + index) * 0.035 * this.motionSettings.jitterScale;
      point.y += Math.cos(t * Math.PI * 5 + index) * 0.03 * this.motionSettings.jitterScale;
      mote.mesh.position.copy(point);
      mote.mesh.scale.setScalar(
        localT <= 0 || localT >= 1
          ? 0.16
          : 0.52 + Math.sin(localT * Math.PI) * 0.5 * this.motionSettings.pulseScale,
      );
    }
  }

  private updateBondLifecycleEffect(bond: BondLifecycleEffectState, t: number): void {
    const fade = 1 - sstep(0.78, 1, t);
    const pulse = Math.sin(Math.PI * clamp(t / 0.86, 0, 1));
    const pulseScale = this.motionSettings.pulseScale;
    if (bond.threadMaterial) {
      bond.threadMaterial.opacity = (0.14 + (1 - t) * 0.52) * fade;
    }
    bond.cueMaterial.opacity = (0.18 + pulse * 0.58 * pulseScale) * fade;
    if (bond.secondaryMaterial) {
      bond.secondaryMaterial.opacity = (0.22 + pulse * 0.48 * pulseScale) * fade;
    }
    if (bond.moteMaterial) {
      bond.moteMaterial.opacity = (0.24 + pulse * 0.58 * pulseScale) * fade;
    }
    bond.light.intensity = (0.3 + pulse * 1.45 * pulseScale) * fade;
    for (const [index, mesh] of bond.cueMeshes.entries()) {
      mesh.scale.setScalar(1 + pulse * 0.22 * pulseScale + t * 0.18 * pulseScale);
      mesh.rotation.y += (0.012 + index * 0.002) * this.motionSettings.rotationScale;
    }
    if (bond.proxy) {
      const rise = sstep(0.08, 0.54, t);
      bond.proxy.scale.setScalar(0.5 + rise * 0.5 + Math.sin(t * Math.PI * 5) * 0.025 * this.motionSettings.jitterScale);
      bond.proxy.position.y = bond.anchorWorld.y + 0.08 + rise * 0.3 * this.motionSettings.driftScale;
      for (const material of bond.proxyMaterials) {
        if ("opacity" in material) {
          material.opacity = (0.28 + rise * 0.54) * fade;
        }
      }
    }
    for (const [index, mote] of bond.motes.entries()) {
      const localT = clamp((t - mote.offset * 0.18) / 0.78, 0, 1);
      const eased = sstep(0, 1, localT);
      const pointIndex = Math.min(
        mote.points.length - 1,
        Math.floor(eased * (mote.points.length - 1)),
      );
      const point = mote.points[pointIndex].clone();
      point.x += Math.sin(t * Math.PI * 7 + index) * 0.035 * this.motionSettings.jitterScale;
      point.y += Math.cos(t * Math.PI * 6 + index) * 0.03 * this.motionSettings.jitterScale;
      mote.mesh.position.copy(point);
      mote.mesh.scale.setScalar(localT <= 0 || localT >= 1 ? 0.18 : 0.58 + pulse * 0.32 * pulseScale);
    }
  }

  private updateHomeBuildEffect(build: HomeBuildEffectState, t: number): void {
    const rise = sstep(0.1, 0.72, t);
    const settle = sstep(0.7, 1, t);
    const endFade = 1 - sstep(0.82, 1, t);
    const shimmer = 0.5 + Math.sin(t * Math.PI * 8) * 0.5;
    const frameScale = lerp(0.34, 1, rise);
    build.frame.position.y = lerp(0.06, 0.58, rise) + Math.sin(t * Math.PI) * 0.08 * (1 - settle) * this.motionSettings.jitterScale;
    build.frame.scale.set(
      frameScale,
      lerp(0.18, 1, rise),
      frameScale,
    );
    build.frame.rotation.y = Math.sin(t * Math.PI * 2) * 0.025 * (1 - settle) * this.motionSettings.rotationScale;

    build.scaffoldMaterial.opacity = (0.5 + shimmer * 0.24) * Math.max(0.18, endFade);
    build.crossbarMaterial.opacity = (0.44 + shimmer * 0.2) * Math.max(0.12, endFade);
    for (const material of build.frameMaterials) {
      if ("opacity" in material) {
        material.opacity = (0.16 + rise * 0.68) * Math.max(0.28, endFade);
      }
    }

    const glowPulse = Math.sin(Math.PI * clamp(t / 0.9, 0, 1));
    build.glowMaterial.opacity = (0.08 + glowPulse * 0.28 * this.motionSettings.pulseScale) * endFade;
    build.light.intensity = (0.4 + glowPulse * 1.65 * this.motionSettings.pulseScale) * endFade;
    build.dustMaterial.opacity = Math.max(0, (0.5 - t * 0.32) * endFade);
    for (const [index, puff] of build.dust.entries()) {
      const drift = t * (0.42 + index * 0.05) * this.motionSettings.driftScale;
      puff.position.y = 0.1 + index * 0.035 + drift;
      puff.position.x += Math.sin(t * Math.PI * 2 + index) * 0.002 * this.motionSettings.jitterScale;
      puff.scale.setScalar(1 + t * (0.85 + index * 0.08) * this.motionSettings.pulseScale);
    }
  }

  private updateShelterEffect(shelter: ShelterEffectState, t: number): void {
    const enterEnd = 0.42;
    const pauseEnd = 0.62;
    const reducedShelterMotion = shelter.motionMode === "reduced";
    let position: THREE.Vector3;
    let scale: number;
    if (reducedShelterMotion) {
      const pulse = Math.sin(t * Math.PI);
      position = shelter.actorStart.clone();
      position.y += 0.02 + pulse * 0.035 * this.motionSettings.pulseScale;
      position.x += Math.sin(t * Math.PI * 2) * 0.014 * this.motionSettings.jitterScale;
      position.z += Math.cos(t * Math.PI * 2) * 0.012 * this.motionSettings.jitterScale;
      scale = 0.34 + pulse * 0.045 * this.motionSettings.pulseScale;
    } else if (t < enterEnd) {
      const phaseT = sstep(0, 1, t / enterEnd);
      position = shelter.actorStart.clone().lerp(shelter.thresholdBase, phaseT);
      scale = lerp(0.92, 0.42, phaseT);
    } else if (t < pauseEnd) {
      const phaseT = sstep(0, 1, (t - enterEnd) / (pauseEnd - enterEnd));
      position = shelter.thresholdBase.clone();
      position.y += phaseT * 0.08;
      scale = lerp(0.42, 0.26, phaseT);
    } else {
      const phaseT = sstep(0, 1, (t - pauseEnd) / (1 - pauseEnd));
      position = shelter.thresholdBase.clone().lerp(shelter.actorStart, phaseT);
      scale = lerp(0.26, 0.86, phaseT);
    }
    position.y += Math.sin(t * Math.PI * 2) * 0.04 * this.motionSettings.jitterScale;
    shelter.proxy.position.copy(position);
    shelter.proxy.scale.setScalar(scale);

    const hearthPulse = Math.sin(Math.PI * clamp(t / 0.92, 0, 1));
    const quickPulse = 0.5 + Math.sin(t * Math.PI * (reducedShelterMotion ? 4 : 7)) * 0.5;
    const thresholdFade = Math.max(0, 1 - Math.max(0, t - 0.72) / 0.28);
    const cueFade = 1 - sstep(0.88, 1, t);
    const doorOpenAmount = reducedShelterMotion
      ? 0
      : sstep(0.1, 0.34, t) * (1 - sstep(0.76, 1, t));
    shelter.doorOpenAmount = doorOpenAmount;
    shelter.doorPivot.rotation.y = doorOpenAmount * 1.08;
    shelter.thresholdMaterial.opacity = clamp(
      0.28 + hearthPulse * (reducedShelterMotion ? 0.5 : 0.64) * thresholdFade * this.motionSettings.pulseScale,
      0,
      0.92,
    );
    shelter.thresholdSillMaterial.opacity = clamp(
      (0.22 + hearthPulse * (reducedShelterMotion ? 0.46 : 0.62) * this.motionSettings.pulseScale) * cueFade,
      0,
      0.88,
    );
    shelter.glowMaterial.opacity = clamp(
      (0.2 + hearthPulse * (reducedShelterMotion ? 0.48 : 0.6) * thresholdFade * this.motionSettings.pulseScale + quickPulse * 0.08) * cueFade,
      0,
      0.92,
    );
    shelter.doorGlowMaterial.opacity = clamp(
      (0.22 + hearthPulse * (reducedShelterMotion ? 0.58 : 0.78) * this.motionSettings.pulseScale + quickPulse * 0.1) * cueFade,
      0,
      0.95,
    );
    shelter.windowGlowMaterial.opacity = clamp(
      (0.16 + hearthPulse * (reducedShelterMotion ? 0.5 : 0.66) * this.motionSettings.pulseScale + quickPulse * 0.06) * cueFade,
      0,
      0.82,
    );
    shelter.doorMaterial.opacity = (reducedShelterMotion ? 0.34 : 0.48 + doorOpenAmount * 0.08) * cueFade;
    shelter.pathMaterial.opacity = reducedShelterMotion
      ? 0.08 * cueFade
      : (0.1 + (1 - t) * 0.54) * cueFade;
    shelter.smokeMaterial.opacity = Math.max(
      0,
      ((reducedShelterMotion ? 0.46 : 0.58) + quickPulse * (reducedShelterMotion ? 0.24 : 0.38) * this.motionSettings.pulseScale) * (1 - t * 0.62),
    );
    shelter.light.intensity = (
      (reducedShelterMotion ? 0.5 : 0.62)
      + hearthPulse * (reducedShelterMotion ? 2.4 : 3.4) * thresholdFade * this.motionSettings.pulseScale
    ) * cueFade;
    for (const [index, puff] of shelter.smoke.entries()) {
      const drift = t * (0.32 + index * 0.08) * this.motionSettings.driftScale * (reducedShelterMotion ? 0.7 : 1.35);
      puff.position.y = shelter.thresholdMid.y + 0.18 + index * 0.16 + drift;
      puff.position.x = shelter.thresholdMid.x - 0.18 + index * 0.11 + Math.sin(t * Math.PI * 2 + index) * 0.04 * this.motionSettings.jitterScale;
      puff.position.z = shelter.thresholdMid.z + 0.04 - index * 0.035 + Math.cos(t * Math.PI * 3 + index) * 0.025 * this.motionSettings.jitterScale;
      puff.scale.setScalar(
        1
        + t * (reducedShelterMotion ? 0.42 : 0.92 + index * 0.14) * this.motionSettings.pulseScale
        + quickPulse * 0.08 * this.motionSettings.pulseScale,
      );
    }
    let proxyOpacity: number;
    if (reducedShelterMotion) {
      proxyOpacity = 0;
      shelter.proxy.visible = false;
    } else if (t < enterEnd) {
      shelter.proxy.visible = true;
      proxyOpacity = lerp(0.92, 0.06, sstep(0, 1, t / enterEnd));
    } else if (t < pauseEnd) {
      shelter.proxy.visible = true;
      proxyOpacity = 0;
    } else {
      shelter.proxy.visible = true;
      proxyOpacity = lerp(0.06, 0.86, sstep(0, 1, (t - pauseEnd) / (1 - pauseEnd)));
    }
    if (t > 0.94) {
      proxyOpacity *= Math.max(0, (1 - t) / 0.06);
    }
    for (const material of shelter.proxyMaterials) {
      if ("opacity" in material) {
        material.opacity = proxyOpacity;
      }
    }
    shelter.proxyOpacity = proxyOpacity;
  }

  private updateHomeRaidEffect(raid: HomeRaidEffectState, t: number): void {
    const shockPulse = Math.sin(Math.PI * clamp(t / 0.58, 0, 1));
    const pulse = shockPulse * this.motionSettings.pulseScale;
    const shockFade = 1 - sstep(0.58, 1, t);
    const crackFade = 1 - sstep(0.76, 1, t);
    raid.shock.scale.setScalar(1 + pulse * 0.62 + t * 0.28 * this.motionSettings.pulseScale);
    raid.shockMaterial.opacity = (0.18 + pulse * 0.68) * shockFade;
    raid.crackMaterial.opacity = (0.36 + pulse * 0.5) * crackFade;
    raid.lowCue.scale.setScalar(1 + Math.sin(t * Math.PI * 3) * 0.055 * this.motionSettings.jitterScale);
    raid.lowCueMaterial.opacity = (0.18 + pulse * 0.28) * (1 - sstep(0.84, 1, t));
    raid.light.intensity = (0.55 + pulse * 2.4) * shockFade;

    for (const [index, crack] of raid.cracks.entries()) {
      crack.rotation.z += Math.sin(t * Math.PI * 2 + index) * 0.0016 * this.motionSettings.rotationScale;
      crack.scale.y = 0.82 + pulse * 0.42;
    }

    if (raid.streamMaterial && raid.streamLineMaterial) {
      const streamFade = 1 - sstep(0.78, 1, t);
      raid.streamMaterial.opacity = (0.28 + pulse * 0.64) * streamFade;
      raid.streamLineMaterial.opacity = (0.16 + pulse * 0.42) * streamFade;
    }
    for (const [index, mote] of raid.motes.entries()) {
      const localT = clamp((t - mote.offset * 0.22) / 0.72, 0, 1);
      const eased = sstep(0, 1, localT);
      const pointIndex = Math.min(
        mote.points.length - 1,
        Math.floor(eased * (mote.points.length - 1)),
      );
      const point = mote.points[pointIndex].clone();
      point.x += Math.sin(t * Math.PI * 8 + index) * 0.045 * this.motionSettings.jitterScale;
      point.y += Math.cos(t * Math.PI * 7 + index) * 0.035 * this.motionSettings.jitterScale;
      mote.mesh.position.copy(point);
      mote.mesh.scale.setScalar(localT <= 0 || localT >= 1 ? 0.18 : 0.72 + pulse * 0.48);
    }

    if (raid.banner) {
      const rise = sstep(0.08, 0.48, t);
      const settle = 1 - sstep(0.78, 1, t);
      raid.banner.scale.set(0.62 + rise * 0.38, 0.34 + rise * 0.66, 0.62 + rise * 0.38);
      raid.banner.rotation.z = Math.sin(t * Math.PI * 4) * 0.05 * settle * this.motionSettings.rotationScale;
      if (raid.bannerMaterial) {
        raid.bannerMaterial.opacity = (0.38 + rise * 0.48) * Math.max(0.35, settle);
      }
      if (raid.pennantMaterial) {
        raid.pennantMaterial.opacity = (0.3 + rise * 0.6) * Math.max(0.38, settle);
      }
    }

    for (const [index, hint] of raid.evictionHints.entries()) {
      const localT = clamp((t - index * 0.06) / 0.82, 0, 1);
      const eased = sstep(0, 1, localT);
      const pointIndex = Math.min(
        hint.points.length - 1,
        Math.floor(eased * (hint.points.length - 1)),
      );
      hint.proxy.position.copy(hint.points[pointIndex]);
      hint.proxy.scale.setScalar(0.62 + Math.sin(localT * Math.PI) * 0.18 * this.motionSettings.pulseScale);
      hint.lineMaterial.opacity = (0.12 + (1 - t) * 0.46) * (1 - sstep(0.86, 1, t));
      for (const material of hint.proxyMaterials) {
        if ("opacity" in material) {
          material.opacity = (0.28 + (1 - t) * 0.54) * (1 - sstep(0.9, 1, t));
        }
      }
    }
  }

  private updateHomeLifecycleEffect(lifecycle: HomeLifecycleEffectState, t: number): void {
    const pulse = Math.sin(Math.PI * clamp(t / 0.84, 0, 1)) * this.motionSettings.pulseScale;
    const fade = 1 - sstep(0.78, 1, t);
    lifecycle.cue.scale.setScalar(1 + pulse * 0.34 + t * 0.22 * this.motionSettings.pulseScale);
    lifecycle.cueMaterial.opacity = (0.2 + pulse * 0.58) * fade;
    lifecycle.light.intensity = (0.35 + pulse * 2.15) * fade;

    if (lifecycle.pathMaterial) {
      lifecycle.pathMaterial.opacity = (0.16 + (1 - t) * 0.48) * fade;
    }

    if (lifecycle.proxy && lifecycle.pathPoints) {
      const eased = sstep(0, 1, clamp(t / 0.82, 0, 1));
      const pointIndex = Math.min(
        lifecycle.pathPoints.length - 1,
        Math.floor(eased * (lifecycle.pathPoints.length - 1)),
      );
      lifecycle.proxy.position.copy(lifecycle.pathPoints[pointIndex]);
      lifecycle.proxy.scale.setScalar(0.58 + Math.sin(t * Math.PI) * 0.16 * this.motionSettings.pulseScale);
      for (const material of lifecycle.proxyMaterials) {
        if ("opacity" in material) {
          material.opacity = (0.28 + (1 - t) * 0.58) * fade;
        }
      }
    }

    for (const [index, mote] of lifecycle.motes.entries()) {
      const localT = clamp((t - mote.offset * 0.2) / 0.78, 0, 1);
      const eased = sstep(0, 1, localT);
      const pointIndex = Math.min(
        mote.points.length - 1,
        Math.floor(eased * (mote.points.length - 1)),
      );
      const point = mote.points[pointIndex].clone();
      point.x += Math.sin(t * Math.PI * 7 + index) * 0.035 * this.motionSettings.jitterScale;
      point.y += Math.cos(t * Math.PI * 5 + index) * 0.028 * this.motionSettings.jitterScale;
      mote.mesh.position.copy(point);
      mote.mesh.scale.setScalar(localT <= 0 || localT >= 1 ? 0.18 : 0.66 + pulse * 0.26);
    }

    for (const [index, part] of lifecycle.fallParts.entries()) {
      const drop = sstep(0.08, 0.86, t);
      part.position.y = lerp(
        lifecycle.thresholdWorld.y + 0.7 + (index % 2) * 0.24,
        lifecycle.homeWorld.y + 0.2 + (index % 3) * 0.05,
        drop,
      );
      part.rotation.x += (0.012 + index * 0.001) * this.motionSettings.rotationScale;
      part.rotation.z += (index % 2 === 0 ? 1 : -1) * 0.014 * this.motionSettings.rotationScale;
      part.scale.setScalar(1 - sstep(0.86, 1, t) * 0.32);
    }

    if (lifecycle.previewGroup) {
      const rise = sstep(0.08, 0.5, t);
      lifecycle.previewGroup.scale.setScalar(0.68 + rise * 0.32);
      lifecycle.previewGroup.rotation.y = Math.sin(t * Math.PI * 2) * 0.035 * this.motionSettings.rotationScale;
      for (const material of lifecycle.previewMaterials) {
        if ("opacity" in material) {
          material.opacity = (0.22 + rise * 0.46) * fade;
        }
      }
    }
  }

  private effectDebugEntry(effect: VisualEffect): EffectDebugEntry {
    const summary = this.effectDebugSummary(effect);
    const bubbleScreen = effect.bubble
      ? this.screenPointForWorld(effect.bubble.anchor) ?? effect.bubble.screen
      : null;
    const bubble = effect.bubble
      ? {
          cursor: effect.bubble.cursor,
          lane: effect.bubble.lane,
          priority: effect.bubble.priority,
          catalogPriority: effect.bubble.catalogPriority,
          glyph: effect.bubble.glyph,
          iconKey: effect.bubble.iconKey,
          iconLabel: effect.bubble.iconLabel,
          medallionLabel: effect.bubble.medallionLabel,
          accent: effect.bubble.accent,
          arrivalPhase: effect.bubble.arrivalPhase,
          arrivalProgress: effect.bubble.arrivalProgress,
          arrivalOpacity: effect.bubble.arrivalOpacity,
          offset: [effect.bubble.offsetX, effect.bubble.offsetY] as [number, number],
          anchorWorld: effect.bubble.anchor.toArray() as [number, number, number],
          screen: bubbleScreen ? { ...bubbleScreen } : null,
          ...(effect.bubble.chainDetail
            ? {
                chainDetail: {
                  kind: effect.bubble.chainDetail.kind,
                  text: effect.bubble.chainDetail.text,
                  count: effect.bubble.chainDetail.count,
                  window: effect.bubble.chainDetail.window,
                },
              }
            : {}),
        }
      : undefined;
    return {
      id: effect.id,
      eventType: effect.eventType,
      group: effect.group,
      ...(bubble ? { bubble } : {}),
      ...(summary ? { summary } : {}),
    };
  }

  private effectDebugSummary(effect: VisualEffect): EffectDebugSummary | undefined {
    if (effect.summary) {
      return effect.summary;
    }

    const homeBuild = effect.homeBuild;
    if (homeBuild) {
      const progress = clamp(effect.age / effect.duration, 0, 1);
      const currentHome = homeBuild.homeId ? this.entityObjects.get(`home:${homeBuild.homeId}`) : null;
      const currentHomeWorld = currentHome?.getWorldPosition(new THREE.Vector3()) ?? null;
      const currentActor = homeBuild.actorId ? this.entityObjects.get(`agent:${homeBuild.actorId}`) : null;
      const actorWorld = currentActor?.getWorldPosition(new THREE.Vector3()) ?? null;
      return {
        kind: "home-build",
        actorId: homeBuild.actorId,
        homeId: homeBuild.homeId,
        regionName: homeBuild.regionName,
        phase: homeBuildPhase(progress),
        progress: Number(progress.toFixed(3)),
        motionCue: "scaffold-to-home-rise",
        motionMode: this.motionDebug.mode,
        anchorSource: homeBuild.anchorSource,
        anchorMode: homeBuild.anchorSource,
        homeAnchored: currentHomeWorld
          ? currentHomeWorld.distanceTo(homeBuild.anchorWorld) < 0.05
          : false,
        homeWorld: currentHomeWorld
          ? vectorTuple(currentHomeWorld)
          : homeBuild.homeWorld
            ? vectorTuple(homeBuild.homeWorld)
            : undefined,
        buildSiteWorld: vectorTuple(homeBuild.anchorWorld),
        actorWorld: actorWorld ? vectorTuple(actorWorld) : undefined,
        durableHomePresent: Boolean(currentHomeWorld),
        persistentHomeCreated: false,
        scaffold: true,
        scaffoldPoles: homeBuild.scaffoldPoles.length,
        scaffoldCrossbars: homeBuild.scaffoldCrossbars.length,
        buildRise: true,
        buildDust: homeBuild.dust.length > 0,
        warmRise: homeBuild.light.visible,
        risingHome: true,
        buildSiteOnly: !currentHomeWorld,
        durableHomeCreated: false,
        persistentOccupancy: false,
        actualActorMutated: false,
        inspectorMutated: false,
        selectionMutated: false,
      };
    }

    const homeRaid = effect.homeRaid;
    if (homeRaid) {
      const progress = clamp(effect.age / effect.duration, 0, 1);
      const currentHome = homeRaid.homeId ? this.entityObjects.get(`home:${homeRaid.homeId}`) : null;
      const currentHomeWorld = currentHome?.getWorldPosition(new THREE.Vector3()) ?? null;
      const currentActor = homeRaid.actorId ? this.entityObjects.get(`agent:${homeRaid.actorId}`) : null;
      const actorWorld = currentActor?.getWorldPosition(new THREE.Vector3()) ?? homeRaid.actorWorld ?? null;
      const currentTarget = homeRaid.targetId ? this.entityObjects.get(`agent:${homeRaid.targetId}`) : null;
      const targetWorld = currentTarget?.getWorldPosition(new THREE.Vector3()) ?? homeRaid.targetWorld ?? null;
      const streamToWorld = homeRaid.streamEndWorld ?? targetWorld ?? actorWorld ?? null;
      return {
        kind: homeRaid.raidKind === "theft" ? "home-theft-raid" : "home-colonize-raid",
        raidKind: homeRaid.raidKind,
        actorId: homeRaid.actorId,
        targetId: homeRaid.targetId,
        homeId: homeRaid.homeId,
        regionName: homeRaid.regionName,
        previousOwnerId: homeRaid.previousOwnerId,
        newOwnerId: homeRaid.newOwnerId,
        previousStakeholderIds: homeRaid.previousStakeholderIds,
        newStakeholderIds: homeRaid.newStakeholderIds,
        recipientIds: homeRaid.recipientIds,
        visibleEvicteeIds: homeRaid.visibleEvicteeIds,
        lootMaterials: homeRaid.lootMaterials,
        phase: homeRaidPhase(homeRaid.raidKind, progress),
        progress: Number(progress.toFixed(3)),
        motionCue: homeRaid.raidKind === "theft"
          ? "breach-vault-strip-stream"
          : "breach-owner-flip-eviction",
        motionMode: this.motionDebug.mode,
        streamDirection: homeRaid.streamDirection,
        anchorSource: homeRaid.anchorSource,
        anchorMode: homeRaid.anchorSource,
        homeAnchored: currentHomeWorld
          ? currentHomeWorld.distanceTo(homeRaid.homeWorld) < 0.05
          : false,
        homeWorld: vectorTuple(homeRaid.homeWorld),
        thresholdWorld: vectorTuple(homeRaid.thresholdWorld),
        vaultWorld: vectorTuple(homeRaid.vaultWorld),
        streamFromWorld: homeRaid.raidKind === "theft" ? vectorTuple(homeRaid.vaultWorld) : undefined,
        streamToWorld: streamToWorld ? vectorTuple(streamToWorld) : undefined,
        actorWorld: actorWorld ? vectorTuple(actorWorld) : undefined,
        targetWorld: targetWorld ? vectorTuple(targetWorld) : undefined,
        actorPathWorld: actorWorld
          ? [vectorTuple(actorWorld), vectorTuple(homeRaid.thresholdWorld)]
          : undefined,
        targetPathWorld: targetWorld
          ? [vectorTuple(homeRaid.thresholdWorld), vectorTuple(targetWorld)]
          : undefined,
        actorVisible: currentActor ? isVisibleInHierarchy(currentActor) : false,
        targetVisible: currentTarget ? isVisibleInHierarchy(currentTarget) : false,
        durableHomePresent: Boolean(currentHomeWorld),
        persistentHomeCreated: false,
        durableHomeCreated: false,
        breachCue: true,
        thresholdGlow: true,
        thresholdLight: homeRaid.light.visible,
        crackCue: homeRaid.cracks.length > 0,
        vaultStream: homeRaid.raidKind === "theft" && homeRaid.motes.length > 0,
        goldMotes: homeRaid.motes.length,
        standingHomeCue: homeRaid.standingHomeAtStart,
        lowIntegrityHomeCue: homeRaid.lowIntegrityCue,
        bannerCue: Boolean(homeRaid.banner),
        pennantCue: Boolean(homeRaid.pennantMaterial),
        ownerFlipCue: homeRaid.raidKind === "colonize",
        evictionHints: homeRaid.evictionHints.length > 0,
        evictionHintCount: homeRaid.evictionHints.length,
        persistentOccupancy: false,
        actualActorMutated: false,
        durableHomeMutated: false,
        ownerStateMutated: false,
        stakeholderStateMutated: false,
        vaultStateMutated: false,
        inspectorMutated: false,
        selectionMutated: false,
      };
    }

    const homeLifecycle = effect.homeLifecycle;
    if (homeLifecycle) {
      const progress = clamp(effect.age / effect.duration, 0, 1);
      const currentHome = homeLifecycle.homeId ? this.entityObjects.get(`home:${homeLifecycle.homeId}`) : null;
      const currentHomeWorld = currentHome?.getWorldPosition(new THREE.Vector3()) ?? null;
      const currentHomeVisual = (currentHome?.userData as { visual?: HomeVisualState } | undefined)?.visual;
      const currentActor = homeLifecycle.actorId ? this.entityObjects.get(`agent:${homeLifecycle.actorId}`) : null;
      const actorWorld = currentActor?.getWorldPosition(new THREE.Vector3()) ?? homeLifecycle.actorWorld ?? null;
      const actorMidWorld = actorWorld ? actorWorld.clone().add(new THREE.Vector3(0, 1.15, 0)) : null;
      const kind = homeLifecycle.lifecycleKind;
      const isJoin = kind === "join";
      const isLeave = kind === "left";
      const isHoard = kind === "hoard";
      const isCollapse = kind === "collapse";
      const isScavenge = kind === "scavenge";
      return {
        kind: homeLifecycleDebugKind(kind),
        homeEventKind: kind,
        actorId: homeLifecycle.actorId,
        homeId: homeLifecycle.homeId,
        regionName: homeLifecycle.regionName,
        previousOwnerId: homeLifecycle.previousOwnerId,
        newOwnerId: homeLifecycle.newOwnerId,
        previousStakeholderIds: homeLifecycle.previousStakeholderIds,
        newStakeholderIds: homeLifecycle.stakeholderIds,
        stakeholderIds: homeLifecycle.stakeholderIds,
        vaultMaterials: homeLifecycle.vaultMaterials,
        remnantMaterials: homeLifecycle.remnantMaterials,
        agentMaterials: homeLifecycle.agentMaterials,
        resourceType: homeLifecycle.resourceType,
        amount: homeLifecycle.amount,
        phase: homeLifecyclePhase(kind, progress),
        progress: Number(progress.toFixed(3)),
        motionCue: homeLifecycleMotionCue(kind),
        motionMode: this.motionDebug.mode,
        streamDirection: homeLifecycle.streamDirection,
        anchorSource: homeLifecycle.anchorSource,
        anchorMode: homeLifecycle.anchorSource,
        homeAnchored: currentHomeWorld
          ? currentHomeWorld.distanceTo(homeLifecycle.homeWorld) < 0.05
          : false,
        homeWorld: vectorTuple(homeLifecycle.homeWorld),
        thresholdWorld: vectorTuple(homeLifecycle.thresholdWorld),
        vaultWorld: vectorTuple(homeLifecycle.vaultWorld),
        streamFromWorld: homeLifecycle.streamStartWorld ? vectorTuple(homeLifecycle.streamStartWorld) : undefined,
        streamToWorld: homeLifecycle.streamEndWorld ? vectorTuple(homeLifecycle.streamEndWorld) : undefined,
        actorWorld: actorWorld ? vectorTuple(actorWorld) : undefined,
        actorPathWorld: actorMidWorld && (isJoin || isLeave)
          ? isJoin
            ? [vectorTuple(actorMidWorld), vectorTuple(homeLifecycle.thresholdWorld)]
            : [vectorTuple(homeLifecycle.thresholdWorld), vectorTuple(actorMidWorld)]
          : undefined,
        actorVisible: currentActor ? isVisibleInHierarchy(currentActor) : false,
        durableHomePresent: Boolean(currentHomeWorld),
        durableHomeCreated: false,
        persistentHomeCreated: false,
        membershipCue: isJoin || isLeave,
        pledgeCue: isJoin,
        departureCue: isLeave,
        growthPreview: isJoin && Boolean(homeLifecycle.previewGroup),
        shrinkPreview: isLeave,
        vaultShimmer: isHoard,
        hoardThresholdCue: isHoard,
        vaultStream: isHoard && homeLifecycle.motes.length > 0,
        goldMotes: homeLifecycle.motes.length,
        collapseCue: isCollapse,
        ruinPreview: isCollapse && Boolean(homeLifecycle.previewGroup),
        remnantStream: isScavenge && homeLifecycle.motes.length > 0,
        scavengeStream: isScavenge && homeLifecycle.motes.length > 0,
        standingHomeCue: homeLifecycle.standingHomeAtStart,
        persistentOccupancy: false,
        actualActorMutated: false,
        durableHomeMutated: false,
        homeStateMutated: false,
        ruinStateMutated: false,
        remnantStateMutated: false,
        ownerStateMutated: false,
        stakeholderStateMutated: false,
        vaultStateMutated: false,
        inspectorMutated: false,
        selectionMutated: false,
        ...(currentHomeVisual ? { lowIntegrityHomeCue: !currentHomeVisual.ruined && currentHomeVisual.health < 0.35 } : {}),
      };
    }

    const resourceHarvest = effect.resourceHarvest;
    if (resourceHarvest) {
      const progress = clamp(effect.age / effect.duration, 0, 1);
      const currentActor = resourceHarvest.actorId ? this.entityObjects.get(`agent:${resourceHarvest.actorId}`) : null;
      const actorWorld = currentActor?.getWorldPosition(new THREE.Vector3()) ?? resourceHarvest.streamEndWorld;
      return {
        kind: "resource-harvest",
        actorId: resourceHarvest.actorId,
        regionName: resourceHarvest.regionName,
        resourceType: resourceHarvest.resourceType,
        amount: resourceHarvest.amount,
        phase: progress < 0.35 ? "land-release" : progress < 0.8 ? "stream-to-being" : "settle",
        progress: Number(progress.toFixed(3)),
        motionCue: "land-to-being-resource-stream",
        streamDirection: "region-to-actor",
        streamFromWorld: vectorTuple(resourceHarvest.streamStartWorld),
        streamToWorld: vectorTuple(resourceHarvest.streamEndWorld),
        actorWorld: actorWorld ? vectorTuple(actorWorld) : undefined,
        resourceStream: resourceHarvest.motes.length > 0,
        resourceMotes: resourceHarvest.motes.length,
        regionEnergyRatio: resourceHarvest.regionEnergyRatio,
        regionMaterialRatio: resourceHarvest.regionMaterialRatio,
        actorVisible: currentActor ? isVisibleInHierarchy(currentActor) : false,
        actualActorMutated: false,
        regionStateMutated: false,
        inspectorMutated: false,
        selectionMutated: false,
      };
    }

    const recoveryRelight = effect.recoveryRelight;
    if (recoveryRelight) {
      const progress = clamp(effect.age / effect.duration, 0, 1);
      const currentActor = recoveryRelight.actorId ? this.entityObjects.get(`agent:${recoveryRelight.actorId}`) : null;
      const currentTarget = recoveryRelight.targetId ? this.entityObjects.get(`agent:${recoveryRelight.targetId}`) : null;
      const actorWorld = currentActor?.getWorldPosition(new THREE.Vector3()) ?? recoveryRelight.actorWorld ?? null;
      const targetWorld = recoveryRelight.targetWorld;
      return {
        kind: "agent-recovered-relight",
        actorId: recoveryRelight.actorId,
        targetId: recoveryRelight.targetId,
        regionName: recoveryRelight.regionName,
        resourceType: recoveryRelight.resourceType,
        amount: recoveryRelight.amount,
        phase: progress < 0.3 ? "gift-in-flight" : progress < 0.72 ? "flame-catching" : "settle",
        progress: Number(progress.toFixed(3)),
        motionCue: "gift-relights-flame",
        streamDirection: "actor-to-target",
        streamFromWorld: recoveryRelight.actorWorld ? vectorTuple(recoveryRelight.actorWorld) : undefined,
        streamToWorld: vectorTuple(recoveryRelight.targetWorld),
        proxyFlameWorld: vectorTuple(
          recoveryRelight.proxyFlame.getWorldPosition(new THREE.Vector3()),
        ),
        relightLightWorld: vectorTuple(
          recoveryRelight.light.getWorldPosition(new THREE.Vector3()),
        ),
        actorWorld: actorWorld ? vectorTuple(actorWorld) : undefined,
        targetWorld: targetWorld ? vectorTuple(targetWorld) : undefined,
        actorVisible: currentActor ? isVisibleInHierarchy(currentActor) : false,
        targetVisible: currentTarget ? isVisibleInHierarchy(currentTarget) : false,
        sourceFlameLevel: recoveryRelight.sourceFlameLevel,
        targetFlameLevel: recoveryRelight.targetFlameLevel,
        relightCue: true,
        resourceStream: recoveryRelight.motes.length > 0,
        resourceMotes: recoveryRelight.motes.length,
        actualActorMutated: false,
        targetStateMutated: false,
        inspectorMutated: false,
        selectionMutated: false,
      };
    }

    const lifeTransition = effect.lifeTransition;
    if (lifeTransition) {
      const progress = clamp(effect.age / effect.duration, 0, 1);
      const currentActor = lifeTransition.actorId ? this.entityObjects.get(`agent:${lifeTransition.actorId}`) : null;
      const currentTarget = lifeTransition.targetId ? this.entityObjects.get(`agent:${lifeTransition.targetId}`) : null;
      const actorWorld = currentActor?.getWorldPosition(new THREE.Vector3()) ?? lifeTransition.actorWorld ?? null;
      const targetWorld = currentTarget?.getWorldPosition(new THREE.Vector3()) ?? lifeTransition.targetWorld ?? null;
      const transitionKind = lifeTransition.transitionKind;
      return {
        kind: "life-transition",
        lifeEventKind: transitionKind,
        actorId: lifeTransition.actorId,
        targetId: lifeTransition.targetId,
        regionName: lifeTransition.regionName,
        trigger: lifeTransition.trigger,
        energy: lifeTransition.energy,
        diedAt: lifeTransition.diedAt,
        decayedAt: lifeTransition.decayedAt,
        phase: lifeTransitionPhase(transitionKind, progress),
        progress: Number(progress.toFixed(3)),
        motionCue: lifeTransitionMotionCue(transitionKind),
        actorWorld: actorWorld ? vectorTuple(actorWorld) : undefined,
        targetWorld: targetWorld ? vectorTuple(targetWorld) : undefined,
        thresholdWorld: vectorTuple(lifeTransition.anchorWorld),
        actorVisible: currentActor ? isVisibleInHierarchy(currentActor) : false,
        targetVisible: currentTarget ? isVisibleInHierarchy(currentTarget) : false,
        flameState: lifeTransition.flameState,
        flameDropCue: true,
        paralysisCue: transitionKind === "paralyzed",
        deathCue: transitionKind === "died",
        decayCue: transitionKind === "decayed",
        bodyDissolveCue: transitionKind === "decayed",
        durableAgentMutated: false,
        actualActorMutated: false,
        targetStateMutated: false,
        regionStateMutated: false,
        inspectorMutated: false,
        selectionMutated: false,
      };
    }

    const bondLifecycle = effect.bondLifecycle;
    if (bondLifecycle) {
      const progress = clamp(effect.age / effect.duration, 0, 1);
      const currentActor = bondLifecycle.actorId ? this.entityObjects.get(`agent:${bondLifecycle.actorId}`) : null;
      const currentTarget = bondLifecycle.targetId ? this.entityObjects.get(`agent:${bondLifecycle.targetId}`) : null;
      const currentChild = bondLifecycle.childId ? this.entityObjects.get(`agent:${bondLifecycle.childId}`) : null;
      const actorWorld = bondLifecycle.actorId
        ? this.anchorForAgent(bondLifecycle.actorId) ?? bondLifecycle.actorWorld ?? null
        : bondLifecycle.actorWorld ?? null;
      const targetWorld = bondLifecycle.targetId
        ? this.anchorForAgent(bondLifecycle.targetId) ?? bondLifecycle.targetWorld ?? null
        : bondLifecycle.targetWorld ?? null;
      const childWorld = bondLifecycle.childId
        ? this.anchorForAgent(bondLifecycle.childId) ?? bondLifecycle.childWorld ?? null
        : bondLifecycle.childWorld ?? null;
      const parentWorlds = bondLifecycle.parentIds
        .map((parentId, index) => this.anchorForAgent(parentId) ?? bondLifecycle.parentWorlds[index])
        .filter((point): point is THREE.Vector3 => Boolean(point));
      const streamPoints = bondLifecycle.motes[0]?.points;
      return {
        kind: "bond-lifecycle",
        bondEventKind: bondLifecycle.bondEventKind,
        actorId: bondLifecycle.actorId,
        targetId: bondLifecycle.targetId,
        participantIds: bondLifecycle.participantIds,
        initiatorId: bondLifecycle.initiatorId,
        rejecterId: bondLifecycle.rejecterId,
        acceptorId: bondLifecycle.acceptorId,
        childId: bondLifecycle.childId,
        parentIds: bondLifecycle.parentIds,
        regionName: bondLifecycle.regionName,
        phase: bondLifecyclePhase(bondLifecycle.bondEventKind, progress),
        progress: Number(progress.toFixed(3)),
        motionCue: bondLifecycleMotionCue(bondLifecycle.bondEventKind),
        streamDirection: bondLifecycleStreamDirection(bondLifecycle.bondEventKind),
        relationshipThreadCue: bondLifecycle.relationshipThreadCue,
        relationshipThreadWorld: bondLifecycle.relationshipThreadWorld.map((point) => vectorTuple(point)),
        streamFromWorld: streamPoints?.[0] ? vectorTuple(streamPoints[0]) : undefined,
        streamToWorld: streamPoints?.[streamPoints.length - 1]
          ? vectorTuple(streamPoints[streamPoints.length - 1])
          : undefined,
        actorWorld: actorWorld ? vectorTuple(actorWorld) : undefined,
        targetWorld: targetWorld ? vectorTuple(targetWorld) : undefined,
        childWorld: childWorld ? vectorTuple(childWorld) : undefined,
        parentWorlds: parentWorlds.length > 0 ? parentWorlds.map((point) => vectorTuple(point)) : undefined,
        actorVisible: currentActor ? isVisibleInHierarchy(currentActor) : false,
        targetVisible: currentTarget ? isVisibleInHierarchy(currentTarget) : false,
        childVisible: currentChild ? isVisibleInHierarchy(currentChild) : false,
        offerCue: bondLifecycle.bondEventKind === "initiated",
        declineCue: bondLifecycle.bondEventKind === "rejected",
        refundCue: bondLifecycle.bondEventKind === "rejected" ||
          bondLifecycle.bondEventKind === "invalidated" ||
          bondLifecycle.bondEventKind === "timeout",
        lapsedCue: bondLifecycle.bondEventKind === "timeout",
        brokenCue: bondLifecycle.bondEventKind === "invalidated",
        birthCue: bondLifecycle.bondEventKind === "birth",
        resourceStream: bondLifecycle.motes.length > 0,
        resourceMotes: bondLifecycle.motes.length,
        actualActorMutated: false,
        targetStateMutated: false,
        regionStateMutated: false,
        durableChildCreated: false,
        inspectorMutated: false,
        selectionMutated: false,
      };
    }

    const shelter = effect.shelter;
    if (!shelter) {
      return undefined;
    }
    const progress = clamp(effect.age / effect.duration, 0, 1);
    const currentHome = this.entityObjects.get(`home:${shelter.homeId}`);
    const currentHomeWorld = currentHome?.getWorldPosition(new THREE.Vector3()) ?? null;
    const currentActor = this.entityObjects.get(`agent:${shelter.actorId}`);
    const actorWorld = currentActor?.getWorldPosition(new THREE.Vector3()) ?? null;
    return {
      kind: "shelter-use",
      actorId: shelter.actorId,
      homeId: shelter.homeId,
      phase: shelterPhase(progress),
      progress: Number(progress.toFixed(3)),
      motionCue: shelter.motionMode === "reduced"
        ? "reduced-glow-smoke-shelter"
        : "actor-threshold-enter-exit",
      motionMode: shelter.motionMode,
      homeAnchored: currentHomeWorld
        ? currentHomeWorld.distanceTo(shelter.homeWorld) < 0.05
        : false,
      homeWorld: vectorTuple(shelter.homeWorld),
      thresholdWorld: vectorTuple(shelter.thresholdMid),
      actorWorld: actorWorld ? vectorTuple(actorWorld) : undefined,
      actorVisible: currentActor ? isVisibleInHierarchy(currentActor) : false,
      proxyFigure: shelter.motionMode !== "reduced",
      thresholdGlow: true,
      thresholdSmoke: shelter.smoke.length > 0,
      thresholdLight: shelter.light.visible,
      doorCue: true,
      doorOpen: shelter.doorOpenAmount > 0.05,
      doorStatic: shelter.motionMode === "reduced",
      windowGlow: true,
      smokeRateCue: shelter.smoke.length > 0,
      reducedMotionShelterCue: shelter.motionMode === "reduced",
      thresholdTravel: shelter.motionMode !== "reduced",
      swallowCue: shelter.motionMode !== "reduced",
      proxyVisible: shelter.proxy.visible,
      proxyOpacity: Number(shelter.proxyOpacity.toFixed(3)),
      persistentOccupancy: false,
      actualActorMutated: false,
      homeStateMutated: false,
      inspectorMutated: false,
      selectionMutated: false,
    };
  }

  private clearEffects(): void {
    for (const effect of this.effects) {
      this.disposeEffect(effect);
    }
    this.effects.length = 0;
  }

  private registerEffect(effect: VisualEffect): void {
    if (this.isTourEffectDetail()) {
      effect.duration = Math.max(effect.bubble ? 1.75 : 1.1, effect.duration * 0.58);
    }
    this.effects.push(effect);
    this.newEffectCapture?.push(effect);
    if (effect.bubble) {
      this.activeBubbleEffects.add(effect);
    }
    if (this.effectRequiresWebGLRender(effect)) {
      this.invalidateFrame();
    }
    this.enforceEffectBudget();
  }

  private enforceEffectBudget(): void {
    const activeEffectLimit = this.activeEffectLimit();
    while (this.effects.length > activeEffectLimit) {
      const index = this.effectCullIndex();
      if (index < 0) {
        return;
      }
      const [effect] = this.effects.splice(index, 1);
      if (!effect) {
        return;
      }
      this.disposeEffect(effect);
      this.lifecycleCounters.culledEffectCount += 1;
    }
  }

  private enforceActiveBubbleLimit(): void {
    const activeBubbleEffects = this.activeBubbleEffects ?? new Set(
      this.effects.filter((effect) => Boolean(effect.bubble)),
    );
    const activeBubbleLimit = this.activeBubbleLimit ?? (() => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      return rect.width <= 700 || rect.height <= 420 ? 1 : 3;
    })();
    if (activeBubbleEffects.size <= activeBubbleLimit) {
      return;
    }
    const priorityRank: Readonly<Record<BubblePriority, number>> = {
      ambient: 0,
      featured: 1,
      drama: 2,
    };
    const retained = new Set<VisualEffect>(
      [...activeBubbleEffects]
        .filter((effect): effect is VisualEffect & { bubble: BubbleEffectState } => Boolean(effect.bubble))
        .sort((left, right) => (
          priorityRank[right.bubble.priority] - priorityRank[left.bubble.priority]
          || right.bubble.cursor - left.bubble.cursor
        ))
        .slice(0, activeBubbleLimit),
    );
    let culled = false;
    for (const effect of [...activeBubbleEffects]) {
      if (retained.has(effect)) {
        continue;
      }
      const index = this.effects.indexOf(effect);
      if (index < 0) {
        activeBubbleEffects.delete(effect);
        continue;
      }
      this.effects.splice(index, 1);
      this.disposeEffect(effect);
      this.lifecycleCounters.culledEffectCount += 1;
      culled = true;
    }
    if (culled) {
      this.bubbleLayoutSignature = "";
      this.invalidateFrame();
    }
  }

  private isTourEffectDetail(): boolean {
    return this.options.effectDetail === "tour";
  }

  private activeEffectLimit(): number {
    if (this.isTourEffectDetail()) {
      return 36;
    }
    return this.activeBubbleLimit === 1 ? 64 : MAX_ACTIVE_EFFECT_COUNT;
  }

  private activeEffectParticleLimit(): number {
    return this.isTourEffectDetail() ? 56 : MAX_ACTIVE_EFFECT_PARTICLE_COUNT;
  }

  private shouldRenderDefaultPulse(): boolean {
    return !this.isTourEffectDetail();
  }

  private shouldRenderDefaultArc(group: EffectGroup): boolean {
    if (!this.isTourEffectDetail()) {
      return true;
    }
    return false;
  }

  private shouldRenderSpecialEffects(): boolean {
    return !this.isTourEffectDetail();
  }

  private shouldRenderWebGLFrame(): boolean {
    return !this.isTourEffectDetail() ||
      this.needsWebGLRender ||
      this.selectionRing.visible ||
      this.focus.t < 1 ||
      this.effects.some((effect) => this.effectRequiresWebGLRender(effect));
  }

  private effectRequiresWebGLRender(effect: VisualEffect): boolean {
    return !effect.bubble ||
      effect.materials.length > 0 ||
      Boolean(effect.travel) ||
      Boolean(effect.homeBuild) ||
      Boolean(effect.shelter) ||
      Boolean(effect.homeRaid) ||
      Boolean(effect.homeLifecycle) ||
      Boolean(effect.resourceHarvest) ||
      Boolean(effect.recoveryRelight) ||
      Boolean(effect.bondLifecycle) ||
      Boolean(effect.lifeTransition);
  }

  private effectCullIndex(): number {
    const decorativeIndex = this.effects.findIndex((effect) => !effect.bubble && !effect.homeBuild && !effect.shelter);
    if (decorativeIndex >= 0) {
      return decorativeIndex;
    }
    const bubbleIndex = this.effects.findIndex((effect) => effect.bubble);
    if (bubbleIndex >= 0) {
      return bubbleIndex;
    }
    return this.effects.length > 0 ? 0 : -1;
  }

  private clearPendingProposalVisuals(): void {
    for (const visual of this.pendingProposalVisuals) {
      this.proposalRoot.remove(visual.root);
      let geometryCount = 0;
      visual.root.traverse((object: THREE.Object3D) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          geometryCount += 1;
        }
      });
      for (const material of visual.materials) {
        material.dispose();
      }
      this.lifecycleCounters.disposedProposalGeometryCount += geometryCount;
      this.lifecycleCounters.disposedProposalMaterialCount += visual.materials.length;
    }
    this.pendingProposalVisuals.length = 0;
  }

  private disposeEffect(effect: VisualEffect): void {
    this.activeBubbleEffects.delete(effect);
    this.effectRoot.remove(effect.root);
    let geometryCount = 0;
    effect.root.traverse((object: THREE.Object3D) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        geometryCount += 1;
      }
      if (object instanceof CSS2DObject) {
        object.element.remove();
      }
    });
    for (const material of effect.materials) {
      material.dispose();
    }
    this.lifecycleCounters.disposedEffectGeometryCount += geometryCount;
    this.lifecycleCounters.disposedEffectMaterialCount += effect.materials.length;
  }
}

const EFFECT_COLORS = {
  movement: "#6fc7bd",
  speech: "#6fc7bd",
  thought: "#d6b96f",
  resource: "#8fac6d",
  material: "#d6b96f",
  bond: "#d9a8bd",
  combat: "#c74f45",
  home: "#d6b96f",
  contest: "#d96e3f",
  life: "#f0c66f",
  system: "#ede4d2",
};

function reducedMotionQueryFor(option: WorldRendererOptions["reducedMotion"]): MediaQueryList | null {
  if (option !== undefined && option !== "auto") {
    return null;
  }
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
}

function resolveMotionDebug(
  option: WorldRendererOptions["reducedMotion"],
  query: MediaQueryList | null,
): MotionDebugState {
  if (typeof option === "boolean") {
    return {
      mode: option ? "reduced" : "full",
      reduced: option,
      source: "option",
    };
  }
  if (query?.matches) {
    return {
      mode: "reduced",
      reduced: true,
      source: "media",
    };
  }
  return {
    mode: "full",
    reduced: false,
    source: "default",
  };
}

function motionSettingsFor(debug: MotionDebugState): MotionSettings {
  return debug.reduced ? REDUCED_MOTION_SETTINGS : FULL_MOTION_SETTINGS;
}

function bubbleAnchorRole(
  anchors: Record<AnchorRole, THREE.Vector3 | null>,
  primary: THREE.Vector3,
): AnchorRole | "primary" {
  for (const role of ["actor", "home", "target", "region", "toRegion", "fromRegion"] as const) {
    if (anchors[role] === primary) {
      return role;
    }
  }
  return "primary";
}

function visualSpecFor(entry: EventEnvelopeEntry): EventVisualSpec {
  const { event, resolved } = entry;
  const payload = event.payload;
  const actorId = resolvedString(resolved.actor_id) ?? sourceAgent(event.source);
  const targetId =
    resolvedString(resolved.target_id) ??
    nullableString(event.target) ??
    payloadString(payload, "target_id", "target", "receiver_id", "recipient_id", "revived_id", "victim_id", "acceptor_id");
  const regionName =
    resolvedString(resolved.region) ??
    nullableString(event.region) ??
    payloadString(payload, "region");
  const homeId =
    resolvedString(resolved.home_id) ??
    payloadString(payload, "home_id", "target_home");
  const amount =
    resolvedNumber(resolved.amount) ??
    payloadNumber(payload, "amount") ??
    payloadNestedNumber(payload, "loot", "materials");
  const resourceType =
    resolvedString(resolved.resource_type) ??
    payloadString(payload, "resource_type");
  const resourceColor = resourceType === "materials" ? EFFECT_COLORS.material : EFFECT_COLORS.resource;
  const message = shortLabel(payloadString(payload, "message"));

  const base: EventVisualSpec = {
    group: "system",
    actorId,
    targetId,
    homeId,
    regionName,
    resourceType,
    amount,
    label: eventTitle(event.type),
    bubbleClass: "viv-event-bubble-system",
    color: EFFECT_COLORS.system,
    pulseScale: 1,
  };

  switch (event.type) {
    case "agent_left_region":
      return {
        ...base,
        group: "movement",
        actorId: payloadString(payload, "agent_id") ?? actorId,
        regionName: payloadString(payload, "from_region") ?? regionName,
        fromRegionName: payloadString(payload, "from_region"),
        toRegionName: payloadString(payload, "to_region"),
        label: "left",
        bubbleClass: "viv-event-bubble-movement",
        color: EFFECT_COLORS.movement,
        pulseScale: 0.92,
        primaryAnchor: "region",
        pulseAnchor: "region",
        arc: { from: "fromRegion", to: "toRegion" },
      };
    case "agent_entered_region":
      return {
        ...base,
        group: "movement",
        actorId: payloadString(payload, "agent_id") ?? actorId,
        regionName: payloadString(payload, "to_region") ?? regionName,
        fromRegionName: payloadString(payload, "from_region"),
        toRegionName: payloadString(payload, "to_region"),
        label: "arrived",
        bubbleClass: "viv-event-bubble-movement",
        color: EFFECT_COLORS.movement,
        pulseScale: 1.04,
        primaryAnchor: "toRegion",
        pulseAnchor: "toRegion",
        arc: { from: "fromRegion", to: "toRegion" },
      };
    case "speak": {
      return {
        ...base,
        group: "speech",
        actorId: payloadString(payload, "speaker_id") ?? actorId,
        targetId,
        label: message ?? "speaks",
        bubbleClass: "viv-event-bubble-speech",
        color: EFFECT_COLORS.speech,
        pulseScale: 1.05,
        arc: targetId ? { from: "actor", to: "target" } : undefined,
      };
    }
    case "self_talk":
      return {
        ...base,
        group: "speech",
        actorId: payloadString(payload, "agent_id") ?? actorId,
        label: message ?? "thinking",
        bubbleClass: "viv-event-bubble-thought",
        color: EFFECT_COLORS.thought,
        pulseScale: 0.88,
      };
    case "resource_changed":
      return {
        ...base,
        group: "resource",
        actorId: payloadString(payload, "agent_id") ?? actorId,
        label: amountLabel("+", amount, resourceType),
        bubbleClass: "viv-event-bubble-resource",
        color: resourceColor,
        pulseScale: 1.08,
        arc: { from: "region", to: "actor" },
      };
    case "resource_transferred":
      return {
        ...base,
        group: "resource",
        actorId: payloadString(payload, "sender_id") ?? actorId,
        targetId: payloadString(payload, "receiver_id", "recipient_id") ?? targetId,
        label: amountLabel("gives", amount, resourceType),
        bubbleClass: "viv-event-bubble-resource",
        color: resourceColor,
        pulseScale: 1,
        arc: { from: "actor", to: "target" },
      };
    case "agent_recovered":
      return {
        ...base,
        group: "life",
        actorId: payloadString(payload, "giver_id") ?? actorId,
        targetId: payloadString(payload, "revived_id", "recipient_id") ?? targetId,
        label: "recovered",
        bubbleClass: "viv-event-bubble-life",
        color: EFFECT_COLORS.speech,
        pulseScale: 1.18,
        primaryAnchor: "target",
        pulseAnchor: "target",
        arc: { from: "actor", to: "target" },
      };
    case "agent_paralyzed": {
      const affected = payloadString(payload, "agent_id", "victim_id") ?? targetId ?? actorId;
      const attacker = payloadString(payload, "attacker_id");
      return {
        ...base,
        group: "combat",
        actorId: attacker,
        targetId: affected,
        label: "paralyzed",
        bubbleClass: "viv-event-bubble-combat",
        color: EFFECT_COLORS.contest,
        pulseScale: 1.1,
        primaryAnchor: "target",
        pulseAnchor: "target",
        arc: attacker ? { from: "actor", to: "target" } : undefined,
        lifeTransitionKind: "paralyzed",
        trigger: payloadString(payload, "trigger"),
        energy: payloadNumber(payload, "energy", "victim_energy"),
      };
    }
    case "agent_started_hoarding":
      return {
        ...base,
        group: "resource",
        actorId: payloadString(payload, "agent_id") ?? actorId,
        energy: payloadNumber(payload, "energy"),
        agentMaterials: payloadNumber(payload, "materials"),
        label: "hoarding",
        bubbleClass: "viv-event-bubble-resource",
        color: EFFECT_COLORS.material,
        pulseScale: 1.12,
      };
    case "agent_born": {
      const childId = payloadString(payload, "child_id") ?? actorId;
      const parentIds = birthParentIds(payload, targetId);
      const initiatorId = payloadString(payload, "initiator_id") ?? parentIds[0];
      const acceptorId = payloadString(payload, "acceptor_id") ?? parentIds[1] ?? targetId;
      return {
        ...base,
        group: "life",
        actorId: childId,
        targetId: acceptorId ?? initiatorId ?? targetId,
        childId,
        parentIds,
        initiatorId,
        acceptorId,
        label: shortLabel(payloadString(payload, "child_name")) ?? "child born",
        bubbleClass: "viv-event-bubble-life",
        color: EFFECT_COLORS.life,
        pulseScale: 1.22,
        primaryAnchor: "region",
        pulseAnchor: "region",
      };
    }
    case "agent_died": {
      const killer = payloadString(payload, "killer_id", "killer") ?? actorId;
      const victim = payloadString(payload, "victim_id") ?? targetId ?? sourceAgent(event.source);
      return {
        ...base,
        group: "combat",
        actorId: killer,
        targetId: victim,
        label: `${shortLabel(payloadString(payload, "victim_name")) ?? "being"} died`,
        bubbleClass: "viv-event-bubble-combat",
        color: EFFECT_COLORS.combat,
        pulseScale: 1.28,
        primaryAnchor: "target",
        pulseAnchor: "target",
        arc: killer ? { from: "actor", to: "target" } : undefined,
        lifeTransitionKind: "died",
        diedAt: payloadNumber(payload, "died_at"),
      };
    }
    case "agent_decayed":
      return {
        ...base,
        group: "life",
        actorId: payloadString(payload, "agent_id") ?? actorId,
        targetId: payloadString(payload, "agent_id") ?? targetId,
        regionName: payloadString(payload, "region") ?? regionName,
        label: "returns to earth",
        bubbleClass: "viv-event-bubble-life",
        color: EFFECT_COLORS.life,
        pulseScale: 1.12,
        primaryAnchor: "region",
        pulseAnchor: "region",
        lifeTransitionKind: "decayed",
        diedAt: payloadNumber(payload, "died_at"),
        decayedAt: payloadNumber(payload, "decayed_at"),
      };
    case "mating_initiated": {
      const initiatorId = payloadString(payload, "initiator_id") ?? actorId;
      const proposalTargetId = payloadString(payload, "target_id", "acceptor_id") ?? targetId;
      return {
        ...base,
        group: "bond",
        actorId: initiatorId,
        targetId: proposalTargetId,
        initiatorId,
        label: "bond call",
        bubbleClass: "viv-event-bubble-bond",
        color: EFFECT_COLORS.bond,
        pulseScale: 1,
        arc: { from: "actor", to: "target" },
      };
    }
    case "mating_rejected": {
      const rejecterId = payloadString(payload, "rejecter_id") ?? actorId;
      const initiatorId = payloadString(payload, "initiator_id") ?? targetId;
      return {
        ...base,
        group: "bond",
        actorId: rejecterId,
        targetId: initiatorId ?? payloadString(payload, "target_id") ?? targetId,
        initiatorId,
        rejecterId,
        label: "bond refused",
        bubbleClass: "viv-event-bubble-bond",
        color: EFFECT_COLORS.thought,
        pulseScale: 0.9,
        arc: { from: "actor", to: "target" },
      };
    }
    case "mating_proposal_invalidated":
    case "mating_proposal_timeout": {
      const initiatorId = payloadString(payload, "initiator_id") ?? actorId;
      const proposalTargetId = payloadString(payload, "target_id", "acceptor_id") ?? targetId;
      return {
        ...base,
        group: "bond",
        actorId: initiatorId,
        targetId: proposalTargetId,
        initiatorId,
        label: event.type === "mating_proposal_timeout" ? "bond faded" : "bond broke",
        bubbleClass: "viv-event-bubble-bond",
        color: EFFECT_COLORS.thought,
        pulseScale: 0.86,
        arc: { from: "actor", to: "target" },
      };
    }
    case "attack":
      return {
        ...base,
        group: "combat",
        actorId: payloadString(payload, "attacker_id") ?? actorId,
        targetId: payloadString(payload, "victim_id") ?? targetId,
        label: "attack",
        bubbleClass: "viv-event-bubble-combat",
        color: EFFECT_COLORS.combat,
        pulseScale: 1.18,
        primaryAnchor: "target",
        pulseAnchor: "target",
        arc: { from: "actor", to: "target" },
      };
    case "home_built":
      return homeSpec(base, payload, {
        label: "home raised",
        group: "home",
        className: "viv-event-bubble-home",
        color: EFFECT_COLORS.home,
        actorKeys: ["builder_id", "owner_id"],
        scale: 1.22,
        suppressDefaultPulse: true,
      });
    case "hearth_used":
      return {
        ...homeSpec(base, payload, {
          label: "hearth",
          group: "home",
          className: "viv-event-bubble-home",
          color: EFFECT_COLORS.home,
          actorKeys: ["agent_id"],
          scale: 1.1,
          arc: true,
          suppressDefaultArc: true,
          suppressDefaultPulse: true,
        }),
        materialsBurned: payloadNumber(payload, "materials_burned"),
        energyGained: payloadNumber(payload, "energy_gained"),
        agentEnergy: payloadNumber(payload, "agent_energy"),
        agentMaterials: payloadNumber(payload, "agent_materials"),
      };
    case "home_joined":
      return {
        ...homeSpec(base, payload, {
        label: "home joined",
        group: "home",
        className: "viv-event-bubble-home",
        color: EFFECT_COLORS.speech,
        actorKeys: ["agent_id"],
        scale: 1.05,
        arc: true,
        }),
        newOwnerId: payloadString(payload, "owner_id"),
        newStakeholderIds: payloadStringArray(payload, "stakeholders"),
      };
    case "home_left":
      return {
        ...homeSpec(base, payload, {
        label: "home left",
        group: "home",
        className: "viv-event-bubble-home",
        color: EFFECT_COLORS.thought,
        actorKeys: ["agent_id"],
        scale: 0.95,
        arc: true,
        arcDirection: "homeToActor",
        }),
        previousOwnerId: payloadString(payload, "previous_owner_id"),
        newOwnerId: payloadString(payload, "owner_id"),
        previousStakeholderIds: payloadStringArray(payload, "previous_stakeholders"),
        newStakeholderIds: payloadStringArray(payload, "stakeholders"),
      };
    case "home_started_hoarding":
      return {
        ...homeSpec(base, payload, {
        label: "vault hoards",
        group: "home",
        className: "viv-event-bubble-home",
        color: EFFECT_COLORS.material,
        actorKeys: ["agent_id"],
        scale: 1.16,
        }),
        vaultMaterials: payloadNumber(payload, "vault_materials"),
      };
    case "home_collapsed":
      return {
        ...homeSpec(base, payload, {
        label: "home collapsed",
        group: "contest",
        className: "viv-event-bubble-contest",
        color: EFFECT_COLORS.contest,
        actorKeys: ["owner_id"],
        scale: 1.26,
        }),
        newOwnerId: payloadString(payload, "owner_id"),
        newStakeholderIds: payloadStringArray(payload, "stakeholders"),
        vaultMaterials: payloadNumber(payload, "vault_materials"),
        remnantMaterials: payloadNumber(payload, "remnant_materials"),
      };
    case "home_breached":
      return {
        ...homeSpec(base, payload, {
          label: "breached",
          group: "contest",
          className: "viv-event-bubble-contest",
          color: EFFECT_COLORS.contest,
          actorKeys: ["breacher_id"],
          scale: 1.2,
          arc: true,
        }),
        breachIntent: payloadString(payload, "intent"),
        breacherIds: payloadStringArray(payload, "breachers"),
        energyCost: payloadNumber(payload, "energy_cost"),
        materialsCost: payloadNumber(payload, "materials_cost"),
        integrityDamage: payloadNumber(payload, "integrity_damage"),
        integrity: payloadNumber(payload, "integrity"),
      };
    case "home_thieved": {
      const recipientIds = payloadStringArray(payload, "recipients", "recipient_ids") ?? payloadRecordKeys(payload, "loot_shares");
      const spec = homeSpec(base, payload, {
        label: amountLabel("loot", amount, "materials"),
        group: "contest",
        className: "viv-event-bubble-contest",
        color: EFFECT_COLORS.material,
        actorKeys: ["breacher_id"],
        scale: 1.12,
        arc: true,
        arcDirection: "homeToActor",
      });
      return {
        ...spec,
        targetId: payloadString(payload, "recipient_id", "receiver_id", "thief_id") ?? recipientIds[0] ?? spec.actorId,
        recipientIds,
        lootMaterials: amount,
      };
    }
    case "home_colonized": {
      const previousOwnerId = payloadString(payload, "previous_owner_id", "old_owner_id");
      return {
        ...homeSpec(base, payload, {
          label: "seized",
          group: "contest",
          className: "viv-event-bubble-contest",
          color: EFFECT_COLORS.combat,
          actorKeys: ["breacher_id", "new_owner_id"],
          scale: 1.18,
          arc: true,
        }),
        targetId: previousOwnerId ?? base.targetId,
        previousOwnerId,
        newOwnerId: payloadString(payload, "new_owner_id", "owner_id"),
        previousStakeholderIds: payloadStringArray(payload, "previous_stakeholders", "old_stakeholders"),
        newStakeholderIds: payloadStringArray(payload, "new_stakeholders", "stakeholders"),
      };
    }
    case "ruins_scavenged":
      return {
        ...homeSpec(base, payload, {
        label: amountLabel("scavenge", amount, "materials"),
        group: "contest",
        className: "viv-event-bubble-contest",
        color: EFFECT_COLORS.material,
        actorKeys: ["agent_id"],
        scale: 1.06,
        arc: true,
        arcDirection: "homeToActor",
        }),
        resourceType,
        amount,
        remnantMaterials: payloadNumber(payload, "remnant_materials"),
        agentMaterials: payloadNumber(payload, "agent_materials"),
      };
    case "simulation_started":
      return {
        ...base,
        label: "world wakes",
        bubbleClass: "viv-event-bubble-system",
        color: EFFECT_COLORS.system,
        pulseScale: 1.2,
        primaryAnchor: "region",
        pulseAnchor: "region",
      };
    default:
      return base;
  }
}

function bubblePriorityFor(eventType: string, group: EffectGroup): BubblePriority {
  if (DRAMA_BUBBLE_EVENTS.has(eventType) || group === "combat" || group === "contest") {
    return "drama";
  }
  if (FEATURED_BUBBLE_EVENTS.has(eventType) || group === "speech" || group === "bond" || group === "life") {
    return "featured";
  }
  return "ambient";
}

function strongestBubblePriority(
  catalogPriority: BubblePriority,
  fallbackPriority: BubblePriority,
): BubblePriority {
  return bubblePriorityRank(catalogPriority) >= bubblePriorityRank(fallbackPriority)
    ? catalogPriority
    : fallbackPriority;
}

function bubblePriorityRank(priority: BubblePriority): number {
  switch (priority) {
    case "drama":
      return 3;
    case "featured":
      return 2;
    case "ambient":
      return 1;
  }
}

function bubbleArrivalVisualState(
  progress: number,
  priority: BubblePriority,
  motionMode: MotionMode,
): {
  phase: BubbleArrivalPhase;
  progress: number;
  opacity: number;
  scale: number;
  glowPercent: number;
} {
  const t = clamp(progress, 0, 1);
  const phase: BubbleArrivalPhase = t < 0.18
    ? "arriving"
    : t >= 0.78
      ? "fading"
      : "held";
  const enter = sstep(0, 0.18, t);
  const exit = sstep(0.78, 1, t);
  const opacity = clamp((0.72 + enter * 0.28) * (1 - exit), 0, 1);
  const priorityBoost = priority === "drama" ? 14 : priority === "featured" ? 8 : 4;
  const arrivalBoost = (1 - enter) * (motionMode === "reduced" ? 0 : 7);
  return {
    phase,
    progress: t,
    opacity,
    scale: motionMode === "reduced" ? 1 : 0.98 + enter * 0.02 - exit * 0.015,
    glowPercent: priority === "drama" ? 42 + arrivalBoost : 24 + priorityBoost + arrivalBoost,
  };
}

function applyBubbleArrivalVisualState(
  element: HTMLElement,
  state: ReturnType<typeof bubbleArrivalVisualState>,
): void {
  element.dataset.eventArrivalPhase = state.phase;
  element.dataset.eventArrivalProgress = formatBubbleArrivalNumber(state.progress);
  element.dataset.eventArrivalOpacity = formatBubbleArrivalNumber(state.opacity);
  element.style.setProperty("--bubble-arrival-scale", formatBubbleArrivalNumber(state.scale));
  element.style.setProperty("--bubble-arrival-glow", `${formatBubbleArrivalNumber(state.glowPercent)}%`);
}

function formatBubbleArrivalNumber(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function fallbackEventGlyph(eventType: string): string {
  const glyph = eventType
    .split("_")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return glyph || "EV";
}

function bubbleViewportLaneOffsets(
  screen: { x: number; y: number },
  viewport: { left: number; right: number; top: number; bottom: number },
  compact: boolean,
  dimensions?: { width: number; height: number },
): Array<{ x: number; y: number }> {
  const width = dimensions?.width ?? (compact ? BUBBLE_ESTIMATED_WIDTH_COMPACT : BUBBLE_ESTIMATED_WIDTH);
  const height = dimensions?.height ?? (compact ? BUBBLE_ESTIMATED_HEIGHT_COMPACT : BUBBLE_ESTIMATED_HEIGHT);
  const columns = 4;
  const rows = compact ? 9 : 7;
  const left = viewport.left + width / 2;
  const right = viewport.right - width / 2;
  const top = viewport.top + height * 1.12;
  const bottom = viewport.bottom + height * 0.08;
  return Array.from({ length: rows }, (_, row) => (
    Array.from({ length: columns }, (__, column) => ({
      x: left + ((right - left) * column) / Math.max(1, columns - 1) - screen.x,
      y: top + ((bottom - top) * row) / Math.max(1, rows - 1) - screen.y,
    }))
  )).flat();
}

function bubbleRectFits(
  rect: { left: number; right: number; top: number; bottom: number },
  viewport: { left: number; right: number; top: number; bottom: number },
  blockers: Array<{ left: number; right: number; top: number; bottom: number }>,
): boolean {
  return rect.left >= viewport.left
    && rect.right <= viewport.right
    && rect.top >= viewport.top
    && rect.bottom <= viewport.bottom
    && blockers.every((blocker) => rectOverlapArea(rect, blocker) === 0);
}

function packedBubbleOffset(
  origin: { left: number; right: number; top: number; bottom: number },
  viewport: { left: number; right: number; top: number; bottom: number },
  blockers: Array<{ left: number; right: number; top: number; bottom: number }>,
): { index: number; offsetX: number; offsetY: number } | null {
  const width = origin.right - origin.left;
  const height = origin.bottom - origin.top;
  const horizontal = uniqueSortedNumbers([
    viewport.left,
    ...blockers.flatMap((blocker) => [
      blocker.right + BUBBLE_COLLISION_GAP,
      blocker.left - width - BUBBLE_COLLISION_GAP,
    ]),
  ]).slice(0, MAX_ACTIVE_EFFECT_COUNT * 2 + 1);
  const vertical = uniqueSortedNumbers([
    viewport.top,
    ...blockers.flatMap((blocker) => [
      blocker.bottom + BUBBLE_COLLISION_GAP,
      blocker.top - height - BUBBLE_COLLISION_GAP,
    ]),
  ]).slice(0, MAX_ACTIVE_EFFECT_COUNT * 2 + 1);
  let best: { index: number; offsetX: number; offsetY: number; distance: number } | null = null;
  let index = 0;
  for (const top of vertical) {
    for (const left of horizontal) {
      const rect = { left, right: left + width, top, bottom: top + height };
      const distance = (left - origin.left) ** 2 + (top - origin.top) ** 2;
      if (
        bubbleRectFits(rect, viewport, blockers)
        && (!best || distance < best.distance)
      ) {
        best = {
          index,
          offsetX: left - origin.left,
          offsetY: top - origin.top,
          distance,
        };
      }
      index += 1;
    }
  }
  return best;
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value * 100) / 100))]
    .sort((left, right) => left - right);
}

function bubbleEstimatedRect(
  screen: { x: number; y: number },
  offsetX: number,
  offsetY: number,
  compact: boolean,
  dimensions?: { width: number; height: number },
): { left: number; right: number; top: number; bottom: number } {
  const width = dimensions?.width ?? (compact ? BUBBLE_ESTIMATED_WIDTH_COMPACT : BUBBLE_ESTIMATED_WIDTH);
  const height = dimensions?.height ?? (compact ? BUBBLE_ESTIMATED_HEIGHT_COMPACT : BUBBLE_ESTIMATED_HEIGHT);
  const left = screen.x - width / 2 + offsetX;
  const top = screen.y - height * 1.12 + offsetY;
  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
  };
}

function bubbleLaneScore(
  rect: { left: number; right: number; top: number; bottom: number },
  occupiedRects: Array<{ left: number; right: number; top: number; bottom: number }>,
  sameClusterLaneCount: number,
  viewport: { left: number; right: number; top: number; bottom: number },
): number {
  const overlapArea = occupiedRects.reduce((total, occupied) => total + rectOverlapArea(rect, occupied), 0);
  const overflow =
    Math.max(0, viewport.left - rect.left) +
    Math.max(0, rect.right - viewport.right) +
    Math.max(0, viewport.top - rect.top) +
    Math.max(0, rect.bottom - viewport.bottom);
  return overlapArea * 100 + sameClusterLaneCount * 1000 + overflow * 10000;
}

function rectOverlapArea(
  left: { left: number; right: number; top: number; bottom: number },
  right: { left: number; right: number; top: number; bottom: number },
): number {
  const width = Math.min(left.right, right.right) - Math.max(left.left, right.left) + BUBBLE_COLLISION_GAP;
  const height = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) + BUBBLE_COLLISION_GAP;
  return width > 0 && height > 0 ? width * height : 0;
}

function homeSpec(
  base: EventVisualSpec,
  payload: Record<string, unknown>,
  options: {
    label: string;
    group: EffectGroup;
    className: string;
    color: string;
    actorKeys: string[];
    scale: number;
    arc?: boolean;
    arcDirection?: "actorToHome" | "homeToActor";
    suppressDefaultArc?: boolean;
    suppressDefaultPulse?: boolean;
  },
): EventVisualSpec {
  return {
    ...base,
    group: options.group,
    actorId: payloadString(payload, ...options.actorKeys) ?? base.actorId,
    homeId: payloadString(payload, "home_id", "target_home") ?? base.homeId,
    regionName: payloadString(payload, "region") ?? base.regionName,
    label: options.label,
    bubbleClass: options.className,
    color: options.color,
    pulseScale: options.scale,
    suppressDefaultArc: options.suppressDefaultArc,
    suppressDefaultPulse: options.suppressDefaultPulse,
    primaryAnchor: "home",
    pulseAnchor: "home",
    arc: options.arc
      ? options.arcDirection === "homeToActor"
        ? { from: "home", to: "actor" }
        : { from: "actor", to: "home" }
      : undefined,
  };
}

function resolvedString(value: string | number | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resolvedNumber(value: string | number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function payloadString(payload: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function payloadStringArray(payload: Record<string, unknown>, ...keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      const strings = value.filter((item): item is string => typeof item === "string" && item.length > 0);
      if (strings.length > 0) {
        return strings;
      }
    }
  }
  return undefined;
}

function payloadRecordKeys(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value).filter((item) => item.length > 0);
}

function birthParentIds(payload: Record<string, unknown>, fallbackTargetId: string | undefined): string[] {
  const structured = payloadStringArray(payload, "parent_ids");
  if (structured) {
    return structured;
  }
  const keyed = uniqueStrings([
    payloadString(payload, "initiator_id"),
    payloadString(payload, "acceptor_id"),
    fallbackTargetId,
  ]);
  if (keyed.length > 0) {
    return keyed;
  }
  const message = payloadString(payload, "message");
  if (!message) {
    return [];
  }
  const parentText = message.includes("Mated by")
    ? message.slice(message.indexOf("Mated by"))
    : message;
  return uniqueStrings(
    [...parentText.matchAll(/Agent ID:([A-Za-z0-9_-]+)/g)].map((match) => match[1]),
  ).slice(0, 2);
}

function uniqueStrings(values: Iterable<string | undefined | null>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (value) {
      seen.add(value);
    }
  }
  return [...seen];
}

function payloadNumber(payload: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function payloadNestedNumber(payload: Record<string, unknown>, key: string, nestedKey: string): number | undefined {
  const value = payload[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const nested = (value as Record<string, unknown>)[nestedKey];
  return typeof nested === "number" && Number.isFinite(nested) ? nested : undefined;
}

function nullableString(value: string | null): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function sourceAgent(source: string): string | undefined {
  return source && source !== "system" && source !== "world" ? source : undefined;
}

function shortLabel(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const cleaned = cleanVisibleText(value);
  return cleaned.length > 58 ? `${cleaned.slice(0, 55).trim()}...` : cleaned;
}

function amountLabel(verb: string, amount: number | undefined, resourceType: string | undefined): string {
  const resource = resourceType ?? "resources";
  if (amount === undefined) {
    return verb === "+" ? `+ ${resource}` : `${verb} ${resource}`;
  }
  const rounded = Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1);
  return verb === "+" ? `+${rounded} ${resource}` : `${verb} ${rounded} ${resource}`;
}

function eventTitle(type: string): string {
  return cleanVisibleText(
    type
      .split("_")
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(" "),
  );
}

export function worldTopologySignature(regions: readonly RegionSnapshot[]): string {
  return JSON.stringify(
    [...regions]
      .sort((left, right) => lexicalCompare(left.name, right.name))
      .map((region) => ({
        name: region.name,
        description: region.description,
        connections: [...region.connections].sort(lexicalCompare),
        energyRate: region.energy_rate,
        materialsRate: region.materials_rate,
        maxEnergy: region.max_energy,
        maxMaterials: region.max_materials,
      })),
  );
}

export type SceneryClearanceKind = "agent" | "home" | "ruin";

export interface SceneryDynamicClearanceEntry extends SceneryDynamicClearance {
  kind: SceneryClearanceKind;
  id: string;
  regionName: string;
}

const SCENERY_CLEARANCE_RADIUS: Readonly<Record<SceneryClearanceKind, number>> = {
  agent: 3.2,
  home: 4,
  ruin: 3.4,
};

/** Derive stable world-space clearings for durable rendered entities without changing scenery identity. */
export function sceneryDynamicClearings(
  snapshot: WorldSnapshot | null,
  layouts: readonly AtlasRegionLayout[],
): SceneryDynamicClearanceEntry[] {
  if (!snapshot) {
    return [];
  }
  const layoutsById = new Map(layouts.map((layout) => [layout.id, layout]));
  const clearings: SceneryDynamicClearanceEntry[] = [];
  const add = (
    kind: SceneryClearanceKind,
    id: string,
    regionName: string,
    offset: readonly [number, number],
  ): void => {
    const layout = layoutsById.get(regionName);
    if (!layout) {
      return;
    }
    clearings.push({
      kind,
      id,
      regionName,
      x: layout.x + offset[0],
      z: layout.z + offset[1],
      radius: SCENERY_CLEARANCE_RADIUS[kind],
    });
  };
  for (const agent of snapshot.agents) {
    const layout = layoutsById.get(agent.position);
    if (layout) {
      add(
        "agent",
        agent.id,
        agent.position,
        agentPlacementOffset(agent.id, layout.radius),
      );
    }
  }
  for (const home of snapshot.homes) {
    const layout = layoutsById.get(home.region);
    if (layout) {
      add(
        "home",
        home.home_id,
        home.region,
        homePlacementOffset(home.home_id, layout.radius),
      );
    }
  }
  for (const ruin of snapshot.ruins) {
    const layout = layoutsById.get(ruin.region);
    if (layout) {
      add(
        "ruin",
        ruin.home_id,
        ruin.region,
        homePlacementOffset(ruin.home_id, layout.radius),
      );
    }
  }
  const kindOrder: Readonly<Record<SceneryClearanceKind, number>> = {
    agent: 0,
    home: 1,
    ruin: 2,
  };
  return clearings.sort((left, right) => (
    kindOrder[left.kind] - kindOrder[right.kind]
    || lexicalCompare(left.id, right.id)
    || lexicalCompare(left.regionName, right.regionName)
  ));
}

/** Hash only topology and durable recipe identity, excluding live resource ratios. */
export function worldSceneryRecipeHash(
  regions: readonly RegionSnapshot[],
  quality: SceneryQuality = "full",
): string {
  return JSON.stringify({
    version: REGION_VISUAL_RECIPE_VERSION,
    quality,
    topology: JSON.parse(worldTopologySignature(regions)) as unknown,
    recipes: [...regions]
      .map(deriveRegionVisualRecipe)
      .sort((left, right) => lexicalCompare(left.regionId, right.regionId))
      .map((recipe) => ({
        version: recipe.version,
        regionId: recipe.regionId,
        visualSeed: recipe.visualSeed,
        archetype: recipe.archetype,
        identity: recipe.identity,
        potential: recipe.potential,
      })),
  });
}

function lexicalCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function worldResourceSignature(regions: readonly RegionSnapshot[]): string {
  return JSON.stringify(regions.map((region) => ({
    name: region.name,
    currentEnergy: region.current_energy,
    currentMaterials: region.current_materials,
  })));
}

function worldEntitySignature(snapshot: WorldSnapshot | null): string {
  if (!snapshot) {
    return "null";
  }
  return JSON.stringify({
    agents: snapshot.agents.slice().sort((left, right) => left.id.localeCompare(right.id)),
    homes: snapshot.homes.slice().sort((left, right) => left.home_id.localeCompare(right.home_id)),
    ruins: snapshot.ruins.slice().sort((left, right) => left.home_id.localeCompare(right.home_id)),
  });
}

function worldProposalSignature(snapshot: WorldSnapshot | null): string {
  if (!snapshot) {
    return "null";
  }
  const proposals = snapshot.pending_proposals.slice().sort((left, right) => {
    const initiator = left.initiator_id.localeCompare(right.initiator_id);
    return initiator !== 0 ? initiator : left.target_id.localeCompare(right.target_id);
  });
  return JSON.stringify({
    worldTime: proposals.length > 0 ? snapshot.world_time : null,
    proposals: proposals.map((proposal) => ({
      ...proposal,
      resources: Object.fromEntries(
        Object.entries(proposal.resources).sort(([left], [right]) => left.localeCompare(right)),
      ),
    })),
  });
}

function atlasLayoutForRenderer(regions: readonly RegionSnapshot[]): AtlasLayout {
  const derived = deriveAtlasLayout(regions);
  if (!hasExactCanonicalRegionSet(regions)) {
    return derived;
  }
  const snapshots = new Map(regions.map((region) => [region.name, region]));
  const canonicalRegions = derived.regions.map((region) => {
    const preset = CANONICAL_LAYOUT[region.id];
    const snapshot = snapshots.get(region.id);
    if (!preset || !snapshot) {
      return region;
    }
    const pool = Math.max(40, snapshot.max_energy + snapshot.max_materials);
    return {
      id: region.id,
      x: preset.cx,
      z: preset.cz,
      radius: preset.baseR * clamp(Math.sqrt(pool / 240), 0.74, 1.22),
      relief: preset.relief,
      dome: preset.dome,
    };
  });
  return {
    ...derived,
    regions: canonicalRegions,
    bounds: atlasRegionBounds(canonicalRegions),
    diagnostics: { ...derived.diagnostics, fallback: false },
  };
}

function hasExactCanonicalRegionSet(regions: readonly RegionSnapshot[]): boolean {
  if (regions.length !== CANONICAL_REGION_IDS.length) {
    return false;
  }
  const regionIds = regions.map((region) => region.name).sort();
  return regionIds.every((regionId, index) => regionId === CANONICAL_REGION_IDS[index]);
}

function atlasRegionBounds(regions: readonly AtlasRegionLayout[]): AtlasLayout["bounds"] {
  if (regions.length === 0) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  }
  return {
    minX: Math.min(...regions.map((region) => region.x - region.radius)),
    maxX: Math.max(...regions.map((region) => region.x + region.radius)),
    minZ: Math.min(...regions.map((region) => region.z - region.radius)),
    maxZ: Math.max(...regions.map((region) => region.z + region.radius)),
  };
}

function sceneryExclusionsForRegion(
  layout: AtlasRegionLayout,
  crossings: readonly AtlasCrossing[],
  regionsById: ReadonlyMap<string, AtlasRegionLayout>,
): { x: number; z: number; radius: number }[] {
  const exclusions = [{
    x: 0,
    z: 0,
    radius: clamp(layout.radius * 0.28, 3, 6),
  }];
  for (const crossing of crossings) {
    if (crossing.from !== layout.id && crossing.to !== layout.id) {
      continue;
    }
    const otherId = crossing.from === layout.id ? crossing.to : crossing.from;
    const other = regionsById.get(otherId);
    if (!other) {
      continue;
    }
    const dx = other.x - layout.x;
    const dz = other.z - layout.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0) {
      continue;
    }
    for (const ratio of [0.5, 0.66, 0.82]) {
      exclusions.push({
        x: (dx / distance) * layout.radius * ratio,
        z: (dz / distance) * layout.radius * ratio,
        radius: 2.6,
      });
    }
  }
  return exclusions;
}

function buildAtlas(
  regions: readonly RegionSnapshot[],
  layout: AtlasLayout,
): AtlasRegion[] {
  const layoutById = new Map(layout.regions.map((region) => [region.id, region]));
  return regions.map((region) => {
    const preset = layoutById.get(region.name);
    const recipe = deriveRegionVisualRecipe(region);
    if (!preset) {
      throw new Error(`Atlas layout is missing region ${region.name}.`);
    }
    return {
      key: region.name,
      display: cleanVisibleText(titleCase(region.name)),
      snapshot: region,
      cx: preset.x,
      cz: preset.z,
      baseR: preset.radius,
      relief: preset.relief,
      dome: preset.dome,
      seed: stringHash(region.name),
      recipe,
      energyRatio: ratio(region.current_energy, region.max_energy),
      materialRatio: ratio(region.current_materials, region.max_materials),
    };
  });
}

function abundanceCount(ratioValue: number, baseR: number): number {
  if (ratioValue <= 0.02) {
    return 0;
  }
  return Math.round(clamp(ratioValue, 0, 1) * clamp(baseR / 8, 2, 5));
}

function regionTerrainTint(region: AtlasRegion): RegionAbundanceDebugState["terrainTint"] {
  if (region.energyRatio > 0.62) {
    return "lush";
  }
  if (region.materialRatio > 0.55) {
    return "material";
  }
  if (region.energyRatio < 0.2 && region.materialRatio < 0.2) {
    return "scarce";
  }
  return "mixed";
}

function islandMask(region: AtlasRegion, x: number, z: number): number {
  const dx = x - region.cx;
  const dz = z - region.cz;
  const angle = Math.atan2(dz, dx);
  const radius = islandRadius(region, angle);
  const q = Math.hypot(dx, dz) / radius;
  return 1 - sstep(0.64, 1.04, q);
}

function islandRadius(region: AtlasRegion, angle: number): number {
  const noise =
    Math.sin(angle * 2.1 + region.seed * 0.00007) * 0.11 +
    Math.cos(angle * 3.7 + region.seed * 0.00003) * 0.08 +
    (vnoise(Math.cos(angle) * 2.4 + region.seed * 0.00001, Math.sin(angle) * 2.4) - 0.5) * 0.18;
  return region.baseR * clamp(1 + noise, 0.72, 1.28);
}

function buildFoamGeometry(region: AtlasRegion): THREE.BufferGeometry {
  const segmentCount = 128;
  const positions: number[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const next = (index + 1) % segmentCount;
    const a = (index / segmentCount) * Math.PI * 2;
    const b = (next / segmentCount) * Math.PI * 2;
    const rA = islandRadius(region, a);
    const rB = islandRadius(region, b);
    const innerA = pointOnRegion(region, a, rA - 0.6);
    const outerA = pointOnRegion(region, a, rA + 0.7);
    const innerB = pointOnRegion(region, b, rB - 0.6);
    const outerB = pointOnRegion(region, b, rB + 0.7);
    positions.push(...innerA, ...outerA, ...innerB, ...outerA, ...outerB, ...innerB);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

function pointOnRegion(region: AtlasRegion, angle: number, radius: number): [number, number, number] {
  return [region.cx + Math.cos(angle) * radius, 0.09, region.cz + Math.sin(angle) * radius];
}

function makeRegionLabel(region: AtlasRegion): HTMLElement {
  const element = document.createElement("div");
  element.className = "viv-region-label";
  element.textContent = region.display;
  return element;
}

function deriveAgentVisualState(agent: AgentSnapshot, renderedParts = 0): AgentVisualState {
  const materialLoadRatio = clamp(agent.materials / MATERIAL_CARRY_VISUAL_FULL, 0, 1);
  const carriedGoodsVisible = agent.materials >= 20;
  const flameState = agentFlameState(agent);
  const flameLevel = agentFlameLevel(agent, flameState);
  const identity = agentIdentityColors(agent.id);
  const robeColor =
    flameState === "dead"
      ? "#4a423c"
      : flameState === "fallen"
        ? blendHex(identity.robeColor, "#d96e3f", 0.22)
        : identity.robeColor;
  const accessory = agentAccessory(identity.identitySeed);
  return {
    id: agent.id,
    status: agent.status,
    energy: agent.energy,
    materials: agent.materials,
    identitySeed: identity.identitySeed,
    paletteId: identity.paletteId,
    robeColor,
    underRobeColor: flameState === "dead" ? "#352f2c" : identity.underRobeColor,
    trimColor: flameState === "dead" ? "#62564a" : identity.trimColor,
    accessory,
    flameState,
    flameLevel,
    flameVisible: flameLevel > 0.02,
    flameLightIntensity: flameState === "dead" ? 0 : flameLevel * 1.35,
    flameSmokeCue: flameState === "fallen",
    materialLoadRatio,
    carriedGoodsVisible,
    satchelCount: carriedGoodsVisible ? clamp(Math.ceil(materialLoadRatio * 3), 1, 3) : 0,
    hoarding: agent.is_hoarding,
    renderedParts,
    semanticParts: [],
    objectCount: 0,
    meshCount: 0,
    lightCount: 0,
    flameLightActive: false,
    visualHeight: 0,
  };
}

function agentIdentityColors(id: string): AgentIdentityColors {
  const identitySeed = stringHash(id);
  const palette = AGENT_PALETTES[identitySeed % AGENT_PALETTES.length];
  return {
    identitySeed,
    paletteId: palette.id,
    robeColor: palette.robe,
    underRobeColor: palette.under,
    trimColor: palette.trim,
    pennantColor: palette.robe,
  };
}

function agentAccessory(identitySeed: number): AgentAccessoryKind {
  const slot = identitySeed % 6;
  if (slot === 0 || slot === 3) {
    return "staff";
  }
  if (slot === 1) {
    return "pouch";
  }
  return "none";
}

function agentFlameState(agent: AgentSnapshot): AgentFlameState {
  if (agent.status === "dead") {
    return "dead";
  }
  if (agent.status === "paralyzed" || agent.energy <= 5) {
    return "fallen";
  }
  if (agent.energy < 20) {
    return "weary";
  }
  return "healthy";
}

function agentFlameLevel(agent: AgentSnapshot, flameState: AgentFlameState): number {
  if (flameState === "dead" || flameState === "fallen") {
    return 0;
  }
  if (flameState === "weary") {
    return clamp(agent.energy / 20, 0.18, 0.48);
  }
  return 0.5 + clamp((agent.energy - 20) / 60, 0, 1) * 0.5;
}

function makeBeing(agent: AgentSnapshot): THREE.Group {
  const group = new THREE.Group();
  const visual = deriveAgentVisualState(agent);
  const visualRoot = new THREE.Group();
  visualRoot.name = "mystic-visual";
  visualRoot.scale.setScalar(MYSTIC_WORLD_SCALE);
  if (visual.flameState === "weary") {
    visualRoot.scale.y *= 0.93;
    visualRoot.rotation.x = 0.08;
  } else if (visual.flameState === "fallen") {
    visualRoot.rotation.z = 1.3;
    visualRoot.position.y = 0.18;
  } else if (visual.flameState === "dead") {
    visualRoot.rotation.z = 1.48;
    visualRoot.position.y = 0.12;
  }
  const robeMaterial = new THREE.MeshStandardMaterial({
    color: visual.robeColor,
    roughness: 0.92,
    flatShading: true,
  });
  const robeLiftMaterial = new THREE.MeshStandardMaterial({
    color: blendHex(visual.robeColor, visual.trimColor, 0.12),
    roughness: 0.92,
    flatShading: true,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: visual.trimColor,
    roughness: 0.86,
    flatShading: true,
  });
  const underMaterial = new THREE.MeshStandardMaterial({
    color: visual.underRobeColor,
    roughness: 0.94,
    flatShading: true,
  });
  const underRobe = semanticMesh(
    jitterGeometry(new THREE.CylinderGeometry(0.23, 0.58, 1.52, 7), 0.018, visual.identitySeed + 1),
    underMaterial,
    "under-robe",
  );
  underRobe.position.y = 0.78;
  underRobe.castShadow = true;

  const leftCloak = semanticMesh(
    jitterGeometry(
      new THREE.ConeGeometry(0.64, 1.46, 7, 1, true, 0.34, Math.PI - 0.36),
      0.022,
      visual.identitySeed + 3,
    ),
    robeLiftMaterial,
    "open-cloak-left",
  );
  leftCloak.position.set(-0.025, 0.86, 0.015);
  leftCloak.castShadow = true;
  const rightCloak = semanticMesh(
    jitterGeometry(
      new THREE.ConeGeometry(0.64, 1.46, 7, 1, true, Math.PI + 0.02, Math.PI - 0.36),
      0.022,
      visual.identitySeed + 5,
    ),
    robeMaterial,
    "open-cloak-right",
  );
  rightCloak.position.set(0.025, 0.86, 0.015);
  rightCloak.castShadow = true;

  const shoulderCape = semanticMesh(
    jitterGeometry(new THREE.ConeGeometry(0.58, 0.42, 7, 1, true), 0.014, visual.identitySeed + 7),
    trimMaterial,
    "shoulder-cape",
  );
  shoulderCape.position.set(0, 1.4, -0.02);
  shoulderCape.castShadow = true;

  const cowl = semanticMesh(
    jitterGeometry(new THREE.ConeGeometry(0.43, 0.78, 7, 1, false), 0.012, visual.identitySeed + 11),
    robeLiftMaterial,
    "deep-cowl",
  );
  cowl.position.set(0, 1.72, 0.035);
  cowl.rotation.x = 0.34;
  cowl.castShadow = true;
  const shadowFace = semanticMesh(
    new THREE.CircleGeometry(0.255, 7),
    new THREE.MeshBasicMaterial({ color: "#15171b", side: THREE.DoubleSide }),
    "shadow-face",
  );
  shadowFace.position.set(0, 1.69, 0.37);
  shadowFace.scale.set(0.88, 1.12, 1);
  shadowFace.castShadow = false;

  const sleeve = new THREE.Mesh(
    jitterGeometry(new THREE.CylinderGeometry(0.13, 0.24, 0.64, 6), 0.01, visual.identitySeed + 13),
    robeMaterial,
  );
  sleeve.name = "raised-sleeve";
  sleeve.position.set(0.46, 1.24, 0.08);
  sleeve.rotation.z = -1.02;
  sleeve.castShadow = true;
  const palm = semanticMesh(
    new THREE.SphereGeometry(0.13, 6, 4),
    new THREE.MeshStandardMaterial({ color: "#b89473", roughness: 0.92, flatShading: true }),
    "open-palm",
  );
  palm.name = "open-palm";
  palm.position.set(0.74, 1.43, 0.1);
  palm.scale.set(1, 0.34, 1.12);
  palm.rotation.z = -0.14;
  palm.castShadow = true;

  const contactShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 12),
    new THREE.MeshBasicMaterial({
      color: "#141516",
      transparent: true,
      opacity: visual.flameState === "dead" ? 0.28 : 0.2,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  contactShadow.name = "mystic-contact-shadow";
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.018;
  contactShadow.castShadow = false;
  contactShadow.receiveShadow = true;

  visualRoot.add(
    contactShadow,
    underRobe,
    leftCloak,
    rightCloak,
    shoulderCape,
    cowl,
    shadowFace,
    sleeve,
    palm,
  );

  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 8, 6),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.name = "mystic-hit-target";
  hit.position.y = 0.8;
  group.add(visualRoot, hit);

  if (visual.accessory === "staff") {
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.046, 1.62, 6), trimMaterial);
    staff.position.set(-0.72, 0.88, 0.02);
    staff.rotation.z = 0.12;
    staff.castShadow = true;
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.105, 0),
      new THREE.MeshStandardMaterial({
        color: "#6fc7bd",
        roughness: 0.5,
        emissive: "#123f3d",
        emissiveIntensity: 0.22,
        flatShading: true,
      }),
    );
    crystal.position.set(-0.82, 1.7, 0.02);
    crystal.castShadow = false;
    visualRoot.add(staff, crystal);
  } else if (visual.accessory === "pouch" && !visual.carriedGoodsVisible) {
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.16), trimMaterial);
    pouch.position.set(-0.31, 0.82, 0.18);
    pouch.rotation.z = 0.18;
    pouch.castShadow = true;
    visualRoot.add(pouch);
  }

  const stateOwnedPointLightCandidates: Array<{
    ownerKind: StateOwnedPointLightOwnerKind;
    ownerId: string;
    intensity: number;
    light: THREE.PointLight;
    mount?: THREE.Object3D;
  }> = [];
  if (visual.flameVisible) {
    const flameMaterial = new THREE.MeshBasicMaterial({
      color: visual.flameState === "weary" ? "#d96e3f" : "#f0c66f",
      transparent: true,
      opacity: 0.72 + visual.flameLevel * 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const flame = semanticMesh(
      new THREE.ConeGeometry(
        0.1 + visual.flameLevel * 0.065,
        0.3 + visual.flameLevel * 0.24,
        7,
      ),
      flameMaterial,
      "hand-flame",
    );
    flame.name = "hand-flame";
    flame.position.set(0.74, 1.65, 0.1);
    flame.rotation.z = -0.18;
    flame.castShadow = false;
    const flameLight = new THREE.PointLight("#f0c66f", visual.flameLightIntensity, 2.2, 2);
    flameLight.name = `agent-flame-light:${agent.id}`;
    flameLight.position.set(0.74, 1.65, 0.1);
    flameLight.castShadow = false;
    flameLight.userData.stateOwnedPointLight = {
      ownerKind: "agent",
      ownerId: agent.id,
      intensity: visual.flameLightIntensity,
    };
    visualRoot.add(flame, flameLight);
    stateOwnedPointLightCandidates.push({
      ownerKind: "agent",
      ownerId: agent.id,
      intensity: visual.flameLightIntensity,
      light: flameLight,
      mount: visualRoot,
    });
  } else if (visual.flameSmokeCue) {
    const smokeMaterial = new THREE.MeshBasicMaterial({
      color: "#9b9184",
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 5), smokeMaterial);
    smoke.name = "fallen-palm-smoke";
    smoke.position.set(0.75, 1.62, 0.1);
    smoke.scale.set(0.7, 1.8, 0.7);
    smoke.castShadow = false;
    visualRoot.add(smoke);
  }
  if (visual.carriedGoodsVisible) {
    const satchelMaterial = new THREE.MeshStandardMaterial({
      color: visual.hoarding ? "#c8a34c" : "#8a6f4d",
      emissive: visual.hoarding ? "#4d3612" : "#000000",
      emissiveIntensity: visual.hoarding ? 0.34 : 0,
      roughness: 0.88,
      flatShading: true,
    });
    const satchels = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.2 + visual.materialLoadRatio * 0.1, 0.26, 0.18),
      satchelMaterial,
      visual.satchelCount,
    );
    satchels.name = "carried-material-satchels";
    satchels.castShadow = true;
    const matrix = new THREE.Object3D();
    for (let index = 0; index < visual.satchelCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      matrix.position.set(
        side * (0.38 + Math.floor(index / 2) * 0.08),
        0.8 - index * 0.03,
        0.04,
      );
      matrix.rotation.set(0, 0, side * 0.25);
      matrix.updateMatrix();
      satchels.setMatrixAt(index, matrix.matrix);
    }
    satchels.instanceMatrix.needsUpdate = true;
    visualRoot.add(satchels);
  }
  group.userData = {
    visual: {
      ...visual,
      renderedParts: Math.max(0, descendantObjectCount(group) - 1),
    },
    stateOwnedPointLightCandidates,
  };
  return group;
}

const MYSTIC_WORLD_SCALE = 0.56;

function semanticMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  semanticPart: AgentSemanticPartName,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.semanticPart = semanticPart;
  return mesh;
}

function jitterGeometry(
  geometry: THREE.BufferGeometry,
  amount: number,
  seed: number,
): THREE.BufferGeometry {
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const xJitter = seededSignedUnit(seed, index * 3) * amount;
    const yJitter = seededSignedUnit(seed, index * 3 + 1) * amount * 0.55;
    const zJitter = seededSignedUnit(seed, index * 3 + 2) * amount;
    position.setXYZ(
      index,
      position.getX(index) + xJitter,
      position.getY(index) + yJitter,
      position.getZ(index) + zJitter,
    );
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function seededSignedUnit(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffff_ffff * 2 - 1;
}

function descendantObjectCount(root: THREE.Object3D): number {
  let count = 0;
  root.traverse(() => count += 1);
  return count;
}

function makeRelightFlame(materials: THREE.Material[]): THREE.Group {
  const group = new THREE.Group();
  const flameMaterial = new THREE.MeshBasicMaterial({
    color: "#f0c66f",
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const emberMaterial = new THREE.MeshBasicMaterial({
    color: "#d96e3f",
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  materials.push(flameMaterial, emberMaterial);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.48, 9), flameMaterial);
  flame.position.y = 0.24;
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.11, 9, 7), emberMaterial);
  ember.position.y = 0.03;
  group.add(flame, ember);
  return group;
}

function makeShelterProxy(materials: THREE.Material[]): THREE.Group {
  const group = new THREE.Group();
  const robeMaterial = new THREE.MeshStandardMaterial({
    color: "#6fc7bd",
    transparent: true,
    opacity: 0.92,
    roughness: 0.9,
    flatShading: true,
  });
  const headMaterial = new THREE.MeshStandardMaterial({
    color: "#b59276",
    transparent: true,
    opacity: 0.92,
    roughness: 0.9,
    flatShading: true,
  });
  materials.push(robeMaterial, headMaterial);
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.78, 8), robeMaterial);
  robe.position.y = 0.42;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), headMaterial);
  head.position.y = 0.88;
  group.add(robe, head);
  group.userData = {
    kind: "shelterProxy",
    persistentOccupancy: false,
  };
  return group;
}

function makeRaidProxy(materials: THREE.Material[], color: string): THREE.Group {
  const group = new THREE.Group();
  const robeMaterial = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: 0.82,
    roughness: 0.9,
    flatShading: true,
  });
  const headMaterial = new THREE.MeshStandardMaterial({
    color: "#b59276",
    transparent: true,
    opacity: 0.82,
    roughness: 0.9,
    flatShading: true,
  });
  materials.push(robeMaterial, headMaterial);
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.58, 8), robeMaterial);
  robe.position.y = 0.32;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), headMaterial);
  head.position.y = 0.66;
  group.add(robe, head);
  group.userData = {
    kind: "raidProxy",
    persistentOccupancy: false,
  };
  return group;
}

function makeLifecycleProxy(materials: THREE.Material[], color: string): THREE.Group {
  const group = makeRaidProxy(materials, color);
  group.userData = {
    kind: "homeLifecycleProxy",
    persistentOccupancy: false,
  };
  return group;
}

function makeBirthArrivalProxy(materials: THREE.Material[]): THREE.Group {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: "#f0c66f",
    transparent: true,
    opacity: 0.82,
    roughness: 0.86,
    flatShading: true,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: "#ede4d2",
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  materials.push(bodyMaterial, glowMaterial);
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.46, 8), bodyMaterial);
  body.position.y = 0.28;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.14, 9, 7), glowMaterial);
  glow.position.y = 0.6;
  group.add(body, glow);
  group.userData = {
    kind: "birthArrivalProxy",
    persistentOccupancy: false,
  };
  return group;
}

function makeMembershipPreview(
  materials: THREE.Material[],
  kind: Extract<HomeLifecycleKind, "join" | "left">,
  growth: number,
): THREE.Group {
  const group = new THREE.Group();
  const opacity = kind === "join" ? 0.62 : 0.46;
  const wallMaterial = new THREE.MeshBasicMaterial({
    color: kind === "join" ? "#d8c18a" : "#8d7a64",
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const pennantMaterial = new THREE.MeshBasicMaterial({
    color: kind === "join" ? EFFECT_COLORS.speech : EFFECT_COLORS.thought,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  materials.push(wallMaterial, pennantMaterial);

  const lean = new THREE.Mesh(new THREE.BoxGeometry(0.56 * growth, 0.54 * growth, 0.76 * growth), wallMaterial);
  lean.position.set(1.34 * growth, 0.36 * growth, -0.14 * growth);
  lean.rotation.z = -0.08;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.5 * growth, 0.34 * growth, 4), wallMaterial);
  roof.position.set(1.34 * growth, 0.78 * growth, -0.14 * growth);
  roof.rotation.y = Math.PI / 4;

  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.035 * growth, 0.42 * growth, 0.035 * growth), wallMaterial);
  pole.position.set(0.54 * growth, 1.76 * growth, 0.08 * growth);
  const pennant = new THREE.Mesh(new THREE.ConeGeometry(0.13 * growth, 0.3 * growth, 3), pennantMaterial);
  pennant.position.set(0.64 * growth, 1.86 * growth, 0.08 * growth);
  pennant.rotation.set(0, 0, -Math.PI / 2);

  group.add(lean, roof, pole, pennant);
  group.userData = {
    kind: "homeMembershipPreview",
    persistentOccupancy: false,
  };
  return group;
}

function makeRuinPreview(materials: THREE.Material[], growth: number): THREE.Group {
  const group = new THREE.Group();
  const stoneMaterial = new THREE.MeshBasicMaterial({
    color: "#51483f",
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  });
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: "#3f3028",
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  materials.push(stoneMaterial, beamMaterial);
  for (let index = 0; index < 7; index += 1) {
    const angle = (index / 7) * Math.PI * 2;
    const radius = (0.34 + (index % 3) * 0.16) * growth;
    const stone = new THREE.Mesh(
      new THREE.BoxGeometry((0.34 + (index % 2) * 0.1) * growth, 0.14 * growth, 0.26 * growth),
      stoneMaterial,
    );
    stone.position.set(Math.cos(angle) * radius, 0.12 * growth + index * 0.012, Math.sin(angle) * radius * 0.72);
    stone.rotation.set(0.18 * index, 0.44 * index, 0.16 * index);
    group.add(stone);
  }
  for (let index = 0; index < 3; index += 1) {
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry((0.88 - index * 0.14) * growth, 0.12 * growth, 0.16 * growth),
      beamMaterial,
    );
    beam.position.set((-0.26 + index * 0.22) * growth, (0.28 + index * 0.04) * growth, (-0.16 + index * 0.24) * growth);
    beam.rotation.set(0.18 + index * 0.1, index * 0.7, index % 2 === 0 ? 0.42 : -0.54);
    group.add(beam);
  }
  group.userData = {
    kind: "homeRuinPreview",
    persistentOccupancy: false,
  };
  return group;
}

function makeHomeBuildFrame(materials: THREE.Material[]): THREE.Group {
  const group = new THREE.Group();
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: "#d8c18a",
    transparent: true,
    opacity: 0.22,
    roughness: 0.86,
    flatShading: true,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: "#b7824a",
    transparent: true,
    opacity: 0.22,
    roughness: 0.9,
    flatShading: true,
  });
  const trimMaterial = new THREE.MeshBasicMaterial({
    color: "#6c4f35",
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  materials.push(wallMaterial, roofMaterial, trimMaterial);

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.64, 0.88), wallMaterial);
  body.position.y = 0.44;

  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.82, 0.44, 4), roofMaterial);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 0.98;

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.38, 0.035), trimMaterial);
  door.position.set(0, 0.29, 0.46);

  const beamOffsets: Array<[number, number]> = [
    [-0.46, -0.36],
    [0.46, -0.36],
    [-0.46, 0.36],
    [0.46, 0.36],
  ];
  for (const [x, z] of beamOffsets) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.74, 6), trimMaterial);
    beam.position.set(x, 0.48, z);
    group.add(beam);
  }

  group.add(body, roof, door);
  group.userData = {
    kind: "homeBuildPreview",
    persistentOccupancy: false,
  };
  return group;
}

const HOME_VAULT_HOARD_THRESHOLD = 300;
const RUIN_REMNANT_VISUAL_FULL = 80;

function deriveHomeVisualState(home: HomeSnapshot, ruined: boolean): HomeVisualState {
  const stakeholderCount = ruined ? 0 : Math.max(1, home.stakeholders.length);
  const health = ruined ? 0 : ratio(home.integrity, home.max_integrity);
  const growth = ruined
    ? 1
    : 1 + 0.34 * (1 - Math.pow(0.5, Math.max(0, stakeholderCount - 1)));
  const vaultRatio = ruined ? 0 : clamp(home.vault_materials / HOME_VAULT_HOARD_THRESHOLD, 0, 1);
  const remnantRatio = ruined ? clamp(home.remnant_materials / RUIN_REMNANT_VISUAL_FULL, 0, 1) : 0;
  const leanToCount = ruined ? 0 : Math.min(4, Math.max(0, stakeholderCount - 1));
  const pennantCount = ruined ? 0 : Math.min(5, Math.max(0, stakeholderCount - 1));
  const identityPennants = deriveHomeIdentityPennants(home, ruined, pennantCount);
  return {
    id: home.home_id,
    ruined,
    health,
    ...identityPennants,
    stakeholderCount,
    growth,
    vaultRatio,
    hoarding: !ruined && (home.is_hoarding || home.vault_materials >= HOME_VAULT_HOARD_THRESHOLD),
    breached: !ruined && home.breachers.length > 0,
    remnantRatio,
    leanToCount,
    pennantCount,
    renderedParts: 0,
    visualHeight: 0,
    windowEmissive: !ruined,
    ownedLightCount: 0,
    hearthLightActive: false,
    lightSource: !ruined && home.vault_materials > 0 ? "vault" : null,
  };
}

function deriveHomeIdentityPennants(
  home: HomeSnapshot,
  ruined: boolean,
  pennantCount: number,
): HomeIdentityPennantState {
  if (ruined) {
    return {
      ownerId: null,
      stakeholderIds: [],
      ownerPaletteId: null,
      ownerPennantColor: null,
      stakeholderPennantColors: [],
      pennantColors: [],
      pennantSource: [],
      identityDerivedPennants: false,
    };
  }

  const ownerId = home.owner_id;
  const ownerIdentity = agentIdentityColors(ownerId);
  const stakeholderIds = Array.from(new Set(home.stakeholders.filter(Boolean))).sort();
  const candidateSources: Array<Omit<HomePennantSource, "index">> = [];
  const seen = new Set<string>();
  candidateSources.push({
    id: ownerId,
    role: "owner",
    paletteId: ownerIdentity.paletteId,
    color: ownerIdentity.pennantColor,
    source: "agent-id",
  });
  seen.add(ownerId);

  for (const stakeholderId of stakeholderIds) {
    if (!stakeholderId || seen.has(stakeholderId)) {
      continue;
    }
    const identity = agentIdentityColors(stakeholderId);
    candidateSources.push({
      id: stakeholderId,
      role: "stakeholder",
      paletteId: identity.paletteId,
      color: identity.pennantColor,
      source: "agent-id",
    });
    seen.add(stakeholderId);
  }

  const pennantSource: HomePennantSource[] = [];
  for (let index = 0; index < pennantCount && candidateSources.length > 0; index += 1) {
    const source = candidateSources[Math.min(index, candidateSources.length - 1)];
    pennantSource.push({ ...source, index });
  }

  return {
    ownerId,
    stakeholderIds,
    ownerPaletteId: ownerIdentity.paletteId,
    ownerPennantColor: ownerIdentity.pennantColor,
    stakeholderPennantColors: pennantSource
      .filter((source) => source.role === "stakeholder")
      .map((source) => source.color),
    pennantColors: pennantSource.map((source) => source.color),
    pennantSource,
    identityDerivedPennants: true,
  };
}

function cloneHomeVisualState(visual: HomeVisualState): HomeVisualState {
  return {
    ...visual,
    stakeholderIds: [...visual.stakeholderIds],
    stakeholderPennantColors: [...visual.stakeholderPennantColors],
    pennantColors: [...visual.pennantColors],
    pennantSource: visual.pennantSource.map((source) => ({ ...source })),
  };
}

function agentPlacementOffset(agentId: string, regionRadius: number): readonly [number, number] {
  const slot = canonicalSlotIndex(agentId, "agent") ?? stableEntitySlot(agentId, stringHash(agentId) % 2048);
  if (slot < ENTITY_OFFSETS.length) {
    return ENTITY_OFFSETS[slot];
  }
  return radialEntityOffset(slot - ENTITY_OFFSETS.length, {
    angleSeed: placementFamilyHash(agentId),
    startRadius: 5.8,
    spacing: 1.48,
    maxRadius: Math.max(6.8, regionRadius * 0.42),
  });
}

function homePlacementOffset(homeId: string, regionRadius = 24): readonly [number, number] {
  const slot = canonicalSlotIndex(homeId, "home");
  if (slot !== undefined && slot < HOME_OFFSETS.length) {
    return HOME_OFFSETS[slot];
  }
  const seed = stringHash(homeId);
  const denseSlot = slot ?? stableEntitySlot(homeId, seed % 2048);
  const [baseX, baseZ] = radialEntityOffset(denseSlot, {
    angleSeed: placementFamilyHash(homeId),
    startRadius: 6.2,
    spacing: 2.22,
    maxRadius: Math.max(8.4, regionRadius * 0.62),
  });
  const jitter = (((seed >>> 12) % 100) / 100 - 0.5) * 0.36;
  const length = Math.hypot(baseX, baseZ) || 1;
  return [
    baseX - (baseZ / length) * jitter,
    baseZ + (baseX / length) * jitter,
  ] as const;
}

function canonicalSlotIndex(id: string, prefix: string): number | undefined {
  const match = id.match(new RegExp(`^${prefix}_(\\d+)$`));
  if (!match) {
    return undefined;
  }
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value - 1 : undefined;
}

function stableEntitySlot(id: string, fallback: number): number {
  const match = id.match(/^(.*?)(\d+)$/);
  if (!match) {
    return fallback;
  }
  const value = Number.parseInt(match[2], 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value - 1;
}

function placementFamilyHash(id: string): number {
  const match = id.match(/^(.*?)(\d+)$/);
  return stringHash(match ? match[1] : id);
}

function radialEntityOffset(
  slot: number,
  options: {
    angleSeed: number;
    startRadius: number;
    spacing: number;
    maxRadius: number;
  },
): readonly [number, number] {
  const capacity = 8;
  const ringSlot = Math.max(0, slot) % capacity;
  const ring = Math.floor(Math.max(0, slot) / capacity);
  const familyLane = (options.angleSeed % 4) * options.spacing * 0.85;
  const rawRadius = options.startRadius + ring * options.spacing + familyLane;
  const radius = rawRadius <= options.maxRadius + options.spacing
    ? Math.min(rawRadius, options.maxRadius)
    : Math.max(options.startRadius * 0.74, options.maxRadius - (ring % 4) * options.spacing);
  const phaseOffset = (options.angleSeed % 1000) / 1000 * 0.7;
  const ringStagger = ring % 2 === 0 ? 0 : 0.5;
  const angle = ((ringSlot + phaseOffset + ringStagger) / capacity) * Math.PI * 2 + ring * 0.7;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius] as const;
}

function makeHome(home: HomeSnapshot): THREE.Group {
  const group = new THREE.Group();
  const visual = deriveHomeVisualState(home, false);
  const stateOwnedPointLightCandidates: Array<{
    ownerKind: StateOwnedPointLightOwnerKind;
    ownerId: string;
    intensity: number;
    light: THREE.PointLight;
  }> = [];
  group.scale.setScalar(visual.growth);
  const wear = 1 - visual.health;
  const wallWidth = 2.34;
  const wallDepth = 1.76;
  const plinthHeight = 0.24;
  const wallHeight = 1.52 - wear * 0.16;
  const roofHeight = 1.16 - wear * 0.2;
  const wallColor = blendHex("#806749", "#5d4437", wear);
  const roofColor = blendHex("#a48a5e", "#5f5145", wear);
  const woodMaterial = new THREE.MeshStandardMaterial({
    color: wallColor,
    roughness: 0.94,
    flatShading: true,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: roofColor,
    roughness: 0.92,
    flatShading: true,
  });
  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: "#6f675b",
    roughness: 0.96,
    flatShading: true,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: "#2f2924",
    roughness: 0.95,
    flatShading: true,
  });
  const glowMaterial = new THREE.MeshStandardMaterial({
    color: "#f2b66d",
    emissive: "#ff9a3d",
    emissiveIntensity: Math.max(0.25, 1.1 - wear * 0.75),
    roughness: 0.72,
    flatShading: true,
  });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(wallWidth + 0.38, plinthHeight, wallDepth + 0.34), stoneMaterial);
  plinth.position.y = plinthHeight / 2;
  plinth.receiveShadow = true;
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(wallWidth, wallHeight, wallDepth),
    woodMaterial,
  );
  wall.position.y = plinthHeight + wallHeight / 2;
  wall.rotation.z = wear * 0.035;
  wall.castShadow = true;
  wall.receiveShadow = true;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(1.76, roofHeight, 4),
    roofMaterial,
  );
  roof.position.y = plinthHeight + wallHeight + roofHeight / 2 - wear * 0.08;
  roof.rotation.y = Math.PI / 4;
  roof.rotation.z = -wear * 0.05;
  roof.castShadow = true;
  group.add(plinth, wall, roof);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.06), visual.breached ? darkMaterial : woodMaterial);
  door.position.set(visual.breached ? -0.18 : 0, plinthHeight + 0.45, wallDepth / 2 + 0.035);
  door.rotation.y = visual.breached ? -0.78 : 0;
  door.castShadow = true;
  group.add(door);

  const window = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.055), glowMaterial);
  window.name = "standing-home-emissive-window";
  window.position.set(0.64, plinthHeight + wallHeight * 0.64, wallDepth / 2 + 0.04);
  group.add(window);

  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.72, 0.24), stoneMaterial);
  chimney.position.set(-0.56, plinthHeight + wallHeight + 0.34, -0.32);
  chimney.rotation.z = wear * 0.06;
  chimney.castShadow = true;
  group.add(chimney);

  for (let index = 0; index < visual.leanToCount; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    const lean = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.74, 0.94), woodMaterial);
    lean.position.set(side * (wallWidth / 2 + 0.36), plinthHeight + 0.37, -0.22 + row * 0.56);
    lean.rotation.z = side * -0.08;
    lean.castShadow = true;
    lean.receiveShadow = true;
    const leanRoof = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.44, 4), roofMaterial);
    leanRoof.position.set(side * (wallWidth / 2 + 0.36), plinthHeight + 0.92, -0.22 + row * 0.56);
    leanRoof.rotation.y = Math.PI / 4;
    leanRoof.rotation.z = side * -0.08;
    leanRoof.castShadow = true;
    group.add(lean, leanRoof);
  }

  for (let index = 0; index < visual.pennantCount; index += 1) {
    const x = -0.5 + index * 0.25;
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.38, 0.035), darkMaterial);
    pole.position.set(x, plinthHeight + wallHeight + roofHeight * 0.72, 0.04);
    const flag = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.3, 3),
      new THREE.MeshStandardMaterial({
        color: visual.pennantColors[index]
          ?? visual.ownerPennantColor
          ?? agentIdentityColors(home.owner_id).pennantColor,
        roughness: 0.86,
        flatShading: true,
      }),
    );
    flag.position.set(x + 0.08, plinthHeight + wallHeight + roofHeight * 0.78, 0.04);
    flag.rotation.set(0, 0, -Math.PI / 2);
    group.add(pole, flag);
  }

  if (visual.breached || wear > 0.35) {
    const crackCount = visual.breached ? 3 : 1;
    for (let index = 0; index < crackCount; index += 1) {
      const crack = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.62 - index * 0.1, 0.035), darkMaterial);
      crack.position.set(-0.62 + index * 0.27, plinthHeight + 0.8 + index * 0.06, wallDepth / 2 + 0.07);
      crack.rotation.z = (index % 2 === 0 ? 1 : -1) * (0.42 + wear * 0.22);
      group.add(crack);
    }
  }

  if (wear > 0.52 || visual.breached) {
    const roofHole = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.32), darkMaterial);
    roofHole.position.set(0.28, plinthHeight + wallHeight + roofHeight * 0.62, 0.16);
    roofHole.rotation.set(-0.42, 0.3, 0.18);
    group.add(roofHole);
  }

  const crateCount = visual.vaultRatio > 0 ? Math.max(1, Math.ceil(visual.vaultRatio * 5)) : 0;
  const crateMaterial = new THREE.MeshStandardMaterial({
    color: visual.hoarding ? "#c8a34c" : "#8a6b42",
    roughness: 0.9,
    flatShading: true,
  });
  for (let index = 0; index < crateCount; index += 1) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.25), crateMaterial);
    crate.position.set(-0.72 + (index % 2) * 0.32, plinthHeight + 0.1 + Math.floor(index / 2) * 0.22, wallDepth / 2 + 0.26);
    crate.rotation.y = index * 0.32;
    crate.castShadow = true;
    group.add(crate);
  }

  if (visual.hoarding) {
    const shimmer = new THREE.Mesh(
      new THREE.TorusGeometry(0.86, 0.025, 6, 34),
      new THREE.MeshBasicMaterial({
        color: "#d9b36a",
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    shimmer.position.set(-0.58, plinthHeight + 0.16, wallDepth / 2 + 0.26);
    shimmer.rotation.x = Math.PI / 2;
    group.add(shimmer);
  }
  if (home.vault_materials > 0) {
    const intensity = visual.hoarding ? 2.2 : 0.75;
    const light = new THREE.PointLight(
      "#d9b36a",
      intensity,
      visual.hoarding ? 5.5 : 3.8,
      2,
    );
    light.name = `home-vault-light:${home.home_id}`;
    light.position.set(-0.48, visual.hoarding ? 1.28 : 1.0, 0.42);
    light.castShadow = false;
    light.userData.stateOwnedPointLight = {
      ownerKind: "home",
      ownerId: home.home_id,
      intensity,
    };
    group.add(light);
    stateOwnedPointLightCandidates.push({
      ownerKind: "home",
      ownerId: home.home_id,
      intensity,
      light,
    });
  }

  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(2.7, 2.85, 2.25),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.position.y = 1.45;
  group.add(hit);
  group.userData = {
    visual,
    stateOwnedPointLightCandidates,
  };
  return group;
}

function makeRuin(home: HomeSnapshot): THREE.Group {
  const group = new THREE.Group();
  const visual = deriveHomeVisualState(home, true);
  group.userData = { visual };
  group.scale.setScalar(1.04 + visual.remnantRatio * 0.14);
  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: visual.remnantRatio > 0 ? "#51483f" : "#37312d",
    roughness: 0.96,
    flatShading: true,
  });
  const beamMaterial = new THREE.MeshStandardMaterial({ color: "#3f3028", roughness: 0.94, flatShading: true });
  const rubbleCount = 6 + Math.round(visual.remnantRatio * 6);
  for (let index = 0; index < rubbleCount; index += 1) {
    const angle = (index / rubbleCount) * Math.PI * 2;
    const radius = 0.42 + (index % 3) * 0.18;
    const stone = new THREE.Mesh(new THREE.BoxGeometry(0.44 + (index % 2) * 0.12, 0.18, 0.3), stoneMaterial);
    stone.position.set(Math.cos(angle) * radius, 0.12 + index * 0.012, Math.sin(angle) * radius * 0.72);
    stone.rotation.set(0.2 * index, 0.4 * index, 0.18 * index);
    stone.castShadow = true;
    stone.receiveShadow = true;
    group.add(stone);
  }
  for (let index = 0; index < 3; index += 1) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.18 - index * 0.18, 0.16, 0.2), beamMaterial);
    beam.position.set(-0.28 + index * 0.26, 0.34 + index * 0.04, -0.18 + index * 0.28);
    beam.rotation.set(0.2 + index * 0.1, index * 0.68, index % 2 === 0 ? 0.42 : -0.54);
    beam.castShadow = true;
    group.add(beam);
  }
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.88, 0.25), stoneMaterial);
  chimney.position.set(-0.58, 0.52, -0.35);
  chimney.rotation.z = -0.24;
  chimney.castShadow = true;
  group.add(chimney);

  if (visual.remnantRatio > 0) {
    const moteMaterial = new THREE.MeshBasicMaterial({
      color: "#d9b36a",
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const moteCount = 3 + Math.round(visual.remnantRatio * 5);
    for (let index = 0; index < moteCount; index += 1) {
      const angle = index * 1.7;
      const mote = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), moteMaterial);
      mote.position.set(Math.cos(angle) * 0.55, 0.46 + index * 0.13, Math.sin(angle) * 0.38);
      group.add(mote);
    }
  }

  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 1.35, 2.0),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.position.y = 0.6;
  group.add(hit);
  return group;
}

function blendHex(from: string, to: string, t: number): string {
  const color = new THREE.Color(from).lerp(new THREE.Color(to), clamp(t, 0, 1));
  return `#${color.getHexString()}`;
}

function clearGroup(group: THREE.Group): void {
  const materials = new Set<THREE.Material>();
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((object: THREE.Object3D) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        collectMaterials(object.material, materials);
      }
      if (object instanceof CSS2DObject) {
        object.element.remove();
      }
    });
  }
  for (const material of materials) {
    material.dispose();
  }
}

function collectMaterials(
  material: THREE.Material | THREE.Material[],
  target: Set<THREE.Material>,
): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      target.add(item);
    }
  } else {
    target.add(material);
  }
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      item.dispose();
    }
  } else {
    material.dispose();
  }
}

function findSelectableOwner(object: THREE.Object3D): { kind: HitKind; id: string } | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const data = current.userData as { kind?: HitKind; id?: string };
    if (data.kind && data.id) {
      return { kind: data.kind, id: data.id };
    }
    current = current.parent;
  }
  return null;
}

function isVisibleInHierarchy(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) {
      return false;
    }
    current = current.parent;
  }
  return true;
}

export function visibleRenderedMeshBounds(root: THREE.Object3D): THREE.Box3 {
  const bounds = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  root.traverseVisible((object: THREE.Object3D) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    if (!materials.some((material) => material.visible)) {
      return;
    }
    if (!object.geometry.boundingBox) {
      object.geometry.computeBoundingBox();
    }
    if (object.geometry.boundingBox) {
      bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    }
  });
  return bounds;
}

function vectorTuple(vector: THREE.Vector3): [number, number, number] {
  return [
    Number(vector.x.toFixed(3)),
    Number(vector.y.toFixed(3)),
    Number(vector.z.toFixed(3)),
  ];
}

function shelterPhase(progress: number): string {
  if (progress < 0.42) {
    return "entering";
  }
  if (progress < 0.62) {
    return "threshold";
  }
  return "exiting";
}

function homeRaidPhase(kind: HomeRaidKind, progress: number): string {
  if (kind === "theft") {
    if (progress < 0.28) {
      return "breach";
    }
    if (progress < 0.78) {
      return "vault-strip";
    }
    return "flee";
  }
  if (progress < 0.3) {
    return "breach";
  }
  if (progress < 0.68) {
    return "owner-flip";
  }
  return "evict";
}

function homeLifecycleDebugKind(kind: HomeLifecycleKind): string {
  switch (kind) {
    case "join":
      return "home-membership-join";
    case "left":
      return "home-membership-leave";
    case "hoard":
      return "home-vault-hoard";
    case "collapse":
      return "home-collapse";
    case "scavenge":
      return "ruin-scavenge";
  }
}

function homeLifecycleMotionCue(kind: HomeLifecycleKind): string {
  switch (kind) {
    case "join":
      return "actor-to-home-pledge-growth";
    case "left":
      return "home-to-actor-departure-shrink";
    case "hoard":
      return "vault-threshold-shimmer";
    case "collapse":
      return "standing-home-fall-ruin-preview";
    case "scavenge":
      return "ruin-remnant-stream-to-scavenger";
  }
}

function homeLifecyclePhase(kind: HomeLifecycleKind, progress: number): string {
  if (kind === "join") {
    if (progress < 0.44) {
      return "approaching";
    }
    if (progress < 0.76) {
      return "pledging";
    }
    return "settling";
  }
  if (kind === "left") {
    if (progress < 0.42) {
      return "departing";
    }
    if (progress < 0.78) {
      return "withdrawing";
    }
    return "clear";
  }
  if (kind === "hoard") {
    if (progress < 0.36) {
      return "threshold";
    }
    if (progress < 0.8) {
      return "shimmer";
    }
    return "held";
  }
  if (kind === "collapse") {
    if (progress < 0.3) {
      return "buckling";
    }
    if (progress < 0.74) {
      return "falling";
    }
    return "remnant-preview";
  }
  if (progress < 0.24) {
    return "prying";
  }
  if (progress < 0.82) {
    return "streaming";
  }
  return "pocketed";
}

function bondRelationshipThreadCue(kind: BondLifecycleKind, parentThread: boolean): string {
  switch (kind) {
    case "initiated":
      return "offer-thread";
    case "rejected":
      return "decline-thread-refund";
    case "invalidated":
      return "broken-thread-refund";
    case "timeout":
      return "expired-thread-refund";
    case "birth":
      return parentThread ? "birth-arrival-parent-thread" : "birth-arrival";
  }
}

function bondLifecyclePhase(kind: BondLifecycleKind, progress: number): string {
  if (kind === "initiated") {
    if (progress < 0.36) {
      return "offering";
    }
    if (progress < 0.82) {
      return "thread-open";
    }
    return "settle";
  }
  if (kind === "rejected") {
    if (progress < 0.34) {
      return "declining";
    }
    if (progress < 0.82) {
      return "refunding";
    }
    return "clear";
  }
  if (kind === "invalidated") {
    if (progress < 0.34) {
      return "breaking";
    }
    if (progress < 0.82) {
      return "refunding";
    }
    return "clear";
  }
  if (kind === "timeout") {
    if (progress < 0.34) {
      return "lapsing";
    }
    if (progress < 0.82) {
      return "refunding";
    }
    return "clear";
  }
  if (progress < 0.32) {
    return "arriving";
  }
  if (progress < 0.76) {
    return "parent-thread";
  }
  return "settle";
}

function bondLifecycleMotionCue(kind: BondLifecycleKind): string {
  switch (kind) {
    case "initiated":
      return "initiator-to-target-offer-thread";
    case "rejected":
      return "rejecter-decline-with-refund-stream";
    case "invalidated":
      return "proposal-thread-breaks-with-refund";
    case "timeout":
      return "proposal-thread-lapses-with-refund";
    case "birth":
      return "parent-thread-to-child-arrival";
  }
}

function lifeTransitionPhase(kind: LifeTransitionKind, progress: number): string {
  if (kind === "paralyzed") {
    if (progress < 0.32) {
      return "stagger";
    }
    if (progress < 0.78) {
      return "collapse";
    }
    return "still-fallen";
  }
  if (kind === "died") {
    if (progress < 0.3) {
      return "impact";
    }
    if (progress < 0.72) {
      return "flame-out";
    }
    return "still";
  }
  if (progress < 0.34) {
    return "loosening";
  }
  if (progress < 0.82) {
    return "returning";
  }
  return "gone";
}

function lifeTransitionMotionCue(kind: LifeTransitionKind): string {
  switch (kind) {
    case "paralyzed":
      return "being-collapses-flame-falls";
    case "died":
      return "being-dies-flame-extinguishes";
    case "decayed":
      return "body-dissolves-to-earth";
  }
}

function bondLifecycleStreamDirection(kind: BondLifecycleKind): string | undefined {
  switch (kind) {
    case "rejected":
      return "rejecter-to-initiator-refund";
    case "invalidated":
    case "timeout":
      return "target-to-initiator-refund";
    case "birth":
      return "parents-to-child";
    case "initiated":
      return "initiator-to-target";
  }
}

function homeBuildPhase(progress: number): string {
  if (progress < 0.32) {
    return "scaffold";
  }
  if (progress < 0.78) {
    return "rising";
  }
  return "settling";
}

function groupAgents(agents: AgentSnapshot[]): Map<string, AgentSnapshot[]> {
  const grouped = new Map<string, AgentSnapshot[]>();
  for (const agent of agents) {
    grouped.set(agent.position, [...(grouped.get(agent.position) ?? []), agent]);
  }
  return grouped;
}

function ratio(value: number, max: number): number {
  if (max <= 0) {
    return 0;
  }
  return clamp(value / max, 0, 1);
}

function normalizeSafeFrameInsets(insets: SafeFrameInsets): SafeFrameInsets {
  return {
    top: normalizedSafeFrameInset(insets.top),
    right: normalizedSafeFrameInset(insets.right),
    bottom: normalizedSafeFrameInset(insets.bottom),
    left: normalizedSafeFrameInset(insets.left),
  };
}

function normalizedSafeFrameInset(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function sameSafeFrameInsets(
  left: SafeFrameInsets,
  right: SafeFrameInsets,
): boolean {
  return left.top === right.top
    && left.right === right.right
    && left.bottom === right.bottom
    && left.left === right.left;
}

function safeFrameViewportRect(
  viewport: DOMRect,
  insets: SafeFrameInsets,
): DOMRect {
  const normalized = normalizeSafeFrameInsets(insets);
  const left = clamp(viewport.left + normalized.left, viewport.left, viewport.right);
  const right = clamp(viewport.right - normalized.right, left, viewport.right);
  const top = clamp(viewport.top + normalized.top, viewport.top, viewport.bottom);
  const bottom = clamp(viewport.bottom - normalized.bottom, top, viewport.bottom);
  return new DOMRect(left, top, right - left, bottom - top);
}

function safeFrameCameraTarget({
  subjectTarget,
  cameraOffset,
  camera,
  viewport,
  insets,
}: {
  subjectTarget: THREE.Vector3;
  cameraOffset: THREE.Vector3;
  camera: THREE.PerspectiveCamera;
  viewport: DOMRect;
  insets: SafeFrameInsets;
}): THREE.Vector3 {
  if (viewport.width <= 0 || viewport.height <= 0 || cameraOffset.lengthSq() === 0) {
    return subjectTarget.clone();
  }
  const safeViewport = safeFrameViewportRect(viewport, insets);
  const viewportCenterX = viewport.left + viewport.width / 2;
  const viewportCenterY = viewport.top + viewport.height / 2;
  const safeCenterX = safeViewport.left + safeViewport.width / 2;
  const safeCenterY = safeViewport.top + safeViewport.height / 2;
  const desiredNdcX = (safeCenterX - viewportCenterX) / (viewport.width / 2);
  const desiredNdcY = (viewportCenterY - safeCenterY) / (viewport.height / 2);
  if (desiredNdcX === 0 && desiredNdcY === 0) {
    return subjectTarget.clone();
  }

  const viewDirection = cameraOffset.clone().multiplyScalar(-1).normalize();
  const screenRight = new THREE.Vector3().crossVectors(viewDirection, camera.up);
  if (screenRight.lengthSq() === 0) {
    return subjectTarget.clone();
  }
  screenRight.normalize();
  const screenUp = new THREE.Vector3().crossVectors(screenRight, viewDirection).normalize();
  const distance = cameraOffset.length();
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance;
  const aspect = Number.isFinite(camera.aspect) && camera.aspect > 0
    ? camera.aspect
    : viewport.width / viewport.height;
  const halfWidth = halfHeight * aspect;

  return subjectTarget
    .clone()
    .addScaledVector(screenRight, -desiredNdcX * halfWidth)
    .addScaledVector(screenUp, -desiredNdcY * halfHeight);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function boundedDebugString(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > MAX_RENDERED_EVENT_BEAT_STRING_LENGTH
    ? normalized.slice(0, MAX_RENDERED_EVENT_BEAT_STRING_LENGTH)
    : normalized;
}

function sstep(min: number, max: number, value: number): number {
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

function oceanAlphaAtRadius(radius: number): number {
  return 1 - sstep(OCEAN_FADE_START, OCEAN_FADE_END, radius);
}

function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
}

function fbm(x: number, y: number): number {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  for (let octave = 0; octave < 4; octave += 1) {
    sum += amplitude * vnoise(x * frequency, y * frequency);
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return sum / 0.9375;
}

function lerp(left: number, right: number, t: number): number {
  return left + (right - left) * t;
}

function segmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  const ex = ax + dx * t - px;
  const ez = az + dz * t - pz;
  return Math.hypot(ex, ez);
}

function stringHash(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function sampleCanvasPixels(canvas: HTMLCanvasElement): number {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) {
    return 0;
  }
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const sampleCount = 7;
  const pixel = new Uint8Array(4);
  let variance = 0;
  let previous = -1;
  for (let index = 0; index < sampleCount; index += 1) {
    const x = Math.floor((width * (index + 1)) / (sampleCount + 1));
    const y = Math.floor((height * ((index * 3) % sampleCount + 1)) / (sampleCount + 1));
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const value = pixel[0] + pixel[1] + pixel[2];
    if (previous >= 0) {
      variance += Math.abs(value - previous);
    }
    previous = value;
  }
  return variance;
}
