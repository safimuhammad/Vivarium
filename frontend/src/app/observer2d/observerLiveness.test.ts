import { describe, expect, it } from "vitest";

import type {
  PresentationLiveness,
  PresentedObserverFrame,
} from "../../presentation/contracts";
import { makeWorld } from "../../test/fixtures";
import { resolveObserverLiveness } from "./observerLiveness";

describe("resolveObserverLiveness", () => {
  it("reads a finished run as ended whatever the socket is doing", () => {
    expect(resolveObserverLiveness(frame({
      liveness: liveness({ runStatus: "stopped" }),
      connection: "live",
    }))).toMatchObject({ state: "ended", retryable: false });
    // The sim self-terminates at `duration`; a stopped run with a still-open
    // socket is the exact shape a viewer used to read as "live".
    expect(resolveObserverLiveness(frame({
      liveness: liveness({ runStatus: "stopped", lastSignalWasHeartbeat: true }),
      connection: "offline",
    })).state).toBe("ended");
  });

  it("reads a run that raised as ended, not as beings deep in thought", () => {
    // `failed` is a terminal status the run-lifecycle API reports. Falling
    // through to `quiet` would draw the exact picture this module exists to
    // stop: a finished run rendered as a world that is merely thinking.
    expect(resolveObserverLiveness(frame({
      liveness: liveness({ runStatus: "failed", lastSignalWasHeartbeat: true }),
      connection: "live",
    }))).toMatchObject({ state: "ended", retryable: false });
  });

  it.each(["starting", "stopping"] as const)(
    "does not call a run that is still %s ended",
    (runStatus) => {
      // `stopping` means the stop was asked for, not that the last event has
      // arrived; the world is still emitting and the watcher should still watch.
      expect(resolveObserverLiveness(frame({
        liveness: liveness({ runStatus }),
        connection: "live",
      })).state).not.toBe("ended");
    },
  );

  it.each([
    ["offline", "Offline"],
    ["error", "Offline"],
    ["connecting", "Offline"],
    ["rejoining", "Offline"],
    ["recovery-paused", "Paused"],
  ] as const)("reads %s as disconnected", (connection, label) => {
    expect(resolveObserverLiveness(frame({ connection, retryable: true })))
      .toMatchObject({ state: "disconnected", label, retryable: true });
  });

  it("outranks a backlog with a dead socket, because a dead socket never drains", () => {
    expect(resolveObserverLiveness(frame({
      connection: "offline",
      backlogState: "behind",
      pendingMoments: 12,
    })).state).toBe("disconnected");
  });

  it.each(["behind", "overflow"] as const)("reads a %s stage as behind", (backlogState) => {
    expect(resolveObserverLiveness(frame({
      connection: "live",
      backlogState,
      pendingMoments: 12,
      liveness: liveness({ lastSignalWasHeartbeat: true }),
    }))).toMatchObject({ state: "behind", detail: "12 moments still to play." });
  });

  it("reads a heartbeat-only stream as quiet, not as live and not as dead", () => {
    expect(resolveObserverLiveness(frame({
      connection: "live",
      liveness: liveness({ lastSignalWasHeartbeat: true }),
    }))).toMatchObject({ state: "quiet", label: "Quiet" });
  });

  it("reads events arriving on a level stage as live", () => {
    expect(resolveObserverLiveness(frame({
      connection: "live",
      liveness: liveness({ lastSignalWasHeartbeat: false }),
    }))).toMatchObject({ state: "live", label: "Live" });
  });

  it("never claims quiet against a backend that sends no heartbeat", () => {
    // Degrading to "live" is the honest answer: without a keepalive the client
    // genuinely cannot tell a thinking world from a dead socket.
    expect(resolveObserverLiveness(frame({ connection: "live" })).state).toBe("live");
  });
});

function liveness(
  overrides: Partial<PresentationLiveness> = {},
): PresentationLiveness {
  return {
    runStatus: "running",
    lastSignalAtMs: 1_000,
    lastSignalWasHeartbeat: false,
    heartbeatWorldTime: null,
    ...overrides,
  };
}

function frame(options: {
  connection?: PresentedObserverFrame["transport"]["connection"];
  retryable?: boolean;
  backlogState?: PresentedObserverFrame["backlog"]["state"];
  pendingMoments?: number;
  liveness?: PresentationLiveness;
}): PresentedObserverFrame {
  const world = makeWorld({ run_id: "run-a", event_cursor: 4 });
  return {
    runId: "run-a",
    sourceKey: "live:run-a",
    revision: 1,
    firstCursor: 4,
    lastCursor: 4,
    source: "live",
    ingestedCursor: 4,
    presentedCursor: 4,
    world: {
      exactBaseCursor: 4,
      projectedThroughCursor: 4,
      worldTime: world.world_time,
      agents: [],
      regions: [],
      homes: [],
      ruins: [],
      pendingProposals: [],
    } as unknown as PresentedObserverFrame["world"],
    scene: null,
    selection: null,
    backlog: {
      pendingMoments: options.pendingMoments ?? 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: options.backlogState ?? "caught-up",
      label: "Caught up.",
    },
    transport: {
      connection: options.connection ?? "live",
      ingestedCursor: 4,
      retryable: options.retryable ?? false,
    },
    ...(options.liveness === undefined ? {} : { liveness: options.liveness }),
  };
}
