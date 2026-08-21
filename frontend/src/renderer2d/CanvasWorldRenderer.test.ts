import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetLease, SpriteAtlasId } from "./assets/atlasStore";
import { DEMO_SHELTER_MANIFEST, resolveShelterFrame } from "./assets/shelterManifest";
import { NIRVANA_TILE_MANIFEST, resolveTileFrame } from "./assets/tileManifest";
import type { CanvasRendererDiagnostics, FrameDriver, WakeScheduler } from "./contracts";
import { compareDynamicDrawOrder, createCanvasWorldRenderer } from "./CanvasWorldRenderer";
import { hitTest } from "./interaction/hitTest";

class FakeFrameDriver implements FrameDriver {
  time = 0;
  requests = 0;
  cancels = 0;
  private next = 1;
  callbacks = new Map<number, FrameRequestCallback>();
  retainedCancelled = new Map<number, FrameRequestCallback>();
  request(callback: FrameRequestCallback): number { const id = this.next++; this.requests += 1; this.callbacks.set(id, callback); return id; }
  cancel(handle: number): void {
    const callback = this.callbacks.get(handle);
    if (callback !== undefined && this.callbacks.delete(handle)) { this.retainedCancelled.set(handle, callback); this.cancels += 1; }
  }
  now(): number { return this.time; }
  advanceBy(milliseconds: number): void {
    const target = this.time + milliseconds;
    while (this.callbacks.size > 0 && this.time < target) {
      this.time = Math.min(target, this.time + 1000 / 60);
      const callbacks = [...this.callbacks.values()]; this.callbacks.clear();
      callbacks.forEach((callback) => callback(this.time));
    }
    this.time = target;
  }
  pending(): number { return this.callbacks.size; }
  pendingHandles(): readonly number[] { return [...this.callbacks.keys()]; }
  fireCancelled(handle: number, timestamp: number): void { this.retainedCancelled.get(handle)?.(timestamp); }
}

class FakeWakeScheduler implements WakeScheduler {
  time = 0;
  scheduled = 0;
  cancelled = 0;
  private next = 1;
  callbacks = new Map<number, { at: number; callback: () => void }>();
  retainedCancelled = new Map<number, { at: number; callback: () => void }>();
  schedule(atMs: number, callback: () => void): number { const id = this.next++; this.scheduled += 1; this.callbacks.set(id, { at: atMs, callback }); return id; }
  cancel(handle: number): void {
    const item = this.callbacks.get(handle);
    if (item !== undefined && this.callbacks.delete(handle)) { this.retainedCancelled.set(handle, item); this.cancelled += 1; }
  }
  now(): number { return this.time; }
  fireNext(): void { const item = [...this.callbacks.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (!item) return; this.callbacks.delete(item[0]); this.time = item[1].at; item[1].callback(); }
  fireCancelled(handle: number): void { this.retainedCancelled.get(handle)?.callback(); }
}

function fakeContext() {
  return {
    imageSmoothingEnabled: true, globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1,
    clearRect: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), drawImage: vi.fn(),
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), rotate: vi.fn(), setLineDash: vi.fn(),
    beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), arc: vi.fn(), ellipse: vi.fn(), stroke: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })),
  } as unknown as CanvasRenderingContext2D;
}

const bitmap = (label = "atlas") => ({ label, width: 672, height: 512, close: vi.fn() }) as unknown as ImageBitmap;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe("CanvasWorldRenderer", () => {
  let contexts: WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>;
  let contextRequests: Array<{ readonly canvas: HTMLCanvasElement; readonly alpha: boolean | undefined }>;
  beforeEach(() => {
    contexts = new WeakMap();
    contextRequests = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, _id: string, options?: CanvasRenderingContext2DSettings) {
      contextRequests.push({ canvas: this, alpha: options?.alpha });
      let context = contexts.get(this);
      if (!context) { context = fakeContext(); contexts.set(this, context); }
      return context;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  async function createTestRenderer(
    scene: "full-loop" | "static" = "full-loop",
    overrides: { readonly reducedMotion?: boolean; readonly callbacks?: Parameters<typeof createCanvasWorldRenderer>[0]["callbacks"] } = {},
  ) {
    const driver = new FakeFrameDriver();
    const wake = new FakeWakeScheduler();
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const acquire = vi.fn(async (_id: SpriteAtlasId): Promise<AssetLease<ImageBitmap>> => {
      const release = vi.fn(); releases.push(release); return { value: bitmap(_id), release };
    });
    const dispose = vi.fn();
    const canvas = document.createElement("canvas");
    const renderer = await createCanvasWorldRenderer({
      canvas, callbacks: overrides.callbacks ?? {}, frameDriver: driver, wakeScheduler: wake, initialScene: scene,
      reducedMotion: overrides.reducedMotion,
      atlasStoreFactory: () => ({ acquire, diagnostics: () => ({ compressedBytes: 5, decodedBytes: 10, leaseCount: 5 }), dispose }),
    });
    expect(renderer.debug().isReady()).toBe(false);
    await vi.waitFor(() => expect(renderer.debug().isReady()).toBe(true));
    return { renderer, driver, wake, canvas, releases, dispose };
  }

  it("orders overlapping actors and shelters by feet Y with a stable identity tie-break", () => {
    const entries = [
      { kind: "actor" as const, id: "agent-front", feetY: 180 },
      { kind: "shelter" as const, id: "home", feetY: 112 },
      { kind: "actor" as const, id: "agent-behind", feetY: 80 },
      { kind: "actor" as const, id: "agent-a", feetY: 112 },
    ];

    expect(entries.sort(compareDynamicDrawOrder).map(({ id }) => id)).toEqual([
      "agent-behind", "agent-a", "home", "agent-front",
    ]);
  });

  it("keeps one canvas and actor instance across walk and shelter updates without rebuilding static layers", async () => {
    const { renderer, driver, canvas } = await createTestRenderer();
    const actorIdentity = renderer.debug().actorState("agent_aster")!.instanceId;
    renderer.debug().advanceBy(4_000);
    expect(renderer.debug().actorState("agent_aster")!.instanceId).toBe(actorIdentity);
    expect(renderer.debug().actorState("agent_aster")!.distanceTravelled).toBeGreaterThan(32);
    expect(renderer.getDiagnostics().staticLayerRebuilds).toBe(1);
    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(288);
  });

  it("retains a bounded raw draw-duration window for performance evidence", async () => {
    const { renderer } = await createTestRenderer();
    for (let index = 0; index < 300; index += 1) renderer.debug().advanceBy(16);

    const diagnostics = renderer.getDiagnostics();
    expect(diagnostics.drawDurationsMs).toHaveLength(240);
    expect(diagnostics.drawDurationsMs.every((duration) => Number.isFinite(duration) && duration >= 0)).toBe(true);
    expect(diagnostics.drawP95Ms).toBeGreaterThanOrEqual(0);
  });

  it("resizes to native logical desktop/mobile backing pixels and restores no smoothing", async () => {
    const { renderer, canvas, driver } = await createTestRenderer("static");
    renderer.resize(320, 288);
    driver.advanceBy(20);
    expect([canvas.width, canvas.height]).toEqual([320, 288]);
    expect(renderer.getDiagnostics()).toMatchObject({ cssScale: 1, cropMode: "mobile-crop", smoothingEnabled: false, integerDrawRects: true });
    expect(contexts.get(canvas)!.imageSmoothingEnabled).toBe(false);
    const context = contexts.get(canvas)!;
    expect(context.translate).toHaveBeenCalledWith(160, 144);
    expect(context.scale).toHaveBeenCalledWith(1, 1);
    expect(context.translate).toHaveBeenCalledWith(-256, -144);
  });

  it("schedules idle camera easing at 60Hz to the exact home focus endpoint then stops RAF", async () => {
    const { renderer, driver } = await createTestRenderer();
    renderer.debug().seek(10_000);
    driver.advanceBy(20);
    const actorId = renderer.debug().actorState("agent_aster")!.instanceId;
    const shelterId = renderer.debug().shelterState("shelter-east")!.instanceId;
    const requestsBefore = driver.requests;

    renderer.focusSelection({ kind: "home", id: "shelter-east" });
    driver.advanceBy(120);
    const intermediate = renderer.debug().cameraState().center;
    expect(intermediate).not.toEqual({ x: 256, y: 144 });
    expect(intermediate).not.toEqual({ x: 354, y: 77.5 });
    driver.advanceBy(120);

    expect(renderer.debug().cameraState().center).toEqual({ x: 354, y: 77.5 });
    expect(driver.requests - requestsBefore).toBeGreaterThan(2);
    expect(driver.pending()).toBe(0);
    expect(renderer.debug().actorState("agent_aster")!.instanceId).toBe(actorId);
    expect(renderer.debug().shelterState("shelter-east")!.instanceId).toBe(shelterId);
  });

  it("finishes home focus after the terminal timeline clamp and releases RAF", async () => {
    const { renderer, driver } = await createTestRenderer();
    renderer.debug().seek(16_000);
    renderer.focusSelection({ kind: "home", id: "shelter-east" });

    driver.advanceBy(240);

    expect(renderer.debug().cameraState().center).toEqual({ x: 368, y: 77.5 });
    expect(driver.pending()).toBe(0);
    expect(renderer.getDiagnostics().cadence).toBe("idle");
  });

  it("uses one matching X/Y/zoom transform for world drawing and hit projection on mobile", async () => {
    const { renderer, driver, canvas } = await createTestRenderer();
    renderer.debug().seek(10_000);
    renderer.resize(320, 288);
    renderer.panCamera({ x: 64, y: 32 });
    renderer.zoomCamera(2, { x: 160, y: 144 });
    const context = contexts.get(canvas)!;
    vi.mocked(context.translate).mockClear();
    vi.mocked(context.scale).mockClear();
    driver.advanceBy(20);

    const camera = renderer.debug().cameraState();
    expect(context.translate).toHaveBeenCalledWith(160, 144);
    expect(context.scale).toHaveBeenCalledWith(camera.zoom, camera.zoom);
    expect(context.translate).toHaveBeenCalledWith(-camera.center.x, -camera.center.y);

    const actor = renderer.debug().actorState("agent_aster")!;
    const project = (world: { readonly x: number; readonly y: number }) => ({
      x: (world.x - camera.center.x) * camera.zoom + 160,
      y: (world.y - camera.center.y) * camera.zoom + 144,
    });
    expect(hitTest({
      pointCss: project(actor.position),
      targets: [{
        selection: { kind: "agent", id: actor.id },
        feetY: actor.position.y,
        worldBounds: { x: actor.position.x - 24, y: actor.position.y - 61, width: 48, height: 64 },
      }],
      camera: { worldToScreen: project },
    })).toEqual({ kind: "agent", id: "agent_aster" });
  });

  it("reports integer raster alignment truthfully across fractional and integral camera transforms", async () => {
    const { renderer, driver } = await createTestRenderer("static");
    renderer.zoomCamera(1.25, { x: 256, y: 144 });
    driver.advanceBy(20);
    expect(renderer.getDiagnostics().integerDrawRects).toBe(false);

    renderer.zoomCamera(1.6, { x: 256, y: 144 });
    driver.advanceBy(20);
    expect(renderer.debug().cameraState().zoom).toBe(2);
    expect(renderer.getDiagnostics().integerDrawRects).toBe(true);
  });

  it("snaps reduced-motion camera focus to the same endpoint without chained RAF", async () => {
    const { renderer, driver } = await createTestRenderer("full-loop", { reducedMotion: true });
    renderer.debug().seek(10_000);
    driver.advanceBy(20);
    const requestsBefore = driver.requests;
    renderer.focusSelection({ kind: "home", id: "shelter-east" });
    expect(renderer.debug().cameraState().center).toEqual({ x: 354, y: 77.5 });
    driver.advanceBy(20);
    expect(driver.requests - requestsBefore).toBe(1);
    expect(driver.pending()).toBe(0);
  });

  it("lands desktop and mobile story focus in the same asymmetric safe-frame endpoint", async () => {
    const normal = await createTestRenderer();
    const reduced = await createTestRenderer("full-loop", { reducedMotion: true });
    const insets = { top: 48, right: 16, bottom: 24, left: 32 };
    for (const fixture of [normal, reduced]) {
      fixture.renderer.debug().seek(10_000);
      fixture.driver.advanceBy(20);
      fixture.renderer.resize(320, 288);
      fixture.renderer.setSafeFrame(insets);
      fixture.renderer.focusSelection({ kind: "home", id: "shelter-east" });
    }
    const endpoint = reduced.renderer.debug().cameraState().center;
    expect(endpoint).toEqual({ x: 346, y: 65.5 });
    normal.driver.advanceBy(120);
    expect(normal.renderer.debug().cameraState().center).not.toEqual(endpoint);
    normal.driver.advanceBy(120);
    expect(normal.renderer.debug().cameraState().center).toEqual(endpoint);
    expect(normal.driver.pending()).toBe(0);
  });

  it("suppresses reduced-motion ambient and dust effects while preserving terminal shelter truth", async () => {
    const normal = await createTestRenderer();
    const reduced = await createTestRenderer("full-loop", { reducedMotion: true });
    const normalContext = contexts.get(normal.canvas)!;
    const reducedContext = contexts.get(reduced.canvas)!;
    vi.mocked(normalContext.fillRect).mockClear(); vi.mocked(normalContext.drawImage).mockClear();
    vi.mocked(reducedContext.fillRect).mockClear(); vi.mocked(reducedContext.drawImage).mockClear();

    normal.renderer.debug().seek(14_000);
    reduced.renderer.debug().seek(14_000);
    const isDust = (args: unknown[]) => {
      const frame = resolveShelterFrame(DEMO_SHELTER_MANIFEST, "dust").rect;
      return (args[0] as { label?: string }).label === "shelter" && args[1] === frame.x && args[2] === frame.y;
    };
    expect(vi.mocked(normalContext.drawImage).mock.calls.some(isDust)).toBe(true);
    expect(vi.mocked(reducedContext.drawImage).mock.calls.some(isDust)).toBe(false);
    expect(vi.mocked(normalContext.fillRect).mock.calls.some((args) => args[2] === 2 && args[3] === 2)).toBe(true);
    expect(vi.mocked(reducedContext.fillRect).mock.calls.some((args) => args[2] === 2 && args[3] === 2)).toBe(false);

    normal.renderer.debug().seek(16_000);
    reduced.renderer.debug().seek(16_000);
    const normalShelter = normal.renderer.debug().shelterState("shelter-east")!;
    const reducedShelter = reduced.renderer.debug().shelterState("shelter-east")!;
    expect({ ...reducedShelter, instanceId: 0 }).toEqual({ ...normalShelter, instanceId: 0 });
    reduced.driver.advanceBy(20);
    expect(reduced.driver.pending()).toBe(0);
    expect(reduced.wake.callbacks.size).toBe(0);
  });

  it("keeps terrain opaque, props transparent, and samples named native tile frames", async () => {
    const { renderer, canvas } = await createTestRenderer("static");
    const offscreenRequests = contextRequests.filter((request) => request.canvas !== canvas);
    expect(offscreenRequests.slice(-2).map(({ alpha }) => alpha)).toEqual([false, true]);
    const terrainContext = contexts.get(offscreenRequests.at(-2)!.canvas)!;
    const propContext = contexts.get(offscreenRequests.at(-1)!.canvas)!;
    expect(terrainContext.fillRect).toHaveBeenCalledWith(0, 0, 512, 288);
    expect(propContext.fillRect).not.toHaveBeenCalled();

    const sourceRects = (context: CanvasRenderingContext2D) => vi.mocked(context.drawImage).mock.calls
      .filter(([image]) => (image as { label?: string }).label === "nirvana-tiles")
      .map((args) => args.slice(1, 5));
    const rect = (id: Parameters<typeof resolveTileFrame>[1]) => {
      const frame = resolveTileFrame(NIRVANA_TILE_MANIFEST, id);
      return [frame.rect.x, frame.rect.y, 32, 32];
    };
    expect(sourceRects(terrainContext)).toEqual(expect.arrayContaining([rect("ground-a"), rect("path-horizontal")]));
    expect(sourceRects(propContext)).toEqual(expect.arrayContaining([
      rect("tree-a"), rect("shrub-a"), rect("garden-bed"), rect("water-corner-es"), rect("signpost"),
    ]));
    expect([...vi.mocked(terrainContext.drawImage).mock.calls, ...vi.mocked(propContext.drawImage).mock.calls]
      .filter(([image]) => (image as { label?: string }).label === "nirvana-tiles")
      .every((args) => args[3] === 32 && args[4] === 32 && args[7] === 32 && args[8] === 32)).toBe(true);
    renderer.dispose();
  });

  it("captures exact logical backing pixels and becomes unready after idempotent disposal", async () => {
    const { renderer, releases, dispose } = await createTestRenderer("static");
    const image = renderer.debug().captureLogicalImageData();
    expect([image.width, image.height]).toEqual([512, 288]);
    renderer.dispose(); renderer.dispose();
    expect(renderer.debug().isReady()).toBe(false);
    expect(releases).toHaveLength(5);
    releases.forEach((release) => expect(release).toHaveBeenCalledTimes(1));
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps a completely static scene off RAF and wake scheduling", async () => {
    const { renderer, driver, wake } = await createTestRenderer("static");
    driver.advanceBy(100);
    expect(driver.pending()).toBe(0);
    expect(wake.callbacks.size).toBe(0);
    expect(renderer.getDiagnostics().cadence).toBe("idle");
  });

  it("cancels idle RAF and wakes it exactly once at the next ambient or blink deadline", async () => {
    const { renderer, driver, wake } = await createTestRenderer();
    driver.advanceBy(20);
    expect(driver.pending()).toBe(0);
    expect(wake.callbacks.size).toBe(1);
    const before = driver.requests;
    wake.fireNext();
    expect(driver.requests).toBe(before + 1);
    expect(driver.pending()).toBe(1);
    renderer.dispose();
  });

  it("switches motion to ambient cadence and double disposal cancels each owned mechanism once", async () => {
    const { renderer, driver, wake, releases, dispose } = await createTestRenderer();
    renderer.debug().seek(1_000);
    driver.advanceBy(20);
    expect(renderer.getDiagnostics().cadence).toBe("motion-60");
    renderer.debug().seek(11_000);
    driver.advanceBy(20);
    expect(renderer.getDiagnostics().cadence).toBe("ambient-30");
    expect(wake.callbacks.size).toBe(1);
    renderer.setSelection({ kind: "agent", id: "agent_aster" });
    expect(wake.cancelled).toBe(1);
    expect(driver.pending()).toBe(1);
    const cancelledBeforeDispose = driver.cancels;
    renderer.dispose(); renderer.dispose();
    expect(driver.cancels).toBe(cancelledBeforeDispose + 1);
    releases.forEach((release) => expect(release).toHaveBeenCalledTimes(1));
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("commits one shelter across coarse seek and later standing hold", async () => {
    const { renderer, canvas } = await createTestRenderer();
    vi.mocked(contexts.get(canvas)!.drawImage).mockClear();
    renderer.debug().seek(10_000);
    expect(renderer.debug().shelterState("shelter-east")).toMatchObject({ phase: "standing", buildCommitCount: 1 });
    const shelterCalls = vi.mocked(contexts.get(canvas)!.drawImage).mock.calls.filter((args) => args[3] === 128 && args[4] === 128);
    expect(shelterCalls.map((args) => args.slice(1, 5))).toEqual([
      "foundation", "post", "wall-intact", "roof-intact", "door-closed", "hearth",
    ].map((id) => {
      const { rect } = resolveShelterFrame(DEMO_SHELTER_MANIFEST, id as Parameters<typeof resolveShelterFrame>[1]);
      return [rect.x, rect.y, rect.width, rect.height];
    }));
    renderer.debug().advanceBy(1_500);
    expect(renderer.debug().shelterState("shelter-east")!.buildCommitCount).toBe(1);
  });

  it("renders standing, falling, dust, and persistent ruin from the bound shelter manifest", async () => {
    const { renderer, canvas } = await createTestRenderer();
    const visible = contexts.get(canvas)!;
    const shelterCalls = () => vi.mocked(visible.drawImage).mock.calls
      .filter(([image]) => (image as { label?: string }).label === "shelter");
    const rect = (id: Parameters<typeof resolveShelterFrame>[1]) => {
      const frame = resolveShelterFrame(DEMO_SHELTER_MANIFEST, id);
      return [frame.rect.x, frame.rect.y, 128, 128];
    };

    vi.mocked(visible.drawImage).mockClear();
    renderer.debug().seek(10_000);
    expect(shelterCalls().map((args) => args.slice(1, 5))).toEqual(expect.arrayContaining([
      rect("foundation"), rect("post"), rect("wall-intact"), rect("roof-intact"), rect("door-closed"), rect("hearth"),
    ]));
    expect(shelterCalls().every((args) => args[7] === 128 && args[8] === 128)).toBe(true);

    vi.mocked(visible.drawImage).mockClear();
    renderer.debug().seek(13_500);
    expect(shelterCalls().map((args) => args.slice(1, 5))).toEqual(expect.arrayContaining([
      rect("roof-falling"), rect("wall-falling"), rect("door-falling"),
    ]));

    vi.mocked(visible.drawImage).mockClear();
    renderer.debug().seek(14_000);
    expect(shelterCalls().map((args) => args.slice(1, 5))).toContainEqual(rect("dust"));

    vi.mocked(visible.drawImage).mockClear();
    renderer.debug().seek(16_000);
    expect(shelterCalls().map((args) => args.slice(1, 5))).toEqual([rect("rubble-full")]);
    expect(visible.rotate).not.toHaveBeenCalled();
  });

  it("keeps stable entity instances while synchronizing agent, home, region, and null selection overlays", async () => {
    const onSelect = vi.fn();
    const { renderer, driver, canvas } = await createTestRenderer("full-loop", { callbacks: { onSelect } });
    renderer.debug().seek(10_000);
    const actorInstance = renderer.debug().actorState("agent_aster")!.instanceId;
    const shelterInstance = renderer.debug().shelterState("shelter-east")!.instanceId;
    const context = contexts.get(canvas)!;

    vi.mocked(context.ellipse).mockClear(); vi.mocked(context.strokeRect).mockClear();
    renderer.setSelection({ kind: "agent", id: "agent_aster" });
    driver.advanceBy(20);
    expect(renderer.debug().actorState("agent_aster")!.channels.selected).toBe(true);
    expect(context.ellipse).toHaveBeenCalled();

    vi.mocked(context.ellipse).mockClear(); vi.mocked(context.strokeRect).mockClear();
    renderer.setSelection({ kind: "home", id: "shelter-east" });
    driver.advanceBy(20);
    expect(renderer.debug().actorState("agent_aster")!.channels.selected).toBe(false);
    expect(context.strokeRect).toHaveBeenCalledWith(276, 16, 156, 123);
    expect(context.ellipse).not.toHaveBeenCalled();

    vi.mocked(context.strokeRect).mockClear();
    renderer.setSelection({ kind: "region", id: "nirvana" });
    driver.advanceBy(20);
    expect(context.strokeRect).toHaveBeenCalledWith(2, 2, 508, 284);

    vi.mocked(context.ellipse).mockClear(); vi.mocked(context.strokeRect).mockClear();
    renderer.setSelection(null);
    driver.advanceBy(20);
    expect(context.ellipse).not.toHaveBeenCalled();
    expect(context.strokeRect).not.toHaveBeenCalled();
    expect(renderer.debug().actorState("agent_aster")!.instanceId).toBe(actorInstance);
    expect(renderer.debug().shelterState("shelter-east")!.instanceId).toBe(shelterInstance);
    expect(onSelect.mock.calls.map(([selection]) => selection)).toEqual([
      { kind: "agent", id: "agent_aster" },
      { kind: "home", id: "shelter-east" },
      { kind: "region", id: "nirvana" },
      null,
    ]);
  });

  it("stops all scheduling at the persistent 16000ms ruin hold", async () => {
    const { renderer, driver, wake, canvas } = await createTestRenderer();
    vi.mocked(contexts.get(canvas)!.drawImage).mockClear();
    renderer.debug().seek(16_000);
    driver.advanceBy(20);
    expect(renderer.debug().shelterState("shelter-east")!.phase).toBe("ruin");
    expect(driver.pending()).toBe(0);
    expect(wake.callbacks.size).toBe(0);
    expect(renderer.getDiagnostics().cadence).toBe("idle");
    const shelterCalls = vi.mocked(contexts.get(canvas)!.drawImage).mock.calls.filter((args) => args[3] === 128 && args[4] === 128);
    const rubble = resolveShelterFrame(DEMO_SHELTER_MANIFEST, "rubble-full").rect;
    expect(shelterCalls.map((args) => args.slice(1, 5))).toEqual([[rubble.x, rubble.y, rubble.width, rubble.height]]);
  });

  it("rebases the frame clock on resume instead of consuming paused wall time", async () => {
    const { renderer, driver } = await createTestRenderer();
    renderer.debug().seek(1_000);
    const before = renderer.debug().actorState("agent_aster")!.distanceTravelled;
    renderer.debug().pause();
    driver.time += 10_000;
    renderer.debug().resume();
    driver.advanceBy(1000 / 60);
    const travelled = renderer.debug().actorState("agent_aster")!.distanceTravelled - before;
    expect(travelled).toBeGreaterThan(0);
    expect(travelled).toBeLessThan(2);
  });

  it("restarts a paused renderer as running with a rebased frame clock and owned RAF", async () => {
    const { renderer, driver, wake } = await createTestRenderer();
    renderer.debug().seek(4_000);
    renderer.debug().pause();
    expect(driver.pending()).toBe(0);
    expect(wake.callbacks.size).toBe(0);
    driver.time += 10_000;

    renderer.debug().restart();

    expect(renderer.debug().actorState("agent_aster")!.distanceTravelled).toBe(0);
    expect(driver.pending()).toBe(1);
    expect(renderer.getDiagnostics().scheduledFrame).toBe(true);
    driver.advanceBy(1000 / 60);
    expect(driver.pending()).toBe(0);
    expect(wake.callbacks.size).toBe(1);
    wake.fireNext();
    expect(driver.pending()).toBe(1);
    expect(renderer.debug().actorState("agent_aster")!.distanceTravelled).toBe(0);
  });

  it.each(["restart", "seek", "setScene", "pause", "dispose"] as const)("rejects a cancelled stale RAF after %s", async (operation) => {
    const dialogue = vi.fn();
    const { renderer, driver } = await createTestRenderer("full-loop", { callbacks: { onDialogueChange: dialogue } });
    const staleHandle = driver.pendingHandles()[0]!;
    if (operation === "restart") renderer.debug().restart();
    else if (operation === "seek") renderer.debug().seek(10_000);
    else if (operation === "setScene") renderer.debug().setScene("shelter-collapse");
    else if (operation === "pause") renderer.debug().pause();
    else renderer.dispose();
    const actorBefore = renderer.debug().actorState("agent_aster");
    const shelterBefore = renderer.debug().shelterState("shelter-east");
    const handlesBefore = driver.pendingHandles();
    const scheduledBefore = renderer.getDiagnostics().scheduledFrame;
    const requestsBefore = driver.requests;
    const dialogueBefore = dialogue.mock.calls.length;

    driver.fireCancelled(staleHandle, driver.time + 5_000);

    expect(renderer.debug().actorState("agent_aster")).toEqual(actorBefore);
    expect(renderer.debug().shelterState("shelter-east")).toEqual(shelterBefore);
    expect(driver.pendingHandles()).toEqual(handlesBefore);
    expect(renderer.getDiagnostics().scheduledFrame).toBe(scheduledBefore);
    expect(driver.requests).toBe(requestsBefore);
    expect(dialogue).toHaveBeenCalledTimes(dialogueBefore);
  });

  it("rejects a cancelled stale wake without clobbering the replacement RAF", async () => {
    const { renderer, driver, wake } = await createTestRenderer();
    driver.advanceBy(20);
    const staleWake = [...wake.callbacks.keys()][0]!;
    renderer.debug().restart();
    const actorBefore = renderer.debug().actorState("agent_aster");
    const handlesBefore = driver.pendingHandles();
    const scheduledBefore = renderer.getDiagnostics().scheduledFrame;
    const requestsBefore = driver.requests;

    wake.fireCancelled(staleWake);

    expect(renderer.debug().actorState("agent_aster")).toEqual(actorBefore);
    expect(driver.pendingHandles()).toEqual(handlesBefore);
    expect(renderer.getDiagnostics().scheduledFrame).toBe(scheduledBefore);
    expect(driver.requests).toBe(requestsBefore);
  });

  it("throttles diagnostics to at most 4Hz and takes at most one actor/shelter snapshot per motion frame", async () => {
    const onDiagnostics = vi.fn();
    const { renderer, driver } = await createTestRenderer("full-loop", { callbacks: { onDiagnostics } });
    renderer.debug().seek(1_000);
    onDiagnostics.mockClear();
    const before = renderer.getDiagnostics() as CanvasRendererDiagnostics & {
      readonly runtimeCounters: { readonly actorSnapshotReads: number; readonly shelterSnapshotReads: number; readonly p95Computations: number };
    };
    const framesBefore = before.frameCount;
    driver.advanceBy(2_000);
    const after = renderer.getDiagnostics() as typeof before;
    const drawnFrames = after.frameCount - framesBefore;

    expect(onDiagnostics.mock.calls.length).toBeLessThanOrEqual(8);
    expect(after.runtimeCounters.actorSnapshotReads - before.runtimeCounters.actorSnapshotReads).toBeLessThanOrEqual(drawnFrames + 1);
    expect(after.runtimeCounters.shelterSnapshotReads - before.runtimeCounters.shelterSnapshotReads).toBeLessThanOrEqual(drawnFrames + 1);
    expect(after.runtimeCounters.p95Computations - before.runtimeCounters.p95Computations).toBeLessThanOrEqual(9);
  });

  it("publishes diagnostics only after the next RAF or wake ownership is committed", async () => {
    let armed = false;
    let rendererRef: Awaited<ReturnType<typeof createCanvasWorldRenderer>> | null = null;
    const observed: Array<{ scheduledFrame: boolean; wakes: number }> = [];
    const driver = new FakeFrameDriver();
    const wake = new FakeWakeScheduler();
    const renderer = await createCanvasWorldRenderer({
      canvas: document.createElement("canvas"),
      callbacks: { onDiagnostics: () => {
        if (armed && rendererRef !== null) observed.push({
          scheduledFrame: rendererRef.getDiagnostics().scheduledFrame,
          wakes: wake.callbacks.size,
        });
      } },
      frameDriver: driver,
      wakeScheduler: wake,
      atlasStoreFactory: () => ({
        acquire: async (id) => ({ value: bitmap(id), release: vi.fn() }),
        diagnostics: () => ({ compressedBytes: 0, decodedBytes: 0, leaseCount: 5 }),
        dispose: vi.fn(),
      }),
    });
    rendererRef = renderer;
    await vi.waitFor(() => expect(renderer.debug().isReady()).toBe(true));
    renderer.debug().seek(1_000);
    armed = true;
    driver.advanceBy(300);

    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every(({ scheduledFrame, wakes }) => scheduledFrame !== (wakes > 0))).toBe(true);
  });

  it.each(["restart", "seek", "setScene", "pause", "dispose"] as const)("keeps scheduler ownership coherent when diagnostics re-enters %s", async (operation) => {
    let rendererRef: Awaited<ReturnType<typeof createCanvasWorldRenderer>> | null = null;
    let armed = false;
    let fired = false;
    const { renderer, driver, wake } = await createTestRenderer("full-loop", { callbacks: {
      onDiagnostics: () => {
        if (!armed || fired || rendererRef === null) return;
        fired = true;
        if (operation === "restart") rendererRef.debug().restart();
        else if (operation === "seek") rendererRef.debug().seek(10_000);
        else if (operation === "setScene") rendererRef.debug().setScene("shelter-collapse");
        else if (operation === "pause") rendererRef.debug().pause();
        else rendererRef.dispose();
      },
    } });
    rendererRef = renderer;
    renderer.debug().seek(1_000);
    armed = true;
    driver.advanceBy(300);

    expect(fired).toBe(true);
    expect(driver.pending() > 0 && wake.callbacks.size > 0).toBe(false);
    if (operation === "dispose") expect(renderer.getDiagnostics().disposed).toBe(true);
  });

  it.each(["restart", "seek", "setScene", "pause", "dispose"] as const)("aborts outer cue work when dialogue re-enters %s", async (operation) => {
    let rendererRef: Awaited<ReturnType<typeof createCanvasWorldRenderer>> | null = null;
    let armed = false;
    let fired = false;
    let committedFrameCount = -1;
    const { renderer, driver, wake } = await createTestRenderer("full-loop", { callbacks: {
      onDialogueChange: (next) => {
        if (!armed || fired || next === null || rendererRef === null) return;
        fired = true;
        if (operation === "restart") rendererRef.debug().restart();
        else if (operation === "seek") rendererRef.debug().seek(10_000);
        else if (operation === "setScene") rendererRef.debug().setScene("shelter-collapse");
        else if (operation === "pause") rendererRef.debug().pause();
        else rendererRef.dispose();
        committedFrameCount = rendererRef.getDiagnostics().frameCount;
      },
    } });
    rendererRef = renderer;
    renderer.debug().seek(3_100);
    armed = true;

    renderer.debug().advanceBy(100);

    expect(fired).toBe(true);
    expect(renderer.getDiagnostics().frameCount).toBe(committedFrameCount);
    expect(driver.pending() > 0 && wake.callbacks.size > 0).toBe(false);
    if (operation === "pause") {
      expect(renderer.debug().actorState("agent_aster")?.channels.action).toBe("none");
      expect(renderer.getDiagnostics()).toMatchObject({ scheduledFrame: false, cadence: "idle" });
    } else if (operation === "dispose") {
      expect(renderer.debug().actorState("agent_aster")).toBeNull();
      expect(renderer.debug().isReady()).toBe(false);
    } else if (operation === "setScene") {
      expect(renderer.debug().shelterState("shelter-east")?.phase).toBe("standing");
    }
  });

  it("rejects stale async asset completion after scene reset", async () => {
    const loads = Array.from({ length: 10 }, () => deferred<AssetLease<ImageBitmap>>());
    let index = 0;
    const dispose = vi.fn();
    const renderer = await createCanvasWorldRenderer({
      canvas: document.createElement("canvas"), callbacks: {}, initialScene: "walk",
      frameDriver: new FakeFrameDriver(), wakeScheduler: new FakeWakeScheduler(),
      atlasStoreFactory: () => ({
        acquire: () => loads[index++]!.promise,
        diagnostics: () => ({ compressedBytes: 0, decodedBytes: 0, leaseCount: 0 }),
        dispose,
      }),
    });
    renderer.debug().setScene("dialogue");
    const secondReleases = loads.slice(5).map(() => vi.fn());
    loads.slice(5).forEach((load, offset) => load.resolve({ value: bitmap(), release: secondReleases[offset]! }));
    await vi.waitFor(() => expect(renderer.debug().isReady()).toBe(true));
    const identity = renderer.debug().actorState("agent_aster")!.instanceId;
    const staleReleases = loads.slice(0, 5).map(() => vi.fn());
    loads.slice(0, 5).forEach((load, offset) => load.resolve({ value: bitmap(), release: staleReleases[offset]! }));
    await vi.waitFor(() => staleReleases.forEach((release) => expect(release).toHaveBeenCalledTimes(1)));
    expect(renderer.debug().actorState("agent_aster")!.instanceId).toBe(identity);
    renderer.dispose();
    secondReleases.forEach((release) => expect(release).toHaveBeenCalledTimes(1));
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("reports only the failed atlas, releases late leases, and can retry to ready", async () => {
    const loads = Array.from({ length: 10 }, () => deferred<AssetLease<ImageBitmap>>());
    const releases = loads.map(() => vi.fn());
    const diagnostics = vi.fn();
    const onAssetLoadFailure = vi.fn();
    let index = 0;
    const callbacks = { onDiagnostics: diagnostics, onAssetLoadFailure };
    const renderer = await createCanvasWorldRenderer({
      canvas: document.createElement("canvas"), callbacks,
      frameDriver: new FakeFrameDriver(), wakeScheduler: new FakeWakeScheduler(),
      atlasStoreFactory: () => ({
        acquire: () => loads[index++]!.promise,
        diagnostics: () => ({ compressedBytes: 0, decodedBytes: 0, leaseCount: 0 }),
        dispose: vi.fn(),
      }),
    });

    loads[3]!.reject(new Error("shelter atlas corrupt"));
    loads.slice(0, 3).forEach((load, offset) => load.resolve({ value: bitmap(), release: releases[offset]! }));
    loads[4]!.resolve({ value: bitmap(), release: releases[4]! });
    await vi.waitFor(() => expect(renderer.getDiagnostics().missingSprites).toEqual(["shelter"]));
    expect(onAssetLoadFailure).toHaveBeenCalledOnce();
    expect(onAssetLoadFailure).toHaveBeenCalledWith({
      missingSprites: ["shelter"],
      message: "Unable to acquire shelter.",
    });
    await vi.waitFor(() => [0, 1, 2, 4].forEach((offset) => expect(releases[offset]).toHaveBeenCalledTimes(1)));
    expect(renderer.debug().isReady()).toBe(false);

    renderer.debug().restart();
    loads.slice(5).forEach((load, offset) => load.resolve({ value: bitmap(), release: releases[offset + 5]! }));
    await vi.waitFor(() => expect(renderer.debug().isReady()).toBe(true));
    expect(renderer.getDiagnostics().missingSprites).toEqual([]);
    expect(diagnostics.mock.calls.some(([value]) => value.missingSprites.length === 1)).toBe(true);
    renderer.dispose();
    releases.slice(5).forEach((release) => expect(release).toHaveBeenCalledTimes(1));
  });

  it("cannot become ready when factories finish after disposal", async () => {
    const loads = Array.from({ length: 5 }, () => deferred<AssetLease<ImageBitmap>>());
    const releases = loads.map(() => vi.fn());
    let index = 0;
    const renderer = await createCanvasWorldRenderer({
      canvas: document.createElement("canvas"), callbacks: {},
      frameDriver: new FakeFrameDriver(), wakeScheduler: new FakeWakeScheduler(),
      atlasStoreFactory: () => ({
        acquire: () => loads[index++]!.promise,
        diagnostics: () => ({ compressedBytes: 0, decodedBytes: 0, leaseCount: 0 }),
        dispose: vi.fn(),
      }),
    });
    renderer.dispose();
    loads.forEach((load, offset) => load.resolve({ value: bitmap(), release: releases[offset]! }));
    await vi.waitFor(() => releases.forEach((release) => expect(release).toHaveBeenCalledTimes(1)));
    expect(renderer.debug().isReady()).toBe(false);
  });
});
