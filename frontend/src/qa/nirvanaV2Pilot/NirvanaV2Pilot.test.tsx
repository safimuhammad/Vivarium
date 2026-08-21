import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NirvanaV2Pilot } from "./NirvanaV2Pilot";

describe("NirvanaV2Pilot", () => {
  it("renders a focused game viewport without production observer chrome", () => {
    const markup = renderToStaticMarkup(<NirvanaV2Pilot />);

    expect(markup).toMatch(/aria-label="Nirvana atlas pilot"/);
    expect(markup).toMatch(/<h1[^>]*>Nirvana<\/h1>/);
    expect(markup).toMatch(/Drag[^<]*(?:WASD|arrow keys)/i);
    expect(markup).toMatch(/Tile atlas pilot/i);

    expect(markup).not.toMatch(/World time|Chronicle|Selection|Archive|living|dead|ruins/i);
  });
});
