import { describe, expect, it, vi } from "vitest";

import { makeEventEnvelope, makeRun, makeWorld } from "../test/fixtures";
import { createCanonicalWorldStore } from "./CanonicalWorldStore";
import type {
  ObserverRendererDiagnostics,
  ObserverRendererPort,
  PresentedObserverFrame,
} from "./rendererPort";
import { createGuardedObserverRendererPort } from "./rendererPort";

function makeDiagnostics(): ObserverRendererDiagnostics {
  return {
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
  };
}

function makeFrame(
  overrides: Partial<PresentedObserverFrame> = {},
): PresentedObserverFrame {
  return {
    runId: "run-a",
    sourceKey: "live-a",
    revision: 1,
    firstCursor: 4,
    lastCursor: 5,
    source: "live",
    ingestedCursor: 5,
    presentedCursor: 5,
    world: {
      exactBaseCursor: 4,
      projectedThroughCursor: 5,
      worldTime: 12,
      agents: [],
      regions: [],
      homes: [],
      ruins: [],
      pendingProposals: [],
    },
    scene: null,
    selection: null,
    backlog: {
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Live",
    },
    transport: {
      connection: "live",
      ingestedCursor: 5,
      retryable: true,
    },
    ...overrides,
  };
}

describe("CanonicalWorldStore", () => {
  it("keeps exact snapshot progress separate from accepted transport progress", () => {
    const store = createCanonicalWorldStore();
    store.acceptRun(makeRun({ run_id: "run-a", event_cursor: 4 }));
    store.acceptEnvelope(makeEventEnvelope({ cursor: 4, next_cursor: 12 }));

    expect(store.acceptSnapshot(makeWorld({ run_id: "run-a", event_cursor: 8 }))).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      runId: "run-a",
      ingestedCursor: 12,
      exactSnapshotCursor: 8,
      snapshot: expect.objectContaining({ event_cursor: 8 }),
    });

    expect(store.acceptSnapshot(makeWorld({ run_id: "run-a", event_cursor: 7 }))).toBe(false);
    expect(store.getSnapshot()).toMatchObject({
      ingestedCursor: 12,
      exactSnapshotCursor: 8,
    });
  });

  it("atomically resets replacement runs so a lower cursor can be accepted", () => {
    const store = createCanonicalWorldStore();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.acceptRun(makeRun({ run_id: "run-a", event_cursor: 40 }))).toBe("initial");
    expect(store.acceptSnapshot(makeWorld({ run_id: "run-a", event_cursor: 42 }))).toBe(true);
    expect(store.acceptRun(makeRun({ run_id: "run-a", event_cursor: 45 }))).toBe("same-run");
    expect(store.acceptRun(makeRun({ run_id: "run-b", event_cursor: 2 }))).toBe("replacement");

    expect(store.getSnapshot()).toMatchObject({
      runId: "run-b",
      ingestedCursor: 2,
      exactSnapshotCursor: null,
      snapshot: null,
      revision: 1,
    });
    expect(store.acceptSnapshot(makeWorld({ run_id: "run-b", event_cursor: 3 }))).toBe(true);
    expect(store.acceptSnapshot(makeWorld({ run_id: "run-a", event_cursor: 99 }))).toBe(false);
    expect(store.getSnapshot()).toMatchObject({
      runId: "run-b",
      ingestedCursor: 3,
      exactSnapshotCursor: 3,
    });
    expect(listener).toHaveBeenCalledTimes(5);
  });
});

describe("guarded observer renderer port", () => {
  it("validates frame identity before forwarding an atomic presentation", () => {
    const updatePresentation = vi.fn();
    const delegate: ObserverRendererPort = {
      updatePresentation,
      setSelection: vi.fn(),
      focusSelection: vi.fn(),
      observeRegion: vi.fn(),
      setSafeFrame: vi.fn(),
      setCameraMode: vi.fn(),
      panCamera: vi.fn(),
      zoomCamera: vi.fn(),
      resize: vi.fn(),
      diagnostics: makeDiagnostics,
      dispose: vi.fn(),
    };
    const port = createGuardedObserverRendererPort(delegate);

    port.updatePresentation(makeFrame());
    expect(updatePresentation).toHaveBeenCalledTimes(1);
    expect(() => {
      port.updatePresentation(makeFrame({ firstCursor: 8, lastCursor: 7 }));
    }).toThrow("firstCursor must not exceed lastCursor");
    expect(updatePresentation).toHaveBeenCalledTimes(1);
  });

  it("forwards camera inputs and disposes its delegate exactly once", () => {
    const panCamera = vi.fn();
    const zoomCamera = vi.fn();
    const resize = vi.fn();
    const dispose = vi.fn();
    const delegate: ObserverRendererPort = {
      updatePresentation: vi.fn(),
      setSelection: vi.fn(),
      focusSelection: vi.fn(),
      observeRegion: vi.fn(),
      setSafeFrame: vi.fn(),
      setCameraMode: vi.fn(),
      panCamera,
      zoomCamera,
      resize,
      diagnostics: makeDiagnostics,
      dispose,
    };
    const port = createGuardedObserverRendererPort(delegate);

    port.panCamera({ x: 12, y: -4 });
    port.zoomCamera(1.25, { x: 80, y: 40 });
    port.resize(1024, 768);
    port.dispose();
    port.dispose();
    port.panCamera({ x: 1, y: 1 });

    expect(panCamera).toHaveBeenCalledOnce();
    expect(panCamera).toHaveBeenCalledWith({ x: 12, y: -4 });
    expect(zoomCamera).toHaveBeenCalledWith(1.25, { x: 80, y: 40 });
    expect(resize).toHaveBeenCalledWith(1024, 768);
    expect(dispose).toHaveBeenCalledOnce();
    expect(port.diagnostics().disposed).toBe(true);
  });

  it("returns cached diagnostics after delegate disposal releases its resources", () => {
    let delegateDisposed = false;
    const diagnostics = vi.fn((): ObserverRendererDiagnostics => {
      if (delegateDisposed) {
        throw new Error("renderer resources released");
      }
      return {
        ...makeDiagnostics(),
        frameIdentity: {
          runId: "run-a",
          sourceKey: "live-a",
          revision: 2,
          firstCursor: 7,
          lastCursor: 9,
        },
        activeActors: 3,
      };
    });
    const delegate: ObserverRendererPort = {
      updatePresentation: vi.fn(),
      setSelection: vi.fn(),
      focusSelection: vi.fn(),
      observeRegion: vi.fn(),
      setSafeFrame: vi.fn(),
      setCameraMode: vi.fn(),
      panCamera: vi.fn(),
      zoomCamera: vi.fn(),
      resize: vi.fn(),
      diagnostics,
      dispose: vi.fn(() => {
        delegateDisposed = true;
      }),
    };
    const port = createGuardedObserverRendererPort(delegate);

    port.dispose();

    expect(port.diagnostics()).toMatchObject({
      disposed: true,
      frameIdentity: { runId: "run-a", lastCursor: 9 },
      activeActors: 3,
    });
    expect(diagnostics).toHaveBeenCalledOnce();
  });

  it("still releases renderer resources when the pre-disposal diagnostic sample throws", () => {
    const dispose = vi.fn();
    const delegate: ObserverRendererPort = {
      updatePresentation: vi.fn(),
      setSelection: vi.fn(),
      focusSelection: vi.fn(),
      observeRegion: vi.fn(),
      setSafeFrame: vi.fn(),
      setCameraMode: vi.fn(),
      panCamera: vi.fn(),
      zoomCamera: vi.fn(),
      resize: vi.fn(),
      diagnostics: vi.fn(() => { throw new Error("diagnostic probe failed"); }),
      dispose,
    };
    const port = createGuardedObserverRendererPort(delegate);

    expect(() => port.dispose()).not.toThrow();
    port.dispose();

    expect(dispose).toHaveBeenCalledOnce();
    expect(port.diagnostics().disposed).toBe(true);
  });
});
