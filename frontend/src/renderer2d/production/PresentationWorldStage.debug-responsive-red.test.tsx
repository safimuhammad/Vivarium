import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ObserverRendererPort } from "../../presentation/rendererPort";
import type { PresentedObserverFrame } from "../../presentation/contracts";
import { createProductionCanvasSceneRenderer } from "./ProductionCanvasSceneFactory";
import * as productionDebugModule from "./debug";
import { createRegionMapIdentity } from "./maps/RegionMapIdentity";
import { createRegionMapRecipe } from "./maps/RegionMapRecipe";
import type { PlacementLedger } from "./placement/PlacementLedger";
import {
  PresentationWorldStage,
  type PresentationFrameSource,
} from "./PresentationWorldStage";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("./ProductionCanvasSceneFactory", () => ({
  createProductionCanvasSceneRenderer: vi.fn(),
}));

interface StageDebugSnapshot {
  readonly rendererId: string;
  readonly frameIdentity: null;
  readonly visibleRegionId: string;
  readonly loadingRegionId: string | null;
  readonly staticCacheRegions: readonly string[];
  readonly staticLayerRebuilds: number;
  readonly graph: Readonly<Record<string, unknown>>;
  readonly camera: Readonly<Record<string, unknown>>;
  readonly scheduler: Readonly<Record<string, unknown>>;
  readonly pool: Readonly<Record<string, unknown>>;
}

interface StageDebugProbe {
  snapshot(): StageDebugSnapshot;
}

interface StageDebugRegistration {
  release(): void;
}

interface ExpectedProductionDebugApi {
  installProductionStageDebugProbe(
    surface: Element,
    probe: StageDebugProbe,
  ): StageDebugRegistration;
  getProductionStageDebugProbe(surface: Element): StageDebugProbe | null;
}

const expectedDebugApi = productionDebugModule as unknown as Partial<ExpectedProductionDebugApi>;
const createRenderer = vi.mocked(createProductionCanvasSceneRenderer);
const placement = {} as PlacementLedger;
const regionValue = {
  name: "worn",
  description: "a once-heavenly landscape, now thinning and picked-over",
  connections: [],
  energy_rate: 0.2,
  materials_rate: 0.2,
  current_energy: 50,
  current_materials: 40,
  max_energy: 100,
  max_materials: 100,
};
const recipes = new Map([
  ["worn", createRegionMapRecipe(createRegionMapIdentity(181, regionValue, [regionValue]))],
]);

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  ResizeObserverFake.instances = [];
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverFake,
  });
  createRenderer.mockReset();
  createRenderer.mockResolvedValue(debugRenderer("default"));
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  container.remove();
  vi.restoreAllMocks();
});

describe("production observer-only stage debug REDs", () => {
  it("registers a snapshot-only probe by exact surface with token-safe stale cleanup", () => {
    const api = requireDebugApi();
    const surface = document.createElement("main");
    const first = probe("first");
    const second = probe("second");

    const firstRegistration = api.installProductionStageDebugProbe(surface, first);
    expect(api.getProductionStageDebugProbe(surface)).toBe(first);
    expect(Object.keys(first)).toEqual(["snapshot"]);
    expect(first).not.toHaveProperty("pause");
    expect(first).not.toHaveProperty("resume");
    expect(first).not.toHaveProperty("restart");
    expect(first).not.toHaveProperty("seek");
    expect(first).not.toHaveProperty("advanceBy");
    expect(first).not.toHaveProperty("setScene");

    firstRegistration.release();
    const secondRegistration = api.installProductionStageDebugProbe(surface, second);
    firstRegistration.release();
    expect(api.getProductionStageDebugProbe(surface)).toBe(second);
    secondRegistration.release();
    expect(api.getProductionStageDebugProbe(surface)).toBeNull();
  });

  it("installs the active renderer probe on the exact Stage surface and removes it on cleanup", async () => {
    const api = requireDebugApi();
    const renderer = debugRenderer("active");
    createRenderer.mockResolvedValue(renderer);
    const source = frameSource(frame(1));
    await mount(source);

    const stageSurface = container.querySelector(".presentation-world-stage")!;
    const canvas = container.querySelector("canvas")!;
    const installed = api.getProductionStageDebugProbe(stageSurface);
    expect(installed).not.toBeNull();
    expect(api.getProductionStageDebugProbe(canvas)).toBeNull();
    expect(Object.keys(installed!)).toEqual(["snapshot"]);
    expect(installed!.snapshot()).toEqual(renderer.debug());
    expect(installed!.snapshot()).not.toBe(renderer.debug());

    await act(async () => root?.unmount());
    root = null;
    expect(api.getProductionStageDebugProbe(stageSurface)).toBeNull();
  });

  it("keeps the newer StrictMode probe when the first renderer resolves after cleanup", async () => {
    const api = requireDebugApi();
    const first = deferred<ObserverRendererPort>();
    const second = deferred<ObserverRendererPort>();
    const oldRenderer = debugRenderer("old");
    const currentRenderer = debugRenderer("current");
    createRenderer
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    await act(async () => root?.render(
      <StrictMode>{stage(frameSource(frame(1)))}</StrictMode>,
    ));
    const stageSurface = container.querySelector(".presentation-world-stage")!;
    second.resolve(currentRenderer);
    await settle();
    expect(api.getProductionStageDebugProbe(stageSurface)?.snapshot().rendererId).toBe("current");

    first.resolve(oldRenderer);
    await settle();
    expect(api.getProductionStageDebugProbe(stageSurface)?.snapshot().rendererId).toBe("current");
    expect(oldRenderer.dispose).toHaveBeenCalledOnce();
  });

  it("keeps the debug and Stage source closures route/session/provider independent and command-free", () => {
    const debugSource = readFileSync(
      resolve(process.cwd(), "src/renderer2d/production/debug.ts"),
      "utf8",
    );
    const stageSource = readFileSync(
      resolve(process.cwd(), "src/renderer2d/production/PresentationWorldStage.tsx"),
      "utf8",
    );
    for (const source of [debugSource, stageSource]) {
      expect(source).not.toMatch(/window\.location|URLSearchParams|rendererMode|Vivarium2DApp/);
      expect(source).not.toMatch(/useLiveRun|PresentationSession|ReplayArtifact|Archive/);
      expect(source).not.toMatch(/backend|provider|ollama|gemini/i);
    }
    expect(debugSource).not.toMatch(/\b(?:pause|resume|restart|seek|advanceBy|setScene)\s*\(/);
  });
});

function requireDebugApi(): ExpectedProductionDebugApi {
  expect(expectedDebugApi.installProductionStageDebugProbe).toBeTypeOf("function");
  expect(expectedDebugApi.getProductionStageDebugProbe).toBeTypeOf("function");
  return expectedDebugApi as ExpectedProductionDebugApi;
}

function probe(rendererId: string): StageDebugProbe {
  return Object.freeze({
    snapshot: (): StageDebugSnapshot => debugSnapshot(rendererId),
  });
}

function debugRenderer(rendererId: string): ObserverRendererPort & {
  readonly debug: ReturnType<typeof vi.fn<() => StageDebugSnapshot>>;
} {
  return {
    updatePresentation: vi.fn(),
    setSelection: vi.fn(),
    focusSelection: vi.fn(),
    observeRegion: vi.fn(),
    setSafeFrame: vi.fn(),
    setCameraMode: vi.fn(),
    panCamera: vi.fn(),
    zoomCamera: vi.fn(),
    resize: vi.fn(),
    diagnostics: vi.fn(() => ({
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
    })),
    dispose: vi.fn(),
    debug: vi.fn(() => debugSnapshot(rendererId)),
  };
}

function debugSnapshot(rendererId: string): StageDebugSnapshot {
  return structuredClone({
    rendererId,
    frameIdentity: null,
    visibleRegionId: "worn",
    loadingRegionId: null,
    staticCacheRegions: ["worn"],
    staticLayerRebuilds: 1,
    graph: { generation: 1, activeActors: 1, activeHomes: 0 },
    camera: {
      mode: "story",
      center: { x: 10, y: 20 },
      zoom: 1,
      followEntityId: null,
      storyTarget: null,
      pendingStoryTarget: null,
      safeFrame: { x: 0, y: 0, width: 512, height: 288 },
      followDeadZone: { x: 192, y: 108, width: 128, height: 72 },
      rasterOrigin: { x: 246, y: 124 },
      safeFrameInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    scheduler: { hidden: false, dirty: false, rafScheduled: false, wakeScheduled: false },
    pool: { activeAtlasIds: ["core-human-body-rigs"], leases: 1 },
  });
}

function stage(source: PresentationFrameSource) {
  return (
    <PresentationWorldStage
      frameSource={source}
      placement={placement}
      recipes={recipes}
    />
  );
}

async function mount(source: PresentationFrameSource): Promise<void> {
  await act(async () => root?.render(stage(source)));
  await settle();
}

function frameSource(initial: PresentedObserverFrame): PresentationFrameSource {
  return {
    getSnapshot: vi.fn(() => initial),
    subscribe: vi.fn(() => vi.fn()),
  };
}

function frame(revision: number): PresentedObserverFrame {
  return {
    runId: "run-debug",
    sourceKey: "fixture:debug",
    revision,
    firstCursor: revision,
    lastCursor: revision,
    source: "fixture",
    ingestedCursor: revision,
    presentedCursor: revision,
    world: {
      exactBaseCursor: revision,
      projectedThroughCursor: revision,
      worldTime: revision,
      agents: [],
      regions: [{ completeness: "exact", value: regionValue }],
      homes: [],
      ruins: [],
      pendingProposals: [],
    },
    scene: {
      momentId: `moment-${revision}`,
      regionId: "worn",
      phase: "hold",
      focus: { kind: "system", regionId: "worn" },
      dialogue: null,
      actorIntents: [],
      homeIntents: [],
      effectIntents: [],
      safeCancelMarkers: [],
      reducedMotion: false,
    },
    selection: null,
    backlog: {
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Caught up",
    },
    transport: { connection: "live", ingestedCursor: revision, retryable: true },
  };
}

class ResizeObserverFake {
  static instances: ResizeObserverFake[] = [];
  readonly disconnect = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverFake.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}
