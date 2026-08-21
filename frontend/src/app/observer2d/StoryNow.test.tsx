import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { StoryNow } from "./StoryNow";
import type { ChronicleMomentRowView, StoryNowView } from "./publicViewModels";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("StoryNow", () => {
  it("renders active public story copy and routes its opaque key without exposing it", async () => {
    const onViewMoment = vi.fn();
    const view: StoryNowView = {
      kind: "moment",
      state: "active",
      moment: moment("private:moment:key"),
    };
    const { container, root } = await render(
      <StoryNow view={view} dialogueActive={false} onViewMoment={onViewMoment} />,
    );

    const surface = container.querySelector<HTMLElement>("[data-story-now]")!;
    expect(surface.getAttribute("data-story-kind")).toBe("moment");
    expect(surface.getAttribute("data-story-state")).toBe("active");
    expect(surface.getAttribute("aria-current")).toBe("true");
    expect(container.textContent).toContain("NowShelter raisedAster completed a shelter.Warm Springs");
    expect(container.innerHTML).not.toContain("private:moment:key");
    expect(container.querySelector("[role='status'],[aria-live]")).toBeNull();

    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(onViewMoment).toHaveBeenCalledWith("private:moment:key");
    await act(async () => root.unmount());
  });

  it("labels settled copy as Latest without marking it current", async () => {
    const view: StoryNowView = {
      kind: "moment",
      state: "latest",
      moment: moment("settled:key"),
    };
    const { container, root } = await render(
      <StoryNow view={view} dialogueActive={false} onViewMoment={vi.fn()} />,
    );

    expect(container.querySelector("[data-story-state='latest']")?.getAttribute("aria-current"))
      .toBeNull();
    expect(container.textContent).toContain("Latest");
    await act(async () => root.unmount());
  });

  it("renders a checkpoint as static present-state copy with bounded segment context", async () => {
    const view: StoryNowView = {
      kind: "checkpoint",
      state: "checkpoint",
      regionName: "Warm Springs",
      title: "A shelter has changed",
      summary: "Warm Springs now holds a changed shelter.",
      segmentIndex: 1,
      segmentCount: 3,
    };
    const { container, root } = await render(
      <StoryNow view={view} dialogueActive={false} onViewMoment={vi.fn()} />,
    );

    expect(container.textContent).toContain(
      "Between momentsA shelter has changedWarm Springs now holds a changed shelter.Warm SpringsChange 2 of 3",
    );
    expect(container.querySelector("button")).toBeNull();
    expect(container.innerHTML).not.toMatch(/entity|checkpointFocus|segmentIndex/);
    await act(async () => root.unmount());
  });

  it("yields the narrative slot to active dialogue", async () => {
    const view: StoryNowView = {
      kind: "moment",
      state: "active",
      moment: moment("private:key"),
    };
    const { container, root } = await render(
      <StoryNow view={view} dialogueActive onViewMoment={vi.fn()} />,
    );

    expect(container.querySelector("[data-story-now]")).toBeNull();
    await act(async () => root.unmount());
  });
});

function moment(key: string): ChronicleMomentRowView {
  return {
    key,
    firstCursor: 4,
    lastCursor: 4,
    priority: "featured",
    regionName: "Warm Springs",
    focusLabel: "Aster's home",
    timestamp: 42,
    title: "Shelter raised",
    summary: "Aster completed a shelter.",
  };
}

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(node));
  return { container, root };
}
