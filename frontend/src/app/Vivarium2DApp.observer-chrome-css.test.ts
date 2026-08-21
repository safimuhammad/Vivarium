import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(`${process.cwd()}/src/app/Vivarium2DApp.css`, "utf8");

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return "";
  const bodyStart = css.indexOf("{", start) + 1;
  return css.slice(bodyStart, css.indexOf("}", bodyStart));
}

describe("Vivarium 2D observer chrome visual contract", () => {
  it("uses a dark game-frame surface with restrained light controls", () => {
    expect(css).toContain("--observer-panel: #17231e");
    expect(css).toContain("--observer-control: #ead9a8");
    expect(css).toContain("--observer-control-ink: #1b2821");
    expect(rule(".observer-panel")).toContain("background: var(--observer-panel)");
    expect(rule(".observer-panel")).toContain("border-radius: 4px");
  });

  it("keeps the world dominant with a wrapping status strip and drawer-owned Atlas", () => {
    expect(rule(".observer-hud")).toMatch(/padding:\s*6px 10px/);
    expect(rule(".observer-hud")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".observer-hud")).toMatch(/overflow:\s*visible/);
    expect(rule(".world-drawer \.living-atlas-2d")).toMatch(/position:\s*relative/);
    expect(rule(".semantic-world-mirror")).toMatch(/clip:\s*rect\(0, 0, 0, 0\)/);
  });

  it("centers a pointer-transparent region plaque and keeps drawers above it", () => {
    expect(rule(".region-arrival-plaque")).toMatch(/pointer-events:\s*none/);
    expect(rule(".region-arrival-plaque")).toMatch(/place-items:\s*center/);
    expect(rule(".observer-primary-surface")).toMatch(/z-index:\s*19/);
  });

  it("fits single-control Atlas pins and a compact external detail action", () => {
    expect(rule(".living-atlas-2d__node")).toMatch(/grid-template-columns:\s*1fr/);
    expect(rule(".living-atlas-2d__node")).toMatch(/width:\s*3\.75rem/);
    expect(rule(".living-atlas-2d__detail")).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 44px/);
    expect(rule(".living-atlas-2d__detail")).toContain("background: var(--observer-panel-solid)");
    expect(css).not.toContain(".living-atlas-2d__paths { display: none; }");
  });

  it("presents dialogue as a bounded narrative caption instead of a utility shelf", () => {
    expect(rule(".dialogue-now")).toMatch(/left:\s*auto/);
    expect(rule(".dialogue-now")).toMatch(/width:\s*min\(46rem, calc\(100vw - 22rem\)\)/);
    expect(rule(".dialogue-now")).toMatch(/min-height:\s*0/);
    expect(rule(".dialogue-now")).toMatch(/border-left-width:\s*4px/);
  });

  it("presents Story Now as a compact persistent caption in the shared narrative slot", () => {
    expect(rule(".story-now")).toMatch(/position:\s*absolute/);
    expect(rule(".story-now")).toMatch(/bottom:\s*max\(10px, env\(safe-area-inset-bottom\)\)/);
    expect(rule(".story-now")).toMatch(/width:\s*min\(38rem, calc\(100vw - 22rem\)\)/);
    expect(rule(".story-now")).toMatch(/max-height:\s*8rem/);
    expect(rule(".story-now")).toMatch(/border-left-width:\s*4px/);
    expect(rule(".story-now__copy p")).toMatch(/-webkit-line-clamp:\s*2/);
    expect(rule(".story-now button")).toMatch(/min-width:\s*44px/);
    expect(rule(".story-now button")).toMatch(/min-height:\s*44px/);
  });

  it("uses flat pixel-game surfaces without decorative gradients", () => {
    expect(css).not.toMatch(/(?:linear|radial|conic)-gradient\(/);
    expect(rule(".living-atlas-2d__map")).toContain("background: #111b18");
    expect(rule(".observer-edge-triggers button")).toContain("background: var(--observer-panel-solid)");
  });
});
