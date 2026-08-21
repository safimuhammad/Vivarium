import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { LivingAtlasChrome } from "./LivingAtlasChrome";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("LivingAtlasChrome surface intent", () => {
  it("keeps each visible edge label inside its accessible name", async () => {
    installMatchMedia();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <LivingAtlasChrome
          surface={{ kind: "closed" }}
          hud={<div>hud</div>}
          world={<div>world</div>}
          chronicle={<div>chronicle</div>}
          selection={<div>selection</div>}
          archive={<div>archive</div>}
          archiveAvailable={true}
          onSurfaceIntent={vi.fn()}
          onOpen={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    expect(container.querySelector("button[aria-label^='Open world']")?.getAttribute("aria-label")).toBe(
      "Open world — World Beings & land",
    );
    expect(
      container.querySelector("button[aria-label^='Open chronicle']")?.getAttribute("aria-label"),
    ).toBe("Open chronicle — Chronicle Living memory");
    expect(container.querySelector("button[aria-label^='Open archive']")?.getAttribute("aria-label")).toBe(
      "Open archive — Archive Preserved view",
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("prefetches World on keyboard focus without opening a surface", async () => {
    installMatchMedia();
    const onSurfaceIntent = vi.fn();
    const onOpen = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <LivingAtlasChrome
          surface={{ kind: "closed" }}
          hud={<div>hud</div>}
          world={<div>world</div>}
          chronicle={<div>chronicle</div>}
          selection={<div>selection</div>}
          archive={<div>archive</div>}
          archiveAvailable={true}
          onSurfaceIntent={onSurfaceIntent}
          onOpen={onOpen}
          onClose={vi.fn()}
        />,
      );
    });

    const world = container.querySelector<HTMLButtonElement>("button[aria-label^='Open world']");
    await act(async () => world?.focus());
    expect(onSurfaceIntent).toHaveBeenCalledWith("world");
    expect(onOpen).not.toHaveBeenCalled();
    expect(container.querySelector("[data-atlas-surface]")?.getAttribute("data-open")).toBe(
      "false",
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("prefetches World on pointer intent and keeps click ownership unchanged", async () => {
    installMatchMedia();
    const onSurfaceIntent = vi.fn();
    const onOpen = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <LivingAtlasChrome
          surface={{ kind: "closed" }}
          hud={<div>hud</div>}
          world={<div>world</div>}
          chronicle={<div>chronicle</div>}
          selection={<div>selection</div>}
          archive={<div>archive</div>}
          archiveAvailable={false}
          onSurfaceIntent={onSurfaceIntent}
          onOpen={onOpen}
          onClose={vi.fn()}
        />,
      );
    });

    const world = container.querySelector<HTMLButtonElement>("button[aria-label^='Open world']");
    await act(async () => {
      world?.dispatchEvent(new Event("pointerover", { bubbles: true }));
    });
    expect(onSurfaceIntent).toHaveBeenCalledWith("world");

    await act(async () => world?.click());
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith({ kind: "world" });
    await act(async () => root.unmount());
    container.remove();
  });
});
