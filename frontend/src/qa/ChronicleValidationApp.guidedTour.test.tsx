/**
 * Focused regression coverage for the guided tour's coordination with
 * `ChronicleValidationRuntime`'s own auto-play (see `ChronicleValidationApp.tsx`'s
 * guided-tour effect, and the guided-tour report's "Review fixes" section for the
 * live HUD evidence this fix responds to).
 *
 * `ChronicleValidationRuntime` keeps its own coarse batched auto-play running after
 * `restart()`. Left alone, it races ahead of the guided tour's own per-beat pacing
 * and — for every chronicle used by this route — delivers the entire event stream
 * within its first ~1-second tick, regardless of which beat is captioned. Enabling
 * the guided tour must pause that competing auto-play *before* handing delivery
 * control to the guided-tour controller, and hand it back on cleanup.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ObserverShellRuntime } from "../app/observer2d/observerShellRuntime";
import { ChronicleValidationApp } from "./ChronicleValidationApp";
import type { ProductionChronicleQaOwner } from "./chronicleValidationProduction";
import type {
  ChroniclePlayback,
  ChroniclePlaybackSnapshot,
  ChronicleValidationRuntime,
} from "./chronicleValidationRuntime";

function fakePlayback(): ChroniclePlayback {
  const listeners = new Set<() => void>();
  const snapshot: ChroniclePlaybackSnapshot = {
    runId: "mock-c18-v1",
    source: "live",
    sourceKey: "live:mock-c18-v1",
    presentedCursor: 0,
    presentedTime: 1_800_180_000,
  };
  return {
    ready: Promise.resolve(),
    start: () => {},
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    deliverThroughCursor: () => {},
    deliverToMarker: () => {},
    pause: () => {},
    resume: () => {},
    setSpeed: () => {},
    dispose: () => {},
  };
}

/** Records call order on `pause`/`resume`/`restart` — the exact sequence this fix guarantees. */
function fakeValidationRuntime(): Readonly<{
  runtime: ChronicleValidationRuntime;
  calls: string[];
}> {
  const calls: string[] = [];
  const playback = fakePlayback();
  const snapshot = {
    chronicle: { id: "C18" as const, slug: "grand-tour-all-events", expectedFinalCursor: 37, authorityKind: "mechanic-story", markers: [] },
    generation: 1,
    status: "ready" as const,
    error: null,
    playing: true,
    speed: 1 as const,
    presentedCursor: 0,
    presentedTime: 1_800_180_000,
    markerIndex: -1,
    marker: null,
    scenario: null,
  };
  const runtime: ChronicleValidationRuntime = {
    ready: Promise.resolve(),
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    start: async () => {},
    selectChronicle: async () => {},
    pause: () => { calls.push("pause"); },
    resume: () => { calls.push("resume"); },
    setSpeed: () => {},
    restart: async () => { calls.push("restart"); },
    previousMarker: async () => {},
    nextMarker: async () => {},
    runScenarioPhase: async () => {},
    copyFailureToken: () => "token",
    getActivePlayback: () => playback,
    dispose: () => {},
  };
  return { runtime, calls };
}

/** Minimal observer runtime: only the 3 camera-port methods the guided tour controller calls are real. */
function fakeObserverRuntime(): ObserverShellRuntime {
  return {
    setCameraMode: vi.fn(),
    requestFocus: vi.fn(),
    observeRegion: vi.fn(),
  } as unknown as ObserverShellRuntime;
}

function fakeOwner(): Readonly<{ owner: ProductionChronicleQaOwner; calls: string[] }> {
  const { runtime, calls } = fakeValidationRuntime();
  const owner: ProductionChronicleQaOwner = {
    observerRuntime: fakeObserverRuntime(),
    validationRuntime: runtime,
    ready: Promise.resolve(),
    getObserverBinding: () => null, // WorldApp never mounts — irrelevant to this test.
    subscribeObserverBinding: () => () => {},
    start: async () => {},
    settle: async () => {},
    runToTerminal: async () => {},
    diagnostics: () => ({}) as ReturnType<ProductionChronicleQaOwner["diagnostics"]>,
    setReducedMotionOverride: () => {},
    dispose: () => {},
  };
  return { owner, calls };
}

describe("ChronicleValidationApp — guided tour vs. the outer runtime's auto-play", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
  });

  it("pauses the outer validation runtime's auto-play immediately after restart, before wiring the controller", async () => {
    const { owner, calls } = fakeOwner();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ChronicleValidationApp owner={owner} />);
    });
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();

    await act(async () => {
      checkbox!.click();
    });

    // restart() must happen, then pause() — in that order — before anything else
    // (the guided tour controller's own delivery calls target the raw playback
    // port directly, never the runtime's restart/pause/resume surface).
    expect(calls).toEqual(["restart", "pause"]);
  });

  it("resumes the outer validation runtime once the guided tour is turned back off", async () => {
    const { owner, calls } = fakeOwner();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ChronicleValidationApp owner={owner} />);
    });
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');

    await act(async () => {
      checkbox!.click(); // on
    });
    expect(calls).toEqual(["restart", "pause"]);

    await act(async () => {
      checkbox!.click(); // off
    });
    expect(calls).toEqual(["restart", "pause", "resume"]);
  });

  it("does not resume the outer runtime on cleanup when the tour was never actually enabled long enough to pause it", async () => {
    const { owner, calls } = fakeOwner();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // Never toggling the checkbox at all must produce zero runtime calls, and in
    // particular no stray unpaired resume().
    await act(async () => {
      root?.render(<ChronicleValidationApp owner={owner} />);
    });
    expect(calls).toEqual([]);

    await act(async () => {
      root?.unmount();
    });
    root = null;
    expect(calls).toEqual([]);
  });
});
