import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { makeWorld } from "../test/fixtures";
import type {
  PresentationControls,
  PresentationSession,
} from "../presentation/PresentationSession";
import { PresentedWorldModel } from "../presentation/PresentedWorldModel";
import type { PresentedObserverFrame } from "../presentation/contracts";
import { usePresentationSession } from "./usePresentationSession";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("usePresentationSession", () => {
  it("creates one session, publishes its one frame source, and disposes it on unmount", async () => {
    const session = new FakeSession(frame(4));
    const createSession = vi.fn(() => session);
    const observed: PresentedObserverFrame[] = [];
    const container = document.createElement("div");
    const root = createRoot(container);

    function Probe() {
      const state = usePresentationSession({ createSession });
      if (state.frame !== null) observed.push(state.frame);
      return <output>{state.frame?.presentedCursor ?? "loading"}</output>;
    }

    await act(async () => root.render(<Probe />));
    expect(createSession).toHaveBeenCalledOnce();
    expect(container.textContent).toBe("4");

    await act(async () => session.publish(frame(5)));
    expect(container.textContent).toBe("5");
    expect(observed.at(-1)?.presentedCursor).toBe(5);

    await act(async () => root.unmount());
    expect(session.dispose).toHaveBeenCalledOnce();
  });

  it("keeps a stable factory session, propagates Chronicle/controls, and replaces lifecycle once", async () => {
    const first = new FakeSession(frame(4));
    const second = new FakeSession(frame(8));
    const firstFactory = vi.fn(() => first);
    const secondFactory = vi.fn(() => second);
    const replacementRenders: string[] = [];
    const container = document.createElement("div");
    const root = createRoot(container);

    function Probe({ factory }: { factory: () => PresentationSession }) {
      const state = usePresentationSession({ createSession: factory });
      replacementRenders.push(state.frame === null ? "loading" : String(state.frame.presentedCursor));
      if (
        state.session === null
        || state.frame === null
        || state.chronicle === null
        || state.controls === null
      ) return <output>loading</output>;
      return (
        <output>
          {state.frame.presentedCursor}:{state.chronicle.gaps.length}:
          {String(state.controls === state.session.controls())}
        </output>
      );
    }

    await act(async () => root.render(<Probe factory={firstFactory} />));
    await act(async () => root.render(<Probe factory={firstFactory} />));
    expect(firstFactory).toHaveBeenCalledOnce();
    expect(first.dispose).not.toHaveBeenCalled();
    expect(container.textContent).toBe("4:0:true");

    replacementRenders.length = 0;
    await act(async () => root.render(<Probe factory={secondFactory} />));
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(secondFactory).toHaveBeenCalledOnce();
    expect(container.textContent).toBe("8:0:true");
    expect(replacementRenders).not.toContain("4");
    await act(async () => root.unmount());
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it("renders an honest nullable loading view until an async live-like session is ready", async () => {
    const pending = deferred<void>();
    const session = new DeferredReadySession(frame(4), pending.promise);
    const factory = () => session;
    const container = document.createElement("div");
    const root = createRoot(container);

    function Probe() {
      const state = usePresentationSession({ createSession: factory });
      return <output>{state.frame?.presentedCursor ?? "loading"}</output>;
    }

    await act(async () => root.render(<Probe />));
    expect(container.textContent).toBe("loading");
    pending.resolve();
    session.markReady();
    await act(async () => pending.promise);
    expect(container.textContent).toBe("4");
    await act(async () => root.unmount());
    expect(session.dispose).toHaveBeenCalledOnce();
  });

  it("disposes every StrictMode-probed effect-owned session exactly once and silences stale readiness", async () => {
    const pending = deferred<void>();
    const created: DeferredReadySession[] = [];
    const factory = () => {
      const session = new DeferredReadySession(frame(created.length + 1), pending.promise);
      created.push(session);
      return session;
    };
    const container = document.createElement("div");
    const root = createRoot(container);

    function Probe() {
      const state = usePresentationSession({ createSession: factory });
      return <output>{state.frame?.presentedCursor ?? "loading"}</output>;
    }

    await act(async () => root.render(<StrictMode><Probe /></StrictMode>));
    expect(created).toHaveLength(2);
    expect(created[0].dispose).toHaveBeenCalledOnce();
    expect(created[1].dispose).not.toHaveBeenCalled();

    created[0].markReady();
    pending.resolve();
    await act(async () => pending.promise);
    expect(container.textContent).toBe("loading");
    created[1].markReady();
    await act(async () => Promise.resolve());
    expect(container.textContent).toBe("2");

    await act(async () => root.unmount());
    expect(created.every((session) => session.dispose.mock.calls.length === 1)).toBe(true);
  });
});

class FakeSession implements PresentationSession {
  readonly source = "live" as const;
  readonly ready = Promise.resolve();
  readonly dispose = vi.fn();
  private readonly listeners = new Set<() => void>();

  constructor(private current: PresentedObserverFrame) {}

  publish(value: PresentedObserverFrame): void {
    this.current = value;
    for (const listener of [...this.listeners]) listener();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  getFrame(): PresentedObserverFrame {
    return this.current;
  }
  getChronicle(): ReturnType<PresentationSession["getChronicle"]> {
    return { now: null, previous: [], upcoming: [], gaps: [] };
  }
  getPlacementGeneration(): null {
    return null;
  }
  private readonly sessionControls: PresentationControls = {
      pause: vi.fn(),
      resume: vi.fn(),
      setSpeed: vi.fn(),
      holdCurrentMoment: vi.fn(),
      viewMoment: vi.fn(),
  };
  controls(): PresentationControls {
    return this.sessionControls;
  }
  reset(): void {}
  select(): void {}
  retryRecovery(): Promise<void> {
    return Promise.resolve();
  }
  diagnostics(): ReturnType<PresentationSession["diagnostics"]> {
    return {
      disposed: false,
      paused: false,
      speed: 1,
      held: false,
      hidden: false,
      recovery: { status: "idle" },
      lastCompletedRecovery: null,
      settlement: null,
      ingress: { runId: null, sourceKey: null, ingestedCursor: 0, acceptedCount: 0, duplicateCount: 0, gaps: [], lifetimeAcceptedCount: 0, lifetimeDuplicateCount: 0, refusedBatchCount: 0, lastRefusedBatch: null },
      director: { pendingMoments: 0, unpresentableMoments: 0, checkpointHold: null, framePublicationSerial: 0, retainedChapters: 0, retainedPressureSummaries: 0, activeSceneCount: 0, recoveryRequired: false, retryableIngressFaults: 0, lastRetryableIngressFault: null, deferredUtteranceEvidence: 0 },
      chronicle: { previous: 0, upcoming: 0, gaps: 0 },
      checkpoint: { disposed: false, runId: null, lastDeliveredLine: 0, polling: false, retainedSafeCheckpoints: 0, faultCount: 0 },
    };
  }
  setHidden(): void {}
  acceptRunMetadata(): void {}
  replaceRun(): void {}
  reconnectStream(): void {}
}

class DeferredReadySession extends FakeSession {
  private available = false;

  constructor(value: PresentedObserverFrame, override readonly ready: Promise<void>) {
    super(value);
  }

  markReady(): void {
    this.available = true;
    this.publish(super.getFrame());
  }

  override getFrame(): PresentedObserverFrame {
    if (!this.available) throw new Error("presentation session is not ready");
    return super.getFrame();
  }
}

function frame(cursor: number): PresentedObserverFrame {
  const snapshot = makeWorld({ event_cursor: cursor });
  const identity = {
    runId: snapshot.run_id,
    sourceKey: `live:${snapshot.run_id}`,
    revision: cursor,
    firstCursor: cursor,
    lastCursor: cursor,
  };
  return {
    ...identity,
    source: "live",
    ingestedCursor: cursor,
    presentedCursor: cursor,
    world: new PresentedWorldModel(snapshot, identity).getView(),
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
      ingestedCursor: cursor,
      retryable: false,
    },
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
