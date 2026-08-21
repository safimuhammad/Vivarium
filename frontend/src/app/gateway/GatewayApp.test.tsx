import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayApp } from "./GatewayApp";
import { createMockRunLifecycleClient, MOCK_RUN_DEFAULTS_PAYLOAD } from "./mockRunLifecycleClient";
import { RunStartRejectedError } from "./runLifecycleClient";
import {
  parseRunDefaults,
  type RunConfig,
  type RunDefaults,
  type RunLifecycle,
  type RunStartAcknowledgement,
} from "./runConfig";
import type { RunLifecycleClient } from "./runLifecycleClient";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function defaults(): RunDefaults {
  return parseRunDefaults(MOCK_RUN_DEFAULTS_PAYLOAD);
}

/** A client whose every answer is set by the test. */
function stubClient(overrides: Partial<RunLifecycleClient> = {}): RunLifecycleClient {
  return {
    getDefaults: () => Promise.resolve(defaults()),
    getConfig: () => Promise.resolve(defaults().config),
    getLifecycle: () => Promise.resolve<RunLifecycle>({
      run_id: "run-1",
      status: "running",
      raw_status: "running",
    }),
    start: () => Promise.resolve<RunStartAcknowledgement>({
      run_id: "run-1",
      status: "starting",
      warnings: [],
    }),
    stop: () => Promise.resolve<RunStartAcknowledgement>({
      run_id: "run-1",
      status: "stopping",
      warnings: [],
    }),
    ...overrides,
  };
}

async function mount(props: Parameters<typeof GatewayApp>[0] = {}): Promise<void> {
  root = createRoot(container as HTMLDivElement);
  await act(async () => root?.render(
    <GatewayApp
      probeRecording={() => Promise.resolve(true)}
      renderObserver={(runId) => <main data-testid="observer">{runId}</main>}
      renderRecording={(base) => <main data-testid="recording">{base}</main>}
      {...props}
    />,
  ));
}

function text(): string {
  return container?.textContent ?? "";
}

function findButton(label: string | RegExp): HTMLButtonElement {
  const buttons = [...(container?.querySelectorAll("button") ?? [])];
  const match = buttons.find((button) => (
    typeof label === "string"
      ? (button.textContent ?? "").includes(label)
      : label.test(button.textContent ?? "")
  ));
  if (match === undefined) {
    throw new Error(
      `no button matching ${String(label)}; saw: ${buttons.map((b) => b.textContent).join(" | ")}`,
    );
  }
  return match as HTMLButtonElement;
}

async function click(label: string | RegExp): Promise<void> {
  const button = findButton(label);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("the landing page", () => {
  it("says this is a world that never ends, not something to be won", async () => {
    await mount({ client: stubClient() });

    expect(text()).toContain("Vivarium");
    expect(text()).toContain("A world that never ends");
    expect(text()).toContain("Watch a recording");
    expect(text()).toContain("Set the conditions");
  });

  it("offers the recording as a way in that starts nothing", async () => {
    await mount({ client: stubClient() });

    await click("Watch a recording");

    expect(container?.querySelector('[data-testid="recording"]')).not.toBeNull();
  });

  it("shows the recording way disabled, with a reason, when none is published", async () => {
    await mount({ client: stubClient(), probeRecording: () => Promise.resolve(false) });

    expect(findButton("Watch a recording").disabled).toBe(true);
    expect(text()).toContain("No recording is published");
  });
});

describe("the configuration screen", () => {
  it("reads every bound from the server rather than inventing one", async () => {
    const getDefaults = vi.fn(() => Promise.resolve(defaults()));
    await mount({ client: stubClient({ getDefaults }) });

    await click("Set the conditions");

    expect(getDefaults).toHaveBeenCalledOnce();
    const abundance = container?.querySelector<HTMLInputElement>('input[type="range"][max="3"]');
    expect(abundance?.min).toBe("0.25");
    expect(abundance?.step).toBe("0.05");
  });

  it("refuses to guess when the world's dials cannot be read", async () => {
    await mount({
      client: stubClient({ getDefaults: () => Promise.reject(new Error("no such endpoint")) }),
    });

    await click("Set the conditions");

    expect(text()).toContain("will not guess");
    expect(text()).toContain("no such endpoint");
    expect(container?.querySelector('input[type="range"]')).toBeNull();
  });

  it("shows the four regions as a locked display with no way to add or remove one", async () => {
    await mount({ client: stubClient() });

    await click("Set the conditions");

    expect(text()).toContain("Warm Springs");
    expect(text()).toContain("Nirvana West");
    expect(text()).toContain("These four are the world, always");
    const railButtons = [...(container?.querySelectorAll(".region-rail button") ?? [])];
    expect(railButtons).toHaveLength(0);
  });

  it("draws the mating floor and the home cost on the materials slider itself", async () => {
    await mount({ client: stubClient() });

    await click("Set the conditions");

    const markers = [...(container?.querySelectorAll(".knob-marker") ?? [])]
      .map((marker) => marker.textContent);
    expect(markers).toEqual(["a child30", "a home80"]);
  });

  it("tells the truth about the persona instead of the false version", async () => {
    await mount({ client: stubClient() });

    await click("Set the conditions");

    expect(text()).toContain("Your words stay.");
    expect(text()).toContain("It can contradict you. It cannot delete you.");
    expect(text().toLowerCase()).not.toContain("rewritten");
  });

  it("labels the seed as land shape, not as reproducibility", async () => {
    await mount({ client: stubClient() });

    await click("Set the conditions");

    expect(text()).toContain("The seed shapes the land itself");
    expect(text().toLowerCase()).not.toContain("reproduc");
  });

  it("computes the cost from the server's per-place rate and the roster", async () => {
    await mount({ client: stubClient() });

    await click("Set the conditions");

    // 4 beings × the cloud's own $3/being-hour, over the world's 30-minute
    // default. Both numbers are the server's; neither is written on this screen.
    expect(text()).toContain("about $12");
    expect(text()).toContain("about $6");
    expect(text()).toContain("$12 an hour for 4 beings — a breath every second or two.");
  });

  it("reads this machine as free and slow, and says so without a caveat", async () => {
    await mount({ client: stubClient() });

    await click("Set the conditions");
    await click("This machine");

    const surface = text();
    expect(surface).toContain("Costs nothing, and thinks slowly");
    expect(surface).toContain("minutes between breaths, one being at a time");
    expect(surface).toContain("costs nothing");
    expect(surface).not.toContain("$12");
    // Nothing to be indicative about: a local run has no bill to understate.
    expect(surface).not.toContain("Indicative, not a quote");
  });

  it("never shows a bare figure without saying it is indicative, not a quote", async () => {
    await mount({ client: stubClient() });

    await click("Set the conditions");

    // The prices behind the rate are unconfirmed, and a being's prompt grows
    // through a run, so a flat per-hour figure understates a long one.
    const surface = text();
    expect(surface).toContain("Indicative, not a quote");
    expect(surface).toContain("a being's prompt grows as its life lengthens");
    expect(surface).toContain("an order of magnitude, not a bill");
  });

  it("renders every one of the twelve knobs from the server's payload", async () => {
    await mount({ client: stubClient() });

    await click("Set the conditions");

    const surface = text();
    for (const label of [
      "The beings",
      "Starting energy",
      "Starting materials",
      "World abundance",
      "The shape of the land",
      "How long it runs",
      "Where the minds run",
      "How often a being reflects",
      "Children per being",
    ]) {
      expect(surface).toContain(label);
    }
    // The three per-being knobs are on the roster cards rather than in a knob row.
    expect(container?.querySelector('input[aria-label="Name of being 1"]')).not.toBeNull();
    expect(container?.querySelector('[aria-label="Where being 1 wakes"]')).not.toBeNull();
    expect(container?.querySelector('textarea[aria-label="Birth nature of being 1"]'))
      .not.toBeNull();
  });

  it("never offers a dial the spec keeps off this screen", async () => {
    await mount({ client: stubClient() });

    await click("Set the conditions");

    const surface = text().toLowerCase();
    for (const absent of [
      "compaction",
      "temperature",
      "break-in",
      "breakin",
      "memory root",
      "embedding",
      "proposal timeout",
      "conversion",
    ]) {
      expect(surface).not.toContain(absent);
    }
  });
});

describe("pressing let's go live", () => {
  it("waits honestly while the world is starting and enters only when it is running", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const statuses: RunLifecycle[] = [
      { run_id: "run-1", status: "starting", raw_status: "starting" },
      { run_id: "run-1", status: "starting", raw_status: "starting" },
      { run_id: "run-1", status: "running", raw_status: "running" },
    ];
    let poll = 0;
    await mount({
      now: () => clock,
      client: stubClient({
        getLifecycle: () => Promise.resolve(
          statuses[Math.min(poll++, statuses.length - 1)] as RunLifecycle,
        ),
      }),
    });

    await click("Set the conditions");
    await click("Let's go live");

    expect(text()).toContain("The world is being made");
    expect(container?.querySelector('[data-testid="observer"]')).toBeNull();

    for (const _ of [0, 1, 2]) {
      clock += 1_000;
      await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
    }

    expect(container?.querySelector('[data-testid="observer"]')?.textContent).toBe("run-1");
  });

  it("counts the seconds it has actually waited", async () => {
    vi.useFakeTimers();
    let clock = 0;
    await mount({
      now: () => clock,
      client: stubClient({
        getLifecycle: () => Promise.resolve<RunLifecycle>({
          run_id: "run-1",
          status: "starting",
          raw_status: "starting",
        }),
      }),
    });

    await click("Set the conditions");
    await click("Let's go live");
    clock = 4_000;
    await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });

    expect(text()).toContain("Waiting 4s");
    expect(text()).toContain("the world says starting");
  });

  it("carries the server's per-field complaints back to the conditions", async () => {
    await mount({
      client: stubClient({
        start: () => Promise.reject(new RunStartRejectedError(
          422,
          [{ field: "abundance", message: "outside the sane band" }],
          "rejected",
        )),
      }),
    });

    await click("Set the conditions");
    await click("Let's go live");

    expect(text()).toContain("abundance: outside the sane band");
    expect(container?.querySelector(".region-rail")).not.toBeNull();
  });

  it("shows the server's cautions about a bleak world while it is being made", async () => {
    vi.useFakeTimers();
    await mount({
      client: stubClient({
        start: () => Promise.resolve<RunStartAcknowledgement>({
          run_id: "run-1",
          status: "starting",
          warnings: [
            "Every being begins alone in a different region. They may never meet.",
            "The land regenerates about 0.12 energy a second against roughly 0.80.",
          ],
        }),
        getLifecycle: () => Promise.resolve<RunLifecycle>({
          run_id: "run-1",
          status: "starting",
          raw_status: "starting",
        }),
      }),
    });

    await click("Set the conditions");
    await click("Let's go live");

    // Accepted, not refused: the waiting screen is up and the cautions are on it.
    expect(text()).toContain("The world is being made");
    expect(text()).toContain("Every being begins alone");
    expect(text()).toContain("0.12 energy a second");
  });

  it("says plainly when a world could not be brought up", async () => {
    await mount({
      client: stubClient({
        getLifecycle: () => Promise.resolve<RunLifecycle>({
          run_id: "run-1",
          status: "failed",
          raw_status: "failed",
        }),
      }),
    });

    await click("Set the conditions");
    await click("Let's go live");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });

    expect(text()).toContain("The world did not begin");
    expect(container?.querySelector('[data-testid="observer"]')).toBeNull();
  });

  it("sends the conditions the viewer set, and nothing structural", async () => {
    const start = vi.fn((_config: RunConfig) => Promise.resolve<RunStartAcknowledgement>({
      run_id: "run-1",
      status: "starting",
      warnings: [],
    }));
    await mount({ client: stubClient({ start }) });

    await click("Set the conditions");
    await click("Let's go live");

    const sent = start.mock.calls[0]?.[0] as RunConfig;
    expect(Object.keys(sent).sort()).toEqual([
      "abundance",
      "beings",
      "duration_seconds",
      "max_offspring",
      "provider",
      "reflect_every_n_breaths",
      "seed",
    ]);
    expect(sent.beings).toHaveLength(4);
  });
});

describe("the mock seam", () => {
  it("drives the whole journey with no server at all", async () => {
    let clock = 0;
    const client = createMockRunLifecycleClient({ startingMs: 100, now: () => clock });

    await mount({ client, now: () => clock });
    await click("Set the conditions");
    await click("Let's go live");

    expect(text()).toContain("The world is being made");

    clock = 5_000;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });

    expect(container?.querySelector('[data-testid="observer"]')).not.toBeNull();
  });
});
