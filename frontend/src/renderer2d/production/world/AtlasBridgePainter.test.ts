import { describe, expect, it } from "vitest";

import type { BridgeSpan } from "./islandBridges";
import {
  atlasBridgeGeometry,
  bridgeDeckPoint,
  drawAtlasBridge,
} from "./AtlasBridgePainter";

function span(
  a: Readonly<{ x: number; y: number }>,
  b: Readonly<{ x: number; y: number }>,
  kind: BridgeSpan["kind"] = "plank",
): BridgeSpan {
  return {
    regionA: "a",
    regionB: "b",
    a,
    b,
    lengthPx: Math.hypot(b.x - a.x, b.y - a.y),
    kind,
  };
}

interface RecordedDraw {
  readonly args: readonly unknown[];
  readonly alpha: number;
}

class RecordingContext {
  #alpha: number;
  readonly alphaWrites: number[] = [];
  readonly draws: RecordedDraw[] = [];
  readonly points: Array<readonly [number, number]> = [];
  readonly fills: string[] = [];
  readonly strokes: string[] = [];
  readonly saves: number[] = [];
  imageSmoothingEnabled = true;
  fillStyle: string | CanvasGradient | CanvasPattern = "#000";
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000";
  lineWidth = 1;

  constructor(alpha = 1) {
    this.#alpha = alpha;
  }

  get globalAlpha(): number {
    return this.#alpha;
  }

  set globalAlpha(value: number) {
    this.alphaWrites.push(value);
    this.#alpha = value;
  }

  save(): void {
    this.saves.push(this.#alpha);
  }

  restore(): void {
    this.#alpha = this.saves.pop() ?? this.#alpha;
  }

  beginPath(): void {}
  closePath(): void {}
  clip(): void {}
  fill(): void { this.fills.push(String(this.fillStyle)); }
  stroke(): void { this.strokes.push(String(this.strokeStyle)); }
  fillRect(): void { this.fills.push(String(this.fillStyle)); }
  moveTo(x: number, y: number): void { this.points.push([x, y]); }
  lineTo(x: number, y: number): void { this.points.push([x, y]); }
  quadraticCurveTo(_controlX: number, _controlY: number, x: number, y: number): void {
    this.points.push([x, y]);
  }
  translate(): void {}
  rotate(): void {}
  transform(): void {}
  drawImage(...args: unknown[]): void {
    this.draws.push({ args, alpha: this.#alpha });
  }
}

function sourceRect(draw: RecordedDraw): readonly [number, number, number, number] {
  return [
    draw.args[1] as number,
    draw.args[2] as number,
    draw.args[3] as number,
    draw.args[4] as number,
  ];
}

describe("AtlasBridgePainter geometry", () => {
  it("keeps rise smooth and zero at both coast endpoints without mutating spans", () => {
    const crossing = span({ x: 120, y: 360 }, { x: 620, y: 520 });
    const before = structuredClone(crossing);
    const geometry = atlasBridgeGeometry(crossing);

    expect(geometry.width).toBe(80);
    expect(geometry.maxRise).toBeGreaterThanOrEqual(12);
    expect(geometry.maxRise).toBeLessThanOrEqual(18);
    expect(bridgeDeckPoint(crossing, 0)).toEqual(crossing.a);
    expect(bridgeDeckPoint(crossing, 1)).toEqual(crossing.b);
    expect(bridgeDeckPoint(crossing, 0.5).y).toBeLessThan((crossing.a.y + crossing.b.y) / 2);
    expect(crossing).toEqual(before);
  });

  it("is symmetric when the same span is reversed and remains finite for a short vertical crossing", () => {
    const forward = span({ x: 80, y: 180 }, { x: 680, y: 180 });
    const backward = span(forward.b, forward.a);
    const verticalShort = span({ x: 440, y: 100 }, { x: 440, y: 106 }, "causeway");

    expect(bridgeDeckPoint(forward, 0.25)).toEqual(bridgeDeckPoint(backward, 0.75));
    expect(atlasBridgeGeometry(forward).bounds).toEqual(atlasBridgeGeometry(backward).bounds);
    const shortGeometry = atlasBridgeGeometry(verticalShort);
    expect(shortGeometry.segmentCount).toBe(1);
    expect(shortGeometry.postCount).toBeGreaterThanOrEqual(2);
    expect(Object.values(shortGeometry.bounds).every(Number.isFinite)).toBe(true);
  });

  it("keeps bridge detail bounded while world-space bounds grow with its span", () => {
    const short = atlasBridgeGeometry(span({ x: 0, y: 0 }, { x: 240, y: 0 }));
    const long = atlasBridgeGeometry(span({ x: 0, y: 0 }, { x: 100_000, y: 0 }, "causeway"));

    expect(long.bounds.width).toBeGreaterThan(short.bounds.width * 100);
    expect(long.segmentCount).toBeLessThanOrEqual(64);
    expect(long.postCount).toBeLessThanOrEqual(32);
    expect(long.supportCount).toBeLessThanOrEqual(32);
  });
});

describe("drawAtlasBridge", () => {
  it("tiles the timber deck from its top-left material quadrant and uses the lower timber beams for supports", () => {
    const context = new RecordingContext(0.42);
    const crossing = span({ x: 160, y: 180 }, { x: 700, y: 340 });
    const material = {} as CanvasImageSource;

    drawAtlasBridge(context as unknown as CanvasRenderingContext2D, crossing, material, { opacity: 0.75 });

    const geometry = atlasBridgeGeometry(crossing);
    const sourceRects = context.draws.map(sourceRect);
    const deckRects = sourceRects.filter(([x, y]) => x < 512 && y < 512);
    expect(deckRects).toHaveLength(geometry.segmentCount);
    expect(deckRects.every(([x, y, width, height]) => x >= 0 && y >= 0 && x + width <= 512 && y + height <= 512)).toBe(true);
    expect(sourceRects.some(([x, y]) => x < 512 && y >= 512)).toBe(true);
    expect(context.draws.every(({ alpha }) => alpha <= 0.42)).toBe(true);
    expect(context.globalAlpha).toBe(0.42);
  });

  it("uses the right-side stone and masonry quadrants for a causeway, while preserving a restrained fallback", () => {
    const causeway = span({ x: 80, y: 280 }, { x: 1_180, y: 280 }, "causeway");
    const textured = new RecordingContext();
    const fallback = new RecordingContext();

    drawAtlasBridge(textured as unknown as CanvasRenderingContext2D, causeway, {} as CanvasImageSource);
    drawAtlasBridge(fallback as unknown as CanvasRenderingContext2D, causeway, null);

    const sourceRects = textured.draws.map(sourceRect);
    expect(sourceRects.some(([x, y]) => x >= 512 && y < 512)).toBe(true);
    expect(sourceRects.some(([x, y]) => x >= 512 && y >= 512)).toBe(true);
    expect(fallback.draws).toHaveLength(0);
    expect(fallback.fills.length + fallback.strokes.length).toBeGreaterThan(0);
    expect(fallback.points.flat().every(Number.isFinite)).toBe(true);
  });

  it("applies an optional day-night tint only through bridge surface paths", () => {
    const context = new RecordingContext(0.6);
    const crossing = span({ x: 140, y: 220 }, { x: 760, y: 350 });

    drawAtlasBridge(
      context as unknown as CanvasRenderingContext2D,
      crossing,
      {} as CanvasImageSource,
      { tint: "#2a3f78", tintAlpha: 0.46 },
    );

    expect(context.fills).toContain("#2a3f78");
    expect(context.globalAlpha).toBe(0.6);
  });
});
