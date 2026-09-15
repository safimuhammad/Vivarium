import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayApp } from "./GatewayApp";
import { useRunStopController } from "../observer2d/runStopController";
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
      listRecordings={() => Promise.resolve([{
        id: "saved-one", name: "Nirvana at dusk", started_at: 1789000000,
        duration_seconds: 120, event_count: 32, status: "stopped", model: "Qwen",
        base_url: "/api/recordings/saved-one", agent_count: 1, living_count: 1,
        region_count: 1, agents: [{ id: "allen", name: "Allen", persona: null, region: "nirvana", status: "alive" }],
        regions: [{ id: "nirvana", name: "Nirvana" }],
      }])}
      renderObserver={(runId) => <main data-testid="observer">{runId}</main>}
      renderRecording={(base, onExit) => <main data-testid="recording">{base}<button onClick={onExit}>Back to saved runs</button></main>}
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

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("the landing page", () => {
  it("says this is a world that never ends, not something to be won", async () => {
    await mount({ client: stubClient() });

    expect(text()).toContain("Vivarium");
    expect(text()).toContain("A world that never ends");
    expect(text()).toContain("Browse saved runs");
    expect(text()).toContain("Set the conditions");
  });

  it("browses saved worlds and replays the chosen recording without starting inference", async () => {
    const start = vi.fn();
    await mount({ client: stubClient({ start }) });
    await click("Browse saved runs");
    expect(text()).toContain("Nirvana at dusk");
    expect(text()).toContain("Allen");
    await click("Watch replay");
    expect(container?.querySelector('[data-testid="recording"]')?.textContent).toContain("/api/recordings/saved-one");
    expect(start).not.toHaveBeenCalled();
    await click("Back to saved runs");
    expect(text()).toContain("Nirvana at dusk");
  });

  it("keeps an empty saved-run library reachable", async () => {
    await mount({ client: stubClient(), listRecordings: () => Promise.resolve([]) });
    expect(findButton("Browse saved runs").disabled).toBe(false);
    await click("Browse saved runs");
    expect(container?.querySelector('[data-testid="recording"]')).toBeNull();
    expect(text()).toMatch(/no saved runs/i);
  });

  it("refreshes the current-world offer when returning from saved runs", async () => {
    const getLifecycle = vi.fn()
      .mockResolvedValueOnce({
        run_id: "run-before-library",
        status: "running",
        raw_status: "running",
      })
      .mockResolvedValueOnce({
        run_id: "run-after-library",
        status: "running",
        raw_status: "running",
      });
    await mount({ client: stubClient({ getLifecycle }) });

    await click("Browse saved runs");
    await click("Back to home");

    expect(getLifecycle).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Return to current world");
  });

  it("refreshes the current-world offer when returning from configuration", async () => {
    const getLifecycle = vi.fn()
      .mockResolvedValueOnce({
        run_id: "run-before-config",
        status: "running",
        raw_status: "running",
      })
      .mockResolvedValueOnce({
        run_id: "run-after-config",
        status: "running",
        raw_status: "running",
      });
    await mount({ client: stubClient({ getLifecycle }) });

    await click("Set the conditions");
    await click("Back");

    expect(getLifecycle).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Return to current world");
  });

  it("offers a read-only return path after reload and adopts the current world on click", async () => {
    const getLifecycle = vi.fn(() => Promise.resolve<RunLifecycle>({
      run_id: "run-current",
      status: "running",
      raw_status: "running",
    }));
    const start = vi.fn(() => Promise.resolve<RunStartAcknowledgement>({
      run_id: "run-new",
      status: "starting",
      warnings: [],
    }));
    const stop = vi.fn(() => Promise.resolve<RunStartAcknowledgement>({
      run_id: "run-current",
      status: "stopping",
      warnings: [],
    }));
    await mount({ client: stubClient({ getLifecycle, start, stop }) });

    expect(getLifecycle).toHaveBeenCalledOnce();
    expect(text()).toContain("Return to current world");
    expect(container?.querySelector('[data-testid="observer"]')).toBeNull();
    await click("Return to current world");

    expect(getLifecycle).toHaveBeenCalledTimes(2);
    expect(container?.querySelector('[data-testid="observer"]')?.textContent)
      .toBe("run-current");
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it.each(["unknown", "failed"] as const)(
    "does not offer a phantom return when the initial lifecycle is %s",
    async (status) => {
      await mount({
        client: stubClient({
          getLifecycle: () => Promise.resolve<RunLifecycle>({
            run_id: "run-current",
            status,
            raw_status: status,
          }),
        }),
      });

      expect(text()).not.toContain("Return to current world");
      expect(container?.querySelector('[data-testid="observer"]')).toBeNull();
    },
  );

  it.each([
    ["unknown", "The current world could not be confirmed"],
    ["failed", "The current world is no longer running"],
  ] as const)(
    "does not resume a discovered world when click-time lifecycle is %s",
    async (status, message) => {
      const getLifecycle = vi.fn()
        .mockResolvedValueOnce({
          run_id: "run-current",
          status: "running",
          raw_status: "running",
        })
        .mockResolvedValueOnce({
          run_id: "run-current",
          status,
          raw_status: status,
        });
      await mount({ client: stubClient({ getLifecycle }) });

      await click("Return to current world");

      expect(container?.querySelector('[data-testid="observer"]')).toBeNull();
      expect(text()).toContain(message);
      expect(text()).not.toContain("Return to current world");
    },
  );

  it("does not resume an old world when the current run changed before the click", async () => {
    const getLifecycle = vi.fn()
      .mockResolvedValueOnce({
        run_id: "run-old",
        status: "running",
        raw_status: "running",
      })
      .mockResolvedValueOnce({
        run_id: "run-new",
        status: "running",
        raw_status: "running",
      });
    await mount({ client: stubClient({ getLifecycle }) });

    await click("Return to current world");

    expect(container?.querySelector('[data-testid="observer"]')).toBeNull();
    expect(text()).toContain("changed before it could be reopened");
  });

  it("keeps the gateway in place when the click-time lifecycle check is offline", async () => {
    const getLifecycle = vi.fn()
      .mockResolvedValueOnce({
        run_id: "run-current",
        status: "running",
        raw_status: "running",
      })
      .mockRejectedValueOnce(new Error("offline"));
    await mount({ client: stubClient({ getLifecycle }) });

    await click("Return to current world");

    expect(container?.querySelector('[data-testid="observer"]')).toBeNull();
    expect(text()).toContain("could not be checked");
  });

  it("offers a usable retry after a transient lifecycle check failure", async () => {
    const getLifecycle = vi.fn()
      .mockResolvedValueOnce({
        run_id: "run-current",
        status: "running",
        raw_status: "running",
      })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        run_id: "run-current",
        status: "running",
        raw_status: "running",
      });
    await mount({ client: stubClient({ getLifecycle }) });

    await click("Return to current world");
    expect(text()).toContain("Try again");
    await click("Try again");

    expect(getLifecycle).toHaveBeenCalledTimes(3);
    expect(text()).toContain("Return to current world");
  });

  it("does not write a discovered world into an unmounted gateway", async () => {
    const lifecycle = deferred<RunLifecycle>();
    await mount({ client: stubClient({ getLifecycle: () => lifecycle.promise }) });

    await act(async () => {
      root?.unmount();
      root = null;
    });
    lifecycle.resolve({ run_id: "run-current", status: "running", raw_status: "running" });
    await act(async () => { await lifecycle.promise; });

    expect(container?.textContent).toBe("");
  });

  it("does not write a click-time result into an unmounted gateway", async () => {
    const lifecycle = deferred<RunLifecycle>();
    const getLifecycle = vi.fn()
      .mockResolvedValueOnce({
        run_id: "run-current",
        status: "running",
        raw_status: "running",
      })
      .mockReturnValueOnce(lifecycle.promise);
    await mount({ client: stubClient({ getLifecycle }) });

    await click("Return to current world");
    await act(async () => {
      root?.unmount();
      root = null;
    });
    lifecycle.resolve({ run_id: "run-current", status: "running", raw_status: "running" });
    await act(async () => { await lifecycle.promise; });

    expect(container?.textContent).toBe("");
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
    await click("The cloud");

    // Explicitly choose the cloud: 4 beings × its own $3/being-hour rate, over
    // the world's 30-minute default. Both numbers are the server's.
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
    await click("The cloud");

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

/**
 * The observer's real stop seam, mounted by the gateway the way production
 * mounts it: granted the gateway's own client, and reporting the ending back
 * through the callback the gateway handed down. Nothing here is a stand-in for
 * the rule under test — only the world it draws is missing.
 */
function StopProbe(props: {
  readonly client: RunLifecycleClient;
  readonly onRunEnded: () => void;
}): ReactElement {
  const stop = useRunStopController({
    enabled: true,
    client: props.client,
    onEnded: props.onRunEnded,
    pollMs: 10,
  });
  return (
    <main data-testid="observer">
      <button type="button" onClick={stop.requestStop}>End this run</button>
      <span data-testid="stop-error">{stop.error ?? ""}</span>
    </main>
  );
}

describe("ending the run", () => {
  it("comes back to the way in, ready for a NEW world", async () => {
    // Safi, during his own live test: "end run should bring back to the home
    // selection screen". The live world was never a route -- it is a state
    // inside this component -- so coming back is a state transition, not a
    // navigation, and it has to leave nothing of the ended run behind.
    let clock = 0;
    const getDefaults = vi.fn(() => Promise.resolve(defaults()));
    const getLifecycle = vi.fn(() => Promise.resolve<RunLifecycle>({
      run_id: "run-1",
      status: "running",
      raw_status: "running",
    }));
    await mount({
      now: () => clock,
      client: stubClient({ getDefaults, getLifecycle }),
      renderObserver: (runId, onRunEnded) => (
        <>
          <main data-testid="observer">{runId}</main>
          <button type="button" onClick={onRunEnded}>The run has ended</button>
        </>
      ),
    });

    await click("Set the conditions");
    expect(getDefaults).toHaveBeenCalledOnce();
    await click("Let's go live");
    clock = 5_000;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
    expect(container?.querySelector('[data-testid="observer"]')).not.toBeNull();

    const asked = getLifecycle.mock.calls.length;
    await click("The run has ended");

    expect(container?.querySelector('[data-testid="observer"]')).toBeNull();
    expect(text()).toContain("A world that never ends");
    expect(text()).toContain("Set the conditions");
    // It is told, quietly, that the world ended -- otherwise a world vanishing
    // and the way-in appearing is indistinguishable from something breaking.
    expect(text()).toContain("That world has ended");

    // The landing visit performs one fresh, read-only discovery. It must not
    // keep polling the ended run after that single answer.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
    expect(getLifecycle.mock.calls.length).toBe(asked + 1);

    // The next world is set from the world's own dials, read again -- not from
    // the sheet the ended run was started with.
    await click("Set the conditions");
    expect(getDefaults).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain("That world has ended");
  });

  it("keeps the world when the stop itself fails", async () => {
    // A stop that never happened must never cost the viewer the world: they
    // would have lost it without having ended it.
    const client = stubClient({
      stop: () => Promise.reject(new Error("/api/run/stop returned HTTP 500")),
    });
    vi.useFakeTimers();
    await mount({
      client,
      renderObserver: (_runId, onRunEnded) => (
        <StopProbe client={client} onRunEnded={onRunEnded} />
      ),
    });

    await click("Set the conditions");
    await click("Let's go live");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(container?.querySelector('[data-testid="observer"]')).not.toBeNull();

    await click("End this run");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

    expect(container?.querySelector('[data-testid="stop-error"]')?.textContent)
      .toBe("/api/run/stop returned HTTP 500");
    expect(container?.querySelector('[data-testid="observer"]')).not.toBeNull();
    expect(text()).not.toContain("That world has ended");
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
