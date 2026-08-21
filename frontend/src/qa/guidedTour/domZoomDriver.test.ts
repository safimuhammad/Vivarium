import { describe, expect, it } from "vitest";

import { createDomGuidedTourZoomDriver, findPresentationWorldCanvas } from "./domZoomDriver";
import type { GuidedTourBeat } from "./guidedTourBeats";

function beat(overrides: Partial<GuidedTourBeat> = {}): GuidedTourBeat {
  return {
    index: 1,
    total: 37,
    cursor: 1,
    presentedTime: 0,
    type: "resource_changed",
    region: "warm_springs",
    focus: { kind: "agent", id: "wanderer_001" },
    participants: "Joe",
    participantNames: ["Joe"],
    watchLine: "watch this",
    holdMs: 3_000,
    isDeadTravel: false,
    caption: "beat 1/37",
    ...overrides,
  };
}

function subjectButton(name: string, positionText: string): HTMLElement {
  const button = document.createElement("button");
  button.dataset.subjectToken = `subject-${name}`;
  button.setAttribute("aria-label", `${name} Status: Alive Position: ${positionText} Current action: No active action`);
  return button;
}

function setViewport(canvas: HTMLCanvasElement, width: number, height: number): void {
  canvas.getBoundingClientRect = () => ({
    width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}),
  });
}

function buildRoot(canvasWidth: number, canvasHeight: number): Readonly<{
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  keydowns: KeyboardEvent[];
}> {
  const root = document.createElement("div");
  const canvas = document.createElement("canvas");
  setViewport(canvas, canvasWidth, canvasHeight);
  const keydowns: KeyboardEvent[] = [];
  canvas.addEventListener("keydown", (event) => keydowns.push(event as KeyboardEvent));
  root.appendChild(canvas);
  return { root, canvas, keydowns };
}

describe("createDomGuidedTourZoomDriver — single participant (unchanged MAX_ZOOM behavior)", () => {
  it("resets to MIN_ZOOM then presses '+' the max-zoom overshoot count", () => {
    const { root, canvas, keydowns } = buildRoot(800, 600);
    root.appendChild(subjectButton("Joe", "Warm Springs, column 10, row 10"));
    const driver = createDomGuidedTourZoomDriver(() => canvas, () => root);

    const result = driver.zoomToTarget(beat({ participantNames: ["Joe"] }));

    expect(result).toEqual({ fits: true });
    expect(keydowns.filter((event) => event.key === "-")).toHaveLength(10);
    expect(keydowns.filter((event) => event.key === "+")).toHaveLength(7);
    // Reset presses happen before zoom-in presses.
    expect(keydowns.slice(0, 10).every((event) => event.key === "-")).toBe(true);
    expect(keydowns.slice(10).every((event) => event.key === "+")).toBe(true);
  });

  it("also maxes zoom when no participants are named at all", () => {
    const { root, canvas, keydowns } = buildRoot(800, 600);
    const driver = createDomGuidedTourZoomDriver(() => canvas, () => root);

    driver.zoomToTarget(beat({ participantNames: [] }));

    expect(keydowns.filter((event) => event.key === "+")).toHaveLength(7);
  });

  it("does nothing when no canvas is found (defensive no-op)", () => {
    const driver = createDomGuidedTourZoomDriver(() => null, () => document.createElement("div"));
    expect(() => driver.zoomToTarget(beat())).not.toThrow();
    expect(driver.zoomToTarget(beat())).toEqual({ fits: true });
  });

  it("falls back to MAX_ZOOM when the participants root is unavailable", () => {
    const { canvas, keydowns } = buildRoot(800, 600);
    const driver = createDomGuidedTourZoomDriver(() => canvas, () => null);

    driver.zoomToTarget(beat({ participantNames: ["Joe", "Mae"] }));

    expect(keydowns.filter((event) => event.key === "+")).toHaveLength(7);
  });
});

describe("createDomGuidedTourZoomDriver — paired/group participants (fit-to-bounds)", () => {
  it("zooms out to fit two far-apart participants instead of maxing zoom on one", () => {
    const { root, canvas, keydowns } = buildRoot(800, 600);
    root.appendChild(subjectButton("Dick", "Nirvana, column 0, row 0"));
    root.appendChild(subjectButton("Allen", "Nirvana, column 40, row 0"));
    const driver = createDomGuidedTourZoomDriver(() => canvas, () => root);

    const result = driver.zoomToTarget(beat({
      type: "attack",
      focus: { kind: "agent", id: "wanderer_003" },
      participantNames: ["Dick", "Allen"],
    }));

    expect(result.fits).toBe(true);
    const zoomInPresses = keydowns.filter((event) => event.key === "+").length;
    const zoomOutPresses = keydowns.filter((event) => event.key === "-").length;
    expect(zoomOutPresses).toBe(10); // always resets first
    // Two participants 40 tiles apart at 32px/tile need far fewer than the 7
    // max-zoom presses — this is the actual "don't just max zoom" assertion.
    expect(zoomInPresses).toBeLessThan(7);
  });

  it("still maxes zoom for two participants close together", () => {
    const { root, canvas, keydowns } = buildRoot(800, 600);
    root.appendChild(subjectButton("Mae", "Nirvana, column 10, row 10"));
    root.appendChild(subjectButton("Allen", "Nirvana, column 11, row 10"));
    const driver = createDomGuidedTourZoomDriver(() => canvas, () => root);

    driver.zoomToTarget(beat({ participantNames: ["Mae", "Allen"] }));

    expect(keydowns.filter((event) => event.key === "+")).toHaveLength(7);
  });

  it("reports fits:false and clamps to minZoom when a pair is too far apart to ever fit", () => {
    const { root, canvas, keydowns } = buildRoot(800, 600);
    root.appendChild(subjectButton("Dick", "Nirvana, column 0, row 0"));
    root.appendChild(subjectButton("Allen", "Nirvana, column 900, row 0"));
    const driver = createDomGuidedTourZoomDriver(() => canvas, () => root);

    const result = driver.zoomToTarget(beat({ participantNames: ["Dick", "Allen"] }));

    expect(result.fits).toBe(false);
    expect(keydowns.filter((event) => event.key === "+")).toHaveLength(0); // stays at the minZoom reset baseline
  });

  it("gracefully omits a participant not found in the World subjects panel (falls back toward the resolvable ones)", () => {
    const { root, canvas, keydowns } = buildRoot(800, 600);
    root.appendChild(subjectButton("Dick", "Nirvana, column 5, row 5"));
    // "Allen" is not present in the DOM (e.g. not in the observed region yet).
    const driver = createDomGuidedTourZoomDriver(() => canvas, () => root);

    const result = driver.zoomToTarget(beat({ participantNames: ["Dick", "Allen"] }));

    // Degrades to the single-resolvable-position case: MAX_ZOOM, same as one participant.
    expect(result).toEqual({ fits: true });
    expect(keydowns.filter((event) => event.key === "+")).toHaveLength(7);
  });

  it("matches participant names by exact word, not by prefix (Allen vs Allen2-style false match)", () => {
    const { root, canvas } = buildRoot(800, 600);
    root.appendChild(subjectButton("AllenTon", "Nirvana, column 0, row 0")); // must not match "Allen"
    const driver = createDomGuidedTourZoomDriver(() => canvas, () => root);

    // Only "AllenTon" exists, searching for "Allen" must not match it (no participant found).
    const result = driver.zoomToTarget(beat({ participantNames: ["Allen"] }));
    expect(result).toEqual({ fits: true }); // degrades to 0-position / max-zoom, not a false match
  });
});

describe("findPresentationWorldCanvas", () => {
  it("finds the production world canvas by class inside a container", () => {
    const container = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.className = "presentation-world-stage__canvas";
    container.appendChild(canvas);

    expect(findPresentationWorldCanvas(container)).toBe(canvas);
  });

  it("returns null when there is no container or no matching canvas", () => {
    expect(findPresentationWorldCanvas(null)).toBeNull();
    expect(findPresentationWorldCanvas(document.createElement("div"))).toBeNull();
  });
});

describe("createDomGuidedTourZoomDriver — configurable constants", () => {
  it("honors a custom overshoot/reset press configuration", () => {
    const { root, canvas, keydowns } = buildRoot(800, 600);
    const driver = createDomGuidedTourZoomDriver(() => canvas, () => root, {
      zoomInOvershootPresses: 3,
      zoomOutResetPresses: 5,
    });

    driver.zoomToTarget(beat({ participantNames: [] }));

    expect(keydowns.filter((event) => event.key === "-")).toHaveLength(5);
    expect(keydowns.filter((event) => event.key === "+")).toHaveLength(3);
  });
});
