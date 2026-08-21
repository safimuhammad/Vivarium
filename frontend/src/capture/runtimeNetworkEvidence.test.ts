import { describe, expect, it } from "vitest";

import {
  createRuntimeNetworkObservation,
  normalizeRuntimeRequests,
  recordRuntimeNetworkResponse,
  recordRuntimeNetworkTerminal,
} from "./runtimeNetworkEvidence";

const ORIGIN = "http://127.0.0.1:4173";

describe("runtime network evidence", () => {
  it("preserves a fulfilled response when transport later reports failure", () => {
    const observation = createRuntimeNetworkObservation({
      sequence: 1,
      method: "GET",
      url: `${ORIGIN}/api/replay/checkpoints/latest`,
      resourceType: "fetch",
      navigation: false,
    });
    recordRuntimeNetworkResponse(observation, 404);
    recordRuntimeNetworkTerminal(observation, "failed", "net::ERR_ABORTED");

    expect(normalizeRuntimeRequests([observation], [{
      requestId: 1,
      sequence: 1,
      handler: "replay-checkpoint-latest",
      method: "GET",
      path: "/api/replay/checkpoints/latest",
      disposition: "fulfilled",
      status: 404,
    }], ORIGIN)).toEqual([{
      sequence: 1,
      kind: "api",
      method: "GET",
      url: `${ORIGIN}/api/replay/checkpoints/latest`,
      handler: "api-fixture",
      status: 404,
      disposition: "fulfilled",
      responseStatus: 404,
      terminal: "failed",
      failureText: "net::ERR_ABORTED",
    }]);
  });

  it("records a failure without a response as rejected transport", () => {
    const observation = createRuntimeNetworkObservation({
      sequence: 1,
      method: "GET",
      url: `${ORIGIN}/api/replay/artifacts/events`,
      resourceType: "fetch",
      navigation: false,
    });
    recordRuntimeNetworkTerminal(observation, "failed", "net::ERR_FAILED");

    expect(normalizeRuntimeRequests([observation], [{
      requestId: 1,
      sequence: 1,
      handler: "raw-artifact-reject",
      method: "GET",
      path: "/api/replay/artifacts/events",
      disposition: "rejected",
      status: 0,
    }], ORIGIN)).toEqual([expect.objectContaining({
      status: 0,
      disposition: "rejected",
      responseStatus: null,
      terminal: "failed",
      failureText: "net::ERR_FAILED",
    })]);
  });

  it("fails closed when terminal lifecycle is missing", () => {
    const observation = createRuntimeNetworkObservation({
      sequence: 1,
      method: "GET",
      url: `${ORIGIN}/api/run`,
      resourceType: "fetch",
      navigation: false,
    });
    recordRuntimeNetworkResponse(observation, 200);

    expect(() => normalizeRuntimeRequests([observation], [], ORIGIN))
      .toThrow(/missing terminal lifecycle/);
  });

  it("rejects duplicate terminal lifecycle", () => {
    const observation = createRuntimeNetworkObservation({
      sequence: 1,
      method: "GET",
      url: `${ORIGIN}/api/run`,
      resourceType: "fetch",
      navigation: false,
    });
    recordRuntimeNetworkResponse(observation, 200);
    recordRuntimeNetworkTerminal(observation, "finished", null);

    expect(() => recordRuntimeNetworkTerminal(observation, "failed", "net::ERR_ABORTED"))
      .toThrow(/terminal lifecycle already recorded/);
  });

  it("does not match response authority to a rejected route outcome", () => {
    const observation = createRuntimeNetworkObservation({
      sequence: 1,
      method: "GET",
      url: `${ORIGIN}/api/replay/checkpoints/latest`,
      resourceType: "fetch",
      navigation: false,
    });
    recordRuntimeNetworkResponse(observation, 404);
    recordRuntimeNetworkTerminal(observation, "failed", "net::ERR_ABORTED");

    expect(() => normalizeRuntimeRequests([observation], [{
      requestId: 1,
      sequence: 1,
      handler: "replay-checkpoint-latest",
      method: "GET",
      path: "/api/replay/checkpoints/latest",
      disposition: "rejected",
      status: 0,
    }], ORIGIN)).toThrow(/lacks route authority/);
  });
});
