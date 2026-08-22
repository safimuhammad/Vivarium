import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FollowSubjectControl } from "./FollowSubjectControl";
import type { FollowCandidateView, FollowSubjectReading } from "./followSubject";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const CANDIDATES: readonly FollowCandidateView[] = [
  { key: "agent_aster", name: "Aster", regionKey: "nirvana", regionDisplayName: "Nirvana" },
  { key: "agent_ilyra", name: "Ilyra", regionKey: "nirvana", regionDisplayName: "Nirvana" },
  {
    key: "agent_rhea",
    name: "Rhea",
    regionKey: "warm_springs",
    regionDisplayName: "Warm Springs",
  },
];

const AUTOMATIC: FollowSubjectReading = { key: null, name: null, pending: false };

function select(): HTMLSelectElement {
  const found = container.querySelector<HTMLSelectElement>(".observer-hud__follow-select");
  if (found === null) throw new Error("the follow control was not rendered");
  return found;
}

function wrapper(): HTMLElement {
  const found = container.querySelector<HTMLElement>(".observer-hud__follow");
  if (found === null) throw new Error("the follow control was not rendered");
  return found;
}

async function choose(value: string): Promise<void> {
  await act(async () => {
    select().value = value;
    select().dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("FollowSubjectControl", () => {
  it("NAMES the being the camera is on — the complaint this control exists for", async () => {
    await act(async () => root.render(
      <FollowSubjectControl candidates={CANDIDATES}
        subject={{ key: "agent_ilyra", name: "Ilyra", pending: false }}
        onFollow={vi.fn()} onRelease={vi.fn()} />,
    ));

    expect(select().value).toBe("agent_ilyra");
    expect(select().selectedOptions[0]?.textContent).toBe("Ilyra");
    expect(wrapper().getAttribute("data-follow")).toBe("following");
    expect(select().title).toContain("following Ilyra");
  });

  it("reads Automatic under director framing without guessing at the story's subject", async () => {
    await act(async () => root.render(
      <FollowSubjectControl candidates={CANDIDATES} subject={AUTOMATIC}
        onFollow={vi.fn()} onRelease={vi.fn()} />,
    ));

    expect(select().value).toBe("");
    expect(select().selectedOptions[0]?.textContent).toBe("Automatic");
    expect(wrapper().getAttribute("data-follow")).toBe("automatic");
  });

  it("lists the living world grouped by where they are, by public name only", async () => {
    await act(async () => root.render(
      <FollowSubjectControl candidates={CANDIDATES} subject={AUTOMATIC}
        onFollow={vi.fn()} onRelease={vi.fn()} />,
    ));

    expect([...container.querySelectorAll("optgroup")].map((group) => [
      group.label,
      [...group.querySelectorAll("option")].map((option) => option.textContent),
    ])).toEqual([
      ["Nirvana", ["Aster", "Ilyra"]],
      ["Warm Springs", ["Rhea"]],
    ]);
    expect(select().textContent).not.toContain("agent_");
  });

  it("asks to follow the chosen being, and to release when Automatic is chosen back", async () => {
    const onFollow = vi.fn();
    const onRelease = vi.fn();
    await act(async () => root.render(
      <FollowSubjectControl candidates={CANDIDATES} subject={AUTOMATIC}
        onFollow={onFollow} onRelease={onRelease} />,
    ));

    await choose("agent_rhea");
    expect(onFollow).toHaveBeenCalledWith("agent_rhea");

    await act(async () => root.render(
      <FollowSubjectControl candidates={CANDIDATES}
        subject={{ key: "agent_rhea", name: "Rhea", pending: false }}
        onFollow={onFollow} onRelease={onRelease} />,
    ));
    await choose("");
    expect(onRelease).toHaveBeenCalledOnce();
  });

  it("marks a pursuit that is still in flight rather than claiming to have arrived", async () => {
    await act(async () => root.render(
      <FollowSubjectControl candidates={CANDIDATES}
        subject={{ key: "agent_rhea", name: "Rhea", pending: true }}
        onFollow={vi.fn()} onRelease={vi.fn()} />,
    ));

    expect(wrapper().getAttribute("data-follow")).toBe("pending");
    expect(select().title).toContain("Bringing Rhea into view");
  });

  it("names a subject the roster does not carry instead of reading Automatic at it", async () => {
    // Following a HOME, or a being who dropped out of the roster mid-pursuit:
    // either way the camera is on something, and saying `Automatic` would be
    // the same silence this control was built to end.
    await act(async () => root.render(
      <FollowSubjectControl candidates={CANDIDATES} subject={AUTOMATIC}
        heldSubjectName="Aster's home" onFollow={vi.fn()} onRelease={vi.fn()} />,
    ));

    expect(wrapper().getAttribute("data-follow")).toBe("held");
    expect(select().selectedOptions[0]?.textContent).toBe("Aster's home");

    const onRelease = vi.fn();
    await act(async () => root.render(
      <FollowSubjectControl candidates={CANDIDATES} subject={AUTOMATIC}
        heldSubjectName="Aster's home" onFollow={vi.fn()} onRelease={onRelease} />,
    ));
    await choose("");
    expect(onRelease).toHaveBeenCalledOnce();
  });

  it("lists a followed being exactly once when they are also on the roster", async () => {
    await act(async () => root.render(
      <FollowSubjectControl candidates={CANDIDATES}
        subject={{ key: "agent_aster", name: "Aster", pending: false }}
        onFollow={vi.fn()} onRelease={vi.fn()} />,
    ));

    expect([...select().options].filter((option) => option.textContent === "Aster")).toHaveLength(1);
  });

  it("says out loud why a pursuit ended, where the viewer is already looking", async () => {
    await act(async () => root.render(
      <FollowSubjectControl candidates={CANDIDATES} subject={AUTOMATIC}
        notice="Aster has died. Story framing resumed."
        onFollow={vi.fn()} onRelease={vi.fn()} />,
    ));

    expect(container.querySelector(".observer-hud__follow-notice")?.textContent)
      .toBe("Aster has died. Story framing resumed.");
  });
});
