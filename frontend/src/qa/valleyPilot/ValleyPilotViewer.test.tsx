import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ValleyPilotViewer } from "./ValleyPilotViewer";

describe("ValleyPilotViewer", () => {
  it("renders a focused terrain viewport, its toggles, and its readout — no production chrome", () => {
    const markup = renderToStaticMarkup(<ValleyPilotViewer />);

    expect(markup).toMatch(/aria-label="Nirvana valley terrain pilot"/);
    expect(markup).toMatch(/aria-label="Pannable, zoomable pixel-art terrain map/);
    expect(markup).toMatch(/<h1[^>]*>Nirvana river valley<\/h1>/);
    expect(markup).toMatch(/Drag[^<]*(?:arrow keys)/i);
    expect(markup).toMatch(/wheel[^<]*(?:\+\/-|zoom)/i);

    // Both overlay toggles exist, start off, and the readout carries the
    // scene's own numbers — nothing hardcoded or re-derived.
    expect(markup).toMatch(/Walkability: off/);
    expect(markup).toMatch(/Bridges: off/);
    expect(markup).toMatch(/aria-pressed="false"/);
    expect(markup).toMatch(/<dt>Walkable<\/dt>/);
    expect(markup).toMatch(/<dt>Blocked<\/dt>/);
    expect(markup).toMatch(/<dt>Crossings<\/dt>/);
    expect(markup).toMatch(/<dt>Bridges<\/dt>/);

    expect(markup).not.toMatch(/World time|Chronicle|Selection|Archive|living|dead|ruins/i);
  });
});
