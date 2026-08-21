import { createHumanActor, type ActorSnapshot, type HumanActorPort, type HumanAtlasLeases } from "./actors/HumanActor";
import { createSpriteAtlasStore, type AssetLease, type SpriteAtlasId, type SpriteAtlasStore } from "./assets/atlasStore";
import { DEMO_HUMAN_MANIFEST } from "./assets/demoManifest";
import {
  connectedTileFrameId,
  NIRVANA_PROP_FRAME_IDS,
  NIRVANA_TILE_MANIFEST,
  resolveTileFrame,
  validateTileManifest,
  type CardinalConnections,
  type TileFrameId,
} from "./assets/tileManifest";
import {
  DEMO_SHELTER_MANIFEST,
  validateShelterVisualManifest,
  type ShelterAtlasCell,
  type ShelterAtlasCellId,
  type ShelterVisualManifest,
} from "./assets/shelterManifest";
import { createCamera, type Camera2DPort, type CameraSnapshot } from "./camera/Camera2D";
import type {
  CanvasRendererDiagnostics,
  CanvasWorldRendererOptions,
  EntitySelection,
  FrameDriver,
  SliceCanvasRenderer,
  Vivarium2DSliceDebug,
  WakeScheduler,
} from "./contracts";
import {
  createDemoTimelineController,
  DEMO_ACTOR_ID,
  DEMO_SHELTER_ID,
  DEMO_SHELTER_POSITION,
  DEMO_SPAWN_POSITION,
  type DemoSceneBindings,
  type DemoSceneName,
  type DemoTimelineController,
} from "./demoScene";
import { createShelterActor, type ShelterActorPort, type ShelterSnapshot2D } from "./homes/ShelterActor";
import {
  shelterComponentOffset,
  shelterFeetY,
  shelterFrameDestination,
  shelterVisualBounds,
} from "./homes/shelterGeometry";
import { deriveDemoRegionMap, LOGICAL_VIEWPORT, TILE_SIZE } from "./map/regionMap";

const MOBILE_LOGICAL_WIDTH = 320;
const LOGICAL_HEIGHT = 288;
const MOBILE_BREAKPOINT = 512;
const DRAW_SAMPLE_COUNT = 240;
const AMBIENT_INTERVAL_MS = 1_000;
const DIAGNOSTICS_INTERVAL_MS = 250;
const ATLAS_IDS: readonly SpriteAtlasId[] = ["human-body", "human-face", "human-held", "shelter", "nirvana-tiles"];

type SliceScene = DemoSceneName | "static";
type AtlasLeaseMap = Readonly<Record<SpriteAtlasId, AssetLease<ImageBitmap>>>;
export interface DynamicDrawOrderEntry {
  readonly kind: "actor" | "shelter";
  readonly id: string;
  readonly feetY: number;
}

type MutableDrawEntry = { readonly kind: "actor" | "shelter"; readonly id: string; feetY: number };

/** Orders dynamic world entities from back to front with deterministic ties. */
export function compareDynamicDrawOrder(a: DynamicDrawOrderEntry, b: DynamicDrawOrderEntry): number {
  return a.feetY - b.feetY || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
}

class AtlasAcquireError extends Error {
  constructor(readonly atlasId: SpriteAtlasId, options: ErrorOptions) {
    super(`Unable to acquire ${atlasId}.`, options);
    this.name = "AtlasAcquireError";
  }
}

const defaultFrameDriver = (): FrameDriver => ({
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
  now: () => performance.now(),
});

const defaultWakeScheduler = (): WakeScheduler => ({
  schedule: (atMs, callback) => window.setTimeout(callback, Math.max(0, atMs - performance.now())),
  cancel: (handle) => window.clearTimeout(handle),
  now: () => performance.now(),
});

function requireContext(canvas: HTMLCanvasElement, alpha: boolean): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { alpha });
  if (context === null) throw new Error("CanvasWorldRenderer requires a 2D canvas context.");
  context.imageSmoothingEnabled = false;
  return context;
}

function makeCache(width: number, height: number, alpha: boolean): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = requireContext(canvas, alpha);
  context.imageSmoothingEnabled = false;
  return { canvas, context };
}

function leaseView(lease: AssetLease<ImageBitmap>): AssetLease<ImageBitmap> {
  return { value: lease.value, release: () => undefined };
}

function actorBounds(snapshot: ActorSnapshot) {
  return { x: snapshot.position.x - 24, y: snapshot.position.y - 61, width: 48, height: 64 };
}

export type ShelterDrawLayer = "back" | "middle" | "front" | "effects";

export interface ShelterVisualDrawer {
  draw(
    context: CanvasRenderingContext2D,
    atlas: ImageBitmap,
    snapshot: ShelterSnapshot2D,
    layer: ShelterDrawLayer,
    reducedMotion: boolean,
  ): void;
}

/** Binds and validates the native shelter manifest once for allocation-free draws. */
export function createShelterVisualDrawer(manifest: ShelterVisualManifest): ShelterVisualDrawer {
  const errors = validateShelterVisualManifest(manifest);
  if (errors.length > 0) throw new Error(`Invalid shelter visual manifest: ${errors.join("; ")}`);
  const frames = new Map<ShelterAtlasCellId, ShelterAtlasCell>(manifest.frames.map((frame) => [frame.id, frame]));
  const requireFrame = (id: ShelterAtlasCellId): ShelterAtlasCell => {
    const frame = frames.get(id);
    if (frame === undefined) throw new Error(`Shelter frame ${id} is undeclared.`);
    return frame;
  };
  const drawFrame = (
    context: CanvasRenderingContext2D,
    atlas: ImageBitmap,
    snapshot: ShelterSnapshot2D,
    frameId: ShelterAtlasCellId,
    offsetX = 0,
    offsetY = 0,
  ): void => {
    const { rect } = requireFrame(frameId);
    const destination = shelterFrameDestination(snapshot, { x: offsetX, y: offsetY });
    context.drawImage(
      atlas,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      destination.x,
      destination.y,
      destination.width,
      destination.height,
    );
  };

  return {
    draw(context, atlas, snapshot, layer, reducedMotion): void {
      if (snapshot.visual.manifestId !== manifest.id) throw new Error(`Shelter snapshot references undeclared manifest ${snapshot.visual.manifestId}.`);
      context.imageSmoothingEnabled = false;
      if (snapshot.phase === "ruin") {
        if (layer !== "middle") return;
        for (const frameId of snapshot.visual.ruin.composition) drawFrame(context, atlas, snapshot, frameId);
        return;
      }
      if (layer === "middle") {
        return;
      }
      if (layer === "effects") {
        const { dust } = snapshot.visual;
        if (!Number.isFinite(dust.intensity) || dust.intensity < 0 || dust.intensity > 1) throw new Error("Shelter dust intensity must be between zero and one.");
        if (reducedMotion || dust.intensity === 0) return;
        const previousAlpha = context.globalAlpha;
        try {
          context.globalAlpha = dust.intensity;
          drawFrame(context, atlas, snapshot, dust.frameId);
        } finally {
          context.globalAlpha = previousAlpha;
        }
        return;
      }
      const front = layer === "front";
      for (const component of snapshot.components) {
        if (component.visibility !== 0 && component.visibility !== 1) throw new Error("Shelter component visibility must represent presence as zero or one.");
        const componentIsFront = component.id === "door" || component.id === "hearth";
        if (component.visibility === 0 || componentIsFront !== front) continue;
        if (component.id === "roof" && component.frameId === "roof-intact") {
          // The roof cell contains a full board panel. Keep only its authored
          // upper courses so the plaster wall remains visible below.
          context.save();
          context.beginPath();
          context.rect(Math.round(snapshot.plot.x - 64), Math.round(snapshot.plot.y - 92), 128, 48);
          context.clip();
          drawFrame(context, atlas, snapshot, component.frameId, component.offset.x, component.offset.y);
          context.restore();
        } else if (component.id === "hearth") {
          // The authored hearth cell includes a complete plaster fireplace panel.
          // Reveal only its flame/opening at the shelter's right-hand window so it
          // cannot occlude the wall, roof, and door composition beneath it.
          context.save();
          context.beginPath();
          context.rect(Math.round(snapshot.plot.x + 20), Math.round(snapshot.plot.y - 40), 24, 24);
          context.clip();
          drawFrame(context, atlas, snapshot, component.frameId, component.offset.x + 34, component.offset.y);
          context.restore();
        } else if (component.id === "door" && component.frameId === "door-closed") {
          // The closed-door cell includes a broad facade. Reveal only its
          // left bay, leaving plaster around the right-hand hearth/window.
          context.save();
          context.beginPath();
          context.rect(Math.round(snapshot.plot.x - 48), Math.round(snapshot.plot.y - 55), 44, 70);
          context.clip();
          const offset = shelterComponentOffset(component);
          drawFrame(context, atlas, snapshot, component.frameId, offset.x, offset.y);
          context.restore();
        } else {
          const offset = shelterComponentOffset(component);
          drawFrame(context, atlas, snapshot, component.frameId, offset.x, offset.y);
        }
      }
    },
  };
}

/** Creates one renderer-owned, persistent Canvas2D world runtime. */
export async function createCanvasWorldRenderer(options: CanvasWorldRendererOptions): Promise<SliceCanvasRenderer> {
  const tileManifestErrors = validateTileManifest(NIRVANA_TILE_MANIFEST);
  if (tileManifestErrors.length > 0) throw new Error(`Invalid tile manifest: ${tileManifestErrors.join("; ")}`);
  const context = requireContext(options.canvas, false);
  const frameDriver = options.frameDriver ?? defaultFrameDriver();
  const wakeScheduler = options.wakeScheduler ?? defaultWakeScheduler();
  const atlasStore: SpriteAtlasStore = (options.atlasStoreFactory ?? createSpriteAtlasStore)();
  const durationRing = new Float64Array(DRAW_SAMPLE_COUNT);
  const durationScratch = new Float64Array(DRAW_SAMPLE_COUNT);
  const drawList: MutableDrawEntry[] = [];
  const actorDrawEntry: MutableDrawEntry = { kind: "actor", id: DEMO_ACTOR_ID, feetY: 0 };
  const shelterDrawEntry: MutableDrawEntry = { kind: "shelter", id: DEMO_SHELTER_ID, feetY: 0 };
  const shelterVisualDrawer = createShelterVisualDrawer(DEMO_SHELTER_MANIFEST);
  const map = deriveDemoRegionMap(7_113);
  const pathTiles = new Set(map.ground.filter(({ terrain }) => terrain === "pale-path")
    .map(({ tile }) => `${tile.column},${tile.row}`));
  const pondTiles = new Set(map.props.filter(({ kind }) => kind === "pond")
    .map(({ tile }) => `${tile.column},${tile.row}`));
  let logicalWidth: number = LOGICAL_VIEWPORT.width;
  let cssWidth = logicalWidth;
  let cssHeight = LOGICAL_HEIGHT;
  let cssScale = 1;
  let cropMode: CanvasRendererDiagnostics["cropMode"] = "desktop-full";
  let terrainCache = makeCache(LOGICAL_VIEWPORT.width, LOGICAL_HEIGHT, false);
  let propCache = makeCache(LOGICAL_VIEWPORT.width, LOGICAL_HEIGHT, true);
  let staticLayerRebuilds = 0;
  let frameCount = 0;
  let durationCount = 0;
  let durationCursor = 0;
  let lastDrawMs = 0;
  let longFrames = 0;
  let scheduledFrame: number | null = null;
  let scheduledWake: number | null = null;
  let schedulingEpoch = 0;
  let disposed = false;
  let ready = false;
  let paused = false;
  let dirty = true;
  let cadence: CanvasRendererDiagnostics["cadence"] = "idle";
  let selection: EntitySelection = null;
  let dialogue = null as Parameters<NonNullable<CanvasWorldRendererOptions["callbacks"]["onDialogueChange"]>>[0] | null;
  let scene: SliceScene = options.initialScene ?? "full-loop";
  let actor: HumanActorPort | null = null;
  let shelter: ShelterActorPort | null = null;
  let actorFrameSnapshot: ActorSnapshot | null = null;
  let shelterFrameSnapshot: ShelterSnapshot2D | null = null;
  let frameSnapshotsDirty = true;
  let timeline: DemoTimelineController | null = null;
  let camera: Camera2DPort = createCamera({ width: logicalWidth, height: LOGICAL_HEIGHT, initialCenter: { x: 256, y: 144 }, reducedMotion: options.reducedMotion });
  let leases: AtlasLeaseMap | null = null;
  let generation = 0;
  let generationController: AbortController | null = null;
  let lastFrameAtMs = frameDriver.now();
  let nextAmbientMs = AMBIENT_INTERVAL_MS;
  let missingSprites: readonly SpriteAtlasId[] = [];
  let actorSnapshotReads = 0;
  let shelterSnapshotReads = 0;
  let diagnosticsCallbacks = 0;
  let p95Computations = 0;
  let lastDiagnosticsAtMs = Number.NEGATIVE_INFINITY;
  let lastDiagnosticsShelterPhase: ShelterSnapshot2D["phase"] | null = null;
  let notifyingDiagnostics = false;

  const cancelFrame = (): void => {
    if (scheduledFrame === null) return;
    frameDriver.cancel(scheduledFrame);
    scheduledFrame = null;
  };
  const cancelWake = (): void => {
    if (scheduledWake === null) return;
    wakeScheduler.cancel(scheduledWake);
    scheduledWake = null;
  };
  const invalidateScheduling = (): void => {
    schedulingEpoch += 1;
    cancelFrame();
    cancelWake();
  };

  const releaseLeases = (owned: AtlasLeaseMap | null): void => {
    if (owned === null) return;
    for (const id of ATLAS_IDS) owned[id].release();
  };

  const disposeFixture = (): void => {
    actor?.dispose();
    shelter?.dispose();
    actor = null;
    shelter = null;
    actorFrameSnapshot = null;
    shelterFrameSnapshot = null;
    frameSnapshotsDirty = false;
  };

  const refreshFrameSnapshots = (): void => {
    actorFrameSnapshot = actor?.snapshot() ?? null;
    shelterFrameSnapshot = shelter?.snapshot() ?? null;
    if (actor !== null) actorSnapshotReads += 1;
    if (shelter !== null) shelterSnapshotReads += 1;
    frameSnapshotsDirty = false;
    camera.setEntityBounds(DEMO_ACTOR_ID, actorFrameSnapshot === null ? null : actorBounds(actorFrameSnapshot));
    camera.setEntityBounds(DEMO_SHELTER_ID, shelterFrameSnapshot === null ? null : shelterVisualBounds(shelterFrameSnapshot));
  };

  const ensureFrameSnapshots = (): void => {
    if (frameSnapshotsDirty) refreshFrameSnapshots();
  };

  const connectionsAt = (column: number, row: number, occupied: ReadonlySet<string>): CardinalConnections => ({
    north: occupied.has(`${column},${row - 1}`),
    east: occupied.has(`${column + 1},${row}`),
    south: occupied.has(`${column},${row + 1}`),
    west: occupied.has(`${column - 1},${row}`),
  });

  const drawTileFrame = (
    target: CanvasRenderingContext2D,
    frameId: TileFrameId,
    destinationX: number,
    destinationY: number,
  ): void => {
    if (leases === null) return;
    const { rect } = resolveTileFrame(NIRVANA_TILE_MANIFEST, frameId);
    target.drawImage(
      leases["nirvana-tiles"].value,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      destinationX,
      destinationY,
      TILE_SIZE,
      TILE_SIZE,
    );
  };

  const rebuildStaticCaches = (): void => {
    terrainCache = makeCache(LOGICAL_VIEWPORT.width, LOGICAL_HEIGHT, false);
    propCache = makeCache(LOGICAL_VIEWPORT.width, LOGICAL_HEIGHT, true);
    const terrain = terrainCache.context;
    terrain.fillStyle = "#82956a";
    terrain.fillRect(0, 0, LOGICAL_VIEWPORT.width, LOGICAL_HEIGHT);
    for (const ground of map.ground) {
      const x = ground.tile.column * TILE_SIZE;
      const y = ground.tile.row * TILE_SIZE;
      if (leases) {
        const frameId: TileFrameId = ground.terrain === "pale-path"
          ? connectedTileFrameId("path", connectionsAt(ground.tile.column, ground.tile.row, pathTiles))
          : (`ground-${((ground.tile.column + ground.tile.row) % 2 === 0 ? "a" : "b")}` as TileFrameId);
        drawTileFrame(terrain, frameId, x, y);
      } else {
        terrain.fillStyle = ground.terrain === "pale-path" ? "#c8b98a" : "#849a6a";
        terrain.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      }
    }
    const props = propCache.context;
    props.clearRect(0, 0, LOGICAL_VIEWPORT.width, LOGICAL_HEIGHT);
    for (const prop of map.props) {
      const x = prop.tile.column * TILE_SIZE;
      const y = prop.tile.row * TILE_SIZE;
      if (leases) {
        const frameId = prop.kind === "pond"
          ? connectedTileFrameId("water", connectionsAt(prop.tile.column, prop.tile.row, pondTiles))
          : NIRVANA_PROP_FRAME_IDS[prop.kind];
        drawTileFrame(props, frameId, x, y);
      } else {
        props.fillStyle = prop.kind === "pond" ? "#6f9da0" : prop.kind === "tree" ? "#496c4b" : "#617d52";
        props.fillRect(x + 8, y + 8, 16, 16);
      }
    }
    terrain.imageSmoothingEnabled = false;
    props.imageSmoothingEnabled = false;
    staticLayerRebuilds += 1;
    dirty = true;
  };

  const createFixture = (fixtureScene: DemoSceneName): void => {
    if (leases === null) return;
    disposeFixture();
    actor = createHumanActor({
      id: DEMO_ACTOR_ID,
      name: "Aster",
      position: DEMO_SPAWN_POSITION,
      facing: "east",
      selected: selection?.kind === "agent" && selection.id === DEMO_ACTOR_ID,
      manifest: DEMO_HUMAN_MANIFEST,
      atlasLeases: {
        body: leaseView(leases["human-body"]),
        face: leaseView(leases["human-face"]),
        held: leaseView(leases["human-held"]),
      } satisfies HumanAtlasLeases,
      blinkSeed: 7_113,
    });
    shelter = createShelterActor({ id: DEMO_SHELTER_ID, plot: DEMO_SHELTER_POSITION, atlasLease: leaseView(leases.shelter) });
    camera = createCamera({ width: logicalWidth, height: LOGICAL_HEIGHT, initialCenter: { x: 256, y: 144 }, reducedMotion: options.reducedMotion });
    dialogue = null;
    nextAmbientMs = AMBIENT_INTERVAL_MS;
    frameSnapshotsDirty = true;
    dirty = true;
    void fixtureScene;
  };

  const nextDynamicDeadlineMs = (): number | null => {
    if (scene === "static" || actor === null) return null;
    const actorDeadline = actor.nextDeadlineMs();
    const timelineNow = timeline?.currentTimeMs() ?? 0;
    const ambient = options.reducedMotion ? null : (nextAmbientMs > timelineNow ? nextAmbientMs : null);
    const values = [actorDeadline, ambient].filter((value): value is number => value !== null && value > timelineNow);
    return values.length === 0 ? null : Math.min(...values);
  };

  const bindings: DemoSceneBindings = {
    reset(nextScene) { createFixture(nextScene); },
    applyActor(id, command) { if (id === DEMO_ACTOR_ID) { actor?.apply(command); frameSnapshotsDirty = true; } },
    applyShelter(id, command, nowMs) { if (id === DEMO_SHELTER_ID) { shelter?.apply(command, nowMs); frameSnapshotsDirty = true; } },
    applyCamera(intent) { camera.apply(intent); },
    setDialogue(next, notify) { dialogue = next; if (notify) options.callbacks.onDialogueChange?.(next); },
    update(deltaMs, nowMs) {
      actor?.update(deltaMs / 1_000, nowMs);
      shelter?.advanceTo(nowMs);
      frameSnapshotsDirty = true;
      refreshFrameSnapshots();
      camera.update(deltaMs);
      while (nextAmbientMs <= nowMs) nextAmbientMs += AMBIENT_INTERVAL_MS;
      dirty = true;
    },
    draw() { dirty = true; },
    nextDynamicDeadlineMs,
    operationToken: () => schedulingEpoch,
  };

  const isMotionActive = (): boolean => {
    ensureFrameSnapshots();
    const actorMotion = actorFrameSnapshot?.channels.locomotion;
    const shelterPhase = shelterFrameSnapshot?.phase;
    return actorMotion === "walk" || actorMotion === "turn" || actorMotion === "stop"
      || shelterPhase === "building" || shelterPhase === "collapsing" || !camera.isSettled();
  };

  const drawShelterLayer = (snapshot: ShelterSnapshot2D | null, layer: ShelterDrawLayer): void => {
    if (leases === null || snapshot === null) return;
    shelterVisualDrawer.draw(context, leases.shelter.value, snapshot, layer, options.reducedMotion ?? false);
  };

  const recordDuration = (durationMs: number): void => {
    durationRing[durationCursor] = durationMs;
    durationCursor = (durationCursor + 1) % DRAW_SAMPLE_COUNT;
    durationCount = Math.min(DRAW_SAMPLE_COUNT, durationCount + 1);
    lastDrawMs = durationMs;
    if (durationMs > 16.7) longFrames += 1;
  };

  const draw = (): void => {
    if (disposed || !dirty) return;
    const startedAt = performance.now();
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, logicalWidth, LOGICAL_HEIGHT);
    const cameraSnapshot = camera.snapshot();
    ensureFrameSnapshots();
    const actorSnapshot = actorFrameSnapshot;
    const shelterSnapshot = shelterFrameSnapshot;
    context.save();
    context.translate(logicalWidth / 2, LOGICAL_HEIGHT / 2);
    context.scale(cameraSnapshot.zoom, cameraSnapshot.zoom);
    context.translate(-cameraSnapshot.center.x, -cameraSnapshot.center.y);
    context.drawImage(terrainCache.canvas, 0, 0);
    context.drawImage(propCache.canvas, 0, 0);
    if (scene !== "static" && !options.reducedMotion) {
      context.fillStyle = "#d8c66d";
      context.fillRect(Math.round((timeline?.currentTimeMs() ?? 0) / 250) % LOGICAL_VIEWPORT.width, 31, 2, 2);
    }
    drawShelterLayer(shelterSnapshot, "back");
    drawList.length = 0;
    if (actorSnapshot !== null) { actorDrawEntry.feetY = actorSnapshot.position.y; drawList.push(actorDrawEntry); }
    if (shelterSnapshot && shelterSnapshot.phase !== "absent") { shelterDrawEntry.feetY = shelterFeetY(shelterSnapshot); drawList.push(shelterDrawEntry); }
    drawList.sort(compareDynamicDrawOrder);
    for (const entry of drawList) {
      if (entry.kind === "actor" && actorSnapshot !== null) actor?.draw(context, actorSnapshot);
      else drawShelterLayer(shelterSnapshot, "middle");
    }
    drawShelterLayer(shelterSnapshot, "front");
    drawShelterLayer(shelterSnapshot, "effects");
    if (selection !== null) {
      context.strokeStyle = "#f5df83";
      context.lineWidth = 2;
      context.setLineDash([4, 2]);
      if (selection.kind === "agent" && selection.id === actorSnapshot?.id) {
        const position = actorSnapshot.position;
        context.beginPath();
        context.ellipse(Math.round(position.x), Math.round(position.y), 18, 7, 0, 0, Math.PI * 2);
        context.stroke();
      } else if (selection.kind === "home" && selection.id === shelterSnapshot?.id && shelterSnapshot.phase !== "absent") {
        const bounds = shelterVisualBounds(shelterSnapshot);
        if (bounds !== null) context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      } else if (selection.kind === "region" && selection.id === map.regionId) {
        context.strokeRect(2, 2, LOGICAL_VIEWPORT.width - 4, LOGICAL_HEIGHT - 4);
      }
      context.setLineDash([]);
    }
    context.restore();
    dirty = false;
    frameCount += 1;
    recordDuration(performance.now() - startedAt);
  };

  const scheduleWake = (): void => {
    cancelWake();
    if (disposed || paused || !ready || scene === "static" || isMotionActive()) return;
    const deadline = timeline?.nextDeadlineMs() ?? null;
    if (deadline === null || timeline === null) { cadence = "idle"; return; }
    cadence = "ambient-30";
    const delay = Math.max(0, deadline - timeline.currentTimeMs());
    const callbackEpoch = schedulingEpoch;
    let callbackHandle = -1;
    callbackHandle = wakeScheduler.schedule(wakeScheduler.now() + delay, () => {
      if (callbackEpoch !== schedulingEpoch || scheduledWake !== callbackHandle) return;
      scheduledWake = null;
      if (disposed || paused || timeline === null) return;
      const operationEpoch = schedulingEpoch;
      timeline.advanceTo(deadline);
      if (disposed || paused || schedulingEpoch !== operationEpoch) return;
      dirty = true;
      requestFrame();
    });
    scheduledWake = callbackHandle;
  };

  const onFrame = (timestamp: number): void => {
    if (disposed || paused || !ready) return;
    const operationEpoch = schedulingEpoch;
    const delta = Math.max(0, Math.min(250, timestamp - lastFrameAtMs));
    lastFrameAtMs = timestamp;
    let cameraAdvancedByTimeline = false;
    if (timeline && isMotionActive()) {
      const timelineBefore = timeline.currentTimeMs();
      timeline.advanceTo(timelineBefore + delta);
      if (disposed || paused || schedulingEpoch !== operationEpoch) return;
      cameraAdvancedByTimeline = timeline.currentTimeMs() > timelineBefore;
    }
    if (!cameraAdvancedByTimeline && !camera.isSettled()) {
      camera.update(delta);
      dirty = true;
    }
    draw();
    if (isMotionActive()) {
      cadence = "motion-60";
      requestFrame();
    } else {
      scheduleWake();
    }
    notifyDiagnostics(timestamp);
  };

  function requestFrame(): void {
    if (disposed || paused || !ready || scheduledFrame !== null) return;
    cancelWake();
    const callbackEpoch = schedulingEpoch;
    let callbackHandle = -1;
    callbackHandle = frameDriver.request((timestamp) => {
      if (callbackEpoch !== schedulingEpoch || scheduledFrame !== callbackHandle) return;
      scheduledFrame = null;
      onFrame(timestamp);
    });
    scheduledFrame = callbackHandle;
  }

  const resetReadyScene = (nextScene: SliceScene): void => {
    scene = nextScene;
    nextAmbientMs = AMBIENT_INTERVAL_MS;
    invalidateScheduling();
    if (scene === "static") {
      timeline = null;
      disposeFixture();
      dialogue = null;
      dirty = true;
      draw();
      cadence = "idle";
      notifyDiagnostics(frameDriver.now(), true);
      return;
    }
    if (timeline === null) timeline = createDemoTimelineController({ scene, bindings });
    else timeline.setScene(scene);
    draw();
    requestFrame();
    notifyDiagnostics(frameDriver.now(), true);
  };

  const beginLoad = (): void => {
    invalidateScheduling();
    generation += 1;
    const loadGeneration = generation;
    ready = false;
    generationController?.abort();
    const controller = new AbortController();
    generationController = controller;
    const held = new Map<SpriteAtlasId, AssetLease<ImageBitmap>>();
    const releaseHeld = (): void => {
      for (const lease of held.values()) lease.release();
      held.clear();
    };
    const pending = ATLAS_IDS.map((id) => atlasStore.acquire(id, controller.signal)
      .catch((cause: unknown) => { throw new AtlasAcquireError(id, { cause }); })
      .then((lease) => {
        if (disposed || controller.signal.aborted || loadGeneration !== generation) {
          lease.release();
          throw new DOMException("Aborted", "AbortError");
        }
        held.set(id, lease);
        return [id, lease] as const;
      }));
    void Promise.all(pending).then((loaded) => {
      const acquired = Object.fromEntries(loaded) as unknown as AtlasLeaseMap;
      if (disposed || controller.signal.aborted || loadGeneration !== generation) {
        releaseHeld();
        return;
      }
      held.clear();
      releaseLeases(leases);
      leases = acquired;
      missingSprites = [];
      rebuildStaticCaches();
      ready = true;
      lastFrameAtMs = frameDriver.now();
      resetReadyScene(scene);
    }).catch((error: unknown) => {
      const stale = controller.signal.aborted || disposed || loadGeneration !== generation;
      controller.abort();
      releaseHeld();
      if (stale) return;
      ready = false;
      missingSprites = error instanceof AtlasAcquireError ? [error.atlasId] : [...ATLAS_IDS];
      dirty = true;
      notifyDiagnostics(frameDriver.now(), true);
      options.callbacks.onAssetLoadFailure?.({
        missingSprites,
        message: error instanceof Error ? error.message : "Unable to load world art.",
      });
      void error;
    });
  };

  const drawP95 = (): number => {
    p95Computations += 1;
    if (durationCount === 0) return 0;
    durationScratch.set(durationRing.subarray(0, durationCount));
    const samples = durationScratch.subarray(0, durationCount);
    samples.sort();
    return samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]!;
  };

  const drawDurations = (): readonly number[] => {
    if (durationCount < DRAW_SAMPLE_COUNT) {
      return Array.from(durationRing.subarray(0, durationCount));
    }
    return Array.from({ length: durationCount }, (_unused, index) => (
      durationRing[(durationCursor + index) % DRAW_SAMPLE_COUNT]!
    ));
  };

  function diagnostics(): CanvasRendererDiagnostics {
    const assets = atlasStore.diagnostics();
    const cameraSnapshot = camera.snapshot();
    const rasterOriginX = logicalWidth / 2 - cameraSnapshot.center.x * cameraSnapshot.zoom;
    const rasterOriginY = LOGICAL_HEIGHT / 2 - cameraSnapshot.center.y * cameraSnapshot.zoom;
    const integerDrawRects = Number.isInteger(rasterOriginX)
      && Number.isInteger(rasterOriginY)
      && Number.isInteger(cameraSnapshot.zoom);
    return {
      disposed,
      frameCount,
      scheduledFrame: scheduledFrame !== null,
      cadence,
      lastDrawMs,
      drawP95Ms: drawP95(),
      drawDurationsMs: drawDurations(),
      staticLayerRebuilds,
      actorCount: actor === null ? 0 : 1,
      shelterCount: shelter === null ? 0 : 1,
      activeAnimations: isMotionActive() ? 1 : 0,
      assetBytesLoaded: assets.compressedBytes,
      decodedAssetBytes: assets.decodedBytes,
      missingSprites,
      pathFallbacks: 0,
      longFrames,
      logicalViewport: { x: 0, y: 0, width: logicalWidth, height: LOGICAL_HEIGHT },
      cssScale,
      cropMode,
      smoothingEnabled: false,
      integerDrawRects,
      runtimeCounters: { actorSnapshotReads, shelterSnapshotReads, diagnosticsCallbacks, p95Computations },
    };
  }

  const notifyDiagnostics = (nowMs: number, force = false): void => {
    if (notifyingDiagnostics || options.callbacks.onDiagnostics === undefined) return;
    ensureFrameSnapshots();
    const shelterPhase = shelterFrameSnapshot?.phase ?? null;
    const phaseChanged = shelterPhase !== lastDiagnosticsShelterPhase;
    if (!force && !phaseChanged && nowMs - lastDiagnosticsAtMs < DIAGNOSTICS_INTERVAL_MS) return;
    lastDiagnosticsAtMs = nowMs;
    lastDiagnosticsShelterPhase = shelterPhase;
    diagnosticsCallbacks += 1;
    notifyingDiagnostics = true;
    try {
      options.callbacks.onDiagnostics(diagnostics());
    } finally {
      notifyingDiagnostics = false;
    }
  };

  const resize = (nextCssWidth: number, nextCssHeight: number): void => {
    if (disposed) return;
    cssWidth = Number.isFinite(nextCssWidth) && nextCssWidth > 0 ? nextCssWidth : cssWidth;
    cssHeight = Number.isFinite(nextCssHeight) && nextCssHeight > 0 ? nextCssHeight : cssHeight;
    const nextLogicalWidth = cssWidth < MOBILE_BREAKPOINT ? MOBILE_LOGICAL_WIDTH : LOGICAL_VIEWPORT.width;
    const logicalChanged = nextLogicalWidth !== logicalWidth;
    logicalWidth = nextLogicalWidth;
    cropMode = logicalWidth === MOBILE_LOGICAL_WIDTH ? "mobile-crop" : "desktop-full";
    cssScale = Math.max(1, Math.floor(Math.min(cssWidth / logicalWidth, cssHeight / LOGICAL_HEIGHT)));
    options.canvas.width = logicalWidth;
    options.canvas.height = LOGICAL_HEIGHT;
    context.imageSmoothingEnabled = false;
    options.canvas.style.width = `${logicalWidth * cssScale}px`;
    options.canvas.style.height = `${LOGICAL_HEIGHT * cssScale}px`;
    options.canvas.style.position = "relative";
    options.canvas.style.left = `${Math.floor((cssWidth - logicalWidth * cssScale) / 2)}px`;
    options.canvas.style.top = `${Math.floor((cssHeight - LOGICAL_HEIGHT * cssScale) / 2)}px`;
    camera.setViewport(logicalWidth, LOGICAL_HEIGHT);
    if (logicalChanged) dirty = true;
    dirty = true;
    if (ready && !paused) requestFrame();
  };

  resize(cssWidth, cssHeight);
  beginLoad();

  const debug: Vivarium2DSliceDebug = {
    isReady: () => ready && !disposed,
    pause() {
      if (disposed || paused) return;
      paused = true; invalidateScheduling(); cadence = "idle";
      notifyDiagnostics(frameDriver.now(), true);
    },
    resume() { if (disposed || !paused) return; paused = false; lastFrameAtMs = frameDriver.now(); dirty = true; requestFrame(); },
    restart() {
      if (disposed) return;
      paused = false;
      if (!ready) { beginLoad(); return; }
      invalidateScheduling();
      if (scene !== "static") timeline?.restart();
      lastFrameAtMs = frameDriver.now();
      draw(); requestFrame(); notifyDiagnostics(frameDriver.now(), true);
    },
    seek(milliseconds) {
      if (disposed || !ready || scene === "static") return;
      invalidateScheduling();
      timeline?.seek(milliseconds);
      lastFrameAtMs = frameDriver.now();
      draw(); requestFrame(); notifyDiagnostics(frameDriver.now(), true);
    },
    advanceBy(milliseconds) {
      if (disposed || !ready || scene === "static" || !Number.isFinite(milliseconds)) return;
      invalidateScheduling();
      const operationEpoch = schedulingEpoch;
      timeline?.advanceTo((timeline?.currentTimeMs() ?? 0) + Math.max(0, milliseconds));
      if (disposed || paused || schedulingEpoch !== operationEpoch) return;
      lastFrameAtMs = frameDriver.now();
      draw();
      if (!paused) requestFrame();
      notifyDiagnostics(frameDriver.now(), true);
    },
    setScene(nextScene) {
      if (disposed) return;
      scene = nextScene;
      if (!ready) { beginLoad(); return; }
      resetReadyScene(nextScene);
    },
    actorState: (id) => id === DEMO_ACTOR_ID ? actor?.snapshot() ?? null : null,
    cameraState: (): CameraSnapshot => camera.snapshot(),
    shelterState: (id) => id === DEMO_SHELTER_ID ? shelter?.snapshot() ?? null : null,
    renderDiagnostics: diagnostics,
    captureLogicalImageData: () => context.getImageData(0, 0, logicalWidth, LOGICAL_HEIGHT),
  };

  let externalAbort = (): void => undefined;
  const renderer: SliceCanvasRenderer = {
    setSelection(next) {
      if (disposed) return;
      selection = next;
      actor?.apply({ type: "selection", payload: { selected: next?.kind === "agent" && next.id === DEMO_ACTOR_ID } });
      frameSnapshotsDirty = true;
      dirty = true;
      requestFrame();
      options.callbacks.onSelect?.(next);
    },
    focusSelection(next) {
      if (disposed) return;
      if (next.kind === "agent") camera.apply({ type: "follow", entityId: next.id });
      else camera.apply({
        type: "story-target",
        target: next.kind === "home" && shelter
          ? shelterVisualBounds(shelter.snapshot()) ?? { x: 0, y: 0, width: logicalWidth, height: LOGICAL_HEIGHT }
          : { x: 0, y: 0, width: logicalWidth, height: LOGICAL_HEIGHT },
      });
      dirty = true; requestFrame();
    },
    setCameraMode(mode) {
      if (disposed) return;
      if (mode === "story") camera.apply({ type: "return-story" });
      else if (mode === "follow" && selection?.kind === "agent") camera.apply({ type: "follow", entityId: selection.id });
      else if (mode === "free") camera.apply({ type: "free-pan", deltaCss: { x: 0, y: 0 } });
      options.callbacks.onCameraModeChange?.(camera.snapshot().mode);
      dirty = true; requestFrame();
    },
    panCamera(deltaCss) {
      if (disposed) return;
      camera.apply({ type: "free-pan", deltaCss });
      options.callbacks.onCameraModeChange?.(camera.snapshot().mode);
      dirty = true; requestFrame();
    },
    zoomCamera(factor, anchorCss) {
      if (disposed) return;
      if (camera.snapshot().mode !== "free") camera.apply({ type: "free-pan", deltaCss: { x: 0, y: 0 } });
      camera.apply({ type: "zoom", factor, anchorCss });
      options.callbacks.onCameraModeChange?.(camera.snapshot().mode);
      dirty = true; requestFrame();
    },
    setSafeFrame(insets) { if (disposed) return; camera.setSafeFrame(insets); dirty = true; requestFrame(); },
    resize,
    getDiagnostics: diagnostics,
    dispose() {
      if (disposed) return;
      disposed = true;
      ready = false;
      generation += 1;
      generationController?.abort();
      invalidateScheduling();
      disposeFixture();
      releaseLeases(leases); leases = null;
      atlasStore.dispose();
      options.signal?.removeEventListener("abort", externalAbort);
      cadence = "idle";
    },
    debug: () => debug,
  };
  externalAbort = () => renderer.dispose();
  if (options.signal?.aborted) renderer.dispose();
  else options.signal?.addEventListener("abort", externalAbort, { once: true });
  return renderer;
}
