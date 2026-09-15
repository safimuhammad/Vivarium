import "./bridgeDepth.css";

import type { AgentSnapshot, RegionSnapshot } from "../../app/schemas";
import type {
  FrameIdentity,
  ObserverSelection,
  PresentedObserverFrame,
} from "../../presentation/contracts";
import { SpriteSheetHumanActor } from "../../renderer2d/production/actors/SpriteSheetHumanActor";
import { BEING_CHIBI_ATLAS_ID } from "../../renderer2d/production/actors/beingChibiAtlas";
import {
  PRODUCTION_SCENE_FACTORIES,
  PRODUCTION_SCENE_MANIFEST,
} from "../../renderer2d/production/ProductionCanvasSceneFactory";
import {
  createProductionSceneGraph,
  type ProductionActorFactoryInput,
  type ProductionSceneFactories,
} from "../../renderer2d/production/ProductionSceneGraph";
import type {
  ProductionSceneCommand,
  ProductionSceneCommandBatch,
} from "../../renderer2d/production/ProductionSceneBridge";
import { createSharedAtlasPool } from "../../renderer2d/production/assets/SharedAtlasPool";
import type { ProductionAssetLease } from "../../renderer2d/production/assets/productionManifest";
import {
  bridgeDepthScene,
  bridgeElevationAt,
} from "../../renderer2d/production/depth/BridgeDepth";
import {
  DEPTH_SCENERY_ATLAS_ID,
} from "../../renderer2d/production/depth/DepthSceneryAssets";
import { depthSceneryReplacements } from "../../renderer2d/production/depth/DepthScenery";
import { createRegionMapIdentity } from "../../renderer2d/production/maps/RegionMapIdentity";
import { createNirvanaRegionMapRecipe } from "../../renderer2d/production/nirvana/NirvanaRegionMapRecipe";
import { NIRVANA_ATLAS_PROFILE } from "../../renderer2d/production/nirvana/NirvanaAssetProfile";
import { createNirvanaStaticScenePlan } from "../../renderer2d/production/nirvana/NirvanaStaticSceneProvider";
import { findNavigationPath, type NavigationGrid } from "../../renderer2d/production/navigation/navigation";
import { PlacementLedger } from "../../renderer2d/production/placement/PlacementLedger";
import {
  drawProductionStaticSceneOperation,
  type ProductionStaticDrawOperation,
} from "../../renderer2d/production/staticScene/ProductionStaticScene";

const WORLD_SIZE = 96 * 32;
const ACTOR_ID = "bridge-study-walker";
const WALK_SPEED = 82;
const SCENE_TOKEN = 1;

const NIRVANA: RegionSnapshot = Object.freeze({
  name: "nirvana",
  description: "a once-heavenly landscape, now thinning and picked-over",
  connections: [],
  energy_rate: 0.2,
  materials_rate: 0.2,
  current_energy: 40,
  current_materials: 40,
  max_energy: 100,
  max_materials: 100,
});

const WALKER: AgentSnapshot = Object.freeze({
  id: ACTOR_ID,
  name: "Bridge walker",
  persona: "A deterministic visual-study walker crossing the north channel.",
  position: "nirvana",
  energy: 40,
  materials: 5,
  status: "alive",
  last_mated_at: null,
  offspring_count: 0,
  died_at: null,
  home_id: null,
  is_hoarding: false,
});

interface CameraState {
  x: number;
  y: number;
  zoom: number;
  mode: "free" | "follow";
}

interface PointerDrag {
  pointerId: number;
  x: number;
  y: number;
  cameraX: number;
  cameraY: number;
}

interface BridgeStudyElements {
  readonly root: HTMLElement;
  readonly stage: HTMLElement;
  readonly status: HTMLElement;
  readonly world: HTMLCanvasElement;
  readonly chrome: HTMLCanvasElement;
  readonly play: HTMLButtonElement;
  readonly speak: HTMLButtonElement;
  readonly free: HTMLButtonElement;
  readonly follow: HTMLButtonElement;
  readonly scrub: HTMLInputElement;
  readonly scrubLabel: HTMLElement;
  readonly feet: HTMLElement;
  readonly elevation: HTMLElement;
  readonly selected: HTMLElement;
}

function mustElement<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (element === null) throw new Error(`Bridge study is missing ${selector}.`);
  return element;
}

function buildStudy(): BridgeStudyElements {
  const root = document.querySelector<HTMLElement>("#bridge-depth-root");
  if (root === null) throw new Error("Bridge study root is unavailable.");
  root.innerHTML = `
    <section class="bridge-study" aria-labelledby="bridge-study-title">
      <header class="bridge-study__header">
        <div>
          <h1 id="bridge-study-title">Bridge render study</h1>
          <p class="bridge-study__subtitle">Bridge render study • scripted crossing • no model calls</p>
        </div>
        <div class="bridge-study__status" data-status>Loading bundled native atlases…</div>
      </header>
      <section class="bridge-stage" data-stage aria-label="Nirvana north-channel bridge render study">
        <canvas data-world></canvas>
        <canvas data-chrome></canvas>
        <p class="bridge-stage__hint">Click walker to select · drag empty ground in Free camera</p>
      </section>
      <section class="bridge-study__controls" aria-label="Bridge study controls">
        <div class="bridge-study__cluster">
          <button type="button" data-play aria-pressed="false">Play</button>
          <button type="button" data-speak>Speak</button>
        </div>
        <label class="bridge-study__scrub">
          <span>Crossing scrub</span>
          <input data-scrub type="range" min="0" max="1000" step="1" value="0" />
          <output data-scrub-label>0%</output>
        </label>
        <div class="bridge-study__cluster" aria-label="Camera mode">
          <button type="button" data-free aria-pressed="false">Free</button>
          <button type="button" data-follow aria-pressed="true">Follow</button>
        </div>
      </section>
      <section class="bridge-study__readout" aria-live="polite">
        <div class="bridge-study__metric"><div class="bridge-study__metric-label">Logical feet</div><div class="bridge-study__metric-value" data-feet>—</div></div>
        <div class="bridge-study__metric"><div class="bridge-study__metric-label">Bridge elevation</div><div class="bridge-study__metric-value" data-elevation>—</div></div>
        <div class="bridge-study__metric"><div class="bridge-study__metric-label">Graph hit selection</div><div class="bridge-study__metric-value" data-selected>—</div></div>
      </section>
    </section>`;

  return {
    root,
    stage: mustElement(root, "[data-stage]"),
    status: mustElement(root, "[data-status]"),
    world: mustElement(root, "canvas[data-world]"),
    chrome: mustElement(root, "canvas[data-chrome]"),
    play: mustElement(root, "button[data-play]"),
    speak: mustElement(root, "button[data-speak]"),
    free: mustElement(root, "button[data-free]"),
    follow: mustElement(root, "button[data-follow]"),
    scrub: mustElement(root, "input[data-scrub]"),
    scrubLabel: mustElement(root, "[data-scrub-label]"),
    feet: mustElement(root, "[data-feet]"),
    elevation: mustElement(root, "[data-elevation]"),
    selected: mustElement(root, "[data-selected]"),
  };
}

function identityOf(frame: PresentedObserverFrame): FrameIdentity {
  return {
    runId: frame.runId,
    sourceKey: frame.sourceKey,
    revision: frame.revision,
    firstCursor: frame.firstCursor,
    lastCursor: frame.lastCursor,
  };
}

function makeFrame(revision: number, selection: ObserverSelection): PresentedObserverFrame {
  return {
    runId: "bridge-depth-study",
    sourceKey: "qa:bridge-depth-study",
    revision,
    firstCursor: 1,
    lastCursor: 1,
    source: "fixture",
    ingestedCursor: 1,
    presentedCursor: 1,
    world: {
      exactBaseCursor: 1,
      projectedThroughCursor: 1,
      worldTime: 0,
      agents: [{ completeness: "exact", value: WALKER }],
      regions: [{ completeness: "exact", value: NIRVANA }],
      homes: [],
      ruins: [],
      pendingProposals: [],
    },
    scene: {
      momentId: "bridge-depth-study",
      regionId: "nirvana",
      phase: "hold",
      focus: { kind: "agent", id: ACTOR_ID },
      dialogue: null,
      actorIntents: [],
      homeIntents: [],
      effectIntents: [],
      safeCancelMarkers: [],
      reducedMotion: false,
    },
    selection,
    backlog: {
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Render study",
    },
    transport: { connection: "live", ingestedCursor: 1, retryable: false },
  };
}

function createStaticCache(
  operations: readonly ProductionStaticDrawOperation[],
  leases: ReadonlyMap<string, ProductionAssetLease>,
): HTMLCanvasElement {
  const cache = document.createElement("canvas");
  cache.width = WORLD_SIZE;
  cache.height = WORLD_SIZE;
  const context = cache.getContext("2d");
  if (context === null) throw new Error("Unable to create native bridge static cache.");
  context.imageSmoothingEnabled = false;
  for (const operation of operations) {
    const lease = leases.get(operation.atlasId);
    if (lease === undefined) throw new Error(`Bridge study is missing static atlas ${operation.atlasId}.`);
    drawProductionStaticSceneOperation(context, lease.value, operation);
  }
  return cache;
}

function replacedBridgeOperation(
  stableId: string,
  replacedOperationIds: ReadonlySet<string>,
): boolean {
  const baseId = stableId.startsWith("grounding:")
    ? stableId.slice("grounding:".length)
    : stableId;
  return replacedOperationIds.has(stableId)
    || replacedOperationIds.has(baseId)
    || replacedOperationIds.has(`grounding:${baseId}`);
}

function legalDeckRoute(
  bridge: NonNullable<ReturnType<typeof bridgeDepthScene>>,
  grid: NavigationGrid,
): Readonly<{
  points: readonly Readonly<{ x: number; y: number }>[];
  southWaypoints: readonly Readonly<{ x: number; y: number }>[];
  northWaypoints: readonly Readonly<{ x: number; y: number }>[];
}> {
  const { collision, columns } = grid;
  const x = bridge.deckBounds.x + bridge.deckBounds.width / 2;
  const firstRow = Math.floor(bridge.startY / 32);
  const lastRow = Math.ceil(bridge.endY / 32) - 1;
  const column = Math.floor(x / 32);
  const open = (row: number): boolean => collision[row * columns + column] === 0;
  if (!open(firstRow) || !open(lastRow)) {
    throw new Error("Trusted bridge deck endpoints are not open in the production collision grid.");
  }
  const tilePoint = (candidateColumn: number, row: number) => ({
    x: candidateColumn * 32 + 16,
    y: row * 32 + 16,
  });
  const openBankApproach = (
    row: number,
    preference: readonly (-1 | 1)[],
  ): readonly Readonly<{ x: number; y: number }>[] | null => {
    for (const direction of preference) {
      const fromDeckOutward: Readonly<{ x: number; y: number }>[] = [];
      for (let offset = 1; ; offset += 1) {
        const candidateColumn = column + direction * offset;
        if (candidateColumn < 0 || candidateColumn >= columns
          || collision[row * columns + candidateColumn] !== 0) break;
        const point = tilePoint(candidateColumn, row);
        fromDeckOutward.push(point);
        // The first collision-open tile can be a display-only taper. Keep walking over
        // actual open bank tiles until the bridge helper says the feet are grounded.
        if (bridgeElevationAt(bridge, point) === 0) return fromDeckOutward;
      }
    }
    return null;
  };
  // The real collision grid has a north-west and south-east lateral approach. Deriving
  // them from it ensures the study begins and ends on dry, zero-elevation ground while
  // still traversing the authored taper into and out of the deck.
  const northApproach = openBankApproach(firstRow, [-1, 1]);
  const southApproach = openBankApproach(lastRow, [1, -1]);
  if (northApproach === null || southApproach === null) {
    throw new Error("North-channel bridge has no collision-open grounded bank approach for this render study.");
  }
  const deckPoints = Array.from({ length: lastRow - firstRow + 1 }, (_, offset) => ({
      x,
      y: (firstRow + offset) * 32 + 16,
    }));
  const points = [
    ...[...northApproach].reverse(),
    ...deckPoints,
    ...southApproach,
  ];
  const tileOpen = (point: Readonly<{ x: number; y: number }>): boolean => {
    const tileColumn = Math.floor(point.x / 32);
    const tileRow = Math.floor(point.y / 32);
    return collision[tileRow * columns + tileColumn] === 0;
  };
  if (!points.every(tileOpen)) {
    throw new Error("Bridge study route would leave the production-open deck tiles.");
  }
  const startPoint = points[0]!;
  const endPoint = points.at(-1)!;
  const firstIngress = findNavigationPath(grid, {
    start: { column: Math.floor(startPoint.x / 32), row: Math.floor(startPoint.y / 32) },
    goal: { column, row: firstRow },
  });
  const lastEgress = findNavigationPath(grid, {
    start: { column, row: lastRow },
    goal: { column: Math.floor(endPoint.x / 32), row: Math.floor(endPoint.y / 32) },
  });
  if (firstIngress.status !== "reached" || lastEgress.status !== "reached") {
    throw new Error("Bridge bank approaches are not connected in the production navigation grid.");
  }
  return Object.freeze({
    points: Object.freeze(points.map((point) => Object.freeze(point))),
    southWaypoints: Object.freeze(points.slice(1).map((point) => Object.freeze({ ...point }))),
    northWaypoints: Object.freeze(points.slice(0, -1).reverse().map((point) => Object.freeze({ ...point }))),
  });
}

function routeProgress(
  points: readonly Readonly<{ x: number; y: number }>[],
  point: Readonly<{ x: number; y: number }>,
): number {
  const distances = points.slice(1).map((candidate, index) => Math.hypot(
    candidate.x - points[index]!.x,
    candidate.y - points[index]!.y,
  ));
  const total = distances.reduce((sum, value) => sum + value, 0);
  let travelled = 0;
  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < distances.length; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    const length = distances[index]!;
    const ratio = length === 0 ? 0 : clamp(
      ((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y)) / (length * length),
      0,
      1,
    );
    const projectedX = from.x + (to.x - from.x) * ratio;
    const projectedY = from.y + (to.y - from.y) * ratio;
    const distance = Math.hypot(point.x - projectedX, point.y - projectedY);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = travelled + length * ratio;
    }
    travelled += length;
  }
  return total === 0 ? 0 : clamp(nearest / total, 0, 1);
}

function routePointAtProgress(
  points: readonly Readonly<{ x: number; y: number }>[],
  progress: number,
): Readonly<{ x: number; y: number }> {
  const distances = points.slice(1).map((candidate, index) => Math.hypot(
    candidate.x - points[index]!.x,
    candidate.y - points[index]!.y,
  ));
  const total = distances.reduce((sum, value) => sum + value, 0);
  let remaining = clamp(progress, 0, 1) * total;
  for (let index = 0; index < distances.length; index += 1) {
    const length = distances[index]!;
    if (remaining <= length || index === distances.length - 1) {
      const from = points[index]!;
      const to = points[index + 1]!;
      const ratio = length === 0 ? 0 : remaining / length;
      return Object.freeze({ x: lerp(from.x, to.x, ratio), y: lerp(from.y, to.y, ratio) });
    }
    remaining -= length;
  }
  return points.at(-1)!;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function contains(bounds: Readonly<{ x: number; y: number; width: number; height: number }>, x: number, y: number): boolean {
  return x >= bounds.x && x <= bounds.x + bounds.width
    && y >= bounds.y && y <= bounds.y + bounds.height;
}

async function startStudy(elements: BridgeStudyElements): Promise<void> {
  const recipe = createNirvanaRegionMapRecipe(
    createRegionMapIdentity(813, NIRVANA, [NIRVANA]),
  );
  const bridge = bridgeDepthScene(recipe);
  if (bridge === null) throw new Error("North-channel bridge depth scene is unavailable for the trusted Nirvana recipe.");
  const route = legalDeckRoute(bridge, recipe.grid);

  const pool = createSharedAtlasPool({ manifest: PRODUCTION_SCENE_MANIFEST });
  const requiredAtlasIds = new Set<string>([
    BEING_CHIBI_ATLAS_ID,
    DEPTH_SCENERY_ATLAS_ID,
    NIRVANA_ATLAS_PROFILE.terrainAtlasId,
    NIRVANA_ATLAS_PROFILE.sceneryAtlasId,
    ...PRODUCTION_SCENE_MANIFEST.regions[recipe.kit].atlasIds,
  ]);
  let leases: ReadonlyMap<string, ProductionAssetLease> = new Map();
  let ownedGraph: ReturnType<typeof createProductionSceneGraph> | null = null;
  let graphDisposed = false;
  let retainedForPage = false;
  try {
    leases = new Map(await Promise.all([...requiredAtlasIds].sort().map(async (id) => (
      [id, await pool.acquire(id)] as const
    ))));

    const staticPlan = createNirvanaStaticScenePlan(recipe, leases);
    const depthReplacements = depthSceneryReplacements(recipe);
    const nativeStaticOperations = staticPlan.operations.filter((operation) => {
      const baseId = operation.stableId.startsWith("grounding:")
        ? operation.stableId.slice("grounding:".length)
        : operation.stableId;
      return !replacedBridgeOperation(operation.stableId, bridge.replacedOperationIds)
        && !depthReplacements.has(baseId);
    });
    const staticCache = createStaticCache(nativeStaticOperations, leases);

    const actualActors = new Map<string, SpriteSheetHumanActor>();
    const factories: ProductionSceneFactories = Object.freeze({
      ...PRODUCTION_SCENE_FACTORIES,
      createActor(input: ProductionActorFactoryInput) {
        const actor = PRODUCTION_SCENE_FACTORIES.createActor(input);
        if (!(actor instanceof SpriteSheetHumanActor)) {
          actor.dispose();
          throw new Error("Bridge study requires the production SpriteSheetHumanActor route.");
        }
        const actorId = input.record.value.id;
        if (typeof actorId !== "string" || actorId.length === 0) {
          actor.dispose();
          throw new Error("Bridge study actor has no stable ID.");
        }
        actualActors.set(actorId, actor);
        return actor;
      },
    });
    const placement = PlacementLedger.reconstruct([recipe], { agents: [WALKER], homes: [] });
    ownedGraph = createProductionSceneGraph({
      manifest: PRODUCTION_SCENE_MANIFEST,
      factories,
      placement,
      recipes: new Map([[recipe.regionId, recipe]]),
      atlasLeases: leases,
      reducedMotion: false,
    });
    const graph = ownedGraph;
    const actor = (() => {
      let currentFrame = makeFrame(1, null);
      const initial = graph.update(currentFrame);
      if (initial.outcome !== "applied") throw new Error(`Bridge study graph rejected its initial frame: ${initial.outcome}.`);
      const resolved = actualActors.get(ACTOR_ID);
      if (resolved === undefined) throw new Error("Bridge study did not create its production walker.");
      return { actor: resolved, currentFrame };
    })();

    let currentFrame = actor.currentFrame;
    let revision = currentFrame.revision;
    let nowMs = 0;
    let commandSerial = 0;
    let speechHoldUntilMs = 0;
    let selectedId: string | null = null;
    let playing = false;
    let direction: 1 | -1 = 1;
    let lastAnimationAt: number | null = null;
    let destroyed = false;
    let drag: PointerDrag | null = null;
    const camera: CameraState = { x: 800, y: 74, zoom: 1.48, mode: "follow" };
    let cssWidth = 1;
    let cssHeight = 1;
    let pixelRatio = 1;
    const worldContext = elements.world.getContext("2d");
    const chromeContext = elements.chrome.getContext("2d");
    if (worldContext === null || chromeContext === null) throw new Error("Bridge study canvas is unavailable.");

    const commandId = (kind: string): string => `${kind}:${++commandSerial}`;
    const submit = (commands: readonly ProductionSceneCommand[]): void => {
      const batch: ProductionSceneCommandBatch = {
        identity: identityOf(currentFrame),
        sceneToken: SCENE_TOKEN,
        commands,
      };
      const result = graph.applySceneCommands(batch, nowMs);
      if (result.ignoredCommandIds.length > 0 || result.outcome === "invalid") {
        const detail = result.rejections.map(({ detail: reason }) => reason).join("; ");
        throw new Error(`Bridge study command was refused: ${detail || result.outcome}.`);
      }
    };

    const setSelection = (next: string | null): void => {
      if (selectedId === next) return;
      selectedId = next;
      revision += 1;
      currentFrame = makeFrame(revision, next === null ? null : { kind: "agent", id: next });
      const result = graph.update(currentFrame);
      if (result.outcome !== "applied") throw new Error(`Bridge study graph rejected selection: ${result.outcome}.`);
      graph.updateTime(0, nowMs);
    };

    const placeAtProgress = (progress: number): void => {
      playing = false;
      const point = routePointAtProgress(route.points, progress);
      submit([{
        kind: "actor",
        commandId: commandId("scrub"),
        actorId: ACTOR_ID,
        command: { kind: "reposition", position: point, reason: "reduced-motion" },
      }]);
      graph.updateTime(0, nowMs);
    };
    const startLeg = (nextDirection: 1 | -1): void => {
      direction = nextDirection;
      const progress = routeProgress(route.points, actor.actor.snapshot().position);
      let waypoints = (direction === 1 ? route.southWaypoints : route.northWaypoints).filter((point) => (
        direction === 1
          ? routeProgress(route.points, point) > progress + 1e-5
          : routeProgress(route.points, point) < progress - 1e-5
      ));
      if (waypoints.length === 0) {
        direction = direction === 1 ? -1 : 1;
        waypoints = direction === 1 ? [...route.southWaypoints] : [...route.northWaypoints];
      }
      submit([{
        kind: "actor",
        commandId: commandId(direction === 1 ? "walk-south" : "walk-north"),
        actorId: ACTOR_ID,
        command: {
          kind: "move",
          waypoints,
          speedPixelsPerSecond: WALK_SPEED,
          gait: "walk",
        },
      }]);
    };
    const emitSpeech = (): void => {
      if (nowMs < speechHoldUntilMs) return;
      const at = actor.actor.snapshot().position;
      submit([{
        kind: "actor",
        commandId: commandId("talk-expression"),
        actorId: ACTOR_ID,
        command: { kind: "set-face", expression: "talk-1" },
      }, {
        kind: "environment",
        commandId: commandId("speech"),
        request: {
          kind: "speech-bubble",
          at,
          speakerId: ACTOR_ID,
          variant: "speech",
          text: "North channel crossing.",
          tailLean: 0,
          hue: "#b9d87a",
          accent: "#5f9274",
          tier: "murmur",
        },
      }]);
      speechHoldUntilMs = graph.overlayHoldUntilMs?.() ?? nowMs + 2_000;
      elements.speak.disabled = true;
    };

    placeAtProgress(0);
    graph.updateTime(0, nowMs);

    const resize = (): void => {
      const bounds = elements.stage.getBoundingClientRect();
      cssWidth = Math.max(1, Math.round(bounds.width));
      cssHeight = Math.max(1, Math.round(bounds.height));
      pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const width = Math.max(1, Math.round(cssWidth * pixelRatio));
      const height = Math.max(1, Math.round(cssHeight * pixelRatio));
      for (const canvas of [elements.world, elements.chrome]) {
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
      }
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(elements.stage);
    resize();

    const focusTarget = (): ReturnType<typeof graph.focusTarget> => graph.focusTarget({
      kind: "agent",
      id: selectedId ?? ACTOR_ID,
    });
    const updateCamera = (): void => {
      if (camera.mode !== "follow") return;
      const target = focusTarget();
      if (target === null) return;
      const desiredX = target.worldBounds.x + target.worldBounds.width / 2 - cssWidth / (2 * camera.zoom);
      const desiredY = target.worldBounds.y + target.worldBounds.height / 2 - cssHeight / (2 * camera.zoom);
      camera.x = lerp(camera.x, desiredX, 0.18);
      camera.y = lerp(camera.y, desiredY, 0.18);
    };
    const render = (): void => {
      const actorSnapshot = actor.actor.snapshot();
      const feet = actorSnapshot.position;
      const progress = routeProgress(route.points, feet);
      const elevation = bridgeElevationAt(bridge, feet);
      const screenScale = camera.zoom * pixelRatio;
      worldContext.setTransform(1, 0, 0, 1, 0, 0);
      worldContext.clearRect(0, 0, elements.world.width, elements.world.height);
      worldContext.imageSmoothingEnabled = false;
      worldContext.setTransform(screenScale, 0, 0, screenScale, -camera.x * screenScale, -camera.y * screenScale);
      worldContext.drawImage(staticCache, 0, 0);
      chromeContext.setTransform(1, 0, 0, 1, 0, 0);
      chromeContext.clearRect(0, 0, elements.chrome.width, elements.chrome.height);
      graph.draw(worldContext, {
        zoom: camera.zoom,
        originX: -camera.x * camera.zoom,
        originY: -camera.y * camera.zoom,
        width: cssWidth,
        height: cssHeight,
        overlayTarget: { context: chromeContext, pixelRatio },
      });
      elements.feet.textContent = `x ${feet.x.toFixed(1)} · y ${feet.y.toFixed(1)} · ${actorSnapshot.facing} · ${actorSnapshot.layers.body.clipId}`;
      elements.elevation.textContent = `${elevation.toFixed(1)} world px`;
      elements.selected.textContent = selectedId ?? "none";
      elements.scrub.value = String(Math.round(progress * 1000));
      elements.scrubLabel.textContent = `${Math.round(progress * 100)}%`;
      elements.play.textContent = playing ? "Pause" : "Play";
      elements.play.setAttribute("aria-pressed", String(playing));
      elements.free.setAttribute("aria-pressed", String(camera.mode === "free"));
      elements.follow.setAttribute("aria-pressed", String(camera.mode === "follow"));
    };
    const tick = (timestamp: number): void => {
      if (destroyed) return;
      const deltaSeconds = lastAnimationAt === null
        ? 0
        : Math.min(0.05, Math.max(0, timestamp - lastAnimationAt) / 1_000);
      lastAnimationAt = timestamp;
      if (playing) {
        nowMs += deltaSeconds * 1_000;
        graph.updateTime(deltaSeconds, nowMs);
        const snapshot = actor.actor.snapshot();
        if (!snapshot.routeActive) startLeg(direction === 1 ? -1 : 1);
      }
      if (elements.speak.disabled && nowMs >= speechHoldUntilMs) {
        elements.speak.disabled = false;
        submit([{
          kind: "actor",
          commandId: commandId("talk-finished"),
          actorId: ACTOR_ID,
          command: { kind: "set-face", expression: "neutral" },
        }]);
      }
      updateCamera();
      render();
      requestAnimationFrame(tick);
    };

    elements.play.addEventListener("click", () => {
      playing = !playing;
      if (playing && !actor.actor.snapshot().routeActive) {
        startLeg(direction);
      }
    });
    elements.speak.addEventListener("click", () => emitSpeech());
    elements.free.addEventListener("click", () => { camera.mode = "free"; });
    elements.follow.addEventListener("click", () => { camera.mode = "follow"; });
    elements.scrub.addEventListener("input", () => placeAtProgress(Number(elements.scrub.value) / 1000));

    const eventWorldPoint = (event: PointerEvent): Readonly<{ x: number; y: number }> => {
      const bounds = elements.world.getBoundingClientRect();
      const localX = (event.clientX - bounds.left) * cssWidth / Math.max(1, bounds.width);
      const localY = (event.clientY - bounds.top) * cssHeight / Math.max(1, bounds.height);
      return { x: camera.x + localX / camera.zoom, y: camera.y + localY / camera.zoom };
    };
    elements.world.addEventListener("pointerdown", (event) => {
      const point = eventWorldPoint(event);
      const target = [...graph.hitTargets()]
        .filter((candidate) => candidate.selection.kind === "agent")
        .sort((left, right) => right.feetY - left.feetY)
        .find((candidate) => contains(candidate.worldBounds, point.x, point.y));
      if (target?.selection.kind === "agent") {
        setSelection(target.selection.id);
        camera.mode = "follow";
        return;
      }
      if (camera.mode !== "free") return;
      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        cameraX: camera.x,
        cameraY: camera.y,
      };
      elements.world.setPointerCapture(event.pointerId);
    });
    elements.world.addEventListener("pointermove", (event) => {
      if (drag === null || drag.pointerId !== event.pointerId) return;
      camera.x = drag.cameraX - (event.clientX - drag.x) / camera.zoom;
      camera.y = drag.cameraY - (event.clientY - drag.y) / camera.zoom;
    });
    const finishDrag = (event: PointerEvent): void => {
      if (drag?.pointerId === event.pointerId && elements.world.hasPointerCapture(event.pointerId)) {
        elements.world.releasePointerCapture(event.pointerId);
      }
      drag = null;
    };
    elements.world.addEventListener("pointerup", finishDrag);
    elements.world.addEventListener("pointercancel", finishDrag);

    const dispose = (): void => {
      if (destroyed) return;
      destroyed = true;
      resizeObserver.disconnect();
      ownedGraph?.dispose();
      graphDisposed = true;
      for (const lease of new Set(leases.values())) lease.release();
      pool.dispose();
    };
    window.addEventListener("pagehide", dispose, { once: true });
    elements.status.textContent = "Ready · real grid bank-to-bank route · bundled native atlases";
    retainedForPage = true;
    requestAnimationFrame(tick);
  } finally {
    if (!retainedForPage && !graphDisposed) {
      ownedGraph?.dispose();
      for (const lease of new Set(leases.values())) lease.release();
      pool.dispose();
    }
  }
}

const elements = buildStudy();
void startStudy(elements).catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  elements.root.innerHTML = `<section class="bridge-study"><p class="bridge-study__error">Bridge render study could not start.\n${detail}</p></section>`;
});
