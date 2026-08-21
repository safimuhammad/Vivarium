import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ArchiveDrawer } from "./ArchiveDrawer";
import type { ArchiveCatalogueView } from "./publicViewModels";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("ArchiveDrawer", () => {
  it("renders bounded public checkpoint facts and stable selection callbacks", async () => {
    const onEnterCheckpoint = vi.fn();
    const view: ArchiveCatalogueView = { state: "ready", checkpoints: [{ key: "line:17", label: "Shown moment 8", worldTime: 42, eventCursor: 8, reason: "Quiet interval", selected: true }], hasMore: true };
    const { container, root } = await render(<ArchiveDrawer view={view} archiveBound={false} onEnterCheckpoint={onEnterCheckpoint} onLoadOlder={vi.fn()} onReturnLive={vi.fn()} onClose={vi.fn()} />);

    expect(container.textContent).toMatch(/Shown moment 8.*World Time 42.*Quiet interval/s);
    expect(container.innerHTML).not.toMatch(/run[_-]?id|source[_-]?key|\.json|export/i);
    await act(async () => container.querySelector<HTMLButtonElement>("button[aria-label='Enter Shown moment 8']")?.click());
    expect(onEnterCheckpoint).toHaveBeenCalledWith("line:17");
    await act(async () => root.unmount());
  });

  it.each([
    [{ state: "loading", checkpoints: [], hasMore: false }, "Reading the archive"],
    [{ state: "empty", checkpoints: [], hasMore: false }, "No shown moments are available"],
    [{ state: "error", checkpoints: [], hasMore: false, message: "Archive is resting" }, "Archive is resting"],
  ] satisfies readonly [ArchiveCatalogueView, string][])('renders %s catalogue state', async (view, copy) => {
    const { container, root } = await render(<ArchiveDrawer view={view} archiveBound={false} onEnterCheckpoint={vi.fn()} onLoadOlder={vi.fn()} onReturnLive={vi.fn()} onClose={vi.fn()} />);
    expect(container.textContent).toContain(copy);
    expect(container.querySelector("[role='status'], [aria-live]")).toBeNull();
    await act(async () => root.unmount());
  });
});

async function render(node: React.ReactNode) { const container = document.createElement("div"); const root = createRoot(container); await act(async () => root.render(node)); return { container, root }; }
