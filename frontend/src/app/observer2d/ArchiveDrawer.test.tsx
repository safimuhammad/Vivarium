import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ArchiveDrawer } from "./ArchiveDrawer";
import type { ArchiveCatalogueView } from "./publicViewModels";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("ArchiveDrawer", () => {
  it("renders bounded public checkpoint facts and stable selection callbacks", async () => {
    const onEnterCheckpoint = vi.fn();
    const onLoadOlder = vi.fn();
    const view: ArchiveCatalogueView = { state: "ready", checkpoints: [{ key: "line:17", label: "Shown moment 8", worldTime: 42, eventCursor: 8, reason: "Quiet interval", selected: true }], hasMore: true };
    const { container, root } = await render(<ArchiveDrawer view={view} archiveBound={false}
      controls={<div data-testid="camera-controls">Camera</div>}
      onEnterCheckpoint={onEnterCheckpoint} onLoadOlder={onLoadOlder}
      onReturnLive={vi.fn()} onClose={vi.fn()} />);

    expect(container.textContent).toMatch(/Shown moment 8.*Day 1, 12:00 AM.*Quiet interval/s);
    expect(container.textContent).not.toContain("World Time 42");
    expect(container.innerHTML).not.toMatch(/run[_-]?id|source[_-]?key|\.json|export/i);
    expect(container.querySelector(".observer-drawer--quiet")).not.toBeNull();
    const header = container.querySelector(".observer-drawer__header");
    expect(header?.querySelector(".observer-drawer__title h2")?.id)
      .toBe("archive-drawer-heading");
    expect(header?.querySelector(".observer-drawer__subtitle")?.textContent)
      .toContain("preserved moments");
    expect(header?.querySelector("[data-testid='camera-controls']")).toBeNull();
    const scroll = container.querySelector(".observer-drawer__scroll");
    expect(scroll?.firstElementChild?.classList.contains("observer-drawer__camera")).toBe(true);
    expect(scroll?.firstElementChild?.classList.contains("observer-drawer__camera--collapsible")).toBe(true);
    expect(scroll?.querySelector("summary")?.textContent).toBe("Camera & playback");
    expect(container.querySelector(".archive-drawer__intro")?.textContent)
      .toContain("1 moment shown");
    const checkpoint = container.querySelector<HTMLButtonElement>(".archive-drawer__checkpoint");
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.querySelector(".archive-drawer__checkpoint-icon[aria-hidden='true']"))
      .not.toBeNull();
    expect(checkpoint?.querySelector(".archive-drawer__checkpoint-title")?.textContent)
      .toContain("Shown moment 8");
    expect(checkpoint?.querySelector(".archive-drawer__time")?.textContent)
      .toBe("Day 1, 12:00 AM");
    expect(checkpoint?.querySelector(".archive-drawer__reason")?.textContent)
      .toBe("Quiet interval");
    expect(checkpoint?.querySelector(".archive-drawer__cursor")?.textContent)
      .toBe("Through event 8");
    expect(checkpoint?.querySelector(".archive-drawer__badge")?.textContent).toBe("Viewing");
    expect(checkpoint?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => container.querySelector<HTMLButtonElement>("button[aria-label='Enter Shown moment 8']")?.click());
    expect(onEnterCheckpoint).toHaveBeenCalledWith("line:17");
    await act(async () => container.querySelector<HTMLButtonElement>(".archive-drawer__more")?.click());
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it.each([
    [{ state: "loading", checkpoints: [], hasMore: false }, "Reading the archive"],
    [{ state: "empty", checkpoints: [], hasMore: false }, "No shown moments are available"],
    [{ state: "error", checkpoints: [], hasMore: false, message: "Archive is resting" }, "Archive is resting"],
  ] satisfies readonly [ArchiveCatalogueView, string][])('renders %s catalogue state', async (view, copy) => {
    const { container, root } = await render(<ArchiveDrawer view={view} archiveBound={false} onEnterCheckpoint={vi.fn()} onLoadOlder={vi.fn()} onReturnLive={vi.fn()} onClose={vi.fn()} />);
    expect(container.textContent).toContain(copy);
    expect(container.querySelector(".observer-drawer__empty")).not.toBeNull();
    expect(container.querySelector("[role='status'], [aria-live]")).toBeNull();
    await act(async () => root.unmount());
  });
});

async function render(node: React.ReactNode) { const container = document.createElement("div"); const root = createRoot(container); await act(async () => root.render(node)); return { container, root }; }
