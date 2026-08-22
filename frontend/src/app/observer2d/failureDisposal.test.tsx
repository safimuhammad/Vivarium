import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoryMoment } from "../../presentation/BeatDirector";
import type { PresentedObserverFrame } from "../../presentation/contracts";
import type { ObserverRendererPort } from "../../presentation/rendererPort";
import type { PresentedChronicleWindow } from "../../presentation/selectors";
import {
  createCanvasPresentationRenderer,
} from "../../renderer2d/production/CanvasPresentationRenderer";
import type { ObserverShellRuntime, ObserverShellSnapshot } from "./observerShellRuntime";
import { Vivarium2DApp } from "../Vivarium2DApp";

vi.mock("../../renderer2d/production/CanvasPresentationRenderer", () => ({
  createCanvasPresentationRenderer: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const createRenderer = vi.mocked(createCanvasPresentationRenderer);
let container: HTMLDivElement;
let root: Root | null;

beforeEach(async () => {
  // PresentationWorldStage starts `import("./ProductionCanvasSceneFactory")` at MODULE
  // level and only creates the renderer in that promise's `.then()`. These cases mount
  // the app and then immediately assert that the renderer was created (
  // `updatePresentation` called, a ResizeObserver installed), so they were racing that
  // import: run alone the graph settled inside the awaited `act()`, but run with the
  // rest of `observer2d` the extra module/microtask traffic pushed it past the
  // assertion and all four failed with `updatePresentation` never called and
  // `ResizeObserverFake.instances[0]` undefined. Awaiting the same module here settles
  // the promise before any case mounts, so the `.then()` is merely a queued microtask
  // that `act()` flushes deterministically. This is the identical pre-await the QA
  // renderer harness already performs in `establishExactRendererBaseline`.
  await import("../../renderer2d/production/ProductionCanvasSceneFactory");
  // The Chronicle killfeed remembers whether the viewer left it open, so a case
  // that opens it must not silently open it for every case after it.
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  createRenderer.mockReset();
  ResizeObserverFake.instances.length = 0;
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverFake,
  });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

describe("production observer failure and lifecycle composition", () => {
  it("views the exact shown moment without advancing or replacing the selected source", async () => {
    const renderer = fakeRenderer();
    createRenderer.mockImplementation(async (options) => {
      renderer.bind(options);
      return renderer.port;
    });
    const fixture = runtimeFixture("view-moment");
    const selectedBefore = fixture.runtime.frameSource.getSnapshot();

    await act(async () => root?.render(
      <Vivarium2DApp createRuntime={() => fixture.runtime} />,
    ));
    await settle();
    // The retired NOW card's "View moment" button now lives on the Chronicle's
    // own leading entry -- one surface, marked as the current moment, carrying
    // the same production path (`viewMoment` + a moment focus request).
    await clickLeadingChronicleEntry();

    expect(fixture.runtime.viewMoment).toHaveBeenCalledOnce();
    expect(fixture.runtime.viewMoment).toHaveBeenCalledWith("4:4:single");
    expect(fixture.runtime.requestFocus).toHaveBeenCalledOnce();
    expect(fixture.runtime.requestFocus).toHaveBeenCalledWith({
      kind: "moment",
      id: "4:4:single",
      firstCursor: 4,
      lastCursor: 4,
    });
    expect(fixture.runtime.frameSource.getSnapshot()).toBe(selectedBefore);
    expect(renderer.updatePresentation).toHaveBeenCalledOnce();
    expect(fixture.runtime.enterArchive).not.toHaveBeenCalled();
    expect(fixture.runtime.enterArchiveCheckpoint).not.toHaveBeenCalled();
    expect(fixture.runtime.returnToLive).not.toHaveBeenCalled();
  });

  it("keeps one Canvas through Live and Archive churn and rejects callbacks from the replaced run", async () => {
    const first = mutableRuntimeFixture("run-a");
    const replacement = mutableRuntimeFixture("run-b");
    const renderers = [fakeRenderer(), fakeRenderer()];
    createRenderer
      .mockImplementationOnce(async (options) => {
        renderers[0]!.bind(options);
        return renderers[0]!.port;
      })
      .mockImplementationOnce(async (options) => {
        renderers[1]!.bind(options);
        return renderers[1]!.port;
      });
    const firstFactory = () => first.runtime;
    const replacementFactory = () => replacement.runtime;

    await act(async () => root?.render(
      <Vivarium2DApp createRuntime={firstFactory} />,
    ));
    await settle();
    const staleCallbacks = createRenderer.mock.calls[0]![0].callbacks;
    expect(container.querySelectorAll("canvas")).toHaveLength(1);

    await act(async () => first.publishSource("archive", 2));
    await settle();
    await act(async () => first.publishSource("archive", 3));
    await settle();

    expect(createRenderer).toHaveBeenCalledOnce();
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(renderers[0]!.updatePresentation).toHaveBeenLastCalledWith(
      first.runtime.frameSource.getSnapshot(),
    );

    await act(async () => root?.render(
      <Vivarium2DApp createRuntime={replacementFactory} />,
    ));
    await settle();

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(first.unsubscribe).toHaveBeenCalledOnce();
    expect(renderers[0]!.dispose).toHaveBeenCalledOnce();
    expect(createRenderer).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(renderers[1]!.updatePresentation).toHaveBeenLastCalledWith(
      replacement.runtime.frameSource.getSnapshot(),
    );

    await act(async () => {
      first.emitStale();
      staleCallbacks.onSelectionChange?.({ kind: "agent", id: "stale-agent" });
      staleCallbacks.onCameraModeChange?.("free");
      staleCallbacks.onDiagnostics?.({
        disposed: false,
        frameIdentity: null,
        drawP95Ms: 0,
        scheduledFrame: false,
        activeActors: 0,
        activeHomes: 0,
        activeEffects: 0,
        staticLayerRebuilds: 0,
        assetBytes: 0,
        decodedAssetBytes: 0,
        pathFallbacks: 0,
      });
    });

    expect(first.select).not.toHaveBeenCalled();
    expect(first.setCameraMode).not.toHaveBeenCalled();
    expect(replacement.select).not.toHaveBeenCalled();
    expect(replacement.setCameraMode).not.toHaveBeenCalled();
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(required(".vivarium-2d-app").getAttribute("data-presented-source")).toBe("live");
  });

  it("keeps Chronicle and inspection usable while Canvas fails, then retries a clean generation", async () => {
    const renderer = fakeRenderer();
    createRenderer
      .mockRejectedValueOnce(new Error("/private/provider/raw-atlas.png"))
      .mockImplementationOnce(async (options) => {
        renderer.bind(options);
        return renderer.port;
      });
    const fixture = runtimeFixture("canvas-failure");

    await act(async () => root?.render(
      <Vivarium2DApp createRuntime={() => fixture.runtime} />,
    ));
    await settle();

    const alert = required<HTMLElement>("[role='alert']");
    expect(alert.textContent).toContain("The world renderer could not be started.");
    expect(container.textContent).not.toContain("/private/provider/raw-atlas.png");
    await click("Chronicle");
    expect(container.textContent).toContain("Aster spoke at Meadow.");
    // And it says which entry is the present tense, which is the whole reason
    // the separate NOW card could be retired.
    expect(required("[data-chronicle-now]").getAttribute("data-chronicle-now")).toBe("Now");
    await click("Selection");
    expect(container.textContent).toContain("Aster");

    await click("Retry world");
    await settle();

    expect(createRenderer).toHaveBeenCalledTimes(2);
    expect(createRenderer.mock.calls[0]![0].signal?.aborted).toBe(true);
    expect(createRenderer.mock.calls[1]![0].signal).not.toBe(
      createRenderer.mock.calls[0]![0].signal,
    );
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(required(".presentation-world-stage").getAttribute("data-ready")).toBe("true");
  });

  it("releases every StrictMode probe and HMR-like remount before callbacks can cross generations", async () => {
    const runtimes: ReturnType<typeof runtimeFixture>[] = [];
    const renderers: ReturnType<typeof fakeRenderer>[] = [];
    const createRuntime = vi.fn(() => {
      const fixture = runtimeFixture(`runtime-${runtimes.length + 1}`);
      runtimes.push(fixture);
      return fixture.runtime;
    });
    createRenderer.mockImplementation(async (options) => {
      const renderer = fakeRenderer();
      renderer.bind(options);
      renderers.push(renderer);
      return renderer.port;
    });

    await act(async () => root?.render(
      <StrictMode><Vivarium2DApp createRuntime={createRuntime} /></StrictMode>,
    ));
    await settle();
    expect(runtimes.length).toBeGreaterThanOrEqual(2);
    expect(runtimes.slice(0, -1).every((fixture) => (
      fixture.dispose.mock.calls.length === 1
      && fixture.unsubscribe.mock.calls.length === 1
    ))).toBe(true);
    expect(runtimes.at(-1)!.dispose).not.toHaveBeenCalled();
    expect(renderers.filter((renderer) => renderer.dispose.mock.calls.length === 0))
      .toHaveLength(1);

    await act(async () => root?.unmount());
    root = null;
    for (const fixture of runtimes) fixture.emitStale();
    expect(runtimes.every((fixture) => (
      fixture.dispose.mock.calls.length === 1
      && fixture.unsubscribe.mock.calls.length === 1
    ))).toBe(true);
    expect(renderers.every((renderer) => renderer.dispose.mock.calls.length === 1)).toBe(true);

    root = createRoot(container);
    await act(async () => root?.render(
      <Vivarium2DApp createRuntime={createRuntime} />,
    ));
    await settle();
    const remountRuntime = runtimes.at(-1)!;
    const remountRenderer = renderers.at(-1)!;
    expect(remountRuntime.dispose).not.toHaveBeenCalled();
    expect(remountRenderer.dispose).not.toHaveBeenCalled();

    await act(async () => root?.unmount());
    root = null;
    remountRuntime.emitStale();
    expect(remountRuntime.dispose).toHaveBeenCalledOnce();
    expect(remountRuntime.unsubscribe).toHaveBeenCalledOnce();
    expect(remountRenderer.dispose).toHaveBeenCalledOnce();
    expect(container.querySelector("canvas")).toBeNull();
    expect(ResizeObserverFake.instances.every((observer) => (
      observer.disconnect.mock.calls.length === 1
    ))).toBe(true);
  });
});

class ResizeObserverFake {
  static readonly instances: ResizeObserverFake[] = [];
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  readonly unobserve = vi.fn();

  constructor(_callback: ResizeObserverCallback) {
    ResizeObserverFake.instances.push(this);
  }
}

function fakeRenderer(): Readonly<{
  port: ObserverRendererPort;
  dispose: ReturnType<typeof vi.fn>;
  updatePresentation: ReturnType<typeof vi.fn>;
  bind: (options: Parameters<typeof createCanvasPresentationRenderer>[0]) => void;
}> {
  const dispose = vi.fn();
  let acceptance: Parameters<typeof createCanvasPresentationRenderer>[0]["frameAcceptance"];
  const updatePresentation = vi.fn((frame: PresentedObserverFrame) => {
    acceptance?.markAccepted(frame);
  });
  return {
    dispose,
    updatePresentation,
    bind(options): void {
      acceptance = options.frameAcceptance;
    },
    port: {
      updatePresentation,
      setSelection: vi.fn(),
      focusSelection: vi.fn(),
      observeRegion: vi.fn(),
      setSafeFrame: vi.fn(),
      setCameraMode: vi.fn(),
      panCamera: vi.fn(),
      zoomCamera: vi.fn(),
      resize: vi.fn(),
      diagnostics: () => ({
        disposed: false,
        frameIdentity: null,
        drawP95Ms: 0,
        scheduledFrame: false,
        activeActors: 0,
        activeHomes: 0,
        activeEffects: 0,
        staticLayerRebuilds: 0,
        assetBytes: 0,
        decodedAssetBytes: 0,
        pathFallbacks: 0,
      }),
      dispose,
    },
  };
}

function runtimeFixture(label: string): Readonly<{
  runtime: ObserverShellRuntime;
  dispose: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  emitStale: () => void;
}> {
  const frame = presentedFrame(label);
  const chronicle = presentedChronicle();
  const snapshot: ObserverShellSnapshot = Object.freeze({
    status: "ready",
    frame,
    chronicle,
    controls: null,
    diagnostics: Object.freeze({
      paused: false,
      speed: 1,
      held: false,
      hidden: false,
      recovery: Object.freeze({ status: "idle", fault: null }),
      settlement: null,
    }) as unknown as ObserverShellSnapshot["diagnostics"],
    placement: Object.freeze({
      snapshot: () => Object.freeze({ agents: [], homes: [], ruins: [] }),
    }) as unknown as NonNullable<ObserverShellSnapshot["placement"]>,
    recipes: new Map(),
    placementOwnerId: Symbol(label),
    placementGeneration: 1,
    cameraMode: "story",
    observedRegionId: null,
    focusRequest: null,
    archive: Object.freeze({ status: "inactive" }),
    error: null,
  });
  const runtimeListeners = new Set<() => void>();
  const frameListeners = new Set<() => void>();
  const capturedRuntimeListeners: (() => void)[] = [];
  const capturedFrameListeners: (() => void)[] = [];
  const unsubscribe = vi.fn();
  const dispose = vi.fn(() => {
    runtimeListeners.clear();
    frameListeners.clear();
  });
  const runtime: ObserverShellRuntime = {
    ready: Promise.resolve(),
    frameSource: {
      getSnapshot: () => frame,
      subscribe(listener) {
        frameListeners.add(listener);
        capturedFrameListeners.push(listener);
        return () => frameListeners.delete(listener);
      },
    },
    frameAcceptance: { markAccepted: vi.fn() },
    subscribe(listener) {
      runtimeListeners.add(listener);
      capturedRuntimeListeners.push(listener);
      return () => {
        runtimeListeners.delete(listener);
        unsubscribe();
      };
    },
    getSnapshot: () => snapshot,
    diagnostics: () => snapshot.diagnostics,
    select: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    setSpeed: vi.fn(),
    holdCurrentMoment: vi.fn(),
    viewMoment: vi.fn(),
    viewCursor: vi.fn(),
    retryRecovery: vi.fn(async () => undefined),
    reconnectStream: vi.fn(),
    setCameraMode: vi.fn(),
    requestFocus: vi.fn(),
    observeRegion: vi.fn(),
    openArchiveCatalogue: vi.fn(async () => undefined),
    loadOlderArchive: vi.fn(async () => undefined),
    enterArchiveCheckpoint: vi.fn(async () => undefined),
    enterArchive: vi.fn(async () => undefined),
    returnToLive: vi.fn(),
    dispose,
  };
  return {
    runtime,
    dispose,
    unsubscribe,
    emitStale: () => {
      for (const listener of [...capturedRuntimeListeners, ...capturedFrameListeners]) listener();
    },
  };
}

function mutableRuntimeFixture(label: string): Readonly<{
  runtime: ObserverShellRuntime;
  dispose: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  setCameraMode: ReturnType<typeof vi.fn>;
  publishSource: (source: "live" | "archive", revision: number) => void;
  emitStale: () => void;
}> {
  const placement = Object.freeze({
    snapshot: () => Object.freeze({ agents: [], homes: [], ruins: [] }),
  }) as unknown as NonNullable<ObserverShellSnapshot["placement"]>;
  const recipes = new Map();
  const placementOwnerId = Symbol(label);
  let frame = presentedFrame(label);
  let snapshot = mutableSnapshot(frame, placement, recipes, placementOwnerId);
  const runtimeListeners = new Set<() => void>();
  const frameListeners = new Set<() => void>();
  const capturedRuntimeListeners: (() => void)[] = [];
  const capturedFrameListeners: (() => void)[] = [];
  const unsubscribe = vi.fn();
  const dispose = vi.fn(() => {
    runtimeListeners.clear();
    frameListeners.clear();
  });
  const select = vi.fn();
  const setCameraMode = vi.fn();
  const runtime: ObserverShellRuntime = {
    ready: Promise.resolve(),
    frameSource: {
      getSnapshot: () => frame,
      subscribe(listener) {
        frameListeners.add(listener);
        capturedFrameListeners.push(listener);
        return () => frameListeners.delete(listener);
      },
    },
    frameAcceptance: { markAccepted: vi.fn() },
    subscribe(listener) {
      runtimeListeners.add(listener);
      capturedRuntimeListeners.push(listener);
      return () => {
        runtimeListeners.delete(listener);
        unsubscribe();
      };
    },
    getSnapshot: () => snapshot,
    diagnostics: () => snapshot.diagnostics,
    select,
    pause: vi.fn(),
    resume: vi.fn(),
    setSpeed: vi.fn(),
    holdCurrentMoment: vi.fn(),
    viewMoment: vi.fn(),
    viewCursor: vi.fn(),
    retryRecovery: vi.fn(async () => undefined),
    reconnectStream: vi.fn(),
    setCameraMode,
    requestFocus: vi.fn(),
    observeRegion: vi.fn(),
    openArchiveCatalogue: vi.fn(async () => undefined),
    loadOlderArchive: vi.fn(async () => undefined),
    enterArchiveCheckpoint: vi.fn(async () => undefined),
    enterArchive: vi.fn(async () => undefined),
    returnToLive: vi.fn(),
    dispose,
  };
  return {
    runtime,
    dispose,
    unsubscribe,
    select,
    setCameraMode,
    publishSource(source, revision): void {
      frame = Object.freeze({
        ...presentedFrame(label),
        source,
        sourceKey: `${source}:${label}:${revision}`,
        revision,
        presentedCursor: revision,
        ingestedCursor: revision,
        lastCursor: revision,
      });
      snapshot = mutableSnapshot(frame, placement, recipes, placementOwnerId);
      for (const listener of [...runtimeListeners]) listener();
      for (const listener of [...frameListeners]) listener();
    },
    emitStale(): void {
      for (const listener of [...capturedRuntimeListeners, ...capturedFrameListeners]) listener();
    },
  };
}

function mutableSnapshot(
  frame: PresentedObserverFrame,
  placement: NonNullable<ObserverShellSnapshot["placement"]>,
  recipes: NonNullable<ObserverShellSnapshot["recipes"]>,
  placementOwnerId: symbol,
): ObserverShellSnapshot {
  return Object.freeze({
    status: "ready",
    frame,
    chronicle: presentedChronicle(),
    controls: null,
    diagnostics: Object.freeze({
      paused: false,
      speed: 1,
      held: false,
      hidden: false,
      recovery: Object.freeze({ status: "idle", fault: null }),
      settlement: null,
    }) as unknown as ObserverShellSnapshot["diagnostics"],
    placement,
    recipes,
    placementOwnerId,
    placementGeneration: 1,
    cameraMode: "story",
    observedRegionId: null,
    focusRequest: null,
    archive: Object.freeze({ status: frame.source === "archive" ? "active" : "inactive",
      ...(frame.source === "archive" ? {
        sourceKey: frame.sourceKey,
        checkpoints: Object.freeze([]),
        hasMore: false,
        selectedKey: null,
      } : {}) }) as ObserverShellSnapshot["archive"],
    error: null,
  });
}

function presentedFrame(label: string): PresentedObserverFrame {
  return Object.freeze({
    runId: label,
    sourceKey: `live:${label}`,
    revision: 1,
    firstCursor: 0,
    lastCursor: 4,
    source: "live",
    ingestedCursor: 4,
    presentedCursor: 4,
    world: Object.freeze({
      exactBaseCursor: 4,
      projectedThroughCursor: 4,
      worldTime: 12,
      agents: Object.freeze([Object.freeze({
        completeness: "exact",
        value: Object.freeze({
          id: "aster",
          name: "Aster",
          status: "alive",
          position: "meadow",
          energy: 9,
          materials: 2,
        }),
      })]),
      regions: Object.freeze([Object.freeze({
        completeness: "exact",
        value: Object.freeze({
          name: "meadow",
          description: "A quiet green place",
          connections: [],
        }),
      })]),
      homes: Object.freeze([]),
      ruins: Object.freeze([]),
      pendingProposals: Object.freeze([]),
    }),
    scene: null,
    selection: Object.freeze({ kind: "agent", id: "aster" }),
    backlog: Object.freeze({
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Caught up",
    }),
    transport: Object.freeze({ connection: "live", ingestedCursor: 4, retryable: false }),
  });
}

function presentedChronicle(): PresentedChronicleWindow {
  const moment = storyMoment();
  return Object.freeze({
    now: moment,
    previous: Object.freeze([moment]),
    upcoming: Object.freeze([]),
    gaps: Object.freeze([]),
  });
}

function storyMoment(): StoryMoment {
  const entry = Object.freeze({
    cursor: 4,
    event: Object.freeze({
      type: "speak",
      source: "aster",
      payload: Object.freeze({ agent_id: "aster", text: "A quiet choice." }),
      scope: "local" as const,
      region: "meadow",
      target: null,
      timestamp: 12,
    }),
    resolved: Object.freeze({ actor_id: "aster", region: "meadow" }),
    snapshot_after: null,
  });
  return Object.freeze({
    id: "4:4:single",
    firstCursor: 4,
    lastCursor: 4,
    evidenceCursors: Object.freeze([4]),
    evidence: Object.freeze([entry]),
    representative: entry,
    chainKind: "single",
    priority: "featured",
    focus: Object.freeze({ kind: "agent", id: "aster" }),
  });
}

/** Clicks the Chronicle entry marked as the moment happening now. */
async function clickLeadingChronicleEntry(): Promise<void> {
  const target = container.querySelector<HTMLButtonElement>(
    "[data-chronicle-now] .chronicle-killfeed__replay",
  );
  if (target === null) throw new Error("the Chronicle marked no leading entry");
  await act(async () => target.click());
}

async function click(name: string): Promise<void> {
  const target = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => (
    button.getAttribute("aria-label") === name || button.textContent?.trim() === name
  ));
  if (target === undefined) throw new Error(`button ${name} was not rendered`);
  await act(async () => target.click());
}

function required<T extends Element = HTMLElement>(selector: string): T {
  const value = container.querySelector<T>(selector);
  if (value === null) throw new Error(`required selector ${selector} was not rendered`);
  return value;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
