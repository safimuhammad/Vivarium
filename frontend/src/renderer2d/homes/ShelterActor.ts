import type { AssetLease } from "../assets/atlasStore";
import {
  DEMO_SHELTER_MANIFEST,
  validateShelterVisualManifest,
  type ShelterAtlasCellId,
  type ShelterLogicalComponentId,
  type ShelterRuinTier,
  type ShelterVisualManifest,
} from "../assets/shelterManifest";
import type { Vec2 } from "../contracts";

export type ShelterComponentId = ShelterLogicalComponentId;
export type ShelterPhase = "absent" | "building" | "standing" | "collapsing" | "ruin";

export interface ShelterComponentState {
  readonly id: ShelterComponentId;
  readonly visibility: number;
  readonly offset: Vec2;
  readonly rotation: number;
  readonly damaged: boolean;
  readonly frameId: ShelterAtlasCellId;
}

export interface ShelterVisualState {
  readonly manifestId: string;
  readonly dust: Readonly<{ frameId: ShelterAtlasCellId; intensity: number }>;
  readonly ruin: Readonly<{ tier: ShelterRuinTier | null; composition: readonly ShelterAtlasCellId[] }>;
}

export interface ShelterSnapshot2D {
  readonly id: string;
  readonly instanceId: number;
  readonly plot: Vec2;
  readonly phase: ShelterPhase;
  readonly components: readonly ShelterComponentState[];
  readonly elapsedMs: number;
  readonly emittedMarkers: readonly string[];
  readonly buildCommitCount: number;
  readonly collapseCommitCount: number;
  readonly visual: ShelterVisualState;
}

export type ShelterCommand =
  | { readonly type: "build"; readonly durationMs: number }
  | { readonly type: "collapse"; readonly durationMs: number }
  | { readonly type: "settle"; readonly phase: "standing" | "ruin" };

export type ShelterSignal = {
  readonly name: ShelterComponentId | "build-commit" | "collapse-commit";
  readonly atMs: number;
};

export interface ShelterActorPort {
  apply(command: ShelterCommand, nowMs: number): void;
  advanceTo(nowMs: number): readonly ShelterSignal[];
  snapshot(): ShelterSnapshot2D;
  reset(): void;
  dispose(): void;
}

export interface ShelterActorOptions {
  readonly id: string;
  readonly plot: Vec2;
  readonly atlasLease?: AssetLease<ImageBitmap>;
  readonly manifest?: ShelterVisualManifest;
}

interface MutableShelterComponentState {
  id: ShelterComponentId;
  visibility: number;
  offset: Vec2;
  rotation: number;
  damaged: boolean;
  frameId: ShelterAtlasCellId;
}

interface BoundShelterVisualContract {
  readonly manifestId: string;
  readonly dustFrameId: ShelterAtlasCellId;
  readonly components: Readonly<Record<ShelterComponentId, Readonly<{
    standing: ShelterAtlasCellId;
    damaged: ShelterAtlasCellId;
    falling: ShelterAtlasCellId;
  }>>>;
  readonly ruins: Readonly<Record<ShelterRuinTier, readonly ShelterAtlasCellId[]>>;
}

interface TimedMarker {
  readonly name: ShelterComponentId;
  readonly progress: number;
}

const COMPONENT_IDS: readonly ShelterComponentId[] = ["foundation", "posts", "walls", "roof", "door", "hearth"];
const BUILD_MARKERS: readonly TimedMarker[] = [
  { name: "foundation", progress: 0 },
  { name: "posts", progress: 0.18 },
  { name: "walls", progress: 0.38 },
  { name: "roof", progress: 0.62 },
  { name: "door", progress: 0.8 },
  { name: "hearth", progress: 0.92 },
];
const COLLAPSE_MARKERS: readonly TimedMarker[] = [
  { name: "hearth", progress: 0 },
  { name: "roof", progress: 0.18 },
  { name: "walls", progress: 0.4 },
  { name: "door", progress: 0.62 },
];
const DUST_START_PROGRESS = 0.7;
const DUST_END_PROGRESS = 0.96;
let nextInstanceId = 1;

function bindVisualContract(manifest: ShelterVisualManifest): BoundShelterVisualContract {
  const errors = validateShelterVisualManifest(manifest);
  if (errors.length > 0) throw new Error(`Invalid shelter visual manifest: ${errors.join("; ")}`);
  return {
    manifestId: manifest.id,
    dustFrameId: manifest.accents.dust,
    components: Object.fromEntries(COMPONENT_IDS.map((id) => [id, { ...manifest.components[id] }])) as BoundShelterVisualContract["components"],
    ruins: {
      full: [...manifest.ruins.full.composition],
      "picked-over": [...manifest.ruins["picked-over"].composition],
      "nearly-bare": [...manifest.ruins["nearly-bare"].composition],
    },
  };
}

function hiddenComponents(visual: BoundShelterVisualContract): MutableShelterComponentState[] {
  return COMPONENT_IDS.map((id) => ({
    id,
    visibility: 0,
    offset: { x: 0, y: 0 },
    rotation: 0,
    damaged: false,
    frameId: visual.components[id].standing,
  }));
}

function standingComponents(visual: BoundShelterVisualContract): MutableShelterComponentState[] {
  return COMPONENT_IDS.map((id) => ({
    id,
    visibility: 1,
    offset: { x: 0, y: 0 },
    rotation: 0,
    damaged: false,
    frameId: visual.components[id].standing,
  }));
}

function ruinComponents(visual: BoundShelterVisualContract): MutableShelterComponentState[] {
  return COMPONENT_IDS.map((id) => ({
    id,
    visibility: 0,
    offset: { x: 0, y: 0 },
    rotation: 0,
    damaged: true,
    frameId: visual.components[id].damaged,
  }));
}

function copyComponents(components: readonly MutableShelterComponentState[]): ShelterComponentState[] {
  return components.map(({ id, visibility, offset, rotation, damaged, frameId }) => ({
    id,
    visibility,
    offset: { ...offset },
    rotation,
    damaged,
    frameId,
  }));
}

function requireFiniteTime(nowMs: number): void {
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error("Shelter time must be a finite non-negative number.");
}

function requireDuration(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("Shelter duration must be a positive finite number.");
}

function requireCommand(command: ShelterCommand): void {
  if (!command || typeof command !== "object" || !("type" in command)) throw new Error("Invalid shelter command.");
  if (command.type === "build" || command.type === "collapse") {
    requireDuration(command.durationMs);
    return;
  }
  if (command.type === "settle" && (command.phase === "standing" || command.phase === "ruin")) return;
  throw new Error("Invalid shelter command.");
}

/** Creates one persistent shelter state machine at a deterministic world plot. */
export function createShelterActor(options: ShelterActorOptions): ShelterActorPort {
  if (!options.id) throw new Error("Shelter id must not be empty.");
  if (!Number.isFinite(options.plot.x) || !Number.isFinite(options.plot.y)) throw new Error("Shelter plot must be finite.");

  const id = options.id;
  const plot = { ...options.plot };
  const atlasLease = options.atlasLease;
  const visualContract = bindVisualContract(options.manifest ?? DEMO_SHELTER_MANIFEST);
  const instanceId = nextInstanceId++;
  let phase: ShelterPhase = "absent";
  let components = hiddenComponents(visualContract);
  let elapsedMs = 0;
  let startedAtMs: number | null = null;
  let durationMs = 0;
  let lastNowMs: number | null = null;
  let activeMarkers = new Set<string>();
  let emittedMarkers: string[] = [];
  let buildCommitCount = 0;
  let collapseCommitCount = 0;
  let dustIntensity = 0;
  let ruinTier: ShelterRuinTier | null = null;
  let ruinComposition: ShelterAtlasCellId[] = [];
  let disposed = false;

  const assertMonotonic = (nowMs: number): void => {
    requireFiniteTime(nowMs);
    if (lastNowMs !== null && nowMs < lastNowMs) throw new Error("Shelter time must be non-monotonic safe and never move backwards.");
  };

  const mutableComponent = (id: ShelterComponentId): MutableShelterComponentState => {
    const found = components.find((component) => component.id === id);
    if (!found) throw new Error(`Shelter component ${id} is missing.`);
    return found;
  };

  const emitMarker = (marker: TimedMarker, start: number, span: number): ShelterSignal => {
    activeMarkers.add(marker.name);
    emittedMarkers.push(marker.name);
    return { name: marker.name, atMs: start + marker.progress * span };
  };

  const applyBuildMarker = (id: ShelterComponentId): void => {
    const target = mutableComponent(id);
    target.visibility = 1;
    target.frameId = visualContract.components[id].standing;
  };

  const applyCollapseMarker = (id: ShelterComponentId): void => {
    const target = mutableComponent(id);
    target.damaged = true;
    target.frameId = visualContract.components[id].falling;
    if (id === "hearth") {
      target.visibility = 0;
    } else if (id === "roof") {
      target.offset = { x: 4, y: 3 };
      target.rotation = 0.18;
    } else if (id === "walls") {
      target.offset = { x: -3, y: 4 };
      target.rotation = -0.1;
    } else if (id === "door") {
      target.offset = { x: 2, y: 5 };
      target.rotation = 0.12;
    }
  };

  const snapshot = (): ShelterSnapshot2D => ({
    id,
    instanceId,
    plot: { ...plot },
    phase,
    components: copyComponents(components),
    elapsedMs,
    emittedMarkers: [...emittedMarkers],
    buildCommitCount,
    collapseCommitCount,
    visual: {
      manifestId: visualContract.manifestId,
      dust: { frameId: visualContract.dustFrameId, intensity: dustIntensity },
      ruin: { tier: ruinTier, composition: [...ruinComposition] },
    },
  });

  return {
    apply(command, nowMs) {
      if (disposed) return;
      requireCommand(command);
      assertMonotonic(nowMs);

      if (command.type === "build") {
        if (phase !== "absent") throw new Error(`Cannot build shelter while ${phase}.`);
        phase = "building";
        components = hiddenComponents(visualContract);
        durationMs = command.durationMs;
        startedAtMs = nowMs;
        elapsedMs = 0;
        activeMarkers = new Set();
        dustIntensity = 0;
        ruinTier = null;
        ruinComposition = [];
      } else if (command.type === "collapse") {
        if (phase !== "standing") throw new Error(`Cannot collapse shelter while ${phase}.`);
        phase = "collapsing";
        durationMs = command.durationMs;
        startedAtMs = nowMs;
        elapsedMs = 0;
        activeMarkers = new Set();
        dustIntensity = 0;
        ruinTier = null;
        ruinComposition = [];
      } else {
        phase = command.phase;
        components = command.phase === "standing" ? standingComponents(visualContract) : ruinComponents(visualContract);
        durationMs = 0;
        startedAtMs = null;
        elapsedMs = 0;
        activeMarkers = new Set();
        dustIntensity = 0;
        ruinTier = command.phase === "ruin" ? "full" : null;
        ruinComposition = command.phase === "ruin" ? [...visualContract.ruins.full] : [];
      }
      lastNowMs = nowMs;
    },

    advanceTo(nowMs) {
      if (disposed) return [];
      assertMonotonic(nowMs);
      lastNowMs = nowMs;
      if (startedAtMs === null || (phase !== "building" && phase !== "collapsing")) return [];

      const transitionEndAtMs = startedAtMs + durationMs;
      elapsedMs = nowMs >= transitionEndAtMs ? durationMs : Math.max(0, nowMs - startedAtMs);
      const signals: ShelterSignal[] = [];

      if (phase === "building") {
        for (const marker of BUILD_MARKERS) {
          const scheduledAtMs = startedAtMs + marker.progress * durationMs;
          if (nowMs < scheduledAtMs || activeMarkers.has(marker.name)) continue;
          applyBuildMarker(marker.name);
          signals.push(emitMarker(marker, startedAtMs, durationMs));
        }
        if (nowMs >= transitionEndAtMs && !activeMarkers.has("build-commit")) {
          activeMarkers.add("build-commit");
          emittedMarkers.push("build-commit");
          buildCommitCount += 1;
          phase = "standing";
          components = standingComponents(visualContract);
          signals.push({ name: "build-commit", atMs: transitionEndAtMs });
        }
      } else {
        for (const marker of COLLAPSE_MARKERS) {
          const scheduledAtMs = startedAtMs + marker.progress * durationMs;
          if (nowMs < scheduledAtMs || activeMarkers.has(marker.name)) continue;
          applyCollapseMarker(marker.name);
          signals.push(emitMarker(marker, startedAtMs, durationMs));
        }
        const dustStartAtMs = startedAtMs + DUST_START_PROGRESS * durationMs;
        const dustEndAtMs = startedAtMs + DUST_END_PROGRESS * durationMs;
        dustIntensity = nowMs >= dustStartAtMs && nowMs < dustEndAtMs ? 1 : 0;
        if (nowMs >= transitionEndAtMs && !activeMarkers.has("collapse-commit")) {
          activeMarkers.add("collapse-commit");
          emittedMarkers.push("collapse-commit");
          collapseCommitCount += 1;
          phase = "ruin";
          components = ruinComponents(visualContract);
          dustIntensity = 0;
          ruinTier = "full";
          ruinComposition = [...visualContract.ruins.full];
          signals.push({ name: "collapse-commit", atMs: transitionEndAtMs });
        }
      }

      return signals;
    },

    snapshot,

    reset() {
      if (disposed) return;
      phase = "absent";
      components = hiddenComponents(visualContract);
      elapsedMs = 0;
      startedAtMs = null;
      durationMs = 0;
      lastNowMs = null;
      activeMarkers = new Set();
      emittedMarkers = [];
      buildCommitCount = 0;
      collapseCommitCount = 0;
      dustIntensity = 0;
      ruinTier = null;
      ruinComposition = [];
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      atlasLease?.release();
    },
  };
}
