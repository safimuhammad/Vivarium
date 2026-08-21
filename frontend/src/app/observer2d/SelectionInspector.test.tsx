import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { SelectionInspector } from "./SelectionInspector";
import type { SelectionView } from "./publicViewModels";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("SelectionInspector", () => {
  it("renders public known facts and explicit unknowns with no being actions", async () => {
    const view: SelectionView = { kind: "agent", key: "raw_agent_id", title: "Moss", subtitle: "Being", completeness: "projected-partial", qualifier: "Observed; awaiting exact record", facts: [{ label: "Energy", value: "Unknown" }, { label: "Hoarding", value: "Unknown" }] };
    const onFocus = vi.fn();
    const { container, root } = await render(<SelectionInspector view={view} onFocus={onFocus} onClear={vi.fn()} onClose={vi.fn()} />);

    expect(container.textContent).toContain("Observed; awaiting exact record");
    expect(container.textContent).toContain("EnergyUnknown");
    expect(container.innerHTML).not.toContain("raw_agent_id");
    expect(container.textContent).not.toMatch(/attack|mate|move|build|command/i);
    expect(container.querySelector("[role='status'], [aria-live]")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("button[aria-label='Focus Moss']")?.click());
    expect(onFocus).toHaveBeenCalledWith("raw_agent_id");
    await act(async () => root.unmount());
  });

  it("keeps visible subject navigation available even before a subject is selected", async () => {
    const { container, root } = await render(<SelectionInspector view={null}
      subjectNavigation={<nav aria-label="Visible subjects">Aster</nav>}
      onFocus={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} />);

    expect(container.querySelector("[aria-label='Visible subjects']")?.textContent).toBe("Aster");
    expect(container.textContent).toContain("No subject selected.");
    await act(async () => root.unmount());
  });
});

async function render(node: React.ReactNode) { const container = document.createElement("div"); const root = createRoot(container); await act(async () => root.render(node)); return { container, root }; }
