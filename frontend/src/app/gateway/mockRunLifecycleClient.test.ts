import { describe, expect, it } from "vitest";

import { parseRunConfig, parseRunDefaults, type RunConfig } from "./runConfig";
import { RunStartRejectedError } from "./runLifecycleClient";
import {
  MOCK_RUN_DEFAULTS_PAYLOAD,
  NoRunError,
  createMockRunLifecycleClient,
} from "./mockRunLifecycleClient";

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

describe("MOCK_RUN_DEFAULTS_PAYLOAD", () => {
  it("is the real server's payload, in the real server's shape", () => {
    // Captured verbatim from `run_defaults_payload(load_world_config(...))`.
    // Asserting the WIRE keys, not just the parsed result, is what keeps the
    // demo path honest: a mock that drifts back toward the screen's convenience
    // would let the two halves diverge again without a test noticing.
    const payload = MOCK_RUN_DEFAULTS_PAYLOAD;
    const knobs = payload.knobs as Record<string, Record<string, unknown>>;

    expect(Object.keys(payload))
      .toEqual(["schema", "defaults", "knobs", "regions", "locked", "derived"]);
    expect(Object.keys(knobs)).toEqual([
      "beings",
      "abundance",
      "seed",
      "duration_seconds",
      "provider",
      "reflect_every_n_breaths",
      "max_offspring",
    ]);
    expect(Object.keys(knobs.beings?.fields as Record<string, unknown>))
      .toEqual(["name", "start_region", "energy", "materials", "persona"]);
    expect(knobs.provider?.choices).toBeInstanceOf(Array);
    expect((payload.locked as Record<string, unknown>).world_tick_interval_seconds).toBe(5);
  });

  it("parses cleanly into the twelve knobs the screen renders", () => {
    const defaults = parseRunDefaults(MOCK_RUN_DEFAULTS_PAYLOAD);

    expect(defaults.config.beings).toEqual([
      { name: "Joe", start_region: "warm_springs", energy: 100, materials: 45, persona: null },
      { name: "Mae", start_region: "warm_springs", energy: 100, materials: 45, persona: null },
      { name: "Dick", start_region: "nirvana", energy: 100, materials: 45, persona: null },
      { name: "Allen", start_region: "nirvana", energy: 100, materials: 45, persona: null },
    ]);
    expect(defaults.config).toMatchObject({
      abundance: 1,
      seed: 7,
      duration_seconds: 1800,
      provider: "mlx",
      reflect_every_n_breaths: 12,
      max_offspring: 5,
    });

    expect(defaults.knobs.being_count).toMatchObject({ min: 1, max: 12, step: 1 });
    expect(defaults.knobs.energy).toMatchObject({ min: 50, max: 200 });
    expect(defaults.knobs.materials).toMatchObject({ min: 0, max: 100 });
    expect(defaults.knobs.materials.markers).toEqual([
      { value: 30, label: "a child", help: null },
      { value: 80, label: "a home", help: null },
    ]);
    expect(defaults.knobs.abundance).toMatchObject({
      min: 0.25,
      max: 3,
      step: 0.05,
      low_label: "the land is dying",
      high_label: "the land provides",
    });
    expect(defaults.knobs.seed).toMatchObject({ min: 0, max: 2_147_483_647 });
    expect(defaults.knobs.max_offspring).toMatchObject({ min: 0, max: 10 });

    expect(defaults.knobs.duration.options.map((option) => option.value))
      .toEqual([1800, 900, 3600, 14400, null]);
    expect(defaults.knobs.provider.options.map((option) => option.value))
      .toEqual(["mlx", "gemini", "ollama"]);
    expect(defaults.knobs.reflect.options.map((option) => option.value)).toEqual([6, 12, 24]);

    expect(defaults.regions.map((region) => region.title))
      .toEqual(["Nirvana", "Nirvana East", "Warm Springs", "Nirvana West"]);
    expect(defaults.regions[2]).toMatchObject({ energy_rate: 0.25, materials_rate: 0.2 });
    expect(defaults.tick_interval_seconds).toBe(5);
  });
});

describe("createMockRunLifecycleClient", () => {
  it("resolves getDefaults from the fixed payload regardless of run state", async () => {
    const client = createMockRunLifecycleClient();

    await expect(client.getDefaults()).resolves.toEqual(parseRunDefaults(MOCK_RUN_DEFAULTS_PAYLOAD));
  });

  it("rejects getLifecycle and getConfig with NoRunError before any start", async () => {
    const client = createMockRunLifecycleClient();

    await expect(client.getLifecycle()).rejects.toBeInstanceOf(NoRunError);
    await expect(client.getConfig()).rejects.toBeInstanceOf(NoRunError);
  });

  it("rejects stop with NoRunError when no run has been started", async () => {
    const client = createMockRunLifecycleClient();

    await expect(client.stop()).rejects.toBeInstanceOf(NoRunError);
  });

  it("mints an incrementing run_id on every start, so the replacement path is exercisable", async () => {
    let time = 0;
    const client = createMockRunLifecycleClient({ now: () => time });

    await expect(client.start(sampleConfig())).resolves.toMatchObject({
      run_id: "mock-run-1",
      status: "starting",
    });
    await expect(client.start(sampleConfig())).resolves.toMatchObject({
      run_id: "mock-run-2",
      status: "starting",
    });
  });

  it("returns the config it was started with from getConfig", async () => {
    const client = createMockRunLifecycleClient();
    const config = sampleConfig();

    await client.start(config);

    await expect(client.getConfig()).resolves.toEqual(config);
  });

  it("reports starting then running as the injected clock crosses startingMs", async () => {
    let time = 0;
    const client = createMockRunLifecycleClient({ now: () => time, startingMs: 1000 });
    await client.start(sampleConfig());

    time = 999;
    await expect(client.getLifecycle()).resolves.toMatchObject({ status: "starting" });

    time = 1000;
    await expect(client.getLifecycle()).resolves.toMatchObject({ status: "running" });
  });

  it("uses the default 2600ms starting window when none is provided", async () => {
    let time = 0;
    const client = createMockRunLifecycleClient({ now: () => time });
    await client.start(sampleConfig());

    time = 2599;
    await expect(client.getLifecycle()).resolves.toMatchObject({ status: "starting" });

    time = 2600;
    await expect(client.getLifecycle()).resolves.toMatchObject({ status: "running" });
  });

  it("stays failed forever once failStart is set and startingMs has elapsed", async () => {
    let time = 0;
    const client = createMockRunLifecycleClient({
      now: () => time,
      startingMs: 1000,
      failStart: true,
    });
    await client.start(sampleConfig());

    time = 1000;
    await expect(client.getLifecycle()).resolves.toMatchObject({ status: "failed" });

    time = 999_999;
    await expect(client.getLifecycle()).resolves.toMatchObject({ status: "failed" });
  });

  it("reports failed even before startingMs elapses, once failStart is set", async () => {
    let time = 0;
    const client = createMockRunLifecycleClient({
      now: () => time,
      startingMs: 1000,
      failStart: true,
    });
    await client.start(sampleConfig());

    time = 200;
    await expect(client.getLifecycle()).resolves.toMatchObject({ status: "failed" });
  });

  it("moves stopping -> stopped half of startingMs after stop() is called", async () => {
    let time = 0;
    const client = createMockRunLifecycleClient({ now: () => time, startingMs: 1000 });
    await client.start(sampleConfig());
    time = 1000;
    await client.stop();

    time = 1499;
    await expect(client.getLifecycle()).resolves.toMatchObject({ status: "stopping" });

    time = 1500;
    await expect(client.getLifecycle()).resolves.toMatchObject({ status: "stopped" });
  });

  it("throws RunStartRejectedError carrying rejectWith instead of starting a run", async () => {
    const rejectWith = [{ field: "abundance", message: "too high" }];
    const client = createMockRunLifecycleClient({ rejectWith });

    const error = await client.start(sampleConfig()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RunStartRejectedError);
    expect((error as RunStartRejectedError).fieldErrors).toEqual(rejectWith);
    await expect(client.getLifecycle()).rejects.toBeInstanceOf(NoRunError);
    await expect(client.getConfig()).rejects.toBeInstanceOf(NoRunError);
  });

  it("never uses a real timer or Math.random — two clients with the same clock agree exactly", async () => {
    let time = 0;
    const clientA = createMockRunLifecycleClient({ now: () => time, startingMs: 1000 });
    const clientB = createMockRunLifecycleClient({ now: () => time, startingMs: 1000 });

    await clientA.start(sampleConfig());
    await clientB.start(sampleConfig());
    time = 500;

    const [lifecycleA, lifecycleB] = await Promise.all([
      clientA.getLifecycle(),
      clientB.getLifecycle(),
    ]);
    expect(lifecycleA.status).toBe(lifecycleB.status);
    expect(lifecycleA.status).toBe("starting");
  });
});
