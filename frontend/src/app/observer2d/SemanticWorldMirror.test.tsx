import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { SemanticWorldMirror } from "./SemanticWorldMirror";
import {
  createSemanticWorldStore,
  type SemanticWorldView,
} from "./semanticWorld";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("SemanticWorldMirror", () => {
  it("renders stable buttons whose names include name, status, position, and current action", async () => {
    const onSelect = vi.fn();
    const onFollow = vi.fn();
    const view = semanticView();
    const store = createSemanticWorldStore();
    store.publish(view);
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<SemanticWorldMirror store={store}
      onSelect={onSelect} onFollow={onFollow} />));

    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
    expect(container.querySelector("h2")?.textContent).toBe("World subjects");
    expect(container.querySelector("section")?.classList).toContain("observer-visually-hidden");
    expect(container.querySelector("section")?.classList).not.toContain("observer-panel");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Nirvana Status: Exact, observed Position: Current world view Current action: No active action",
      "Aster Status: Alive Position: Nirvana, column 2, row 3 Current action: Moving Selected",
    ]);
    expect(buttons.map((button) => button.querySelectorAll("*").length)).toEqual([4, 5]);
    expect(buttons[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(container.innerHTML).not.toMatch(/agent_raw|stable-/);

    await act(async () => buttons[1]?.click());
    expect(onSelect).toHaveBeenCalledWith("subject-2");
    await act(async () => buttons[1]?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "f", bubbles: true,
    })));
    expect(onFollow).toHaveBeenCalledWith("subject-2");
    await act(async () => root.unmount());
  });

  it("can present the same semantic subjects visibly only inside Selection", async () => {
    const store = createSemanticWorldStore();
    store.publish(semanticView());
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<SemanticWorldMirror store={store}
      visuallyHidden={false} onSelect={vi.fn()} onFollow={vi.fn()} />));

    expect(container.querySelector("section")?.classList)
      .not.toContain("observer-visually-hidden");
    expect(container.querySelector("section")?.classList)
      .toContain("semantic-world-mirror--selection");
    expect(container.querySelector("h2")?.textContent).toBe("Visible in this region");
    expect(container.querySelectorAll("[data-subject-token]")).toHaveLength(2);
    await act(async () => root.unmount());
  });

  it("preserves the focused DOM node when the same token receives a tile/action update", async () => {
    const view = semanticView();
    const store = createSemanticWorldStore();
    store.publish(view);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onSelect = vi.fn();
    const onFollow = vi.fn();
    await act(async () => root.render(<SemanticWorldMirror store={store}
      onSelect={onSelect} onFollow={onFollow} />));
    const before = container.querySelector<HTMLButtonElement>("[data-subject-token='subject-2']")!;
    before.focus();

    const next: SemanticWorldView = {
      ...view,
      subjects: view.subjects.map((subject) => subject.token === "subject-2"
        ? { ...subject, position: "Nirvana, column 3, row 3", currentAction: "Speaking" }
        : subject),
    };
    await act(async () => store.publish(next));
    const after = container.querySelector<HTMLButtonElement>("[data-subject-token='subject-2']")!;
    expect(after).toBe(before);
    expect(document.activeElement).toBe(after);
    expect(after.getAttribute("aria-label")).toContain("Current action: Speaking");
    await act(async () => root.unmount());
    container.remove();
  });

  it("updates only the changed structurally shared subject row", async () => {
    const view = semanticView();
    const store = createSemanticWorldStore();
    store.publish(view);
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<SemanticWorldMirror store={store}
      onSelect={vi.fn()} onFollow={vi.fn()} />));
    const region = container.querySelector<HTMLButtonElement>(
      "[data-subject-token='subject-1']",
    )!;
    const agent = container.querySelector<HTMLButtonElement>(
      "[data-subject-token='subject-2']",
    )!;
    const regionMutations: MutationRecord[] = [];
    const agentMutations: MutationRecord[] = [];
    const regionObserver = new MutationObserver((records) => regionMutations.push(...records));
    const agentObserver = new MutationObserver((records) => agentMutations.push(...records));
    regionObserver.observe(region.closest("li")!, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    agentObserver.observe(agent.closest("li")!, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    const next: SemanticWorldView = {
      ...view,
      subjects: [
        view.subjects[0]!,
        { ...view.subjects[1]!, currentAction: "Speaking" },
      ],
    };

    await act(async () => {
      store.publish(next);
      await Promise.resolve();
    });

    expect(container.querySelector("[data-subject-token='subject-1']")).toBe(region);
    expect(container.querySelector("[data-subject-token='subject-2']")).toBe(agent);
    expect(regionMutations).toEqual([]);
    expect(agentMutations.length).toBeGreaterThan(0);
    expect(agent.getAttribute("aria-label")).toContain("Current action: Speaking");
    regionObserver.disconnect();
    agentObserver.disconnect();
    await act(async () => root.unmount());
  });

  it("does not reread fields from an unchanged row when a peer row changes", async () => {
    const view = semanticView();
    let unchangedNameReads = 0;
    const unchanged = {
      token: view.subjects[0]!.token,
      kind: view.subjects[0]!.kind,
      get name(): string {
        unchangedNameReads += 1;
        return view.subjects[0]!.name;
      },
      status: view.subjects[0]!.status,
      position: view.subjects[0]!.position,
      currentAction: view.subjects[0]!.currentAction,
      selected: view.subjects[0]!.selected,
      canFollow: view.subjects[0]!.canFollow,
    };
    const first: SemanticWorldView = { ...view, subjects: [unchanged, view.subjects[1]!] };
    const store = createSemanticWorldStore();
    store.publish(first);
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<SemanticWorldMirror store={store}
      onSelect={vi.fn()} onFollow={vi.fn()} />));
    expect(unchangedNameReads).toBeGreaterThan(0);
    unchangedNameReads = 0;

    await act(async () => store.publish({
      ...first,
      subjects: [unchanged, { ...first.subjects[1]!, currentAction: "Speaking" }],
    }));

    expect(unchangedNameReads).toBe(0);
    await act(async () => root.unmount());
  });
});

function semanticView(): SemanticWorldView {
  return {
    frameIdentity: { runId: "shown-run", sourceKey: "live:shown-run", revision: 3, firstCursor: 0, lastCursor: 9 },
    subjects: [
      { token: "subject-1", kind: "region", name: "Nirvana", status: "Exact, observed", position: "Current world view", currentAction: "No active action", selected: false, canFollow: false },
      { token: "subject-2", kind: "agent", name: "Aster", status: "Alive", position: "Nirvana, column 2, row 3", currentAction: "Moving", selected: true, canFollow: true },
    ],
  };
}
