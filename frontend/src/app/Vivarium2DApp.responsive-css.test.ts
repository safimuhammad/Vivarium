import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(`${process.cwd()}/src/app/Vivarium2DApp.css`, "utf8");

describe("Vivarium2DApp responsive and media CSS contract", () => {
  it("owns dynamic viewport, safe areas, 44px targets, visible focus, and bounded mobile sheet", () => {
    expect(css).toMatch(/height:\s*100dvh/);
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).toMatch(/min-width:\s*44px/);
    expect(css).toMatch(/:focus-visible[\s\S]*outline:\s*3px/);
    expect(css).toMatch(/max-height:[^;]*48dvh[^;]*112px/);
  });

  it("wraps the compact header without clipping and keeps four mobile drawer triggers reachable", () => {
    const mobile = css.slice(css.indexOf("@media (max-width: 760px)"));
    expect(mobile).toMatch(/\.observer-top-chrome\s*\{[\s\S]*?position:\s*absolute/);
    expect(mobile).toMatch(/\.observer-hud\s*\{[\s\S]*?overflow:\s*visible/);
    expect(mobile).toMatch(/\.observer-hud\s*\{[\s\S]*?max-width:\s*none/);
    expect(mobile).toMatch(/grid-auto-columns:\s*minmax\(44px, 1fr\)/);
    expect(mobile).toMatch(/\.observer-edge-triggers button\s*\{[\s\S]*?min-height:\s*44px/);
    expect(mobile).toMatch(/\.observer-edge-triggers\s*\{[\s\S]*?position:\s*static/);
    expect(mobile).not.toMatch(/\.observer-edge-triggers\s*\{[\s\S]*?top:\s*calc/);
  });

  it("preserves color-independent meaning under reduced motion and forced colors", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("CanvasText");
    expect(css).toContain("Highlight");
    expect(css).toMatch(/transition-duration:\s*0s/);
  });

  it("has an explicit short-height layout", () => {
    expect(css).toMatch(/@media \([^)]*max-height:\s*640px[^)]*\)/);
  });

  it("keeps Story Now inside the mobile safe-area with bounded selectable copy", () => {
    const mobile = css.slice(css.indexOf("@media (max-width: 760px)"));
    expect(mobile).toMatch(/\.story-now\s*\{[\s\S]*?right:\s*max\(8px, env\(safe-area-inset-right\)\)/);
    expect(mobile).toMatch(/\.story-now\s*\{[\s\S]*?bottom:\s*max\(8px, env\(safe-area-inset-bottom\)\)/);
    expect(mobile).toMatch(/\.story-now\s*\{[\s\S]*?left:\s*max\(8px, env\(safe-area-inset-left\)\)/);
    expect(mobile).toMatch(/\.story-now\s*\{[\s\S]*?max-height:\s*96px/);
    expect(css).toMatch(/\.story-now__copy p[\s\S]*user-select:\s*text/);
  });
});
