import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordedRun } from "./recordedRunClient";
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
    spanMs: 0,
    snapshotAt: () => snapshot,
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
