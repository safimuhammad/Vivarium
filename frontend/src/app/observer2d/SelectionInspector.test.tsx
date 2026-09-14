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
    const { container, root } = await render(<SelectionInspector view={view}
      controls={<div data-testid="camera-controls">Camera</div>}
      onFocus={onFocus} onClear={vi.fn()} onClose={vi.fn()} />);

    expect(container.textContent).toContain("Observed; awaiting exact record");
    expect(container.textContent).toContain("EnergyUnknown");
    expect(container.innerHTML).not.toContain("raw_agent_id");
    expect(container.textContent).not.toMatch(/attack|mate|move|build|command/i);
    expect(container.querySelector("[role='status'], [aria-live]")).toBeNull();
    expect(container.querySelector(".observer-drawer--quiet")).not.toBeNull();
    const header = container.querySelector(".observer-drawer__header");
    expect(header?.querySelector(".observer-drawer__title h2")?.id)
      .toBe("selection-inspector-heading");
    expect(header?.querySelector("[data-testid='camera-controls']")).toBeNull();
    const scroll = container.querySelector(".observer-drawer__scroll");
    expect(scroll?.firstElementChild?.classList.contains("observer-drawer__camera")).toBe(true);
    expect(scroll?.firstElementChild?.classList.contains("observer-drawer__camera--collapsible")).toBe(true);
    expect(scroll?.querySelector("summary")?.textContent).toBe("Camera & playback");
    expect(scroll?.querySelector(".selection-inspector__subject")).not.toBeNull();
    expect(scroll?.querySelector(".selection-inspector__browse")).not.toBeNull();
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
    expect(container.querySelector(".observer-drawer__empty")?.textContent)
      .toContain("Choose a being or place");
    expect(container.querySelector(".selection-inspector__subject")).toBeNull();
    expect(container.querySelector(".selection-inspector__browse")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("keeps actions above facts and puts compact facts before long prose", async () => {
    const view: SelectionView = {
      kind: "agent",
      key: "agent_007",
      title: "Moss",
      subtitle: "Being",
      completeness: "exact",
      qualifier: null,
      facts: [
        { label: "Identity", value: "A patient observer with a long public description that should remain available in the inspector without pushing the useful status below the first action." },
        { label: "Status", value: "Alive" },
        { label: "Region", value: "Warm Springs" },
        { label: "Notes", value: "A second long public note keeps the original row content intact while checking that prose rows remain together after compact facts." },
      ],
    };
    const { container, root } = await render(<SelectionInspector view={view}
      onFocus={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} />);

    const subject = container.querySelector<HTMLElement>(".selection-inspector__subject");
    expect(subject).not.toBeNull();
    const rows = Array.from(subject!.querySelectorAll("dl > div dt"), (label) => label.textContent);
    expect(rows).toEqual(["Status", "Region", "Identity", "Notes"]);
    const actions = subject!.querySelector(".selection-inspector__observer-actions");
    const facts = subject!.querySelector("dl");
    expect(actions).not.toBeNull();
    expect(facts).not.toBeNull();
    const children = Array.from(subject!.children);
    expect(children.indexOf(actions!)).toBeLessThan(children.indexOf(facts!));
    expect(subject!.querySelectorAll(".selection-inspector__prose")).toHaveLength(2);
    expect(subject!.textContent).toContain("A patient observer with a long public description");
    expect(subject!.textContent).toContain("A second long public note keeps the original row content intact");
    await act(async () => root.unmount());
  });
});

async function render(node: React.ReactNode) { const container = document.createElement("div"); const root = createRoot(container); await act(async () => root.render(node)); return { container, root }; }
