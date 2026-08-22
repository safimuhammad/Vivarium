/**
 * The run-stop seam, proved on its one rule: never assert a state the server
 * has not reported.
 */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunLifecycleStatus } from "../gateway/runConfig";
import { RunStopControl, runStopLabel } from "./RunStopControl";
import {
  resolveRunStatus,
  useRunStopController,
  type RunLifecycleCapability,
  type RunStopController,
} from "./runStopController";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.useFakeTimers();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A capability whose answers a test controls, one poll at a time. */
function capability(statuses: readonly RunLifecycleStatus[]): RunLifecycleCapability & {
  readonly stop: ReturnType<typeof vi.fn>;
  readonly getLifecycle: ReturnType<typeof vi.fn>;
} {
  const queue = [...statuses];
  return {
    stop: vi.fn(async () => ({ run_id: "r", status: "stopping" as const, warnings: [] })),
    getLifecycle: vi.fn(async () => ({ status: queue.shift() ?? statuses.at(-1) ?? "running" })),
  };
}

let latest: RunStopController | null = null;

function Probe(props: {
  readonly enabled: boolean;
  readonly client?: RunLifecycleCapability;
}): ReactElement {
  latest = useRunStopController({
    enabled: props.enabled,
    ...(props.client === undefined ? {} : { client: props.client }),
    pollMs: 10,
  });
  return <span data-status={latest.confirmedStatus ?? "none"} />;
}

async function mount(props: {
  readonly enabled: boolean;
  readonly client?: RunLifecycleCapability;
}): Promise<void> {
  await act(async () => root.render(<Probe {...props} />));
}

describe("useRunStopController", () => {
  it("sends nothing, and holds no timer, until a stop is actually asked for", async () => {
    const client = capability(["running"]);
    await mount({ enabled: true, client });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(client.stop).not.toHaveBeenCalled();
    expect(client.getLifecycle).not.toHaveBeenCalled();
  });

  it("refuses to act at all on a seam that was granted no capability", async () => {
    await mount({ enabled: true });
    await act(async () => latest?.requestStop());
    expect(latest?.requested).toBe(false);
  });

  it("refuses to act on a source that is not a live run", async () => {
    const client = capability(["running"]);
    await mount({ enabled: false, client });
    await act(async () => latest?.requestStop());
    expect(client.stop).not.toHaveBeenCalled();
    expect(latest?.requested).toBe(false);
  });

  it("never claims the run ended -- it asks the server until the server says so", async () => {
    const client = capability(["stopping", "stopping", "stopped"]);
    await mount({ enabled: true, client });

    await act(async () => { latest?.requestStop(); });
    expect(client.stop).toHaveBeenCalledOnce();
    // A 202 is an accepted REQUEST. Nothing is confirmed yet.
    expect(latest?.confirmedStatus).toBeNull();
    expect(latest?.requested).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(15); });
    expect(latest?.confirmedStatus).toBe("stopping");

    // The same answer twice is not a state change, and the loop must survive it.
    await act(async () => { await vi.advanceTimersByTimeAsync(15); });
    expect(latest?.confirmedStatus).toBe("stopping");
    expect(client.getLifecycle).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(15); });
    expect(latest?.confirmedStatus).toBe("stopped");

    const polls = client.getLifecycle.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    // Terminal: nothing more can happen, so nothing more is asked.
    expect(client.getLifecycle.mock.calls.length).toBe(polls);
  });

  it("puts the control back, loudly, when the stop could not be sent", async () => {
    const client = capability(["running"]);
    client.stop.mockRejectedValueOnce(new Error("/api/run/stop returned HTTP 409"));
    await mount({ enabled: true, client });

    await act(async () => { latest?.requestStop(); });
    expect(latest?.error).toBe("/api/run/stop returned HTTP 409");
    // The run is still breathing, so the viewer must be able to try again.
    expect(latest?.requested).toBe(false);
  });

  it("treats an unanswerable poll as silence, never as evidence of an ending", async () => {
    const client = capability(["running"]);
    client.getLifecycle.mockRejectedValue(new Error("socket closed"));
    await mount({ enabled: true, client });
    await act(async () => { latest?.requestStop(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(latest?.confirmedStatus).toBeNull();
    expect(latest?.error).toBeNull();
  });
});

describe("resolveRunStatus", () => {
  it("lets the more terminal of the two sources win", () => {
    // The frame's status rides the SSE heartbeat, and a stopping run takes the
    // stream down with it -- so the last thing the stream ever says can be
    // "running" while the run is already over.
    expect(resolveRunStatus("running", "stopped")).toBe("stopped");
    expect(resolveRunStatus("stopping", "running")).toBe("stopping");
    expect(resolveRunStatus("running", null)).toBe("running");
    expect(resolveRunStatus(null, "failed")).toBe("failed");
  });

  it("reports nothing rather than guessing when neither source knows", () => {
    expect(resolveRunStatus(null, null)).toBeNull();
    expect(resolveRunStatus("ready", null)).toBeNull();
    expect(resolveRunStatus("unknown", "unknown")).toBeNull();
  });
});

describe("runStopLabel", () => {
  it("separates asking from having ended", () => {
    expect(runStopLabel(null, false).text).toBe("End run");
    expect(runStopLabel("running", false).text).toBe("End run");
    // Asked for, not done. This is the only thing a local request may say.
    expect(runStopLabel("running", true).text).toBe("Ending…");
    expect(runStopLabel("stopping", false).text).toBe("Ending…");
    // Only the server's own word ends a run.
    expect(runStopLabel("stopped", false).text).toBe("Ended");
    expect(runStopLabel("failed", false).text).toBe("Ended");
  });

  it("offers the action only while there is a run left to end", () => {
    expect(runStopLabel("running", false).actionable).toBe(true);
    expect(runStopLabel("stopping", false).actionable).toBe(false);
    expect(runStopLabel("stopped", false).actionable).toBe(false);
  });
});

describe("RunStopControl", () => {
  async function show(props: Partial<Parameters<typeof RunStopControl>[0]> = {}): Promise<{
    readonly onStop: ReturnType<typeof vi.fn>;
  }> {
    const onStop = vi.fn();
    await act(async () => root.render(
      <RunStopControl status="running" requested={false} error={null} onStop={onStop} {...props} />,
    ));
    return { onStop };
  }

  const trigger = (): HTMLButtonElement => (
    container.querySelector<HTMLButtonElement>(".observer-hud__stop")!
  );
  const confirmDialog = (): HTMLElement | null => (
    container.querySelector<HTMLElement>(".observer-run-confirm")
  );

  it("never stops a run on one press", async () => {
    const { onStop } = await show();
    await act(async () => trigger().click());
    expect(onStop).not.toHaveBeenCalled();
    const dialog = confirmDialog()!;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("This cannot be undone.");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");

    await act(async () => container.querySelector<HTMLButtonElement>(
      ".observer-run-confirm__go",
    )!.click());
    expect(onStop).toHaveBeenCalledOnce();
    expect(confirmDialog()).toBeNull();
  });

  it("lets the question be declined, and hands focus back to what asked it", async () => {
    const { onStop } = await show();
    await act(async () => trigger().click());
    expect(document.activeElement).toBe(
      container.querySelector(".observer-run-confirm__go"),
    );

    await act(async () => [...container.querySelectorAll<HTMLButtonElement>(
      ".observer-run-confirm button",
    )].find((button) => button.textContent === "Keep watching")!.click());
    expect(onStop).not.toHaveBeenCalled();
    expect(confirmDialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("dismisses on Escape and marks the key handled, so nothing else acts on it", async () => {
    await show();
    await act(async () => trigger().click());
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => { confirmDialog()!.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(confirmDialog()).toBeNull();
  });

  it("reads the run, not the request", async () => {
    await show({ status: "running", requested: true });
    expect(trigger().textContent).toBe("Ending…");
    expect(trigger().disabled).toBe(true);

    await show({ status: "stopped", requested: false });
    expect(trigger().textContent).toBe("Ended");
    expect(trigger().disabled).toBe(true);
    expect(trigger().getAttribute("aria-label")).toContain("Nothing more will arrive.");
  });

  it("closes the question by itself if the run answers it first", async () => {
    await show({ status: "running" });
    await act(async () => trigger().click());
    expect(confirmDialog()).not.toBeNull();
    await show({ status: "stopped" });
    expect(confirmDialog()).toBeNull();
  });

  it("says out loud when the stop could not be sent", async () => {
    await show({ error: "/api/run/stop returned HTTP 409" });
    const alert = container.querySelector("[role='alert']");
    expect(alert?.textContent).toBe("/api/run/stop returned HTTP 409");
    // And the control is still offered, because the run is still running.
    expect(trigger().disabled).toBe(false);
  });
});
