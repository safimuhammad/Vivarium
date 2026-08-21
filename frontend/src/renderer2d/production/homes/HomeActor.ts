import type { HomeSnapshot } from "../../../app/schemas";
import type { PresentedRecord } from "../../../presentation/contracts";
import type { Rect, Vec2 } from "../../contracts";
import type { RegionKitId } from "../maps/biomeKits";
import type {
  HomeComponentManifest,
  HomeYardManifest,
  NativeFrameRef,
  ProductionAssetLease,
  ProductionAssetManifest,
} from "../assets/productionManifest";
import { isProductionDiagnosticsForTestEnabled } from "../debug";

export interface PresentedHomeInput {
  readonly record: PresentedRecord<HomeSnapshot>;
  /** Cursor of the newest authoritative checkpoint, distinct from event projection. */
  readonly exactBaseCursor: number;
  /** Cursor through which evidence has been reapplied over the exact checkpoint. */
  readonly projectedThroughCursor: number;
  /** Latest checkpoint remnant truth; null when that exact partition has no usable value. */
  readonly exactRemnantMaterials: number | null;
  /** Newer visible event truth, retained separately until exact catch-up. */
  readonly projectedRemnantMaterials?: Readonly<{ value: number; evidenceCursor: number }>;
  readonly worldTime: number;
  readonly plot: Vec2;
  readonly door: Vec2;
  readonly kit: RegionKitId;
  /** Scene-owned construction state; never authoritative durable world truth. */
  readonly provisional?: boolean;
}

export interface HomeDurableVisualState {
  readonly status: "standing" | "ruin" | "unknown";
  readonly integrityRatio: number | null;
  readonly ownerId: string | null;
  readonly stakeholderIds: readonly string[] | null;
  readonly vaultMaterials: number | null;
  readonly hoarding: boolean | null;
  readonly breacherIds: readonly string[] | null;
  readonly remnantMaterials: number | null;
  readonly ruinSweepAge: number | null;
}

export type HomePrimitiveCommand =
  | Readonly<{ kind: "build" | "damage" | "collapse"; durationMs: number }>
  | Readonly<{ kind: "scavenge"; durationMs: number; remnantMaterialsAfter: number }>
  | Readonly<{ kind: "door"; state: "open" | "closed" }>
  | Readonly<{ kind: "hearth"; state: "warm" | "quiet" }>
  | Readonly<{ kind: "loot" | "claim"; durationMs: number }>;

export interface ProductionHomeSignal {
  readonly name: string;
  readonly atMs: number;
}

export interface HomeActorSnapshot {
  readonly id: string;
  readonly instanceId: number;
  readonly kit: RegionKitId;
  readonly plot: Vec2;
  readonly door: Vec2;
  readonly durable: HomeDurableVisualState;
  readonly diagnostics: Readonly<{
    rawIntegrity: number | null;
    rawMaxIntegrity: number | null;
    integrityClamped: boolean;
  }>;
  readonly geometry: Readonly<{
    logicalBounds: Readonly<{ width: number; height: number }>;
    doorClearance: Rect;
  }>;
  readonly occupantIds: readonly [];
  readonly marks: readonly HomeVisualMark[];
  readonly cues: readonly HomeVisualCue[];
  /** Whether the observer's current selection is this home; drives status-mark visibility. */
  readonly selected: boolean;
  readonly visual: Readonly<{
    backComponents: readonly string[];
    frontComponents: readonly string[];
    ruinFrameId: string | null;
  }>;
  readonly transient: Readonly<{
    readonly provisional: boolean;
    activeKind: TimedHomeKind | null;
    doorState: "open" | "closed";
    hearthState: "warm" | "quiet";
    progress: number;
    emittedMarkers: readonly string[];
  }>;
}

export interface HomeVisualMark {
  readonly kind: "owner" | "stakeholder" | "vault" | "hoarding" | "breacher" | "loot" | "claim";
  readonly subjectId: string | null;
  readonly frameId: string;
  readonly slot: number;
}

export interface HomeVisualCue {
  readonly kind: "unknown-hatch";
  readonly shape: "hatch";
  readonly colorIndependent: true;
}

interface BoundHomeManifest {
  readonly kit: RegionKitId;
  readonly atlasId: string;
  readonly detailAtlasId: string;
  readonly ruinAtlasId: string;
  readonly logicalBounds: Readonly<{ width: number; height: number }>;
  readonly doorClearance: Rect;
  readonly backComponents: ReadonlySet<string>;
  readonly frontComponents: ReadonlySet<string>;
  readonly frames: Readonly<Record<string, NativeFrameRef>>;
  readonly detailFrames: Readonly<Record<string, NativeFrameRef>>;
  readonly ruinFrames: Readonly<Record<string, NativeFrameRef>>;
  readonly yard: BoundHomeYardManifest;
}

interface BoundHomeYardManifest {
  readonly atlasId: string;
  readonly renderSizePx: HomeYardManifest["renderSizePx"];
  readonly plotOffsetPx: HomeYardManifest["plotOffsetPx"];
  readonly standingVariants: readonly NativeFrameRef[];
  readonly warmFrame: NativeFrameRef;
  readonly hoardingFrame: NativeFrameRef;
  readonly ruinFrame: NativeFrameRef;
}

type TimedHomeKind = "build" | "damage" | "loot" | "claim" | "collapse" | "scavenge";

interface TimedMarker {
  readonly name: string;
  readonly progress: number;
}

interface ActiveTimedCommand {
  readonly kind: TimedHomeKind;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly markers: readonly TimedMarker[];
  readonly emitted: Set<string>;
}

const TIMED_MARKERS: Readonly<Record<TimedHomeKind, readonly TimedMarker[]>> = {
  build: [
    { name: "foundation", progress: 0 },
    { name: "post", progress: 0.18 },
    { name: "walls", progress: 0.38 },
    { name: "roof", progress: 0.62 },
    { name: "door", progress: 0.8 },
    { name: "hearth", progress: 0.92 },
    { name: "build-commit", progress: 1 },
  ],
  damage: [
    { name: "impact", progress: 0 },
    { name: "crack", progress: 0.55 },
    { name: "damage-commit", progress: 1 },
  ],
  loot: [
    { name: "reach", progress: 0 },
    { name: "transfer", progress: 0.5 },
    { name: "loot-commit", progress: 1 },
  ],
  claim: [
    { name: "mark", progress: 0 },
    { name: "claim-commit", progress: 1 },
  ],
  collapse: [
    { name: "hearth", progress: 0 },
    { name: "roof", progress: 0.18 },
    { name: "walls", progress: 0.4 },
    { name: "door", progress: 0.62 },
    { name: "collapse-commit", progress: 1 },
  ],
  scavenge: [
    { name: "lift", progress: 0 },
    { name: "debris", progress: 0.5 },
    { name: "scavenge-commit", progress: 1 },
  ],
};

const REQUIRED_DURABLE_FIELDS = [
  "integrity",
  "max_integrity",
  "owner_id",
  "stakeholders",
  "vault_materials",
  "is_hoarding",
  "breachers",
  "remnant_materials",
] as const;
const MAX_STAKEHOLDER_MARKS = 4;
let nextInstanceId = 1;

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finitePoint(point: Vec2, label: string): Vec2 {
  if (!finite(point.x) || !finite(point.y) || !Number.isInteger(point.x) || !Number.isInteger(point.y)) {
    throw new Error(`${label} must use finite integer coordinates.`);
  }
  return { x: point.x, y: point.y };
}

function requireTime(nowMs: number): void {
  if (!finite(nowMs) || nowMs < 0) throw new Error("Home time must be finite and non-negative.");
}

function exactCursor(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Home exact checkpoint cursor must be a non-negative safe integer.");
  }
  return value;
}

function exactRemnant(value: number | null): number | null {
  return finite(value) && value >= 0 ? value : null;
}

function projectedRemnant(
  value: PresentedHomeInput["projectedRemnantMaterials"],
  exactBaseCursor: number,
  projectedThroughCursor: number,
): Readonly<{ value: number; evidenceCursor: number }> | undefined {
  if (value === undefined) return undefined;
  const cursor = exactCursor(value.evidenceCursor);
  if (!finite(value.value) || value.value < 0 || cursor > projectedThroughCursor) return undefined;
  return cursor > exactBaseCursor ? { value: value.value, evidenceCursor: cursor } : undefined;
}

function requireDuration(durationMs: number): void {
  if (!finite(durationMs) || durationMs <= 0) throw new Error("Home duration must be positive and finite.");
}

function copyFrame(frame: NativeFrameRef): NativeFrameRef {
  return {
    atlasId: frame.atlasId,
    rect: { ...frame.rect },
    durationMs: frame.durationMs,
    feet: { ...frame.feet },
    faceAnchor: { ...frame.faceAnchor },
    heldAnchor: { ...frame.heldAnchor },
  };
}

function bindHomeYard(source: HomeYardManifest): BoundHomeYardManifest {
  const frames = [
    ...source.standingVariants,
    source.warmFrame,
    source.hoardingFrame,
    source.ruinFrame,
  ];
  if (source.standingVariants.length !== 2 || frames.some(({ atlasId }) => atlasId !== source.atlasId)) {
    throw new Error("Production home yard requires two standing bases and one shared atlas.");
  }
  return {
    atlasId: source.atlasId,
    renderSizePx: { ...source.renderSizePx },
    plotOffsetPx: { ...source.plotOffsetPx },
    standingVariants: source.standingVariants.map(copyFrame),
    warmFrame: copyFrame(source.warmFrame),
    hoardingFrame: copyFrame(source.hoardingFrame),
    ruinFrame: copyFrame(source.ruinFrame),
  };
}

function bindHomeManifest(source: HomeComponentManifest): BoundHomeManifest {
  const backComponents = new Set(source.backComponents);
  const frontComponents = new Set(source.frontComponents);
  for (const component of backComponents) {
    if (frontComponents.has(component)) throw new Error(`Home component ${component} belongs to both draw passes.`);
  }
  if (source.logicalBounds.width <= 48 || source.logicalBounds.height <= 64) {
    throw new Error("Production home bounds must be larger than a human.");
  }
  if (source.doorClearance.width < 30 || source.doorClearance.height < 42) {
    throw new Error("Production home door clearance cannot admit a human.");
  }
  return {
    kit: source.kit,
    atlasId: source.atlasId,
    detailAtlasId: source.detailAtlasId,
    ruinAtlasId: source.ruinAtlasId,
    logicalBounds: { ...source.logicalBounds },
    doorClearance: { ...source.doorClearance },
    backComponents,
    frontComponents,
    frames: Object.fromEntries(Object.entries(source.frames).map(([id, frame]) => [id, copyFrame(frame)])),
    detailFrames: Object.fromEntries(Object.entries(source.detailFrames).map(([id, frame]) => [id, copyFrame(frame)])),
    ruinFrames: Object.fromEntries(Object.entries(source.ruinFrames).map(([id, frame]) => [id, copyFrame(frame)])),
    yard: bindHomeYard(source.yard),
  };
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function stringValue(value: Readonly<Partial<HomeSnapshot>>, key: keyof HomeSnapshot): string | null {
  const candidate = value[key];
  return hasOwn(value, key) && typeof candidate === "string" ? candidate : null;
}

function numberValue(value: Readonly<Partial<HomeSnapshot>>, key: keyof HomeSnapshot): number | null {
  const candidate = value[key];
  return hasOwn(value, key) && finite(candidate) ? candidate : null;
}

function nonNegativeNumberValue(
  value: Readonly<Partial<HomeSnapshot>>,
  key: "remnant_materials",
): number | null {
  const candidate = value[key];
  return hasOwn(value, key) && finite(candidate) && candidate >= 0 ? candidate : null;
}

function stringArrayValue(value: Readonly<Partial<HomeSnapshot>>, key: "stakeholders" | "breachers"): string[] | null {
  const candidate = value[key];
  return hasOwn(value, key) && Array.isArray(candidate) && candidate.every((item) => typeof item === "string")
    ? [...candidate]
    : null;
}

function booleanValue(value: Readonly<Partial<HomeSnapshot>>, key: "is_hoarding"): boolean | null {
  const candidate = value[key];
  return hasOwn(value, key) && typeof candidate === "boolean" ? candidate : null;
}

function deriveDurable(input: PresentedHomeInput): {
  durable: HomeDurableVisualState;
  diagnostics: HomeActorSnapshot["diagnostics"];
  unknown: boolean;
} {
  const value = input.record.value;
  const status = value.status === "standing" || value.status === "ruin" ? value.status : "unknown";
  const rawIntegrity = numberValue(value, "integrity");
  const rawMaxIntegrity = numberValue(value, "max_integrity");
  const rawRatio = rawIntegrity !== null && rawMaxIntegrity !== null && rawMaxIntegrity > 0
    ? rawIntegrity / rawMaxIntegrity
    : null;
  const integrityRatio = rawRatio === null ? null : Math.max(0, Math.min(1, rawRatio));
  const ruinedAt = numberValue(value, "ruined_at");
  const ruinSweepAge = status === "ruin" && finite(input.worldTime) && ruinedAt !== null
    ? Math.max(0, input.worldTime - ruinedAt)
    : null;
  const durable: HomeDurableVisualState = {
    status,
    integrityRatio,
    ownerId: stringValue(value, "owner_id"),
    stakeholderIds: stringArrayValue(value, "stakeholders"),
    vaultMaterials: numberValue(value, "vault_materials"),
    hoarding: booleanValue(value, "is_hoarding"),
    breacherIds: stringArrayValue(value, "breachers"),
    remnantMaterials: nonNegativeNumberValue(value, "remnant_materials"),
    ruinSweepAge,
  };
  return {
    durable,
    diagnostics: {
      rawIntegrity,
      rawMaxIntegrity,
      integrityClamped: rawRatio !== null && rawRatio !== integrityRatio,
    },
    unknown: status === "unknown"
      || (status === "ruin" && durable.remnantMaterials === null)
      || (input.record.completeness === "projected-partial"
        && REQUIRED_DURABLE_FIELDS.some((field) => !hasOwn(value, field))),
  };
}

function cloneDurable(value: HomeDurableVisualState): HomeDurableVisualState {
  return {
    ...value,
    stakeholderIds: value.stakeholderIds === null ? null : [...value.stakeholderIds],
    breacherIds: value.breacherIds === null ? null : [...value.breacherIds],
  };
}

function componentState(ratio: number | null): "intact" | "damaged" | "broken" {
  if (ratio === null || ratio >= 0.67) return "intact";
  if (ratio >= 0.34) return "damaged";
  return "broken";
}

function makeMarks(durable: HomeDurableVisualState, activeKind: TimedHomeKind | null): HomeVisualMark[] {
  const marks: HomeVisualMark[] = [];
  if (durable.ownerId !== null) {
    marks.push({ kind: "owner", subjectId: durable.ownerId, frameId: "home-detail-0", slot: 0 });
  }
  for (const [slot, stakeholder] of (durable.stakeholderIds ?? []).slice(0, MAX_STAKEHOLDER_MARKS).entries()) {
    marks.push({ kind: "stakeholder", subjectId: stakeholder, frameId: `home-detail-${slot + 1}`, slot });
  }
  if (durable.vaultMaterials !== null) {
    marks.push({ kind: "vault", subjectId: null, frameId: "home-detail-5", slot: 0 });
  }
  if (durable.hoarding === true) {
    marks.push({ kind: "hoarding", subjectId: null, frameId: "home-detail-6", slot: 0 });
  }
  for (const [slot, breacher] of (durable.breacherIds ?? []).slice(0, 4).entries()) {
    marks.push({ kind: "breacher", subjectId: breacher, frameId: "home-detail-7", slot });
  }
  if (activeKind === "loot") marks.push({ kind: "loot", subjectId: null, frameId: "home-detail-9", slot: 0 });
  if (activeKind === "claim") marks.push({ kind: "claim", subjectId: null, frameId: "home-detail-10", slot: 0 });
  return marks;
}

/** Presents one authoritative home or persistent ruin without interpreting events. */
export class HomeActor {
  readonly #id: string;
  readonly #instanceId: number;
  readonly #home: BoundHomeManifest;
  readonly #componentLease: ProductionAssetLease;
  readonly #detailLease: ProductionAssetLease;
  readonly #ruinLease: ProductionAssetLease;
  readonly #yardLease: ProductionAssetLease;
  readonly #yardBaseFrame: NativeFrameRef;
  #plot: Vec2;
  #door: Vec2;
  #durable: HomeDurableVisualState;
  #diagnostics: HomeActorSnapshot["diagnostics"];
  #unknown: boolean;
  #provisional: boolean;
  #doorState: "open" | "closed" = "closed";
  #hearthState: "warm" | "quiet" = "quiet";
  #selected = false;
  #active: ActiveTimedCommand | null = null;
  #progress = 0;
  #emittedMarkers: string[] = [];
  #exactBaseCursor: number;
  #exactRemnantMaterials: number | null;
  #previousReconcileProvenance: Readonly<{
    cursor: number;
    remnantMaterials: number | null;
    projectedRemnantMaterials: Readonly<{ value: number; evidenceCursor: number }> | undefined;
  }> | null = null;
  #projectedRemnantMaterials: Readonly<{ value: number; evidenceCursor: number }> | undefined;
  #lastNowMs: number | null = null;
  #disposed = false;

  constructor(options: Readonly<{
    id: string;
    manifest: ProductionAssetManifest;
    atlasLeases: ReadonlyMap<string, ProductionAssetLease>;
    initial: PresentedHomeInput;
  }>) {
    if (typeof options.id !== "string" || options.id.length === 0) throw new Error("Home id must not be empty.");
    const pack = options.manifest.regions[options.initial.kit];
    if (!pack) throw new Error(`Missing regional home manifest ${options.initial.kit}.`);
    this.#home = bindHomeManifest(pack.homeManifest);
    const componentLease = options.atlasLeases.get(this.#home.atlasId);
    const detailLease = options.atlasLeases.get(this.#home.detailAtlasId);
    const ruinLease = options.atlasLeases.get(this.#home.ruinAtlasId);
    const yardLease = options.atlasLeases.get(this.#home.yard.atlasId);
    if (!componentLease || !detailLease || !ruinLease || !yardLease) {
      const missing = [
        componentLease ? null : this.#home.atlasId,
        detailLease ? null : this.#home.detailAtlasId,
        ruinLease ? null : this.#home.ruinAtlasId,
        yardLease ? null : this.#home.yard.atlasId,
      ].filter((id): id is string => id !== null);
      throw new Error(
        `Home ${options.id} requires four regional atlas leases; `
        + `kit ${options.initial.kit} is missing ${missing.join(", ")}. `
        + `Leases offered: ${[...options.atlasLeases.keys()].join(", ") || "(none)"}.`,
      );
    }
    this.#id = options.id;
    this.#instanceId = nextInstanceId++;
    this.#componentLease = componentLease;
    this.#detailLease = detailLease;
    this.#ruinLease = ruinLease;
    this.#yardLease = yardLease;
    this.#yardBaseFrame = this.#home.yard.standingVariants[
      stableHash(`${options.id}\0home-yard-base`) % this.#home.yard.standingVariants.length
    ]!;
    this.#plot = finitePoint(options.initial.plot, "Home plot");
    this.#door = finitePoint(options.initial.door, "Home door");
    const derived = deriveDurable(options.initial);
    this.#exactBaseCursor = exactCursor(options.initial.exactBaseCursor);
    const initialProjectedThrough = exactCursor(options.initial.projectedThroughCursor);
    if (initialProjectedThrough < this.#exactBaseCursor) {
      throw new Error("Home projected-through cursor cannot precede its exact checkpoint cursor.");
    }
    this.#exactRemnantMaterials = exactRemnant(options.initial.exactRemnantMaterials);
    this.#projectedRemnantMaterials = projectedRemnant(
      options.initial.projectedRemnantMaterials,
      this.#exactBaseCursor,
      initialProjectedThrough,
    );
    this.#provisional = options.initial.provisional === true;
    this.#durable = derived.durable.status === "ruin"
      ? { ...derived.durable, remnantMaterials: this.#exactRemnantMaterials }
      : derived.durable;
    this.#diagnostics = derived.diagnostics;
    this.#unknown = (derived.unknown
      || (derived.durable.status === "ruin"
        && this.#exactRemnantMaterials === null
        && this.#projectedRemnantMaterials === undefined))
      && !this.#provisional;
  }

  reconcile(input: PresentedHomeInput, mode: "forward" | "transaction-rollback" = "forward"): void {
    if (this.#disposed) return;
    if (input.kit !== this.#home.kit) throw new Error("A HomeActor cannot change regional kit in place.");
    const plot = finitePoint(input.plot, "Home plot");
    const door = finitePoint(input.door, "Home door");
    const derived = deriveDurable(input);
    const nextExactBaseCursor = exactCursor(input.exactBaseCursor);
    const nextProjectedThroughCursor = exactCursor(input.projectedThroughCursor);
    if (nextProjectedThroughCursor < nextExactBaseCursor) {
      throw new Error("Home projected-through cursor cannot precede its exact checkpoint cursor.");
    }
    if (mode === "forward" && nextExactBaseCursor < this.#exactBaseCursor) {
      throw new Error("Home exact checkpoint cursor cannot regress.");
    }
    const presentedProjection = mode === "forward"
      ? projectedRemnant(
          input.projectedRemnantMaterials,
          nextExactBaseCursor,
          nextProjectedThroughCursor,
        )
      : undefined;
    let durable = derived.durable;
    if (mode === "transaction-rollback") {
      if (this.#previousReconcileProvenance?.cursor !== nextExactBaseCursor) {
        throw new Error("Home transaction rollback does not match the previous reconciliation.");
      }
      this.#exactBaseCursor = this.#previousReconcileProvenance.cursor;
      this.#exactRemnantMaterials = this.#previousReconcileProvenance.remnantMaterials;
      this.#projectedRemnantMaterials = this.#previousReconcileProvenance.projectedRemnantMaterials;
      this.#previousReconcileProvenance = null;
      if (derived.durable.status === "ruin") {
        durable = { ...derived.durable, remnantMaterials: this.#exactRemnantMaterials };
      }
    } else {
      this.#previousReconcileProvenance = {
        cursor: this.#exactBaseCursor,
        remnantMaterials: this.#exactRemnantMaterials,
        projectedRemnantMaterials: this.#projectedRemnantMaterials,
      };
      if (nextExactBaseCursor > this.#exactBaseCursor) {
        this.#exactBaseCursor = nextExactBaseCursor;
        this.#exactRemnantMaterials = exactRemnant(input.exactRemnantMaterials);
      }
      if (derived.durable.status === "ruin") {
        durable = { ...derived.durable, remnantMaterials: this.#exactRemnantMaterials };
      }
      if (presentedProjection !== undefined) {
        this.#projectedRemnantMaterials = presentedProjection;
      } else if (nextProjectedThroughCursor === nextExactBaseCursor
        || derived.durable.status !== "ruin") {
        this.#projectedRemnantMaterials = undefined;
      }
    }
    this.#provisional = input.provisional === true;
    this.#plot = plot;
    this.#door = door;
    this.#durable = durable;
    this.#diagnostics = derived.diagnostics;
    this.#unknown = (derived.unknown
      || (derived.durable.status === "ruin"
        && this.#exactRemnantMaterials === null
        && this.#projectedRemnantMaterials === undefined))
      && !this.#provisional;
    if (derived.durable.status !== "ruin"
      || (this.#projectedRemnantMaterials !== undefined
        && this.#projectedRemnantMaterials.evidenceCursor <= this.#exactBaseCursor)) {
      this.#projectedRemnantMaterials = undefined;
    }
  }

  apply(command: HomePrimitiveCommand, nowMs: number, evidenceCursor: number | null = null): void {
    if (this.#disposed) return;
    requireTime(nowMs);
    this.#assertMonotonic(nowMs);
    if (command.kind === "door") {
      if (command.state !== "open" && command.state !== "closed") throw new Error("Invalid home door state.");
      this.#doorState = command.state;
    } else if (command.kind === "hearth") {
      if (command.state !== "warm" && command.state !== "quiet") throw new Error("Invalid home hearth state.");
      this.#hearthState = command.state;
    } else {
      requireDuration(command.durationMs);
      if (command.kind === "scavenge") {
        if (!finite(command.remnantMaterialsAfter) || command.remnantMaterialsAfter < 0) {
          throw new RangeError("Scavenge remnant materials must be a non-negative finite number.");
        }
        if (evidenceCursor === null) {
          throw new Error("Scavenge projection requires its evidence cursor.");
        }
        const cursor = exactCursor(evidenceCursor);
        this.#projectedRemnantMaterials = cursor > this.#exactBaseCursor
          ? { value: command.remnantMaterialsAfter, evidenceCursor: cursor }
          : undefined;
      }
      this.#active = {
        kind: command.kind,
        startedAtMs: nowMs,
        durationMs: command.durationMs,
        markers: TIMED_MARKERS[command.kind],
        emitted: new Set(),
      };
      this.#progress = 0;
      this.#emittedMarkers = [];
    }
    this.#lastNowMs = nowMs;
  }

  advanceTo(nowMs: number): readonly ProductionHomeSignal[] {
    if (this.#disposed) return [];
    requireTime(nowMs);
    this.#assertMonotonic(nowMs);
    this.#lastNowMs = nowMs;
    if (this.#active === null) return [];
    const active = this.#active;
    this.#progress = Math.max(0, Math.min(1, (nowMs - active.startedAtMs) / active.durationMs));
    const signals: ProductionHomeSignal[] = [];
    for (const marker of active.markers) {
      const atMs = active.startedAtMs + marker.progress * active.durationMs;
      if (nowMs < atMs || active.emitted.has(marker.name)) continue;
      active.emitted.add(marker.name);
      this.#emittedMarkers.push(marker.name);
      signals.push({ name: marker.name, atMs });
    }
    if (this.#progress >= 1) this.#active = null;
    return signals;
  }

  draw(context: CanvasRenderingContext2D, pass: "back" | "front"): void {
    if (this.#disposed) return;
    if (pass !== "back" && pass !== "front") throw new Error("Home draw pass must be back or front.");
    context.imageSmoothingEnabled = false;
    const visual = this.#visual();
    if (pass === "back") {
      const yardAt = {
        x: this.#plot.x + this.#home.yard.plotOffsetPx.x,
        y: this.#plot.y + this.#home.yard.plotOffsetPx.y,
      };
      for (const frame of this.#yardFrames(visual)) {
        this.#drawFrame(
          context,
          this.#yardLease.value,
          frame,
          yardAt,
          this.#home.yard.renderSizePx.width,
          this.#home.yard.renderSizePx.height,
        );
      }
    }
    if (this.#durable.status === "ruin") {
      if (pass === "back" && visual.ruinFrameId !== null) {
        this.#drawFrame(context, this.#ruinLease.value, this.#home.ruinFrames[visual.ruinFrameId], this.#plot, 128, 128);
      }
    } else {
      const components = pass === "back" ? visual.backComponents : visual.frontComponents;
      for (const id of components) {
        this.#drawFrame(context, this.#componentLease.value, this.#home.frames[id], this.#plot, 128, 128);
      }
    }
    if (pass === "front") {
      // Owner decision: status-mark badges (owner/stakeholder/vault/hoarding/
      // breacher/loot/claim) are visual noise during ordinary viewing -- draw
      // them only while this home is the observer's current selection. See
      // `setSelected()`.
      if (this.#selected) {
        for (const [index, mark] of makeMarks(this.#durable, this.#active?.kind ?? null).entries()) {
          const frame = this.#home.detailFrames[mark.frameId];
          this.#drawFrame(context, this.#detailLease.value, frame, this.#markAt(index), 32, 32);
        }
      }
      // `#drawUnknownHatch` is a developer/QA diagnostic (an internal
      // presentation-completeness signal, not in-universe home decor) and
      // must never leak into normal viewing -- gated behind the same
      // pre-document test flag `debug.ts` uses for its other developer-only
      // instrumentation. See that flag's doc comment and `#drawUnknownHatch`
      // below for the full rationale.
      if (this.#unknown && isProductionDiagnosticsForTestEnabled()) {
        this.#drawUnknownHatch(context);
      }
    }
  }

  /**
   * Sets whether the observer's current selection is this home.
   *
   * Purely a rendering-visibility toggle (no durable/world-state
   * implication, no validation, cannot throw) -- gates whether `draw()`'s
   * front pass draws this home's status-mark badges (see `draw()`). Mirrors
   * `LayeredHumanActor`'s `#selected`/`set-selected` idiom, driven the same
   * way from `ProductionSceneGraph`'s per-frame reconciliation of
   * `frame.selection`.
   */
  setSelected(selected: boolean): void {
    if (this.#disposed) return;
    this.#selected = selected;
  }

  snapshot(): HomeActorSnapshot {
    const visual = this.#visual();
    return {
      id: this.#id,
      instanceId: this.#instanceId,
      kit: this.#home.kit,
      plot: { ...this.#plot },
      door: { ...this.#door },
      durable: cloneDurable(this.#durable),
      diagnostics: { ...this.#diagnostics },
      geometry: {
        logicalBounds: { ...this.#home.logicalBounds },
        doorClearance: { ...this.#home.doorClearance },
      },
      occupantIds: [],
      marks: makeMarks(this.#durable, this.#active?.kind ?? null).map((mark) => ({ ...mark })),
      cues: this.#unknown ? [{ kind: "unknown-hatch", shape: "hatch", colorIndependent: true }] : [],
      selected: this.#selected,
      visual: {
        backComponents: [...visual.backComponents],
        frontComponents: [...visual.frontComponents],
        ruinFrameId: visual.ruinFrameId,
      },
      transient: {
        provisional: this.#provisional,
        activeKind: this.#active?.kind ?? null,
        doorState: this.#doorState,
        hearthState: this.#hearthState,
        progress: this.#progress,
        emittedMarkers: [...this.#emittedMarkers],
      },
    };
  }

  nextDeadlineMs(): number | null {
    if (this.#disposed || this.#active === null) return null;
    const floor = this.#lastNowMs ?? this.#active.startedAtMs;
    const next = this.#active.markers.find((marker) => (
      !this.#active?.emitted.has(marker.name)
      && this.#active !== null
      && this.#active.startedAtMs + marker.progress * this.#active.durationMs > floor
    ));
    return next ? this.#active.startedAtMs + next.progress * this.#active.durationMs : null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const released = new Set<ProductionAssetLease>();
    for (const lease of [this.#componentLease, this.#detailLease, this.#ruinLease, this.#yardLease]) {
      if (released.has(lease)) continue;
      released.add(lease);
      lease.release();
    }
  }

  #assertMonotonic(nowMs: number): void {
    if (this.#lastNowMs !== null && nowMs < this.#lastNowMs) throw new Error("Home time cannot move backwards.");
  }

  #visual(): { backComponents: string[]; frontComponents: string[]; ruinFrameId: string | null } {
    if (this.#provisional && this.#active?.kind !== "build") {
      return { backComponents: [], frontComponents: [], ruinFrameId: null };
    }
    if (this.#durable.status === "ruin") {
      const remnantMaterials = this.#projectedRemnantMaterials?.value ?? this.#durable.remnantMaterials;
      const base = remnantMaterials === 0 ? "rubble-bare" : "rubble-full";
      const ruinFrameId = this.#active?.kind === "scavenge" ? `${base}-scavenge` : base;
      return { backComponents: [], frontComponents: [], ruinFrameId };
    }
    const state = componentState(this.#durable.integrityRatio);
    let wall = state === "intact" ? "wall-intact" : state === "damaged" ? "wall-cracked" : "wall-broken";
    let roof = state === "intact" ? "roof-intact" : "roof-damaged";
    let door = this.#doorState === "open" ? "door-open" : "door-closed";
    let window = this.#hearthState === "warm" ? "window-lit" : "window-cold";
    let hearth = this.#hearthState === "warm" ? "hearth-lit-1" : "hearth-cold";
    if (this.#active?.kind === "build") {
      const emitted = this.#active.emitted;
      const backComponents = [
        emitted.has("foundation") ? "foundation" : null,
        emitted.has("post") ? "post" : null,
        emitted.has("walls") ? wall : null,
        emitted.has("walls") ? window : null,
        emitted.has("hearth") ? hearth : null,
        emitted.has("hearth") ? "chimney" : null,
      ].filter((id): id is string => id !== null && this.#home.backComponents.has(id));
      const frontComponents = [
        emitted.has("roof") ? roof : null,
        emitted.has("door") ? door : null,
      ].filter((id): id is string => id !== null && this.#home.frontComponents.has(id));
      return { backComponents, frontComponents, ruinFrameId: null };
    }
    if (this.#active?.kind === "damage") {
      wall = "wall-cracked";
      roof = "roof-damaged";
    } else if (this.#active?.kind === "collapse") {
      wall = this.#active.emitted.has("walls") ? "wall-falling" : "wall-broken";
      roof = this.#active.emitted.has("roof") ? "roof-falling" : "roof-damaged";
      door = this.#active.emitted.has("door") ? "door-falling" : "door-breached";
      window = "window-broken";
      hearth = "hearth-cold";
    }
    const backComponents = ["foundation", "post", wall, window, hearth, "chimney"]
      .filter((id) => this.#home.backComponents.has(id));
    const frontComponents = [roof, door].filter((id) => this.#home.frontComponents.has(id));
    return { backComponents, frontComponents, ruinFrameId: null };
  }

  #yardFrames(visual: Readonly<{
    backComponents: readonly string[];
    frontComponents: readonly string[];
    ruinFrameId: string | null;
  }>): readonly NativeFrameRef[] {
    const visibleFoundation = visual.backComponents.includes("foundation");
    if (this.#provisional && !visibleFoundation) return [];
    if (!this.#provisional && this.#durable.status === "unknown") return [];
    if (this.#durable.status === "ruin") return [this.#home.yard.ruinFrame];

    const frames = [this.#yardBaseFrame];
    if (visual.backComponents.some((id) => id.startsWith("hearth-lit"))) {
      frames.push(this.#home.yard.warmFrame);
    }
    if (this.#durable.hoarding === true) frames.push(this.#home.yard.hoardingFrame);
    return frames;
  }

  /**
   * Positions the Nth status-mark badge (owner/stakeholder/vault/hoarding/
   * breacher/loot/claim -- see {@link makeMarks}) against the structure
   * instead of floating above it.
   *
   * Previously this anchored row 0 at `plot.y + 0`, i.e. the very top edge of
   * the home's 128x128 draw cell. Every kit's roof sits at the top of that
   * cell (the ground line lands near the cell's bottom -- confirmed by the
   * hut-kit derivation's own per-cell alpha-bounding-box measurements), so
   * that anchor drew every badge hovering in open air above/beside the roof,
   * fully detached from the building. Since the owner mark alone is drawn for
   * every owned standing home, this was not a rare edge case: it floated on
   * effectively every home in the game. Reported live as small badge icons
   * (a yellow owner banner, a green stakeholder banner) hovering near the
   * roofline, "detached from the building and reading as visual noise."
   *
   * The fix anchors row 0 at the structure's own ground line
   * (`logicalBounds.height`, shared by every kit) and stacks additional rows
   * upward from there, so the common 1-3-mark case (most homes: an owner plus
   * a couple of stakeholders) sits against the wall at ground level, flanking
   * the door, instead of floating in the sky. The two columns are unchanged
   * from the original design (`index % 2` picks left/right) and remain clear
   * of `doorClearance` in x for every row, regardless of how many rows stack.
   */
  #markAt(index: number): Vec2 {
    const column = index % 2 === 0 ? 0 : 96;
    const row = Math.floor(index / 2);
    return {
      x: this.#plot.x + column,
      y: this.#plot.y + (this.#home.logicalBounds.height - 32) - row * 32,
    };
  }

  #drawFrame(
    context: CanvasRenderingContext2D,
    image: ImageBitmap,
    frame: NativeFrameRef | undefined,
    at: Vec2,
    width: number,
    height: number,
  ): void {
    if (!frame) throw new Error("Home visual frame is missing from the active regional manifest.");
    const rect = frame.rect;
    if (![rect.x, rect.y, rect.width, rect.height, at.x, at.y, width, height].every(Number.isInteger)) {
      throw new Error("Home draw requires integer source and destination rectangles.");
    }
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, at.x, at.y, width, height);
  }

  /**
   * Draws the developer/QA "unknown" diagnostic hatch: a small black-outlined
   * square with a diagonal double-stroke, at the top-left of the plot cell.
   *
   * This is `#unknown`'s ONLY visual expression -- `#unknown` itself is a
   * legitimate internal signal (see `deriveDurable()`): it is true when this
   * home's status is genuinely unresolved, or when its presented record is
   * still `completeness: "projected-partial"` (i.e. built from live events,
   * not yet reconciled against an authoritative checkpoint) AND missing one
   * of `REQUIRED_DURABLE_FIELDS`. That second case is common and expected,
   * not a resolution failure: `PresentedEventProjector.ts`'s `home_built`
   * handler deliberately leaves `vault_materials`/`is_hoarding`/`breachers`/
   * `max_integrity` etc. unresolved at introduction time (the event payload
   * genuinely doesn't carry them) rather than silently defaulting them, so
   * every home introduced live stays "unknown" until the next exact
   * checkpoint catches it up. Investigated live (home-cleanup item 1): the
   * hatch was reported "floating near the hut's roof" on a fully-formed,
   * normally-settled home mid-chronicle -- exactly this honest-incompleteness
   * window, not a broken asset lookup.
   *
   * The hatch itself, however, is a developer-facing cue (an internal
   * completeness indicator, not in-universe home decor) and must not leak
   * into normal viewing -- `draw()` only calls this when
   * `isProductionDiagnosticsForTestEnabled()` is true.
   */
  #drawUnknownHatch(context: CanvasRenderingContext2D): void {
    const left = this.#plot.x + 8;
    const top = this.#plot.y + 8;
    context.save();
    context.strokeStyle = "rgba(24, 22, 20, 0.92)";
    context.lineWidth = 1;
    context.strokeRect(left + 0.5, top + 0.5, 15, 15);
    context.lineWidth = 2;
    context.lineCap = "square";
    context.beginPath();
    context.moveTo(left + 3, top + 4);
    context.lineTo(left + 13, top + 14);
    context.moveTo(left + 8, top + 2);
    context.lineTo(left + 16, top + 10);
    context.stroke();
    context.restore();
  }
}
