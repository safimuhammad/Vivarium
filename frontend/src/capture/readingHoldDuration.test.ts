import { describe, expect, it } from "vitest";

import {
  extractProductionDialogueNowWitness,
  readingHoldDuration,
  type ReadingHoldWitness,
} from "./readingHoldDuration";

describe("capture reading-hold duration", () => {
  it("returns identical exact 30fps frame ticks across distant repeating-decimal timelines", () => {
    const standard = framesAt(38_000);
    const reduced = framesAt(2_000);

    expect(readingHoldDuration(standard, 24, 30)).toBe(23 * 1_000 / 30);
    expect(readingHoldDuration(reduced, 24, 30)).toBe(23 * 1_000 / 30);
    expect(readingHoldDuration(standard, 24, 30))
      .toBe(readingHoldDuration(reduced, 24, 30));
  });

  it("returns zero when the contiguous hold has no reading content", () => {
    const frames = framesAt(0).map((frame) => ({ ...frame, readingWitness: null }));

    expect(readingHoldDuration(frames, 24, 30)).toBe(0);
  });

  it("RED: refuses a twenty-three-frame hold when only one frame owns exact DOM reading truth", () => {
    const frames = framesAt(0).map((frame, index) => ({
      ...frame,
      readingWitness: index === 23 ? READING_WITNESS : null,
    }));

    expect(readingHoldDuration(frames, 24, 30)).toBe(0);
  });

  it("RED: refuses an interrupted hold whose DOM attribution or copy changes", () => {
    const frames = framesAt(0).map((frame, index) => ({
      ...frame,
      readingWitness: index === 12
        ? { ...READING_WITNESS, text: "Mae gave 1 material to Joe." }
        : frame.readingWitness,
    }));

    expect(readingHoldDuration(frames, 24, 30)).toBe(0);
  });

  it("RED: extracts one production-scoped DialogueNow owner with exact attribution, copy, and bounds", () => {
    installExactDialogueDom();
    const panel = document.querySelector<HTMLElement>(".dialogue-now")!;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(
      domRect(128, 760, 1_184, 126),
    );

    expect(extractProductionDialogueNowWitness(document)).toEqual(READING_WITNESS);
  });

  it.each([
    ["multiple panels", () => {
      document.querySelector(".vivarium-2d-app")!.insertAdjacentHTML(
        "beforeend",
        dialoguePanelMarkup("Joe", "Mae", "Joe gave 1 material to Mae."),
      );
    }],
    ["unscoped panel", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        dialoguePanelMarkup("Joe", "Mae", "Joe gave 1 material to Mae."),
      );
    }],
    ["multiple apps", () => {
      document.body.insertAdjacentHTML("beforeend", '<main class="vivarium-2d-app"></main>');
    }],
    ["multiple production stages", () => {
      document.querySelector(".vivarium-2d-app")!.insertAdjacentHTML(
        "beforeend",
        '<section class="presentation-world-stage"></section>',
      );
    }],
    ["partial attribution", () => {
      document.querySelector(".dialogue-now__attribution button:last-of-type")!.remove();
    }],
  ])("RED: rejects %s rather than borrowing an arbitrary panel", (_label, corrupt) => {
    installExactDialogueDom();
    corrupt();

    expect(extractProductionDialogueNowWitness(document)).toBeNull();
  });
});

const READING_WITNESS: ReadingHoldWitness = Object.freeze({
  owner: "vivarium-2d-dialogue-now",
  speakerName: "Joe",
  targetName: "Mae",
  direction: "→",
  text: "Joe gave 1 material to Mae.",
  bounds: Object.freeze({ x: 128, y: 760, width: 1_184, height: 126 }),
  viewport: Object.freeze({ width: 1_440, height: 900 }),
});

function framesAt(baseMs: number) {
  return Array.from({ length: 25 }, (_, index) => ({
    presentationTimeMs: baseMs + index * 1_000 / 30,
    scenePhase: index === 0 ? "enter" : index === 24 ? "consequence" : "hold",
    readingWitness: index >= 1 && index <= 23 ? READING_WITNESS : null,
  }));
}

function installExactDialogueDom(): void {
  document.body.innerHTML = `
    <main class="vivarium-2d-app">
      <section class="presentation-world-stage"></section>
      ${dialoguePanelMarkup("Joe", "Mae", "Joe gave 1 material to Mae.")}
    </main>
  `;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
}

function dialoguePanelMarkup(speaker: string, target: string, text: string): string {
  return `
    <section class="dialogue-now">
      <header class="dialogue-now__attribution">
        <button data-dialogue-speaker>${speaker}</button>
        <span data-dialogue-direction aria-hidden="true">→</span>
        <button data-dialogue-target>${target}</button>
        <span>Warm Springs</span>
      </header>
      <p data-dialogue-copy>${text}</p>
      <button>Release Now</button>
    </section>
  `;
}

function domRect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height, top: y, right: x + width, bottom: y + height, left: x, toJSON: () => ({}) };
}
