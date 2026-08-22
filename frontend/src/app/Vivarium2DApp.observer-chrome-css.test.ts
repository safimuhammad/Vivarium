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

  it("has retired the NOW card entirely rather than restyling it", () => {
    // Owner direction (Safi, 2026-08-22): the bottom-right "NOW / View moment"
    // card collided with the live stream and did the same job. The Chronicle
    // marks its own leading entry now; nothing here may reserve space for a
    // second narrative surface.
    expect(css).not.toContain("story-now");
  });

  it("gives the persistent HUD the two controls a watcher must never hunt for", () => {
    // Framing and ending a run are CONTROLS; everything before them on the
    // status line is a reading. The rule between them says so.
    expect(rule(".observer-hud__controls")).toMatch(/border-left:\s*1px solid var\(--observer-line\)/);
    expect(rule(".observer-hud .observer-hud__framing")).toMatch(/display:\s*inline-flex/);
    expect(css).toMatch(
      /\.observer-hud__framing\[data-framing="yours"\][\s\S]*?border-color:\s*var\(--observer-accent\)/,
    );
    expect(rule(".observer-hud .observer-hud__stop")).toMatch(/color:\s*#f0b49d/);
  });

  it("names the camera's subject in the same label/value language as the framing", () => {
    // Two halves of one sentence -- who holds the camera, and what it is on --
    // so they must not read as two unrelated widgets.
    expect(rule(".observer-hud__follow")).toMatch(/display:\s*inline-flex/);
    expect(rule(".observer-hud__follow > span[aria-hidden]"))
      .toMatch(/letter-spacing:\s*0\.14em/);
    // Bounded: one long name must not push the status line off the world.
    expect(rule(".observer-hud .observer-hud__follow-select")).toMatch(/max-width:\s*9\.5rem/);
    expect(css).toMatch(
      /\.observer-hud__follow\[data-follow="following"\][\s\S]*?border-color:\s*var\(--observer-accent\)/,
    );
    // Why a pursuit ended has to be SEEN; the polite announcer is invisible.
    expect(rule(".observer-hud__follow-notice")).toMatch(/color:\s*#f0d9a0/);
  });

  it("asks the irreversible question on a panel anchored to the control that opened it", () => {
    expect(rule(".observer-run-confirm")).toMatch(/position:\s*absolute/);
    expect(rule(".observer-run-confirm")).toMatch(/top:\s*calc\(100% \+ 8px\)/);
    expect(rule(".observer-run-confirm")).toMatch(/width:\s*22rem/);
    // Above every drawer: a question a viewer cannot see is a question they
    // cannot answer.
    expect(rule(".observer-run-confirm")).toMatch(/z-index:\s*30/);
    expect(rule(".observer-hud .observer-run-confirm__go"))
      .toMatch(/border-color:\s*var\(--observer-danger\)/);
  });

  it("uses flat pixel-game surfaces without decorative gradients", () => {
    expect(css).not.toMatch(/(?:linear|radial|conic)-gradient\(/);
    expect(rule(".living-atlas-2d__map")).toContain("background: #111b18");
    expect(rule(".observer-edge-triggers button")).toContain("background: var(--observer-panel-solid)");
  });
});
