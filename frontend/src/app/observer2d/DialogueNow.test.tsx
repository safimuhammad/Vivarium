import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { DialogueNow } from "./DialogueNow";
import type { DialogueNowView } from "./publicViewModels";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("DialogueNow", () => {
  it("renders selectable sanitized visible copy and observer-only speaker focus", async () => {
    const onFocusSpeaker = vi.fn();
    const view: DialogueNowView = { speakerKey: "opaque", speakerName: "Aster", targetKey: null, targetName: "Bramble", regionName: "Warm Springs", visibleText: "The ridge", remote: true, hold: true, phase: "hold", priority: "featured" };
    const { container, root } = await render(<DialogueNow view={view}
      onFocusSpeaker={onFocusSpeaker} onFocusTarget={vi.fn()} />);

    expect(container.textContent).toContain("The ridge");
    expect(container.textContent).toContain("Across the atlas");
    expect(container.innerHTML).not.toContain("opaque");
    expect(container.querySelector("[data-dialogue-copy]")?.classList.contains("observer-copy--selectable")).toBe(true);
    expect(container.querySelector("[data-dialogue-speaker]")?.textContent).toBe("Aster");
    expect(container.querySelector("[data-dialogue-target]")?.textContent).toBe("Bramble");
    expect(container.querySelector("[data-dialogue-direction]")?.textContent).toBe("→");
    expect(container.textContent).not.toMatch(/Hold Now|Release Now/);
    await act(async () => container.querySelector<HTMLButtonElement>("button[aria-label='Focus Aster']")?.click());
    expect(onFocusSpeaker).toHaveBeenCalledWith("opaque");
    await act(async () => root.unmount());
  });
});

async function render(node: React.ReactNode) { const container = document.createElement("div"); const root = createRoot(container); await act(async () => root.render(node)); return { container, root }; }
