import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  parseWorldSnapshot,
  type AgentSnapshot,
  type HomeSnapshot,
  type RegionSnapshot,
  type WorldSnapshot,
} from "../app/schemas";
import type {
  CameraMode,
  ObserverSelection,
  PresentedObserverFrame,
  PresentedRecord,
} from "./contracts";
import {
  createThreeObserverAdapter,
  type ThreeObserverBackend,
  type ThreeObserverBackendCallbacks,
  type ThreeObserverBackendFactoryOptions,
} from "./ThreeObserverAdapter";
import { claimObserverRendererSurface } from "./rendererSurfaceOwnership";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const AGENT: AgentSnapshot = {
  id: "aster",
  name: "Aster",
  persona: "patient builder",
  position: "Nirvana",
  energy: 88,
  materials: 12,
  status: "alive",
  last_mated_at: null,
  offspring_count: 0,
  died_at: null,
  home_id: "home-aster",
  is_hoarding: false,
};

const REGION: RegionSnapshot = {
  name: "Nirvana",
  description: "A worn heartland.",
  connections: ["East"],
  energy_rate: 4,
  materials_rate: 3,
  current_energy: 180,
  current_materials: 90,
  max_energy: 200,
  max_materials: 100,
};

const HOME: HomeSnapshot = {
  home_id: "home-aster",
  owner_id: "aster",
  region: "Nirvana",
  integrity: 80,
  max_integrity: 100,
  built_at: 2,
  last_upkeep_at: 4,
  last_integrity_at: 4,
  stakeholders: ["aster"],
  vault_materials: 8,
  status: "standing",
  ruined_at: null,
  remnant_materials: 0,
  breachers: [],
  is_hoarding: false,
};

const RUIN: HomeSnapshot = {
  ...HOME,
  home_id: "ruin-ember",
  owner_id: "ember",
  integrity: 0,
  status: "ruin",
  ruined_at: 7,
  remnant_materials: 4,
};

const exact = <T,>(value: T): PresentedRecord<T> => ({
  completeness: "exact",
  value,
});

const makeFrame = (revision = 1): PresentedObserverFrame => ({
  source: "live",
  runId: "run-1",
  sourceKey: "live:run-1",
  revision,
  firstCursor: revision,
  lastCursor: revision,
  ingestedCursor: revision,
  presentedCursor: revision,
  world: {
    exactBaseCursor: 0,
    projectedThroughCursor: revision,
    worldTime: revision * 10,
    agents: [exact(AGENT)],
    regions: [exact(REGION)],
    homes: [exact(HOME)],
    ruins: [exact(RUIN)],
    pendingProposals: [{
      initiator_id: "aster",
      target_id: "ember",
      timestamp: 5,
      resources: { energy: 12 },
    }],
  },
  scene: {
    momentId: `moment-${revision}`,
    regionId: "Nirvana",
    phase: "hold",
    focus: { kind: "agent", id: "aster" },
    dialogue: null,
    actorIntents: [],
    homeIntents: [],
    effectIntents: [],
    safeCancelMarkers: [],
    reducedMotion: false,
  },
  selection: { kind: "agent", id: "aster" },
  backlog: {
    pendingMoments: 0,
    firstPendingCursor: null,
    lastPendingCursor: null,
    state: "caught-up",
    label: "Caught up",
  },
  transport: {
    connection: "live",
    ingestedCursor: revision,
    retryable: true,
  },
});

const makeBackend = (): ThreeObserverBackend => ({
  updateSnapshot: vi.fn(),
  setSelected: vi.fn(),
  focusSelection: vi.fn(() => true),
  setSafeFrame: vi.fn(),
  setCameraMode: vi.fn(),
  panCamera: vi.fn(),
  zoomCamera: vi.fn(),
  resize: vi.fn(),
  diagnostics: vi.fn(() => ({
    disposed: false,
    drawP95Ms: 4.5,
    scheduledFrame: true,
    activeActors: 1,
    activeHomes: 2,
    activeEffects: 3,
    staticLayerRebuilds: 4,
    assetBytes: 0,
    decodedAssetBytes: 0,
    pathFallbacks: 5,
  })),
  dispose: vi.fn(),
});

const createHarness = async (options: {
  readonly surface?: HTMLElement;
  readonly backend?: ThreeObserverBackend;
  readonly signal?: AbortSignal;
  readonly onSelectionChange?: (selection: ObserverSelection) => void;
  readonly onCameraModeChange?: (mode: CameraMode) => void;
  readonly onFailure?: (failure: unknown) => void;
} = {}) => {
  const surface = options.surface ?? document.createElement("div");
  const backend = options.backend ?? makeBackend();
  const callbackHolder: { current: ThreeObserverBackendCallbacks | null } = { current: null };
  const backendFactory = vi.fn(async (factoryOptions: ThreeObserverBackendFactoryOptions) => {
    callbackHolder.current = factoryOptions.callbacks;
    expect(factoryOptions.surface).toBe(surface);
    expect(factoryOptions.signal).toBeInstanceOf(AbortSignal);
    return backend;
  });
  const port = await createThreeObserverAdapter({
    surface,
    signal: options.signal,
    callbacks: {
      onSelectionChange: options.onSelectionChange,
      onCameraModeChange: options.onCameraModeChange,
      onFailure: options.onFailure,
    },
    backendFactory,
  });
  const backendCallbacks = callbackHolder.current;
  if (backendCallbacks === null) throw new Error("backend factory did not publish callbacks");
  return { surface, backend, backendCallbacks, backendFactory, port };
};

const snapshots = (backend: ThreeObserverBackend): WorldSnapshot[] => (
  vi.mocked(backend.updateSnapshot).mock.calls
    .map((call: readonly [WorldSnapshot | null]) => call[0])
    .filter((snapshot: WorldSnapshot | null): snapshot is WorldSnapshot => snapshot !== null)
);

describe("ThreeObserverAdapter", () => {
  /**
   * Re-baselined 2026-08-01, deliberately.
   *
   * This expectation was authored against a seven-field snapshot and went stale
   * when two additive fields shipped, both of which `parseWorldSnapshot` now
   * emits unconditionally:
   *   - `region_pressure` (Nirvana growth) — emitted always, derived from live
   *     counts when the wire omits it, as this frame does;
   *   - `seed_persona` (persona dedup) — emitted always, `null` when the wire
   *     declares no run default. The presented frame declares none because each
   *     presented being already carries its own persona, resolved against the
   *     run default at the upstream parse boundary.
   *
   * "Legacy" here names the snapshot-driven backend, not a pinned subset: the
   * adapter's output shape is produced wholly by `parseWorldSnapshot`, and its
   * consumer takes the live `WorldSnapshot`. So the expectation is anchored to
   * the parse of the exact wire payload the adapter should build. That still
   * pins the translation — which frame field lands in which snapshot field —
   * while leaving the *shape* to the one parser that owns it. A hand-listed
   * shape here is precisely the drift that dropped `region_pressure` on the
   * replay clone path.
   */
  it("translates one accepted frame into one exact legacy snapshot without reading scene intents", async () => {
    const { backend, port } = await createHarness();
    const frame = makeFrame(3);
    port.updatePresentation(frame);

    expect(backend.updateSnapshot).toHaveBeenCalledOnce();
    expect(snapshots(backend)[0]).toEqual(parseWorldSnapshot({
      schema: 1,
      run_id: frame.runId,
      world_time: frame.world.worldTime,
      event_cursor: frame.presentedCursor,
      agents: [AGENT],
      regions: [REGION],
      homes: [HOME],
      ruins: [RUIN],
      pending_proposals: frame.world.pendingProposals,
    }));
    expect(snapshots(backend)[0]).not.toBe(frame.world);
    port.dispose();
  });

  it("forwards presented exact region pressure instead of letting it be re-derived from live counts", async () => {
    const { backend, port } = await createHarness();
    const base = makeFrame(1);
    const pressure = [{
      region: REGION.name,
      population_high_water: 9,
      built_footprint_high_water: 6,
    }];

    port.updatePresentation({
      ...base,
      world: { ...base.world, regionPressure: pressure },
    });

    expect(snapshots(backend)[0]?.region_pressure).toEqual(pressure);
    expect(snapshots(backend)[0]?.region_pressure?.[0]).not.toBe(pressure[0]);
    port.dispose();
  });

  it("merges cached projected records, omits unseen partial records, and treats current arrays as authoritative membership", async () => {
    const { backend, port } = await createHarness();
    port.updatePresentation(makeFrame(1));

    const projectedBase = makeFrame(2);
    const projected: PresentedObserverFrame = {
      ...projectedBase,
      world: {
        ...projectedBase.world,
        agents: [
          { completeness: "projected-partial", value: { id: "aster", energy: 61 } },
          { completeness: "projected-partial", value: { id: "unseen", energy: 5 } },
        ],
        homes: [{
          completeness: "projected-partial",
          value: { home_id: "home-aster", integrity: 73 },
        }],
      },
    };
    port.updatePresentation(projected);

    expect(snapshots(backend).at(-1)?.agents).toEqual([{ ...AGENT, energy: 61 }]);
    expect(snapshots(backend).at(-1)?.homes).toEqual([{ ...HOME, integrity: 73 }]);

    const removalBase = makeFrame(3);
    port.updatePresentation({
      ...removalBase,
      world: { ...removalBase.world, agents: [], homes: [] },
    });
    expect(snapshots(backend).at(-1)).toMatchObject({ agents: [], homes: [] });
    port.dispose();
  });

  it("keeps the prior atomic backend state when a candidate exact record is incomplete", async () => {
    const onFailure = vi.fn();
    const { backend, port } = await createHarness({ onFailure });
    port.updatePresentation(makeFrame(1));
    const acceptedBefore = port.diagnostics().frameIdentity;
    const invalidBase = makeFrame(2);
    const invalid: PresentedObserverFrame = {
      ...invalidBase,
      world: {
        ...invalidBase.world,
        agents: [{ completeness: "exact", value: { id: "aster", status: "dead" } }],
      },
    };

    expect(() => port.updatePresentation(invalid)).not.toThrow();
    expect(backend.updateSnapshot).toHaveBeenCalledOnce();
    expect(port.diagnostics().frameIdentity).toEqual(acceptedBefore);
    expect(onFailure).toHaveBeenCalledOnce();
    port.dispose();
  });

  it("rolls the backend back when selection commit fails after a candidate snapshot was staged", async () => {
    const onFailure = vi.fn();
    const backend = makeBackend();
    const { port } = await createHarness({ backend, onFailure });
    const baseline = makeFrame(1);
    port.updatePresentation(baseline);
    const baselineSnapshot = structuredClone(snapshots(backend).at(-1)!);

    vi.mocked(backend.setSelected).mockImplementationOnce(() => {
      throw new Error("selection commit failed");
    });
    expect(() => port.updatePresentation(makeFrame(2))).not.toThrow();

    expect(snapshots(backend).at(-1)).toEqual(baselineSnapshot);
    expect(port.diagnostics().frameIdentity).toMatchObject({ revision: 1 });
    expect(onFailure).toHaveBeenCalledOnce();
    port.dispose();
  });

  it("rolls snapshot, selection, and focus back when automatic focus publication fails", async () => {
    const onFailure = vi.fn();
    const backend = makeBackend();
    const { port } = await createHarness({ backend, onFailure });
    port.updatePresentation(makeFrame(1));
    const baselineSnapshot = structuredClone(snapshots(backend).at(-1)!);

    vi.mocked(backend.focusSelection).mockImplementationOnce(() => {
      throw new Error("focus commit failed");
    });
    const candidateBase = makeFrame(2);
    const candidate: PresentedObserverFrame = {
      ...candidateBase,
      selection: { kind: "home", id: HOME.home_id },
      scene: candidateBase.scene === null
        ? null
        : { ...candidateBase.scene, focus: { kind: "home", id: HOME.home_id } },
    };
    expect(() => port.updatePresentation(candidate)).not.toThrow();

    expect(snapshots(backend).at(-1)).toEqual(baselineSnapshot);
    expect(backend.setSelected).toHaveBeenLastCalledWith({ kind: "agent", id: AGENT.id });
    expect(backend.focusSelection).toHaveBeenLastCalledWith({ kind: "agent", id: AGENT.id });
    expect(port.diagnostics().frameIdentity).toMatchObject({ revision: 1 });
    expect(onFailure).toHaveBeenCalledOnce();
    port.dispose();
  });

  it("rejects stale or foreign lineages and prevents projected terminal-state resurrection", async () => {
    const { backend, port } = await createHarness();
    const terminalBase = makeFrame(3);
    port.updatePresentation({
      ...terminalBase,
      world: {
        ...terminalBase.world,
        agents: [exact({ ...AGENT, status: "dead", died_at: 30 })],
        homes: [],
        ruins: [exact({ ...HOME, status: "ruin", integrity: 0, ruined_at: 30 })],
      },
    });

    const projectedBase = makeFrame(4);
    port.updatePresentation({
      ...projectedBase,
      world: {
        ...projectedBase.world,
        agents: [{
          completeness: "projected-partial",
          value: { id: "aster", status: "alive", died_at: null },
        }],
        homes: [],
        ruins: [{
          completeness: "projected-partial",
          value: { home_id: "home-aster", status: "standing", ruined_at: null },
        }],
      },
    });
    expect(snapshots(backend).at(-1)?.agents[0]).toMatchObject({ status: "dead", died_at: 30 });
    expect(snapshots(backend).at(-1)?.ruins[0]).toMatchObject({ status: "ruin", ruined_at: 30 });

    const callsAfterTerminal = vi.mocked(backend.updateSnapshot).mock.calls.length;
    port.updatePresentation(makeFrame(2));
    port.updatePresentation({ ...makeFrame(5), runId: "other-run" });
    port.updatePresentation({ ...makeFrame(5), sourceKey: "archive:run-1" });
    expect(backend.updateSnapshot).toHaveBeenCalledTimes(callsAfterTerminal);
    expect(port.diagnostics().frameIdentity).toMatchObject({ revision: 4 });
    port.dispose();
  });

  it("accepts a newer exact correction after latching projected terminal contradictions", async () => {
    const { backend, port } = await createHarness();
    const terminalBase = makeFrame(1);
    port.updatePresentation({
      ...terminalBase,
      world: {
        ...terminalBase.world,
        agents: [exact({ ...AGENT, status: "dead", died_at: 10 })],
        homes: [],
        ruins: [exact({ ...HOME, status: "ruin", integrity: 0, ruined_at: 10 })],
      },
    });

    const contradictionBase = makeFrame(2);
    port.updatePresentation({
      ...contradictionBase,
      world: {
        ...contradictionBase.world,
        agents: [{
          completeness: "projected-partial",
          value: { id: AGENT.id, status: "alive", died_at: null },
        }],
        homes: [],
        ruins: [{
          completeness: "projected-partial",
          value: { home_id: HOME.home_id, status: "standing", ruined_at: null },
        }],
      },
    });
    expect(snapshots(backend).at(-1)?.agents[0]).toMatchObject({ status: "dead", died_at: 10 });
    expect(snapshots(backend).at(-1)?.ruins[0]).toMatchObject({ status: "ruin", ruined_at: 10 });

    const correctionBase = makeFrame(3);
    port.updatePresentation({
      ...correctionBase,
      world: {
        ...correctionBase.world,
        agents: [exact(AGENT)],
        homes: [exact(HOME)],
        ruins: [exact(RUIN)],
      },
    });
    expect(snapshots(backend).at(-1)?.agents[0]).toEqual(AGENT);
    expect(snapshots(backend).at(-1)?.homes).toContainEqual(HOME);
    expect(port.diagnostics().frameIdentity).toMatchObject({ revision: 3 });
    port.dispose();
  });

  it("maps home/ruin/moment selections in both directions without fabricating a legacy moment entity", async () => {
    const onSelectionChange = vi.fn();
    const { backend, backendCallbacks, port } = await createHarness({ onSelectionChange });
    port.updatePresentation(makeFrame(1));

    port.setSelection({ kind: "ruin", id: RUIN.home_id });
    expect(backend.setSelected).toHaveBeenLastCalledWith({ kind: "home", id: RUIN.home_id });
    backendCallbacks.onSelectionChange({ kind: "home", id: RUIN.home_id });
    expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: "ruin", id: RUIN.home_id });

    const moment = { kind: "moment", id: "moment-1", firstCursor: 1, lastCursor: 1 } as const;
    port.setSelection(moment);
    expect(backend.setSelected).toHaveBeenLastCalledWith(null);
    port.focusSelection(moment);
    expect(backend.focusSelection).toHaveBeenLastCalledWith({ kind: "agent", id: AGENT.id });

    port.setSelection(null);
    expect(backend.setSelected).toHaveBeenLastCalledWith(null);
    port.dispose();
  });

  it("preserves Free camera ownership while Follow tracks selection and Story tracks scene focus", async () => {
    const onCameraModeChange = vi.fn();
    const { backend, backendCallbacks, port } = await createHarness({ onCameraModeChange });

    port.setCameraMode("follow");
    port.updatePresentation(makeFrame(1));
    expect(backend.focusSelection).toHaveBeenLastCalledWith({ kind: "agent", id: AGENT.id });

    vi.mocked(backend.focusSelection).mockClear();
    port.setCameraMode("free");
    port.updatePresentation(makeFrame(2));
    expect(backend.focusSelection).not.toHaveBeenCalled();

    const storyBase = makeFrame(3);
    port.setCameraMode("story");
    port.updatePresentation({
      ...storyBase,
      scene: storyBase.scene === null
        ? null
        : { ...storyBase.scene, focus: { kind: "home", id: HOME.home_id } },
    });
    expect(backend.focusSelection).toHaveBeenLastCalledWith({ kind: "home", id: HOME.home_id });

    backendCallbacks.onCameraModeChange("free");
    expect(onCameraModeChange).toHaveBeenCalledWith("free");
    expect(backend.setCameraMode).toHaveBeenNthCalledWith(1, "follow");
    expect(backend.setCameraMode).toHaveBeenNthCalledWith(2, "free");
    expect(backend.setCameraMode).toHaveBeenNthCalledWith(3, "story");
    port.dispose();
  });

  it("forwards safe-frame, pan, zoom, resize, and explicit focus exactly once", async () => {
    const { backend, port } = await createHarness();
    const safeFrame = { top: 10, right: 20, bottom: 30, left: 40 };
    port.setSafeFrame(safeFrame);
    port.panCamera({ x: 7, y: -3 });
    port.zoomCamera(1.25, { x: 90, y: 60 });
    port.resize(800, 450);
    port.focusSelection({ kind: "region", id: REGION.name });

    expect(backend.setSafeFrame).toHaveBeenCalledOnce();
    expect(backend.setSafeFrame).toHaveBeenCalledWith(safeFrame);
    expect(backend.panCamera).toHaveBeenCalledWith({ x: 7, y: -3 });
    expect(backend.zoomCamera).toHaveBeenCalledWith(1.25, { x: 90, y: 60 });
    expect(backend.resize).toHaveBeenCalledWith(800, 450);
    expect(backend.focusSelection).toHaveBeenCalledWith({ kind: "region", id: REGION.name });
    port.dispose();
  });

  it("observes only a configured region through the camera and reports an unknown region without changing frame truth", async () => {
    const onFailure = vi.fn();
    const { backend, port } = await createHarness({ onFailure });
    const presented = makeFrame(1);
    port.updatePresentation(presented);
    vi.mocked(backend.focusSelection).mockClear();
    vi.mocked(backend.updateSnapshot).mockClear();
    vi.mocked(backend.setSelected).mockClear();

    port.observeRegion(REGION.name);
    port.observeRegion("Unknown Reach");

    expect(backend.focusSelection).toHaveBeenCalledOnce();
    expect(backend.focusSelection).toHaveBeenCalledWith({ kind: "region", id: REGION.name });
    expect(backend.updateSnapshot).not.toHaveBeenCalled();
    expect(backend.setSelected).not.toHaveBeenCalled();
    expect(port.diagnostics().frameIdentity).toMatchObject({ revision: 1 });
    expect(onFailure).toHaveBeenCalledWith({
      kind: "path",
      retryable: false,
      publicMessage: "The selected region is unavailable.",
    });
    expect(presented.selection).toEqual({ kind: "agent", id: AGENT.id });
    port.dispose();
  });

  it("keeps an observed region under Follow ownership until an explicit Story return", async () => {
    const { backend, port } = await createHarness();
    port.updatePresentation(makeFrame(1));
    port.setCameraMode("follow");
    port.observeRegion(REGION.name);
    vi.mocked(backend.focusSelection).mockClear();

    port.updatePresentation(makeFrame(2));
    expect(backend.focusSelection).not.toHaveBeenCalled();

    port.setCameraMode("story");
    port.updatePresentation(makeFrame(3));
    expect(backend.focusSelection).toHaveBeenLastCalledWith({ kind: "agent", id: AGENT.id });
    port.dispose();
  });

  it("publishes truthful fixed diagnostics and keeps a stable terminal snapshot after idempotent disposal", async () => {
    const { backend, port, surface } = await createHarness();
    port.updatePresentation(makeFrame(2));
    expect(port.diagnostics()).toEqual({
      disposed: false,
      frameIdentity: {
        runId: "run-1",
        sourceKey: "live:run-1",
        revision: 2,
        firstCursor: 2,
        lastCursor: 2,
      },
      drawP95Ms: 4.5,
      scheduledFrame: true,
      activeActors: 1,
      activeHomes: 2,
      activeEffects: 3,
      staticLayerRebuilds: 4,
      assetBytes: 0,
      decodedAssetBytes: 0,
      pathFallbacks: 5,
    });

    port.dispose();
    const terminal = port.diagnostics();
    port.dispose();
    port.resize(1, 1);
    port.updatePresentation(makeFrame(3));
    expect(backend.dispose).toHaveBeenCalledOnce();
    expect(backend.resize).not.toHaveBeenCalled();
    expect(port.diagnostics()).toEqual(terminal);
    expect(terminal.disposed).toBe(true);

    const replacement = await createHarness({ surface });
    replacement.port.dispose();
  });

  it("releases an aborted pending claim, disposes its late backend once, and cannot displace the newer owner", async () => {
    const surface = document.createElement("div");
    const firstController = new AbortController();
    const firstPending = deferred<ThreeObserverBackend>();
    const firstBackend = makeBackend();
    const firstFactory = vi.fn((_options: ThreeObserverBackendFactoryOptions) => firstPending.promise);
    const firstPort = createThreeObserverAdapter({
      surface,
      signal: firstController.signal,
      callbacks: {},
      backendFactory: firstFactory,
    });
    const firstRejection = expect(firstPort).rejects.toMatchObject({ name: "AbortError" });

    firstController.abort();
    const newer = await createHarness({ surface });
    firstPending.resolve(firstBackend);
    await firstRejection;
    expect(firstBackend.dispose).toHaveBeenCalledOnce();

    await expect(createHarness({ surface })).rejects.toMatchObject({
      code: "surface-already-owned",
    });
    newer.port.dispose();
    expect(newer.backend.dispose).toHaveBeenCalledOnce();
  });

  it("keeps the surface claimed until an externally aborted installed backend finishes disposal", async () => {
    const surface = document.createElement("div");
    const controller = new AbortController();
    const backend = makeBackend();
    const claimDuringDispose: {
      current: ReturnType<typeof claimObserverRendererSurface> | null;
    } = { current: null };
    let claimError: unknown = null;
    vi.mocked(backend.dispose).mockImplementation(() => {
      try {
        claimDuringDispose.current = claimObserverRendererSurface(surface, "canvas-production");
      } catch (error) {
        claimError = error;
      }
    });
    const { port } = await createHarness({ surface, backend, signal: controller.signal });

    controller.abort();

    expect(claimDuringDispose.current).toBeNull();
    expect(claimError).toMatchObject({ code: "surface-already-owned" });
    expect(backend.dispose).toHaveBeenCalledOnce();
    expect(port.diagnostics().disposed).toBe(true);
    claimDuringDispose.current?.release();
    const replacement = await createHarness({ surface });
    replacement.port.dispose();
  });

  it("has no Three runtime, WorldRenderer, raw-event, store, demo, provider, or scheduler dependency", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/presentation/ThreeObserverAdapter.ts"),
      "utf8",
    );
    const runtimeImports = [...source.matchAll(/import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gs)]
      .map((match) => match[1]);

    expect(runtimeImports).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/(?:^|\/)three(?:\/|$)|WorldRenderer|LivingAtlasApp|CanvasWorldRenderer/),
      expect.stringMatching(/app\/(?:store|client)|atlasStore|demo/i),
    ]));
    expect(source).not.toMatch(/EventEnvelopeEntry|SerializedEvent|StoryMoment|Ollama|Gemini|provider|model/i);
    expect(source).not.toMatch(/requestAnimationFrame|cancelAnimationFrame|setTimeout|setInterval/);
  });
});
