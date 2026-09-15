import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RecordedCheckpointFeed,
  RecordedCheckpointFeedHub,
  RecordedRun,
  RecordedRunBridge,
  RecordedRunDriverOptions,
} from "./recordedRunClient";
import type { LiveApiClient } from "../client";
import type { ProductionObserverSessionBundle } from "../observer2d/createProductionObserverSession";
import type { SnapshotCheckpoint } from "../replayArtifacts";
import type { WorldSnapshot } from "../schemas";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.resetModules();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
  vi.doUnmock("./recordedRunClient");
  vi.doUnmock("../observer2d/observerShellRuntime");
  vi.doUnmock("../observer2d/createProductionObserverSession");
  vi.doUnmock("../../renderer2d/production/PresentationWorldStage");
  vi.doUnmock("../Vivarium2DApp");
  vi.resetModules();
});

function snapshotFixture(): WorldSnapshot {
  return {
    schema: 1,
    run_id: "seed-abc",
    world_time: 1_000,
    event_cursor: 0,
    agents: [],
    regions: [],
    homes: [],
    ruins: [],
    pending_proposals: [],
  };
}

function fakeRecording(): RecordedRun {
  const snapshot = snapshotFixture();
  return {
    runId: "seed-abc",
    entries: [],
    checkpoints: [],
    firstSnapshot: snapshot,
    run: {
      schema: 1,
      run_id: "seed-abc",
      seed: 0,
      started_at: 1_000,
      status: "running",
      event_cursor: 0,
      world_time: 1_000,
      config_hash: "recorded:seed-abc",
      constants: {},
      seed_persona: null,
      provider: "gemini",
      model: "recorded",
      context_window: null,
      timing: {},
      artifacts: { events: "recorded", usage: "recorded", snapshots: "recorded", memory_root: "recorded" },
    },
    endWorldTime: snapshot.world_time,
    spanMs: 0,
    snapshotAt: () => snapshot,
  };
}

function recordingWithTerminalCheckpoint(): RecordedRun {
  const firstSnapshot: WorldSnapshot = {
    ...snapshotFixture(),
    agents: [
      {
        id: "terminal-agent",
        name: "Terminal agent",
        persona: "",
        position: "meadow",
        energy: 10,
        materials: 7,
        status: "alive",
        last_mated_at: null,
        offspring_count: 0,
        died_at: null,
        home_id: null,
        is_hoarding: false,
      },
    ],
    regions: [
      {
        name: "meadow",
        description: "A test meadow.",
        connections: [],
        energy_rate: 1,
        materials_rate: 1,
        current_energy: 20,
        current_materials: 30,
        max_energy: 100,
        max_materials: 100,
      },
    ],
  };
  const terminalSnapshot: WorldSnapshot = {
    ...firstSnapshot,
    world_time: 1_000.1,
    agents: firstSnapshot.agents.map((agent) => (
      agent.id === "terminal-agent"
        ? { ...agent, energy: 73, materials: 41 }
        : agent
    )),
    regions: firstSnapshot.regions.map((region) => (
      region.name === "meadow"
        ? { ...region, current_energy: 25, current_materials: 35 }
        : region
    )),
  };
  const checkpoints: SnapshotCheckpoint[] = [
    {
      schema: 1,
      type: "world_snapshot_checkpoint",
      reason: "event:simulation_started",
      run_id: firstSnapshot.run_id,
      world_time: firstSnapshot.world_time,
      event_cursor: firstSnapshot.event_cursor,
      snapshot: firstSnapshot,
      lineNumber: 1,
    },
    {
      schema: 1,
      type: "world_snapshot_checkpoint",
      reason: "run_stopped",
      run_id: terminalSnapshot.run_id,
      world_time: terminalSnapshot.world_time,
      event_cursor: terminalSnapshot.event_cursor,
      snapshot: terminalSnapshot,
      lineNumber: 2,
    },
  ];
  const base = fakeRecording();
  return {
    ...base,
    firstSnapshot,
    checkpoints,
    endWorldTime: terminalSnapshot.world_time,
    spanMs: 100,
  };
}

/** Mocks `Vivarium2DApp` the way `src/app/App.test.tsx` does, capturing the props it received. */
async function mountWithMockedObserver(
  load: (base: string) => Promise<RecordedRun>,
): Promise<{
  capturedProps: Array<{ createRuntime?: unknown }>;
  RecordedRunObserver: typeof import("./RecordedRunObserver").RecordedRunObserver;
}> {
  const capturedProps: Array<{ createRuntime?: unknown }> = [];
  vi.doMock("../Vivarium2DApp", () => ({
    Vivarium2DApp: (props: { createRuntime?: unknown }) => {
      capturedProps.push(props);
      return <main data-testid="vivarium-2d-production" />;
    },
  }));
  const module = await import("./RecordedRunObserver");
  return { capturedProps, RecordedRunObserver: module.RecordedRunObserver };
}

describe("RecordedRunObserver", () => {
  it("renders an honest loading state before the recording resolves", async () => {
    let resolveLoad: ((run: RecordedRun) => void) | null = null;
    const load = vi.fn(() => new Promise<RecordedRun>((resolve) => {
      resolveLoad = resolve;
    }));
    const { RecordedRunObserver } = await mountWithMockedObserver(load);

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(<RecordedRunObserver base="/recordings/nirvana" load={load} />);
    });

    expect(container?.querySelector('[data-testid="vivarium-2d-production"]')).toBeNull();
    expect(container?.textContent).toMatch(/loading/i);
    expect(load).toHaveBeenCalledWith("/recordings/nirvana");

    // Resolve after the assertions so the pending promise does not leak into the next test.
    await act(async () => {
      resolveLoad?.(fakeRecording());
    });
  });

  it("mounts the production observer with a createRuntime factory once the recording loads", async () => {
    const recording = fakeRecording();
    const load = vi.fn(async () => recording);
    const { capturedProps, RecordedRunObserver } = await mountWithMockedObserver(load);

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(<RecordedRunObserver base="/recordings/nirvana" load={load} />);
    });

    expect(container?.querySelector('[data-testid="vivarium-2d-production"]')).not.toBeNull();
    expect(capturedProps).toHaveLength(1);
    expect(typeof capturedProps[0]?.createRuntime).toBe("function");
  });

  it("wires exact recorded checkpoints into live reconciliation and completes at terminal time", async () => {
    const recording = fakeRecording();
    const checkpointFeed: RecordedCheckpointFeed = {
      start: vi.fn(),
      reset: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      subscribeFault: vi.fn(() => () => undefined),
      diagnostics: vi.fn(() => ({
        disposed: false,
        runId: recording.runId,
        lastDeliveredLine: 0,
        polling: false,
        retainedSafeCheckpoints: 0,
        faultCount: 0,
      })),
      dispose: vi.fn(),
      advanceTo: vi.fn(),
    };
    const bridge: RecordedRunBridge = {
      client: {} as LiveApiClient,
      setSnapshot: vi.fn(),
      dispatch: async () => undefined,
      heartbeat: vi.fn(),
      dispose: vi.fn(),
    };
    const driver = { start: vi.fn(), stop: vi.fn(), atMs: () => 0 };
    const observed: {
      driverOptions?: RecordedRunDriverOptions;
      shellOptions?: { createLiveBundle?: () => unknown };
    } = {};
    const checkpointHub: RecordedCheckpointFeedHub = {
      createFeed: vi.fn(() => checkpointFeed),
      advanceTo: vi.fn(),
      dispose: vi.fn(),
    };
    const createCheckpointFeedHub = vi.fn(() => checkpointHub);
    const createBridge = vi.fn(() => bridge);
    const createDriver = vi.fn((options: RecordedRunDriverOptions) => {
      observed.driverOptions = options;
      return driver;
    });
    const createShell = vi.fn((options: { createLiveBundle?: () => unknown }) => {
      observed.shellOptions = options;
      return {};
    });
    const createProduction = vi.fn((_options: {
      checkpointFeedFactory?: () => RecordedCheckpointFeed;
    }) => ({}));

    vi.doMock("./recordedRunClient", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./recordedRunClient")>()),
      createRecordedCheckpointFeedHub: createCheckpointFeedHub,
      createRecordedRunBridge: createBridge,
      createRecordedRunDriver: createDriver,
    }));
    vi.doMock("../observer2d/observerShellRuntime", () => ({
      createObserverShellRuntime: createShell,
    }));
    vi.doMock("../observer2d/createProductionObserverSession", () => ({
      createProductionObserverSession: createProduction,
    }));
    const load = vi.fn(async () => recording);
    const { capturedProps, RecordedRunObserver } = await mountWithMockedObserver(load);

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(<RecordedRunObserver base="/api/recordings/test" load={load} />);
    });

    expect(createCheckpointFeedHub).toHaveBeenCalledWith(recording);
    const configuredDriver = observed.driverOptions!;
    expect(configuredDriver.checkpointFeed).toBe(checkpointHub);
    const createRuntime = capturedProps[0]?.createRuntime as (() => unknown);
    createRuntime();
    const configuredShell = observed.shellOptions! as { createLiveBundle: () => unknown };
    configuredShell.createLiveBundle();
    expect(createProduction).toHaveBeenCalledTimes(1);
    const productionOptions = createProduction.mock.calls[0]?.[0];
    expect(productionOptions?.checkpointFeedFactory?.()).toBe(checkpointFeed);
    expect(checkpointHub.createFeed).toHaveBeenCalledOnce();

    configuredDriver.onComplete?.(1_234);
    expect(bridge.heartbeat).toHaveBeenCalledWith(1_234, "stopped");
  });

  it("reconciles terminal world truth only when the surviving StrictMode session reaches it", async () => {
    vi.useFakeTimers();
    const bundles: ProductionObserverSessionBundle[] = [];
    vi.doMock("../../renderer2d/production/PresentationWorldStage", () => ({
      PresentationWorldStage: () => <main data-testid="recorded-production-stage" />,
    }));
    vi.doMock("../observer2d/createProductionObserverSession", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../observer2d/createProductionObserverSession")>();
      return {
        ...actual,
        createProductionObserverSession: (options?: Parameters<typeof actual.createProductionObserverSession>[0]) => {
          const bundle = actual.createProductionObserverSession(options);
          bundles.push(bundle);
          return bundle;
        },
      };
    });
    const { RecordedRunObserver } = await import("./RecordedRunObserver");
    const recording = recordingWithTerminalCheckpoint();
    const load = vi.fn(async () => recording);

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(
        <StrictMode>
          <RecordedRunObserver base="/recordings/strict-mode" load={load} />
        </StrictMode>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bundles).toHaveLength(2);
    expect(bundles[0]?.session.diagnostics().checkpoint.disposed).toBe(true);
    expect(bundles[1]?.session.diagnostics().checkpoint.disposed).toBe(false);
    await act(async () => {
      await bundles[1]!.session.ready;
    });
    expect(bundles[1]?.session.getFrame().world).toMatchObject({
      worldTime: 1_000,
      agents: [
        {
          completeness: "exact",
          value: { id: "terminal-agent", energy: 10, materials: 7 },
        },
      ],
      regions: [
        {
          completeness: "exact",
          value: { name: "meadow", current_energy: 20, current_materials: 30 },
        },
      ],
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_400);
    });

    expect(bundles[1]?.session.getFrame().world).toMatchObject({
      worldTime: 1_000,
      agents: [
        {
          completeness: "exact",
          value: { id: "terminal-agent", energy: 10, materials: 7 },
        },
      ],
      regions: [
        {
          completeness: "exact",
          value: { name: "meadow", current_energy: 20, current_materials: 30 },
        },
      ],
    });
    expect(bundles[1]?.session.diagnostics().checkpoint.lastDeliveredLine).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(bundles[1]?.session.diagnostics().checkpoint).toMatchObject({
      disposed: false,
      lastDeliveredLine: 2,
    });
    expect(bundles[1]?.session.getFrame().world).toMatchObject({
      worldTime: 1_000.1,
      agents: [
        {
          completeness: "exact",
          value: { id: "terminal-agent", energy: 73, materials: 41 },
        },
      ],
      regions: [
        {
          completeness: "exact",
          value: { name: "meadow", current_energy: 25, current_materials: 35 },
        },
      ],
    });
  });

  it("renders an honest failure state and calls onFailure when the recording fails to load", async () => {
    const load = vi.fn(async () => {
      throw new Error("recording fetch exploded");
    });
    const onFailure = vi.fn();
    const { capturedProps, RecordedRunObserver } = await mountWithMockedObserver(load);

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(<RecordedRunObserver base="/recordings/nirvana" load={load} onFailure={onFailure} />);
    });

    expect(container?.querySelector('[data-testid="vivarium-2d-production"]')).toBeNull();
    expect(container?.textContent).toMatch(/recording fetch exploded/);
    expect(capturedProps).toHaveLength(0);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it("keeps the library return available when a recording fails", async () => {
    const load = vi.fn(async () => { throw new Error("missing save"); });
    const onExit = vi.fn();
    const { RecordedRunObserver } = await mountWithMockedObserver(load);
    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(<RecordedRunObserver base="/api/recordings/test" load={load} onExit={onExit} />);
    });
    const back = container?.querySelector("nav button") as HTMLButtonElement;
    expect(back.textContent).toContain("Saved Runs");
    await act(async () => back.click());
    expect(onExit).toHaveBeenCalledOnce();
    expect(container?.textContent).toContain("missing save");
  });

  it("marks a completed replay without remounting the observer runtime", async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(async () => fakeRecording());
      const { capturedProps, RecordedRunObserver } = await mountWithMockedObserver(load);
      root = createRoot(container as HTMLDivElement);
      await act(async () => {
        root?.render(<RecordedRunObserver base="/api/recordings/test" load={load} onExit={() => undefined} />);
      });
      const runtime = capturedProps[0]?.createRuntime;
      await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
      expect(container?.textContent).toContain("Replay finished");
      expect(capturedProps.at(-1)?.createRuntime).toBe(runtime);
      expect(load).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never renders a blank screen on failure — the failure text is non-empty", async () => {
    const load = vi.fn(async () => {
      throw new Error("boom");
    });
    const { RecordedRunObserver } = await mountWithMockedObserver(load);

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(<RecordedRunObserver base="/recordings/nirvana" load={load} />);
    });

    expect(container?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("does not update state after unmounting while the load is still pending", async () => {
    let resolveLoad: ((run: RecordedRun) => void) | null = null;
    const load = vi.fn(() => new Promise<RecordedRun>((resolve) => {
      resolveLoad = resolve;
    }));
    const { RecordedRunObserver } = await mountWithMockedObserver(load);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(<RecordedRunObserver base="/recordings/nirvana" load={load} />);
    });
    await act(async () => {
      await root?.unmount();
    });
    root = null;

    await act(async () => {
      resolveLoad?.(fakeRecording());
    });

    expect(consoleError).not.toHaveBeenCalled();
  });
});
