import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { makeWorld } from "../../test/fixtures";
import {
  WorldPresencePanel,
  WorldPresencePanelFallback,
} from "./WorldPresencePanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("WorldPresencePanel", () => {
  it("renders current beings and the existing world-condition contract", async () => {
    const world = makeWorld();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <WorldPresencePanel
          agents={world.agents}
          snapshot={world}
          onSelect={vi.fn()}
        />,
      );
    });

    expect(container.querySelector(".presence-rail")?.textContent).toContain("Aster");
    expect(container.querySelector(".agent-place")?.textContent).toContain("meadow");
    expect(container.querySelector("[data-testid='world-condition']")?.getAttribute(
      "data-condition-living-count",
    )).toBe("1");
    expect(container.querySelector("[data-testid='world-condition']")?.getAttribute(
      "data-condition-fallen-count",
    )).toBe("1");

    await act(async () => root.unmount());
  });

  it("selects the chosen being exactly once", async () => {
    const world = makeWorld();
    const onSelect = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <WorldPresencePanel
          agents={world.agents}
          snapshot={world}
          onSelect={onSelect}
        />,
      );
    });
    const aster = Array.from(container.querySelectorAll<HTMLButtonElement>(".agent-row"))
      .find((button) => button.textContent?.includes("Aster"));
    await act(async () => aster?.click());

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("agent_001");
    await act(async () => root.unmount());
  });

  it("keeps waiting and loading states accessible and layout-stable", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <>
          <WorldPresencePanel agents={[]} snapshot={null} onSelect={vi.fn()} />
          <WorldPresencePanelFallback />
        </>,
      );
    });

    expect(container.querySelector("[data-testid='world-condition']")?.getAttribute(
      "data-condition-state",
    )).toBe("waiting");
    const fallback = container.querySelector("[data-testid='world-presence-loading']");
    expect(fallback?.getAttribute("role")).toBe("status");
    expect(fallback?.getAttribute("aria-busy")).toBe("true");
    expect(fallback?.classList.contains("presence-rail")).toBe(true);
    expect(fallback?.textContent).toContain("Reading the living atlas");

    await act(async () => root.unmount());
  });
});
