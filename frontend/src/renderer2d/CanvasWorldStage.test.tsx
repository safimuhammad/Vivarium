import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CanvasRendererCallbacks,
  CanvasWorldRendererOptions,
  DialogueState,
  SliceCanvasRenderer,
  Vivarium2DSliceDebug,
} from "./contracts";
import type { CameraSnapshot } from "./camera/Camera2D";
import type { ShelterPhase, ShelterSnapshot2D } from "./homes/ShelterActor";

const { createRenderer } = vi.hoisted(() => ({
  createRenderer: vi.fn<(options: CanvasWorldRendererOptions) => Promise<SliceCanvasRenderer>>(),
}));

vi.mock("./CanvasWorldRenderer", () => ({
  createCanvasWorldRenderer: createRenderer,
}));

import { CanvasWorldStage } from "./CanvasWorldStage";
import { installVivarium2DSliceDebug } from "./debug";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const CAMERA: CameraSnapshot = {
  mode: "story",
  topology: "bounded",
  center: { x: 256, y: 144 },
  zoom: 1,
  viewerControlled: false,
  followEntityId: null,
  storyEntityId: null,
  pendingStoryEntityId: null,
  storyTarget: null,
  guidedTarget: null,
  pendingStoryTarget: null,
  safeFrame: { x: 0, y: 0, width: 512, height: 288 },
  followDeadZone: { x: 154, y: 86, width: 204, height: 116 },
  rasterOrigin: { x: 0, y: 0 },
  worldBounds: null,
  flying: false,
};

const DIAGNOSTICS = {
  disposed: false,
  frameCount: 0,
  scheduledFrame: false,
  cadence: "idle" as const,
  lastDrawMs: 0,
  drawP95Ms: 0,
  drawDurationsMs: [] as readonly number[],
  staticLayerRebuilds: 1,
  actorCount: 1,
  shelterCount: 1,
  activeAnimations: 0,
  assetBytesLoaded: 10,
  decodedAssetBytes: 20,
  missingSprites: [] as readonly string[],
  pathFallbacks: 0,
  longFrames: 0,
  logicalViewport: { x: 0, y: 0, width: 512, height: 288 },
  cssScale: 1,
  cropMode: "desktop-full" as const,
  smoothingEnabled: false as const,
  integerDrawRects: true,
};

const DIALOGUE: DialogueState = {
  speakerId: "agent_aster",
  speakerName: "Aster",
  text: "The path remembers every footstep.",
  visibleCharacters: 34,
  cursor: 34,
  hold: true,
};

function makeShelterSnapshot(phase: ShelterPhase = "standing"): ShelterSnapshot2D {
  return {
    id: "shelter-east",
    instanceId: 1,
    phase,
    plot: { x: 350, y: 165 },
    components: [],
    elapsedMs: 0,
    emittedMarkers: [],
    buildCommitCount: phase === "standing" || phase === "collapsing" || phase === "ruin" ? 1 : 0,
    collapseCommitCount: phase === "ruin" ? 1 : 0,
    visual: {
      manifestId: "shelter-demo-v1",
      dust: { frameId: "dust", intensity: 0 },
      ruin: { tier: phase === "ruin" ? "full" : null, composition: [] },
    },
  };
}

class ResizeObserverFake {
  static instances: ResizeObserverFake[] = [];
  readonly targets: Element[] = [];
  readonly observe = vi.fn((target: Element) => { this.targets.push(target); });
  readonly disconnect = vi.fn();

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverFake.instances.push(this);
  }

  emit(width: number, height: number): void {
    this.callback([
      {
        contentRect: { width, height } as DOMRectReadOnly,
        target: this.targets[0],
      } as ResizeObserverEntry,
    ], this as unknown as ResizeObserver);
  }
}

function makeDebug(overrides: Partial<Vivarium2DSliceDebug> = {}): Vivarium2DSliceDebug {
  return {
    isReady: () => true,
    pause: vi.fn(),
    resume: vi.fn(),
    restart: vi.fn(),
    seek: vi.fn(),
    advanceBy: vi.fn(),
    setScene: vi.fn(),
    actorState: () => ({
      id: "agent_aster",
      instanceId: 1,
      name: "Aster",
      position: { x: 100, y: 100 },
      facing: "east",
      selected: false,
      channels: {
        locomotion: "idle",
        bodyClipId: "idle-east",
        bodyFrame: 0,
        face: "neutral",
        faceFrame: 0,
        held: null,
        heldFrame: 0,
      },
      distanceTravelled: 0,
      bodyAction: null,
      actionEndsAtMs: null,
    }),
    cameraState: () => CAMERA,
    shelterState: () => makeShelterSnapshot(),
    renderDiagnostics: () => DIAGNOSTICS,
    captureLogicalImageData: vi.fn(),
    ...overrides,
  } as Vivarium2DSliceDebug;
}

function makeRenderer(debug = makeDebug()): SliceCanvasRenderer {
  return {
    setSelection: vi.fn(),
    focusSelection: vi.fn(),
    setCameraMode: vi.fn(),
    panCamera: vi.fn(),
    zoomCamera: vi.fn(),
    setSafeFrame: vi.fn(),
    resize: vi.fn(),
    getDiagnostics: () => DIAGNOSTICS,
    dispose: vi.fn(),
    debug: () => debug,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  createRenderer.mockReset();
  ResizeObserverFake.instances = [];
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: ResizeObserverFake });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  window.history.replaceState({}, "", "/?renderer=2d-slice&scene=dialogue");
  delete window.__vivarium2DSlice;
  container = document.createElement("div");
  document.body.append(container);
  root = null;
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  container.remove();
  delete window.__vivarium2DSlice;
  vi.restoreAllMocks();
});

async function renderStage(renderer = makeRenderer()): Promise<{
  renderer: SliceCanvasRenderer;
  callbacks: CanvasRendererCallbacks;
}> {
  let callbacks: CanvasRendererCallbacks = {};
  createRenderer.mockImplementation(async (options) => {
    callbacks = options.callbacks;
    return renderer;
  });
  root = createRoot(container);
  await act(async () => root?.render(<CanvasWorldStage />));
  return { renderer, callbacks };
}

function button(name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing ${name} button`);
  return match;
}

describe("CanvasWorldStage", () => {
  it("mirrors only visible entities and describes their current action truthfully", async () => {
    let phase: ShelterPhase = "absent";
    let actorAction = "idle";
    const baseDebug = makeDebug();
    const debug = makeDebug({
      actorState: (id) => {
        const actor = baseDebug.actorState(id);
        if (actor === null) return null;
        return {
          ...actor,
          channels: {
            ...actor.channels,
            locomotion: actorAction === "walk" ? "walk" : "idle",
            action: actorAction === "work" ? "work" : actorAction === "speak" ? "speak" : "none",
          },
        };
      },
      shelterState: () => makeShelterSnapshot(phase),
    });
    const renderer = makeRenderer(debug);
    const { callbacks } = await renderStage(renderer);

    expect(container.querySelector(".slice2d__semantic-mirror")?.textContent).toContain("Aster — human, resting");
    expect(container.querySelector(".slice2d__semantic-mirror")?.textContent).not.toContain("East shelter");
    expect(container.querySelectorAll(".slice2d__semantic-mirror button")).toHaveLength(1);

    actorAction = "work";
    phase = "building";
    await act(async () => callbacks.onDiagnostics?.({ ...DIAGNOSTICS, frameCount: 1 }));
    expect(container.querySelector(".slice2d__semantic-mirror")?.textContent).toContain("Aster — human, building the east shelter");
    expect(container.querySelector(".slice2d__semantic-mirror")?.textContent).toContain("East shelter — under construction");

    actorAction = "idle";
    phase = "ruin";
    await act(async () => callbacks.onDiagnostics?.({ ...DIAGNOSTICS, frameCount: 2 }));
    expect(container.querySelector(".slice2d__semantic-mirror")?.textContent).toContain("Aster — human, resting");
    expect(container.querySelector(".slice2d__semantic-mirror")?.textContent).toContain("East shelter ruins — rubble remains");
  });

  it("renders a named canvas, stable semantic order, camera pressed state, and two focusable entity entries", async () => {
    await renderStage();

    expect(container.querySelector("canvas")?.getAttribute("aria-label")).toBe("Animated Vivarium region");
    expect([...container.querySelectorAll("main > *")].map((node) => node.className)).toEqual([
      "slice2d__canvas",
      "slice2d__camera-controls",
      "slice2d__dialogue",
      "slice2d__semantic-mirror",
      "slice2d__live-region",
    ]);
    expect(button("Story").getAttribute("aria-pressed")).toBe("true");
    expect(button("Follow").getAttribute("aria-pressed")).toBe("false");
    expect(button("Free").getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelectorAll(".slice2d__semantic-mirror button")).toHaveLength(2);
    expect(container.querySelector(".slice2d__semantic-mirror")?.textContent).toContain("Aster");
    expect(container.querySelector(".slice2d__semantic-mirror")?.textContent).toContain("shelter");
  });

  it("keeps active dialogue as selectable DOM text and announces only a completed dialogue milestone", async () => {
    const { callbacks } = await renderStage();
    const partial = { ...DIALOGUE, visibleCharacters: 8, cursor: 8, hold: false };

    await act(async () => callbacks.onDialogueChange?.(partial));
    expect(container.querySelector(".slice2d__dialogue-text")?.textContent).toBe("The path");
    expect(getComputedStyle(container.querySelector(".slice2d__dialogue-text")!).userSelect).not.toBe("none");
    expect(container.querySelector("[aria-live='polite']")?.textContent).toBe("");

    await act(async () => callbacks.onDialogueChange?.(DIALOGUE));
    expect(container.querySelector(".slice2d__dialogue-text")?.textContent).toBe(DIALOGUE.text);
    expect(container.querySelector("[aria-live='polite']")?.textContent).toBe(`Aster says: ${DIALOGUE.text}`);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("sends camera, pause, restart, view-moment, and semantic focus intents to the renderer", async () => {
    const debug = makeDebug();
    const renderer = makeRenderer(debug);
    await renderStage(renderer);

    await act(async () => button("Follow").click());
    expect(renderer.setSelection).toHaveBeenCalledWith({ kind: "agent", id: "agent_aster" });
    expect(renderer.setCameraMode).toHaveBeenLastCalledWith("follow");
    expect(button("Follow").getAttribute("aria-pressed")).toBe("true");

    await act(async () => button("Free").click());
    await act(async () => button("Story").click());
    expect(renderer.setCameraMode).toHaveBeenCalledWith("free");
    expect(renderer.setCameraMode).toHaveBeenCalledWith("story");

    await act(async () => button("Pause").click());
    expect(debug.pause).toHaveBeenCalledOnce();
    await act(async () => button("Resume").click());
    expect(debug.resume).toHaveBeenCalledOnce();
    await act(async () => button("Restart").click());
    expect(debug.restart).toHaveBeenCalledOnce();
    await act(async () => button("View moment").click());
    expect(renderer.setCameraMode).toHaveBeenLastCalledWith("story");

    await act(async () => button("Aster — human, resting").click());
    expect(renderer.focusSelection).toHaveBeenCalledWith({ kind: "agent", id: "agent_aster" });
    await act(async () => button("East shelter — standing with a lit hearth").click());
    expect(renderer.focusSelection).toHaveBeenCalledWith({ kind: "home", id: "shelter-east" });
  });

  it("forwards resize, canvas pointer selection, and canvas keyboard intents", async () => {
    const renderer = makeRenderer();
    await renderStage(renderer);
    const stage = container.querySelector("main")!;
    const canvas = container.querySelector("canvas")!;
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({ width: 900, height: 600 } as DOMRect);
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 512, height: 288 } as DOMRect);

    await act(async () => ResizeObserverFake.instances[0]?.emit(900, 600));
    expect(renderer.resize).toHaveBeenCalledWith(900, 600);

    await act(async () => canvas.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      clientX: 100,
      clientY: 100,
    })));
    expect(renderer.setSelection).toHaveBeenCalledWith({ kind: "agent", id: "agent_aster" });

    await act(async () => canvas.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      clientX: 350,
      clientY: 75,
    })));
    expect(renderer.setSelection).toHaveBeenLastCalledWith({ kind: "home", id: "shelter-east" });

    await act(async () => canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "f" })));
    expect(renderer.setCameraMode).toHaveBeenCalledWith("follow");
    await act(async () => canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })));
    expect(renderer.setCameraMode).toHaveBeenLastCalledWith("story");
  });

  it("converts overlay intersections into logical safe-frame insets on resize", async () => {
    const renderer = {
      ...makeRenderer(),
      getDiagnostics: () => ({
        ...DIAGNOSTICS,
        logicalViewport: { x: 0, y: 0, width: 320, height: 288 },
        cssScale: 2,
        cropMode: "mobile-crop" as const,
      }),
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBounds(this: HTMLElement) {
      if (this.classList.contains("slice2d")) return { left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844 } as DOMRect;
      if (this.classList.contains("slice2d__canvas")) return { left: -125, top: 100, right: 515, bottom: 676, width: 640, height: 576 } as DOMRect;
      if (this.classList.contains("slice2d__camera-controls")) return { left: 8, top: 50, right: 350, bottom: 150, width: 342, height: 100 } as DOMRect;
      if (this.classList.contains("slice2d__dialogue")) return { left: 8, top: 600, right: 382, bottom: 680, width: 374, height: 80 } as DOMRect;
      if (this.classList.contains("slice2d__semantic-mirror")) return { left: 8, top: 620, right: 382, bottom: 800, width: 374, height: 180 } as DOMRect;
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect;
    });
    await renderStage(renderer);

    await act(async () => ResizeObserverFake.instances[0]?.emit(390, 844));
    expect(renderer.setSafeFrame).toHaveBeenLastCalledWith({ top: 25, right: 0, bottom: 38, left: 0 });
  });

  it("announces each shelter material phase once instead of frame diagnostics", async () => {
    let phase: ShelterPhase = "building";
    const debug = makeDebug({
      shelterState: () => makeShelterSnapshot(phase),
    });
    const { callbacks } = await renderStage(makeRenderer(debug));
    const live = container.querySelector("[aria-live='polite']")!;

    await act(async () => callbacks.onDiagnostics?.({ ...DIAGNOSTICS, frameCount: 1 }));
    expect(live.textContent).toBe("Shelter construction began.");
    await act(async () => callbacks.onDiagnostics?.({ ...DIAGNOSTICS, frameCount: 2 }));
    expect(live.textContent).toBe("Shelter construction began.");
    phase = "ruin";
    await act(async () => callbacks.onDiagnostics?.({ ...DIAGNOSTICS, frameCount: 3 }));
    expect(live.textContent).toBe("The east shelter became a ruin.");
  });

  it("queues the latest material milestone while dialogue is active and announces it when dialogue ends", async () => {
    let phase: ShelterPhase = "building";
    const debug = makeDebug({ shelterState: () => makeShelterSnapshot(phase) });
    const { callbacks } = await renderStage(makeRenderer(debug));
    const live = container.querySelector("[aria-live='polite']")!;

    await act(async () => callbacks.onDialogueChange?.(DIALOGUE));
    await act(async () => callbacks.onDiagnostics?.({ ...DIAGNOSTICS, frameCount: 1 }));
    expect(live.textContent).toBe(`Aster says: ${DIALOGUE.text}`);
    phase = "standing";
    await act(async () => callbacks.onDiagnostics?.({ ...DIAGNOSTICS, frameCount: 2 }));
    await act(async () => callbacks.onDialogueChange?.(null));
    expect(live.textContent).toBe("The east shelter now stands complete.");
  });

  it("passes the scene and reduced-motion preference to the factory and disposes its owners once", async () => {
    const renderer = makeRenderer();
    const { callbacks } = await renderStage(renderer);
    expect(createRenderer.mock.calls[0]?.[0]).toMatchObject({ initialScene: "dialogue", reducedMotion: false });
    expect(createRenderer.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);

    await act(async () => callbacks.onDiagnostics?.(DIAGNOSTICS));
    expect(container.querySelector("main")?.getAttribute("data-ready")).toBe("true");
    await act(async () => root?.unmount());
    root = null;
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(ResizeObserverFake.instances[0]?.disconnect).toHaveBeenCalledOnce();
  });

  it("keeps an early atlas failure unavailable when the renderer factory resolves afterward", async () => {
    const pending = deferred<SliceCanvasRenderer>();
    const renderer = makeRenderer(makeDebug({ isReady: () => false }));
    let callbacks: CanvasRendererCallbacks = {};
    createRenderer.mockImplementation((options) => {
      callbacks = options.callbacks;
      return pending.promise;
    });
    root = createRoot(container);
    await act(async () => root?.render(<CanvasWorldStage />));

    await act(async () => callbacks.onAssetLoadFailure?.({
      missingSprites: ["shelter"],
      message: "Unable to acquire shelter.",
    }));
    expect(container.querySelector("main")?.getAttribute("data-ready")).toBe("false");
    expect(container.querySelector("[role='alert']")?.textContent).toContain("shelter");

    pending.resolve(renderer);
    await act(async () => { await pending.promise; });

    expect(container.querySelector("main")?.getAttribute("data-ready")).toBe("false");
    expect(container.querySelector("[role='alert']")?.textContent).toContain("shelter");
    expect(button("Retry world")).toBe(document.activeElement);
  });

  it("exposes a focused atlas failure alert and retries with a clean renderer", async () => {
    const firstDebug = makeDebug({ isReady: () => false });
    const firstRenderer = makeRenderer(firstDebug);
    const secondDebug = makeDebug();
    const secondRenderer = makeRenderer(secondDebug);
    const callbacks: CanvasRendererCallbacks[] = [];
    createRenderer.mockImplementation(async (options) => {
      callbacks.push(options.callbacks);
      return callbacks.length === 1 ? firstRenderer : secondRenderer;
    });
    root = createRoot(container);
    await act(async () => root?.render(<CanvasWorldStage />));

    type FailureCallbacks = CanvasRendererCallbacks & {
      onAssetLoadFailure?(failure: { readonly missingSprites: readonly ["shelter"]; readonly message: string }): void;
    };
    await act(async () => (callbacks[0] as FailureCallbacks).onAssetLoadFailure?.({
      missingSprites: ["shelter"],
      message: "Unable to acquire shelter.",
    }));

    const alert = container.querySelector<HTMLElement>("[role='alert']");
    expect(alert?.textContent).toContain("World unavailable");
    expect(alert?.textContent).toContain("shelter");
    expect(button("Retry world")).toBe(document.activeElement);

    await act(async () => button("Retry world").click());

    expect(firstRenderer.dispose).toHaveBeenCalledOnce();
    expect(createRenderer).toHaveBeenCalledTimes(2);
    expect(window.__vivarium2DSlice).toBe(secondDebug);
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(container.querySelector("main")?.getAttribute("data-ready")).toBe("true");
    expect(container.querySelector("canvas")).toBe(document.activeElement);
  });

  it("disposes before aborting so the installed renderer removes its signal listener without a second dispose", async () => {
    const renderer = makeRenderer();
    createRenderer.mockImplementation(async (options) => {
      const onAbort = (): void => renderer.dispose();
      options.signal?.addEventListener("abort", onAbort);
      vi.mocked(renderer.dispose).mockImplementation(() => options.signal?.removeEventListener("abort", onAbort));
      return renderer;
    });
    root = createRoot(container);
    await act(async () => root?.render(<CanvasWorldStage />));

    await act(async () => root?.unmount());
    root = null;
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(createRenderer.mock.calls[0]?.[0].signal?.aborted).toBe(true);
  });

  it("keeps the newer StrictMode renderer/debug identity when an aborted factory resolves late", async () => {
    const first = deferred<SliceCanvasRenderer>();
    const second = deferred<SliceCanvasRenderer>();
    const firstRenderer = makeRenderer(makeDebug());
    const secondDebug = makeDebug();
    const secondRenderer = makeRenderer(secondDebug);
    createRenderer
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    root = createRoot(container);

    await act(async () => root?.render(<StrictMode><CanvasWorldStage /></StrictMode>));
    expect(createRenderer).toHaveBeenCalledTimes(2);
    expect(createRenderer.mock.calls[0]?.[0].signal?.aborted).toBe(true);
    second.resolve(secondRenderer);
    await act(async () => { await second.promise; });
    expect(window.__vivarium2DSlice).toBe(secondDebug);

    first.resolve(firstRenderer);
    await act(async () => { await first.promise; });
    expect(firstRenderer.dispose).toHaveBeenCalledOnce();
    expect(window.__vivarium2DSlice).toBe(secondDebug);

    await act(async () => root?.unmount());
    root = null;
    expect(secondRenderer.dispose).toHaveBeenCalledOnce();
    expect(window.__vivarium2DSlice).toBeUndefined();
  });

  it("does not call dispose again when the Task 7 factory returns an already-aborted renderer", async () => {
    const pending = deferred<SliceCanvasRenderer>();
    const dispose = vi.fn();
    const renderer = {
      ...makeRenderer(),
      dispose,
      getDiagnostics: () => ({ ...DIAGNOSTICS, disposed: true }),
    };
    createRenderer.mockImplementation(() => pending.promise);
    root = createRoot(container);
    await act(async () => root?.render(<CanvasWorldStage />));
    await act(async () => root?.unmount());
    root = null;
    dispose();

    pending.resolve(renderer);
    await act(async () => { await pending.promise; });
    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe("installVivarium2DSliceDebug", () => {
  it("removes only the debug object installed by its own cleanup", () => {
    const first = makeDebug();
    const second = makeDebug();
    const cleanupFirst = installVivarium2DSliceDebug(first);
    const cleanupSecond = installVivarium2DSliceDebug(second);

    cleanupFirst();
    expect(window.__vivarium2DSlice).toBe(second);
    cleanupSecond();
    expect(window.__vivarium2DSlice).toBeUndefined();
  });
});
