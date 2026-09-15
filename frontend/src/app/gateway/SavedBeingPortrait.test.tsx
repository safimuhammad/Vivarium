import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveBeingVisualIdentity } from "../../renderer2d/production/actors/visualIdentity";
import { SavedBeingPortrait } from "./SavedBeingPortrait";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
});

describe("SavedBeingPortrait", () => {
  it("shares one atlas request across portraits even when one consumer unmounts", async () => {
    class SharedImage {
      static readonly instances: SharedImage[] = [];
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readonly width = 110;
      readonly height = 1_344;
      src = "";

      constructor() {
        SharedImage.instances.push(this);
      }

      triggerLoad(): void {
        this.onload?.();
      }
    }
    vi.stubGlobal("Image", SharedImage);
    root = createRoot(container!);
    await act(async () => {
      root?.render(
        <div>
          <SavedBeingPortrait id="saved-portrait-one" />
          <SavedBeingPortrait id="saved-portrait-two" />
        </div>,
      );
    });
    expect(SharedImage.instances).toHaveLength(1);

    await act(async () => {
      root?.render(<SavedBeingPortrait id="saved-portrait-two" />);
      SharedImage.instances[0]?.triggerLoad();
      await Promise.resolve();
    });
    expect(SharedImage.instances).toHaveLength(1);
    expect(SharedImage.instances[0]?.src).toContain("being-chibi");
  });

  it("exposes the same id-only visual identity used by the live actor", async () => {
    const id = "saved-portrait-parity";
    const identity = resolveBeingVisualIdentity(id);
    root = createRoot(container!);
    await act(async () => {
      root?.render(<SavedBeingPortrait id={id} persona="A later persona" />);
    });

    const portrait = container?.firstElementChild as HTMLElement | null;
    expect(portrait?.getAttribute("aria-hidden")).toBe("true");
    expect(portrait?.getAttribute("data-being-portrait")).toBe("true");
    expect(portrait?.dataset.characterId).toBe(identity.characterId);
    expect(portrait?.dataset.paletteVariant).toBe(identity.paletteVariant);
    expect(portrait?.dataset.accessory).toBe(identity.accessory);
    expect(portrait?.querySelector("canvas")?.width).toBe(22);
    expect(portrait?.querySelector("canvas")?.height).toBe(48);
    expect((portrait?.querySelector("canvas") as HTMLCanvasElement | null)?.style.imageRendering)
      .toBe("pixelated");
    const fallback = portrait?.querySelector("span") as HTMLElement | null;
    expect(fallback?.style.backgroundImage).toContain("being-chibi");
    expect(fallback?.style.imageRendering).toBe("pixelated");
  });

  it("does not remap the portrait when persona changes for the same saved id", async () => {
    const id = "saved-portrait-stable";
    root = createRoot(container!);
    await act(async () => {
      root?.render(<SavedBeingPortrait id={id} persona={null} />);
    });
    const first = container?.firstElementChild as HTMLElement;
    const firstIdentity = [first.dataset.characterId, first.dataset.paletteVariant, first.dataset.accessory];

    await act(async () => {
      root?.render(<SavedBeingPortrait id={id} persona="A newly available persona" />);
    });
    const second = container?.firstElementChild as HTMLElement;
    expect([second.dataset.characterId, second.dataset.paletteVariant, second.dataset.accessory])
      .toEqual(firstIdentity);
  });

  it("supports a compact native-size portrait for dense observer cards", async () => {
    root = createRoot(container!);
    await act(async () => {
      root?.render(<SavedBeingPortrait id="saved-portrait-compact" size="compact" />);
    });

    const portrait = container?.firstElementChild as HTMLElement | null;
    const canvas = portrait?.querySelector("canvas") as HTMLCanvasElement | null;
    expect(portrait?.getAttribute("data-being-portrait")).toBe("true");
    expect(portrait?.style.width).toBe("44px");
    expect(portrait?.style.height).toBe("44px");
    expect(portrait?.style.overflow).toBe("hidden");
    expect(canvas?.style.width).toBe("33px");
    expect(canvas?.style.height).toBe("72px");
    expect((portrait?.querySelector("span") as HTMLElement | null)?.style.transformOrigin)
      .toBe("top center");
  });
});
