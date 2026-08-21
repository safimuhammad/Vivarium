import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { makeEventEnvelope } from "../../test/fixtures";
import {
  selectPresentedHistory,
  type ChronicleHistoryEntry,
  type PresentedHistoryEvent,
} from "../historySelectors";
import { selectStoryRibbonBeats } from "./narrativeBeat";
import { StoryRibbon } from "./StoryRibbon";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function fixtureBeat(): ReturnType<typeof selectStoryRibbonBeats>[number] {
  const entry = makeEventEnvelope().events[0];
  if (!entry) {
    throw new Error("The event fixture must include one event.");
  }
  const history: ChronicleHistoryEntry[] = [{ kind: "event", entry }];
  const presented = selectPresentedHistory(history).filter(
    (item): item is PresentedHistoryEvent => item.kind === "event",
  );
  const beat = selectStoryRibbonBeats(presented, "desktop")[0];
  if (!beat) {
    throw new Error("Expected one story beat.");
  }
  return beat;
}

describe("StoryRibbon", () => {
  it("renders passive presented copy in a semantic chooser", async () => {
    const beat = fixtureBeat();
    const onChoose = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<StoryRibbon beats={[beat]} onChoose={onChoose} />);
    });

    const button = container.querySelector<HTMLButtonElement>("button[data-event-cursor]");
    expect(button?.type).toBe("button");
    expect(button?.dataset.eventCursor).toBe(String(beat.cursor));
    expect(button?.textContent).toContain(beat.label);
    expect(button?.textContent).toContain(beat.detail);
    expect(container.querySelector("input, select, [data-playback-control]")).toBeNull();

    await act(async () => button?.click());
    expect(onChoose).toHaveBeenCalledWith(beat);

    await act(async () => root.unmount());
  });

  it("renders nothing when no beats survive attention selection", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<StoryRibbon beats={[]} onChoose={vi.fn()} />);
    });

    expect(container.innerHTML).toBe("");
    await act(async () => root.unmount());
  });

  it("does not promise map focus when the beat has no focus target", async () => {
    const beat = { ...fixtureBeat(), focus: null };
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<StoryRibbon beats={[beat]} onChoose={vi.fn()} />);
    });

    const button = container.querySelector<HTMLButtonElement>("button[data-event-cursor]");
    expect(button?.ariaLabel).toBe(
      `Open chronicle at event ${beat.cursorWindow}: ${beat.label}`,
    );
    expect(button?.ariaLabel).not.toContain("Focus");

    await act(async () => root.unmount());
  });
});
