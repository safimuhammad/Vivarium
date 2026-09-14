import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchSavedRuns,
  parseSavedRuns,
  type SavedRunSummary,
} from "./savedRunsClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseSavedRuns", () => {
  it("accepts a complete local catalogue, including nullable metadata", () => {
    const run = validRun({
      id: "run-summer",
      name: "Midsummer Garden",
      base_url: "/api/recordings/run-summer",
      started_at: null,
      model: null,
      agents: [{
        id: "aster",
        name: "Aster",
        persona: "A patient wanderer.",
        region: "Warm Springs",
        status: "alive",
      }],
      regions: [{ id: "warm_springs", name: "Warm Springs" }],
    });

    expect(parseSavedRuns({ runs: [run] })).toEqual([run]);
  });

  it.each([
    "https://example.test/replay/run-1",
    "/recordings/run-1",
    "/api/recordings/a-different-run",
  ])("rejects a nonlocal or arbitrary base_url (%s)", (baseUrl) => {
    expect(() => parseSavedRuns({ runs: [validRun({ base_url: baseUrl })] }))
      .toThrow("Invalid saved-run entry.");
  });

  it.each([
    ["duration_seconds", -1],
    ["event_count", Number.NaN],
    ["agent_count", "many"],
    ["living_count", null],
    ["region_count", -0.5],
  ])("rejects malformed %s", (field, value) => {
    const malformed = { ...validRun(), [field]: value };
    expect(() => parseSavedRuns({ runs: [malformed] })).toThrow("Invalid saved-run entry.");
  });

  it.each(["agents", "regions"])('rejects a run missing the "%s" array', (field) => {
    const malformed = { ...validRun() } as Record<string, unknown>;
    delete malformed[field];
    expect(() => parseSavedRuns({ runs: [malformed] })).toThrow("Invalid saved-run entry.");
  });
});

describe("fetchSavedRuns", () => {
  it("reads and validates the local catalogue endpoint", async () => {
    const run = validRun({ id: "run-7", base_url: "/api/recordings/run-7" });
    const fetcher = vi.fn(async () => Response.json({ runs: [run] }));
    vi.stubGlobal("fetch", fetcher);

    await expect(fetchSavedRuns()).resolves.toEqual([run]);
    expect(fetcher).toHaveBeenCalledWith("/api/recordings", { cache: "no-store" });
  });

  it("surfaces an unavailable local catalogue as a useful error", async () => {
    const fetcher = vi.fn(async () => new Response("offline", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(fetchSavedRuns()).rejects.toThrow(
      "Saved runs could not be read (HTTP 503).",
    );
  });
});

function validRun(overrides: Partial<SavedRunSummary> = {}): SavedRunSummary {
  return {
    id: "run-1",
    name: "A quiet beginning",
    started_at: 1_757_721_600,
    duration_seconds: 1_800,
    event_count: 24,
    status: "completed",
    model: "qwen3:8b",
    base_url: "/api/recordings/run-1",
    agent_count: 2,
    living_count: 2,
    region_count: 4,
    agents: [],
    regions: [],
    ...overrides,
  };
}
