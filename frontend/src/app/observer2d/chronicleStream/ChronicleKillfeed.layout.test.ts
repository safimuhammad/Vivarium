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
    expect(declared).toMatch(/--killfeed-band:\s*min\(20rem, 26vw\)/u);
    // A gap of zero would put the yielding surface flush against the band; the
    // defect was a NEGATIVE gap, so this is the invariant that broke.
    const gap = /--killfeed-gap:\s*(\d+)px/u.exec(declared);
    expect(gap).not.toBeNull();
    expect(Number(gap![1])).toBeGreaterThan(0);
    expect(declared).toMatch(
      /--killfeed-reserve:\s*calc\(\s*var\(--killfeed-rail\)\s*\+\s*var\(--killfeed-band\)\s*\+\s*var\(--killfeed-gap\)\s*\)/u,
    );
  });

  it("positions the band itself from those variables, never from a second constant", () => {
    const band = blockDeclaring("--observer-drawer-width:");
    expect(band).toContain("var(--killfeed-rail)");
    expect(band).toMatch(/--observer-drawer-width:\s*var\(--killfeed-band\)/u);
    expect(band).not.toMatch(/inset:[^;]*\b52px\b/u);
  });

  it("makes every surface that yields to the band reserve the WHOLE band", () => {
    const yielding = block(":is(.dialogue-now, .story-now)");
    expect(yielding).toMatch(/right:\s*calc\(var\(--killfeed-reserve\)/u);
    expect(yielding).toContain("var(--killfeed-reserve)");
    // The 23rem that put "View moment" under the feed must not come back.
    expect(yielding).not.toMatch(/right:\s*\d+(\.\d+)?rem/u);
  });
});

describe("killfeed flow sizing", () => {
  it("never shrinks a card below its own content", () => {
    const flowChildren = block(".chronicle-killfeed__flow > *");
    expect(flowChildren).toMatch(/flex:\s*none/u);
  });

  it("clips a card to its own scrim so nothing can paint over its neighbour", () => {
    const card = block(".chronicle-killfeed .chronicle-killfeed__card {");
    expect(card).toMatch(/overflow:\s*hidden/u);
  });
});
