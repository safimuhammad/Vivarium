import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SavedRunsScreen } from "./SavedRunsScreen";
import type { SavedRunSummary } from "./savedRunsClient";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

describe("SavedRunsScreen", () => {
  it("renders real saved names, portraits, metadata, recording state, and watch callbacks", async () => {
    const first = savedRun({
      id: "run-summer",
      name: "Midsummer Garden",
      started_at: 1_757_721_600,
      duration_seconds: 3_661,
      event_count: 42,
      status: "completed",
      model: "qwen3:8b",
      agent_count: 8,
      living_count: 2,
      region_count: 4,
      agents: [
        { id: "aster", name: "Aster", persona: "A patient wanderer.", region: "warm_springs", status: "alive" },
        { id: "bramble", name: "Bramble", persona: null, region: "nirvana_west", status: "dead" },
        { id: "cedar", name: "Cedar", persona: null, region: "nirvana_west", status: "alive" },
        { id: "fern", name: "Fern", persona: null, region: "warm_springs", status: "alive" },
        { id: "ivy", name: "Ivy", persona: null, region: "nirvana_west", status: "alive" },
        { id: "willow", name: "Willow", persona: null, region: "warm_springs", status: "alive" },
      ],
      regions: [
        { id: "warm_springs", name: "warm_springs" },
        { id: "nirvana_west", name: "nirvana_west" },
      ],
    });
    const ongoing = savedRun({
      id: "run-current",
      name: "Still Growing",
      status: "running",
      agents: [{ id: "moss", name: "Moss", persona: "Quiet", region: null, status: "alive" }],
    });
    const onBack = vi.fn();
    const onRefresh = vi.fn();
    const onWatch = vi.fn();
    await mount(<SavedRunsScreen runs={[first, ongoing]} loading={false} error={null}
      onBack={onBack} onRefresh={onRefresh} onWatch={onWatch} />);

    expect(text()).toContain("Stored on this device");
    expect(text()).toContain("Saved Runs");
    expect(text()).toContain("Autosaved locally");
    expect(text()).toContain("Midsummer Garden");
    expect(text()).toContain("Aster");
    expect(text()).toContain("Bramble");
    expect(text()).toContain("Saved beings");
    expect(text()).toContain("qwen3:8b");
    expect(text()).toContain("1h 1m");
    expect(text()).toContain("42 events");
    expect(text()).toContain("4 regions");
    expect(text()).toContain("Warm Springs");
    expect(text()).toContain("Nirvana West");
    expect(text()).not.toContain("warm_springs");
    expect(text()).not.toContain("nirvana_west");
    expect(text()).toContain("Recording");
    expect(text()).toContain("latest snapshot");
    expect(container?.querySelectorAll(".saved-run-card__portrait")).toHaveLength(7);
    expect(text()).toContain("+ 2 more saved beings");

    await act(async () => container?.querySelector<HTMLButtonElement>(".saved-runs-screen__back")?.click());
    await act(async () => container?.querySelector<HTMLButtonElement>(".saved-runs-screen__refresh")?.click());
    await act(async () => container?.querySelector<HTMLButtonElement>("button[aria-label='Watch replay for Midsummer Garden']")?.click());
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onWatch).toHaveBeenCalledWith(first);
  });

  it("renders an honest empty library and keeps refresh and back available", async () => {
    const onBack = vi.fn();
    const onRefresh = vi.fn();
    await mount(<SavedRunsScreen runs={[]} loading={false} error={null}
      onBack={onBack} onRefresh={onRefresh} onWatch={vi.fn()} />);

    expect(text()).toContain("No saved runs yet.");
    expect(text()).toContain("nothing to replay");
    expect(container?.querySelector(".saved-runs-screen__state")).not.toBeNull();
    await act(async () => container?.querySelector<HTMLButtonElement>("button.saved-runs-screen__state-action")?.click());
    await act(async () => container?.querySelector<HTMLButtonElement>(".saved-runs-screen__back")?.click());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders loading and error states without exposing a blank surface", async () => {
    await mount(<SavedRunsScreen runs={[]} loading={true} error={null}
      onBack={vi.fn()} onRefresh={vi.fn()} onWatch={vi.fn()} />);
    expect(container?.querySelector(".saved-runs-screen__state")?.getAttribute("aria-busy")).toBe("true");
    expect(text()).toContain("Reading saved runs");
    await unmount();

    await mount(<SavedRunsScreen runs={[]} loading={false} error="Local catalogue offline"
      onBack={vi.fn()} onRefresh={vi.fn()} onWatch={vi.fn()} />);
    expect(container?.querySelector("[role='alert']")).not.toBeNull();
    expect(text()).toContain("Local catalogue offline");
    expect(text()).toContain("Try again");
  });
});

function savedRun(overrides: Partial<SavedRunSummary> = {}): SavedRunSummary {
  return {
    id: "run-default",
    name: "Unnamed test run",
    started_at: null,
    duration_seconds: 0,
    event_count: 0,
    status: "completed",
    model: null,
    base_url: "/api/recordings/run-default",
    agent_count: 0,
    living_count: 0,
    region_count: 0,
    agents: [],
    regions: [],
    ...overrides,
  };
}

async function mount(node: React.ReactNode): Promise<void> {
  root = createRoot(container as HTMLDivElement);
  await act(async () => root?.render(node));
}

async function unmount(): Promise<void> {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  container?.replaceChildren();
}

function text(): string {
  return container?.textContent ?? "";
}
