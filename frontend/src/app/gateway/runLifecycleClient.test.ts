import { describe, expect, it, vi } from "vitest";

import { HttpResponseError } from "../client";
import { parseRunConfig, serializeRunConfig, type RunConfig } from "./runConfig";
import { createHttpRunLifecycleClient, RunStartRejectedError } from "./runLifecycleClient";

function sampleConfig(): RunConfig {
  return parseRunConfig({
    beings: [
      { name: "Joe", start_region: "warm_springs", energy: 100, materials: 45 },
    ],
    abundance: 1,
    seed: 7,
    duration_seconds: 1800,
    provider: "gemini",
    reflect_every_n_breaths: 12,
    max_offspring: 5,
  });
}

function rawConfig(): Record<string, unknown> {
  return {
    beings: [
      { name: "Joe", start_region: "warm_springs", energy: 100, materials: 45 },
    ],
    abundance: 1,
    seed: 7,
    duration_seconds: 1800,
    provider: "gemini",
    reflect_every_n_breaths: 12,
    max_offspring: 5,
  };
}

function rawKnobs(): Record<string, unknown> {
  return {
    beings: {
      label: "How many beings",
      min_count: 1,
      max_count: 12,
      default_count: 4,
      fields: {
        energy: { label: "Starting energy", min: 50, max: 200, step: 5 },
        materials: { label: "Starting materials", min: 0, max: 100, step: 1 },
      },
    },
    abundance: { label: "How much the land gives", min: 0.25, max: 3, step: 0.05 },
    seed: { label: "Land shape", min: 0, max: 999999, step: 1 },
    max_offspring: { label: "Children per being", min: 0, max: 10, step: 1 },
    duration_seconds: {
      label: "How long it runs",
      choices: [
        { value: 900, label: "15 minutes" },
        { value: null, label: "until stopped" },
      ],
    },
    provider: {
      label: "Where the minds run",
      choices: [
        {
          value: "gemini",
          label: "the cloud",
          cost_per_being_hour_usd: 3,
          cadence: "a breath every few seconds",
        },
      ],
    },
    reflect_every_n_breaths: {
      label: "How often a being reflects",
      choices: [{ value: 12, label: "every 12 breaths" }],
    },
  };
}

describe("createHttpRunLifecycleClient", () => {
  it("reads defaults, config, and lifecycle from their GET endpoints", async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      requested.push(path);
      if (path === "/api/run/defaults") {
        return Response.json({
          schema: 1,
          defaults: rawConfig(),
          knobs: rawKnobs(),
          regions: [],
          locked: { world_tick_interval_seconds: 5 },
        });
      }
      if (path === "/api/run/config") {
        // The server wraps the config in run metadata; the client unwraps it.
        return Response.json({
          schema: 1,
          run_id: "run-7",
          status: "running",
          config: rawConfig(),
          derived: { mating_proposal_timeout_seconds: 45 },
          warnings: [],
        });
      }
      if (path === "/api/run") {
        return Response.json({ run_id: "run-7", status: "running" });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    const client = createHttpRunLifecycleClient({ fetcher });

    const defaults = await client.getDefaults();
    expect(defaults.tick_interval_seconds).toBe(5);
    expect(defaults.config.beings[0]?.name).toBe("Joe");

    const config = await client.getConfig();
    expect(config).toEqual(sampleConfig());

    const lifecycle = await client.getLifecycle();
    expect(lifecycle).toEqual({ run_id: "run-7", status: "running", raw_status: "running" });

    expect(requested).toEqual(["/api/run/defaults", "/api/run/config", "/api/run"]);
  });

  it("prefixes every request with the configured baseUrl", async () => {
    const fetcher = vi.fn(async () => Response.json({ run_id: "r", status: "running" })) as typeof fetch;
    const client = createHttpRunLifecycleClient({ fetcher, baseUrl: "http://localhost:9000" });

    await client.getLifecycle();

    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:9000/api/run",
      expect.anything(),
    );
  });

  it("surfaces a non-ok GET as a typed HttpResponseError via assertHttpResponseOk", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 404 })) as typeof fetch;
    const client = createHttpRunLifecycleClient({ fetcher });

    const error = await client.getLifecycle().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpResponseError);
    expect(error).toMatchObject({ path: "/api/run", status: 404 });
  });

  it("POSTs the serialized config with JSON headers and accepts a 202 acknowledgement", async () => {
    let capturedInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({
          run_id: "run-9",
          status: "starting",
          warnings: ["Every being begins alone in a different region."],
        }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    const client = createHttpRunLifecycleClient({ fetcher });

    const ack = await client.start(sampleConfig());

    expect(ack).toEqual({
      run_id: "run-9",
      status: "starting",
      warnings: ["Every being begins alone in a different region."],
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/run/start",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }),
    );
    expect(JSON.parse(String(capturedInit?.body))).toEqual(serializeRunConfig(sampleConfig()));
  });

  it("throws RunStartRejectedError carrying the server's per-field messages on rejection", async () => {
    // The 422 body this server sends: a list of {field, message} under `detail`.
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({
        detail: {
          errors: [{ field: "abundance", message: "must be between 0.25 and 3" }],
        },
      }),
      { status: 422 },
    )) as typeof fetch;
    const client = createHttpRunLifecycleClient({ fetcher });

    const error = await client.start(sampleConfig()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RunStartRejectedError);
    expect(error).toMatchObject({
      status: 422,
      fieldErrors: [{ field: "abundance", message: "must be between 0.25 and 3" }],
    });
    expect((error as RunStartRejectedError).message).toContain("abundance");
  });

  it("throws RunStartRejectedError with an empty fieldErrors list when the body says nothing per-field", async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ detail: "server exploded" }),
      { status: 500 },
    )) as typeof fetch;
    const client = createHttpRunLifecycleClient({ fetcher });

    const error = await client.start(sampleConfig()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RunStartRejectedError);
    expect((error as RunStartRejectedError).fieldErrors).toEqual([]);
  });

  it("falls back to a status+text message on a non-JSON rejection body without throwing a parse error", async () => {
    const fetcher = vi.fn(async () => new Response("internal server error", { status: 500 })) as typeof fetch;
    const client = createHttpRunLifecycleClient({ fetcher });

    const error = await client.start(sampleConfig()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RunStartRejectedError);
    const rejected = error as RunStartRejectedError;
    expect(rejected.status).toBe(500);
    expect(rejected.fieldErrors).toEqual([]);
    expect(rejected.message).toContain("500");
    expect(rejected.message).toContain("internal server error");
  });

  it("reads a rejected start's body only once", async () => {
    let textCalls = 0;
    const response = new Response("plain text failure", { status: 400 });
    const originalText = response.text.bind(response);
    response.text = async () => {
      textCalls += 1;
      return originalText();
    };
    const fetcher = vi.fn(async () => response) as typeof fetch;
    const client = createHttpRunLifecycleClient({ fetcher });

    await client.start(sampleConfig()).catch((caught: unknown) => caught);

    expect(textCalls).toBe(1);
  });

  it("POSTs to stop and returns the 202 acknowledgement", async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ run_id: "run-9", status: "stopping" }),
      { status: 202, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
    const client = createHttpRunLifecycleClient({ fetcher });

    await expect(client.stop()).resolves.toEqual({
      run_id: "run-9",
      status: "stopping",
      warnings: [],
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/run/stop",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses assertHttpResponseOk (not the rejection path) for a failed stop", async () => {
    const fetcher = vi.fn(async () => new Response("boom", { status: 500 })) as typeof fetch;
    const client = createHttpRunLifecycleClient({ fetcher });

    const error = await client.stop().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpResponseError);
    expect(error).not.toBeInstanceOf(RunStartRejectedError);
  });
});
