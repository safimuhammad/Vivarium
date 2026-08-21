import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { LivingAtlas2D, layoutAtlasRegions } from "./LivingAtlas2D";
import type { ObserverAtlasView } from "./publicViewModels";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("LivingAtlas2D", () => {
  it("draws only directed edges and observes a region without mutation actions", async () => {
    const onObserveRegion = vi.fn();
    const view: ObserverAtlasView = {
      activeStoryRegionId: "a", observedRegionId: null,
      regions: [
        { key: "a", displayName: "Warm Springs", description: "A basin", connections: [{ key: "b", displayName: "Nirvana" }], livingAgents: 2, unresolvedAgentStatuses: 0, homes: 1, ruins: 0, countsComplete: true, queuedImportance: { ambient: 1, featured: 0, drama: 0 }, active: true, observed: false, completeness: "exact" },
        { key: "b", displayName: "Nirvana", description: "Details awaiting a checkpoint", connections: [], livingAgents: 0, unresolvedAgentStatuses: 1, homes: 0, ruins: 0, countsComplete: false, queuedImportance: { ambient: 0, featured: 0, drama: 0 }, active: false, observed: false, completeness: "projected-partial" },
      ],
    };
    const { container, root } = await render(<LivingAtlas2D view={view} onObserveRegion={onObserveRegion} onInspectRegion={vi.fn()} />);

    expect(container.querySelectorAll("[data-atlas-edge]")).toHaveLength(1);
    expect(container.querySelector("[data-atlas-edge]")?.getAttribute("marker-end"))
      .toBe("url(#living-atlas-arrowhead)");
    expect(container.querySelector("[data-atlas-edge]")?.getAttribute("aria-label"))
      .toBe("Warm Springs leads to Nirvana");
    expect(container.querySelector("svg[aria-label='Directed region paths']")).not.toBeNull();
    expect(container.querySelectorAll(".living-atlas-2d__node")).toHaveLength(2);
    expect(container.querySelector(".living-atlas-2d__node[data-active='true']"))
      .not.toBeNull();
    const observeNirvana = [...container.querySelectorAll<HTMLButtonElement>(".living-atlas-2d__observe")]
      .find((candidate) => candidate.dataset.regionKey === "b");
    await act(async () => observeNirvana?.click());
    expect(onObserveRegion).toHaveBeenCalledWith("b");
    expect(container.textContent).not.toMatch(/attack|move being|command/i);
    const nirvana = observeNirvana;
    expect(nirvana?.textContent).toMatch(/0 known living · 1 unresolved · at least 0 homes · at least 0 ruins/i);
    expect(nirvana?.textContent).toContain("Awaiting exact checkpoint");
    expect(nirvana?.textContent).not.toContain("0 living · 0 homes · 0 ruins");
    await act(async () => root.unmount());
  });

  it("uses deterministic compact node positions and distinguishes the observed region", async () => {
    const view: ObserverAtlasView = {
      activeStoryRegionId: "b", observedRegionId: "c",
      regions: [
        region("a", "Warm Springs", ["b"]),
        region("b", "Nirvana", ["c"]),
        region("c", "Waste", []),
      ],
    };
    const first = await render(<LivingAtlas2D view={view} onObserveRegion={vi.fn()} onInspectRegion={vi.fn()} />);
    const positions = [...first.container.querySelectorAll<HTMLElement>(".living-atlas-2d__node")]
      .map((node) => node.getAttribute("style"));
    expect(new Set(positions).size).toBe(3);
    expect(first.container.querySelector(".living-atlas-2d__node[data-observed='true']")
      ?.textContent).toContain("Waste");
    expect(first.container.querySelectorAll("[data-atlas-edge]")).toHaveLength(2);
    expect(first.container.querySelectorAll(".living-atlas-2d__node .living-atlas-2d__pip")).toHaveLength(9);
    expect(first.container.querySelectorAll(".living-atlas-2d__detail .living-atlas-2d__pip")).toHaveLength(0);
    await act(async () => first.root.unmount());

    const second = await render(<LivingAtlas2D view={view} onObserveRegion={vi.fn()} onInspectRegion={vi.fn()} />);
    expect([...second.container.querySelectorAll<HTMLElement>(".living-atlas-2d__node")]
      .map((node) => node.getAttribute("style"))).toEqual(positions);
    await act(async () => second.root.unmount());
  });

  it("lays out eight single-control pins without collisions and inspects from one detail footer", async () => {
    const onInspectRegion = vi.fn();
    const keys = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const positions = [...layoutAtlasRegions([...keys].reverse()).values()];
    expect(positions).toHaveLength(8);
    for (let left = 0; left < positions.length; left += 1) {
      for (let right = left + 1; right < positions.length; right += 1) {
        const dx = Math.abs(positions[left]!.x - positions[right]!.x);
        const dy = Math.abs(positions[left]!.y - positions[right]!.y);
        expect(dx >= 62 || dy >= 65).toBe(true);
      }
    }

    const view: ObserverAtlasView = {
      activeStoryRegionId: "a",
      observedRegionId: "h",
      regions: keys.map((key, index) => ({
        ...region(key, `Region ${key.toUpperCase()}`, index < keys.length - 1 ? [keys[index + 1]!] : []),
        active: key === "a",
        observed: key === "h",
      })),
    };
    const rendered = await render(<LivingAtlas2D view={view} onObserveRegion={vi.fn()}
      onInspectRegion={onInspectRegion} />);

    expect(rendered.container.querySelectorAll(".living-atlas-2d__observe")).toHaveLength(8);
    expect(rendered.container.querySelectorAll(".living-atlas-2d__inspect")).toHaveLength(1);
    expect(rendered.container.querySelector(".living-atlas-2d__detail")?.textContent)
      .toMatch(/Region H.*Region H description.*2 living.*1 homes/s);
    const inspect = rendered.container.querySelector<HTMLButtonElement>(".living-atlas-2d__inspect");
    expect(inspect?.getAttribute("aria-label")).toBe("Inspect Region H");
    await act(async () => inspect?.click());
    expect(onInspectRegion).toHaveBeenCalledTimes(1);
    expect(onInspectRegion).toHaveBeenCalledWith("h");
    await act(async () => rendered.root.unmount());
  });
});

function region(key: string, displayName: string, connections: readonly string[]) {
  return {
    key,
    displayName,
    description: `${displayName} description`,
    connections: connections.map((connection) => ({ key: connection, displayName: connection.toUpperCase() })),
    livingAgents: 2,
    unresolvedAgentStatuses: 0,
    homes: 1,
    ruins: 0,
    countsComplete: true,
    queuedImportance: { ambient: 1, featured: 0, drama: 0 },
    active: false,
    observed: key === "c",
    completeness: "exact" as const,
  };
}

async function render(node: React.ReactNode) { const container = document.createElement("div"); const root = createRoot(container); await act(async () => root.render(node)); return { container, root }; }
