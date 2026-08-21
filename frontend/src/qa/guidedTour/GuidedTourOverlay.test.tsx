import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GuidedTourOverlay } from "./GuidedTourOverlay";
import type { GuidedTourSnapshot } from "./guidedTourController";
import type { GuidedTourBeat } from "./guidedTourBeats";

const BEAT: GuidedTourBeat = {
  index: 12,
  total: 37,
  cursor: 29,
  presentedTime: 1_800_180_046,
  type: "resource_transferred",
  region: "nirvana",
  focus: { kind: "agent", id: "wanderer_002" },
  participants: "Mae → Allen",
  participantNames: ["Mae", "Allen"],
  watchLine: "Mae sends Allen energy — both turn to face each other",
  holdMs: 3_000,
  isDeadTravel: false,
  caption: "beat 12/37 — resource_transferred · nirvana",
};

function snapshot(overrides: Partial<GuidedTourSnapshot>): GuidedTourSnapshot {
  return {
    active: true,
    playing: true,
    beatIndex: 11,
    beat: BEAT,
    done: false,
    framingFits: true,
    ...overrides,
  };
}

describe("GuidedTourOverlay", () => {
  it("renders nothing when the tour is inactive", () => {
    expect(renderToStaticMarkup(
      <GuidedTourOverlay snapshot={snapshot({ active: false })} />,
    )).toBe("");
  });

  it("renders nothing when there is no current beat", () => {
    expect(renderToStaticMarkup(
      <GuidedTourOverlay snapshot={snapshot({ beat: null })} />,
    )).toBe("");
  });

  it("shows progress, region, participants, and the watch line while playing", () => {
    const markup = renderToStaticMarkup(<GuidedTourOverlay snapshot={snapshot({})} />);
    expect(markup).toContain("beat 12/37 — resource_transferred · nirvana");
    expect(markup).toContain("Mae → Allen");
    expect(markup).toContain("Mae sends Allen energy");
    expect(markup).toContain("Playing");
    expect(markup).toMatch(/space to pause\/resume/);
    expect(markup).toMatch(/→ to step \(forward only/);
    expect(markup).not.toContain("←");
  });

  it("tells the viewer how to go back, since backward stepping is disabled", () => {
    const markup = renderToStaticMarkup(<GuidedTourOverlay snapshot={snapshot({})} />);
    expect(markup).toMatch(/To go back:.*restart/i);
    expect(markup).toContain("Guided tour");
  });

  it("omits the framing note when the current beat's participants all fit", () => {
    const markup = renderToStaticMarkup(<GuidedTourOverlay snapshot={snapshot({ framingFits: true })} />);
    expect(markup).not.toContain("guided-tour-overlay__framing-note");
  });

  it("shows a framing note when the current beat's participants don't all fit", () => {
    const markup = renderToStaticMarkup(<GuidedTourOverlay snapshot={snapshot({ framingFits: false })} />);
    expect(markup).toContain("guided-tour-overlay__framing-note");
    expect(markup).toContain("spread wide");
  });

  it("shows Paused when the tour is stopped mid-beat", () => {
    const markup = renderToStaticMarkup(<GuidedTourOverlay snapshot={snapshot({ playing: false })} />);
    expect(markup).toContain("Paused");
  });

  it("shows Tour complete on the final held beat", () => {
    const markup = renderToStaticMarkup(
      <GuidedTourOverlay snapshot={snapshot({ playing: false, done: true })} />,
    );
    expect(markup).toContain("Tour complete");
  });

  it("omits the participants line when there are none", () => {
    const markup = renderToStaticMarkup(
      <GuidedTourOverlay snapshot={snapshot({ beat: { ...BEAT, participants: "" } })} />,
    );
    expect(markup).not.toContain("guided-tour-overlay__participants");
  });
});
