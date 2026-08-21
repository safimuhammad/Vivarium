import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveAnnouncer, type LiveAnnouncement } from "./LiveAnnouncer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => vi.useRealTimers());

describe("LiveAnnouncer", () => {
  it("owns one stable throttled polite region and deduplicates semantic milestones", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const root = createRoot(container);
    const now: LiveAnnouncement = { key: "moment-9:hold", message: "A quiet exchange. Aster spoke." };
    await act(async () => root.render(<LiveAnnouncer announcement={now} />));
    const region = container.querySelector<HTMLElement>("[role='status']")!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("aria-atomic")).toBe("true");
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.textContent).toBe("");

    await act(async () => vi.advanceTimersByTime(500));
    await act(async () => root.render(<LiveAnnouncer announcement={{ ...now }} />));
    await act(async () => vi.advanceTimersByTime(249));
    expect(region.textContent).toBe("");
    await act(async () => vi.advanceTimersByTime(1));
    expect(region.getAttribute("aria-busy")).toBe("false");
    expect(region.textContent).toBe("A quiet exchange. Aster spoke.");

    await act(async () => root.render(<LiveAnnouncer announcement={now} />));
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(container.querySelector("[role='status']")).toBe(region);
    expect(region.textContent).toBe("A quiet exchange. Aster spoke.");
    await act(async () => root.unmount());
  });

  it("exposes a new semantic key as pending even when its message is unchanged", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const root = createRoot(container);
    const first: LiveAnnouncement = { key: "moment-1", message: "Caught up." };
    const second: LiveAnnouncement = { key: "backlog-2", message: "Caught up." };
    const onAnnounced = vi.fn();

    await act(async () => root.render(
      <LiveAnnouncer announcement={first} onAnnounced={onAnnounced} />,
    ));
    await act(async () => vi.advanceTimersByTime(750));
    const region = container.querySelector<HTMLElement>("[role='status']")!;
    expect(region.getAttribute("aria-busy")).toBe("false");
    expect(region.textContent).toBe("Caught up.");
    expect(onAnnounced).toHaveBeenLastCalledWith("moment-1");

    await act(async () => root.render(
      <LiveAnnouncer announcement={second} onAnnounced={onAnnounced} />,
    ));
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.textContent).toBe("Caught up.");
    await act(async () => vi.advanceTimersByTime(750));
    expect(region.getAttribute("aria-busy")).toBe("false");
    expect(region.textContent).toBe("Caught up.");
    expect(onAnnounced.mock.calls).toEqual([["moment-1"], ["backlog-2"]]);
    await act(async () => root.unmount());
  });

  it("ignores absent ambient candidates and keeps only the newest pending milestone", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<LiveAnnouncer announcement={null} />));
    await act(async () => root.render(<LiveAnnouncer announcement={{ key: "backlog-1", message: "The world moved ahead." }} />));
    await act(async () => root.render(<LiveAnnouncer announcement={{ key: "moment-2", message: "Shelter raised." }} />));
    await act(async () => vi.advanceTimersByTime(750));
    expect(container.querySelector("[role='status']")?.textContent).toBe("Shelter raised.");
    await act(async () => root.unmount());
  });
});
