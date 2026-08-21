import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ObserverHud } from "./ObserverHud";
import type { ObserverHudView } from "./publicViewModels";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("ObserverHud", () => {
  it("renders only compact region, human time, and world totals", async () => {
    const view: ObserverHudView = {
      worldTime: 1_719_120, regionDisplayName: "Nirvana",
      humanTimeLabel: "Day 20, 9:32 PM", livingAgents: 4, deadAgents: 0,
      unresolvedAgentStatuses: 1, homes: 0, ruins: 0,
      connection: "live", retryable: false, presentedCursor: 7, receivedCursor: 9, pendingMoments: 2,
      backlogState: "behind", backlogLabel: "Two moments waiting",
    };
    const { container, root } = await render(<ObserverHud view={view} />);

    // The region is the place being OBSERVED; the counts are the whole world's, so they say so.
    expect(container.textContent).toBe(
      "Nirvana · Day 20, 9:32 PM · World totals: 4 living · 0 dead · 0 homes · 0 ruins",
    );
    expect(container.getAttribute("data-run-id")).toBeNull();
    expect(container.textContent).not.toMatch(/World Time 1719120|Shown|Received|Pause|Story|Follow|Free/);
    expect(container.querySelector("button, select")).toBeNull();
    expect(container.querySelector("[role='status'], [aria-live]")).toBeNull();
    await act(async () => root.unmount());
  });
});

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(node));
  return { container, root };
}
