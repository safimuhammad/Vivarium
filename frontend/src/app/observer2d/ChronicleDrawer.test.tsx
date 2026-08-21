import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ChronicleDrawer } from "./ChronicleDrawer";
import type { ChronicleView } from "./publicViewModels";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("ChronicleDrawer", () => {
  it("pins Now, orders settled rows, and gives all future rows neutral copy", async () => {
    const onViewMoment = vi.fn();
    const view: ChronicleView = {
      now: { key: "now", firstCursor: 9, lastCursor: 9, priority: "featured", regionName: "Warm Springs", focusLabel: "Aster", timestamp: 9, title: "A quiet exchange", summary: "Aster spoke.", details: [{ label: "Place", value: "Warm Springs" }] },
      previous: [
        { key: "late", firstCursor: 7, lastCursor: 8, priority: "drama", regionName: null, focusLabel: "Unknown", timestamp: 8, title: "Something changed", summary: "The world changed." },
        { key: "early", firstCursor: 2, lastCursor: 2, priority: "ambient", regionName: null, focusLabel: "Unknown", timestamp: 2, title: "Something changed", summary: "The world changed." },
      ],
      upcoming: [{ sequence: 1, regionId: null, urgency: "drama" }],
      gaps: [{ firstCursor: 3, lastCursor: 5, chapter: "while-away", archiveAvailable: true }],
    };
    const { container, root } = await render(<ChronicleDrawer view={view} onViewMoment={onViewMoment} onOpenArchive={vi.fn()} onClose={vi.fn()} />);

    expect(container.querySelector("[data-chronicle-now]")?.textContent).toContain("A quiet exchange");
    expect(Array.from(container.querySelectorAll("[data-chronicle-previous]")).map((row) => row.textContent)).toEqual([
      expect.stringContaining("2"), expect.stringContaining("7–8"),
    ]);
    expect(container.querySelector("[data-chronicle-upcoming]")?.textContent).toContain("A moment is gathering");
    expect(container.querySelector("[data-chronicle-upcoming]")?.textContent).not.toMatch(/death|attack|agent/i);
    expect(container.querySelector("[data-chronicle-now] button")?.textContent).toBe("View moment");
    await act(async () => container.querySelector<HTMLButtonElement>("button[aria-label='View shown moment A quiet exchange']")?.click());
    expect(onViewMoment).toHaveBeenCalledWith("now");
    await act(async () => root.unmount());
  });
});

async function render(node: React.ReactNode) { const container = document.createElement("div"); const root = createRoot(container); await act(async () => root.render(node)); return { container, root }; }
