/**
 * Geometric invariants of the killfeed overlay, pinned at the stylesheet.
 *
 * Two defects were found by looking at a native-size still, and neither could
 * have been caught by rendering the surface: jsdom does no layout, so a DOM test
 * can assert what is on screen but never *where* it is or *how tall* it is. What
 * both defects had in common is that a number was tuned twice, in two places,
 * against each other:
 *
 * 1. The narrative NOW card reserved `right: 23rem` (368px) for a band whose own
 *    footprint is 52px + 20rem = 23.25rem (372px). The card therefore already
 *    overlapped the band by 4px, and the only thing keeping its "View moment"
 *    button clickable was the card's own padding. The overlay was eating a
 *    control that belongs to the world.
 * 2. Flow children inherited the flex default `flex-shrink: 1` inside a
 *    `max-height` column, so every card was squeezed BELOW its own content
 *    height (measured: 52px box around 85px of content) and its meta line was
 *    painted outside its scrim, over the card beneath. That is what read as a
 *    card "garbling" as it left the top of the band.
 *
 * These tests therefore assert the *rule* rather than the pixels: one set of
 * geometry numbers, consumed everywhere, and nothing in the flow may shrink.
 * Native-size measurement of the result lives in the evidence stills.
 */

import { describe, expect, it } from "vitest";

import CSS from "./ChronicleKillfeed.css?raw";

function bodyFrom(open: number, what: string): string {
  const close = CSS.indexOf("}", open);
  if (open < 0 || close < 0) throw new Error(`unterminated rule at ${what}`);
  return CSS.slice(open + 1, close);
}

/** The declaration block of the first rule whose selector list matches. */
function block(selectorFragment: string): string {
  const index = CSS.indexOf(selectorFragment);
  if (index < 0) throw new Error(`no rule mentioning ${selectorFragment}`);
  return bodyFrom(CSS.indexOf("{", index), selectorFragment);
}

/** The same, with the comments stripped: what the browser will actually read. */
function declarations(selectorFragment: string): string {
  return block(selectorFragment).replace(/\/\*[\s\S]*?\*\//gu, "");
}

/** The reader deliberately overrides the older killfeed rules later in the sheet. */
function latestDeclarations(selectorFragment: string): string {
  const index = CSS.lastIndexOf(selectorFragment);
  if (index < 0) throw new Error(`no rule mentioning ${selectorFragment}`);
  return bodyFrom(CSS.indexOf("{", index), selectorFragment).replace(/\/\*[\s\S]*?\*\//gu, "");
}

/** The declaration block that *contains* a given declaration. */
function blockDeclaring(declaration: string): string {
  const index = CSS.indexOf(declaration);
  if (index < 0) throw new Error(`nothing declares ${declaration}`);
  return bodyFrom(CSS.lastIndexOf("{", index), declaration);
}

describe("killfeed band geometry", () => {
  it("declares the rail, the band and the gap once, and derives the reserve from them", () => {
    const declared = blockDeclaring("--killfeed-reserve:");
    expect(declared).toMatch(/--killfeed-rail:\s*52px/u);
    // Owner direction: the band is 10-20% of the viewport. The clamp bounds are a
    // legibility floor and a restraint ceiling; 18vw is the width itself.
    expect(declared).toMatch(/--killfeed-band:\s*clamp\(15rem, 18vw, 22rem\)/u);
    // A gap of zero would put the yielding surface flush against the band; the
    // defect was a NEGATIVE gap, so this is the invariant that broke.
    const gap = /--killfeed-gap:\s*(\d+)px/u.exec(declared);
    expect(gap).not.toBeNull();
    expect(Number(gap![1])).toBeGreaterThan(0);
    expect(declared).toMatch(
      /--killfeed-reserve:\s*calc\(\s*var\(--killfeed-rail\)\s*\+\s*var\(--killfeed-band\)\s*\+\s*var\(--killfeed-gap\)\s*\)/u,
    );
  });

  it("publishes the open Chronicle lane to the shell HUD", () => {
    const declared = blockDeclaring("--observer-active-drawer-width:");

    expect(declared).toMatch(/--observer-active-drawer-width:\s*var\(--killfeed-band\)/u);
    expect(declared).toMatch(
      /--observer-active-drawer-right:\s*calc\(\s*var\(--killfeed-rail\)\s*\+\s*env\(safe-area-inset-right\)\s*\)/u,
    );
    expect(declared).toMatch(/--observer-active-drawer-gap:\s*var\(--killfeed-gap\)/u);
  });

  it("positions the band itself from those variables, never from a second constant", () => {
    const band = blockDeclaring("--observer-drawer-width:");
    expect(band).toContain("var(--killfeed-rail)");
    expect(band).toMatch(/--observer-drawer-width:\s*var\(--killfeed-band\)/u);
    expect(band).not.toMatch(/inset:[^;]*\b52px\b/u);
  });

  it("makes every surface that yields to the band reserve the WHOLE band", () => {
    const yielding = block(".vivarium-2d-app:has(.chronicle-killfeed) .dialogue-now");
    expect(yielding).toMatch(/right:\s*calc\(var\(--killfeed-reserve\)/u);
    expect(yielding).toContain("var(--killfeed-reserve)");
    // The 23rem that put "View moment" under the feed must not come back.
    expect(yielding).not.toMatch(/right:\s*\d+(\.\d+)?rem/u);
  });

  it("no longer reserves anything for the retired NOW card", () => {
    // The card that used to share the narrative slot was removed, so nothing in
    // this stylesheet may still be tuned against it.
    expect(CSS).not.toContain(".story-now");
  });
});

describe("killfeed flow sizing", () => {
  it("gives the flow the WHOLE column rather than a hand-tuned viewport fraction", () => {
    const flow = declarations(".chronicle-killfeed .chronicle-killfeed__flow {");
    // Growth, not a fraction: the drawer's own height is definite (it is inset
    // top and bottom), so `flex: 1 1 auto` still resolves a definite box for
    // `fittingCount` to measure -- it is simply the room actually available.
    expect(flow).toMatch(/flex:\s*1 1 auto/u);
    expect(flow).not.toMatch(/height:\s*\d+vh/u);
    // Its parent zone has to grow too, or the flow grows into nothing.
    expect(CSS).toMatch(
      /\.chronicle-killfeed\.observer-drawer > \.chronicle-killfeed__bottom \{\s*flex:\s*1 1 auto;/u,
    );
  });

  it("keeps a phone's band bounded so the drawer cannot eat the world", () => {
    const mobile = CSS.slice(CSS.indexOf("@media (max-width: 760px)"));
    expect(mobile).toMatch(/\.chronicle-killfeed__flow \{[^}]*flex:\s*none/u);
    expect(mobile).toMatch(/\.chronicle-killfeed__flow \{[^}]*height:\s*34vh/u);
  });

  it("never shrinks a card below its own content", () => {
    const flowChildren = block(".chronicle-killfeed__flow > *");
    expect(flowChildren).toMatch(/flex:\s*none/u);
  });

  it("clips a card to its own scrim so nothing can paint over its neighbour", () => {
    const card = block(".chronicle-killfeed .chronicle-killfeed__card {");
    expect(card).toMatch(/overflow:\s*hidden/u);
  });
});

describe("expressive Chronicle reader layout", () => {
  it("uses the parent header lane and reports the exact drawer width it renders", () => {
    const reader = declarations(".vivarium-2d-app .chronicle-killfeed--reader.observer-drawer");

    expect(reader).toMatch(/--observer-active-drawer-width:\s*var\(--killfeed-band\)/u);
    expect(reader).toMatch(/--observer-drawer-width:\s*var\(--killfeed-band\)/u);
    expect(reader).toMatch(/width:\s*var\(--killfeed-band\)/u);
    expect(reader).toMatch(/inset:\s*72px/u);
  });

  it("keeps retained cards in an actual scroll reader instead of a clipped event band", () => {
    const reader = declarations(".chronicle-killfeed--reader .chronicle-killfeed__reader");
    const flow = declarations(".chronicle-killfeed--reader .chronicle-killfeed__flow");

    expect(reader).toMatch(/overflow-y:\s*auto/u);
    expect(reader).toMatch(/flex:\s*1 1 auto/u);
    expect(flow).toMatch(/overflow:\s*visible/u);
    expect(flow).toMatch(/align-content:\s*start/u);
  });

  it("keeps routine cards compact and reveals secondary actions only for an active row", () => {
    const card = latestDeclarations(".chronicle-killfeed--reader .chronicle-killfeed__card {");
    const actionsIndex = CSS.indexOf("max-height: 0;", CSS.indexOf(
      ".chronicle-killfeed--reader .chronicle-killfeed__card-actions {",
    ));
    const actions = actionsIndex < 0 ? "" : bodyFrom(CSS.lastIndexOf("{", actionsIndex), "card actions");

    expect(card).toMatch(/padding:\s*7px 8px/u);
    expect(actions).toMatch(/max-height:\s*0/u);
    expect(actions).toMatch(/pointer-events:\s*none/u);
    expect(CSS).toMatch(/\.chronicle-killfeed--reader \.chronicle-killfeed__card:hover \.chronicle-killfeed__card-actions/u);
    expect(CSS).toMatch(/\.chronicle-killfeed--reader \.chronicle-killfeed__card:focus-within \.chronicle-killfeed__card-actions/u);
  });

  it("caps quote previews at three lines until an explicit disclosure expands them", () => {
    const preview = latestDeclarations(".chronicle-killfeed--reader .chronicle-killfeed__quote q {");
    const expanded = declarations(".chronicle-killfeed--reader .chronicle-killfeed__quote.is-expanded q");

    expect(preview).toMatch(/display:\s*-webkit-box/u);
    expect(preview).toMatch(/-webkit-line-clamp:\s*3/u);
    expect(preview).toMatch(/overflow:\s*hidden/u);
    expect(expanded).toMatch(/-webkit-line-clamp:\s*unset/u);
    expect(expanded).toMatch(/overflow:\s*visible/u);
    expect(CSS).toMatch(/\.chronicle-killfeed--reader \.chronicle-killfeed__quote-disclosure/u);
  });
});
