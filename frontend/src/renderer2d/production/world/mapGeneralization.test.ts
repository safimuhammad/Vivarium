import { describe, expect, it } from "vitest";

import {
  dilateMask,
  erodeMask,
  generalizeMapInset,
  minimumStroke,
  FIELD_TONE_MAX_GAIN,
  MAP_LINE_STROKE_RADIUS_PX,
  MAP_WATER_STROKE_RADIUS_PX,
  WATER_CONTRAST_MAX_GAIN,
} from "./mapGeneralization";

/** A plain `ImageData` stand-in: the module only reads `width`, `height` and `data`. */
function surface(width: number, height: number, fill: readonly number[]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = fill[0] as number;
    data[index * 4 + 1] = fill[1] as number;
    data[index * 4 + 2] = fill[2] as number;
    data[index * 4 + 3] = 255;
  }
  return { width, height, data, colorSpace: "srgb" } as ImageData;
}

function paint(
  image: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: readonly number[],
): void {
  for (let row = y0; row < y1; row += 1) {
    for (let col = x0; col < x1; col += 1) {
      const offset = (row * image.width + col) * 4;
      image.data[offset] = colour[0] as number;
      image.data[offset + 1] = colour[1] as number;
      image.data[offset + 2] = colour[2] as number;
      image.data[offset + 3] = 255;
    }
  }
}

const at = (image: ImageData, col: number, row: number): readonly number[] => {
  const offset = (row * image.width + col) * 4;
  return [
    image.data[offset] as number,
    image.data[offset + 1] as number,
    image.data[offset + 2] as number,
    image.data[offset + 3] as number,
  ];
};

/** Deterministic low-amplitude jitter -- the "real variation" a flat kit field actually carries. */
function jitter(image: ImageData, amplitude: number): void {
  let state = 12_345;
  for (let index = 0; index < image.width * image.height; index += 1) {
    state = (state * 1_103_515_245 + 12_345) & 0x7fffffff;
    const delta = ((state >> 16) % (2 * amplitude + 1)) - amplitude;
    for (let channel = 0; channel < 3; channel += 1) {
      image.data[index * 4 + channel] = (image.data[index * 4 + channel] as number) + delta;
    }
  }
}

const GRASS = [150, 160, 90] as const;
const WATER = [80, 112, 124] as const;
const SAND = [240, 200, 128] as const;
const PATH = [252, 214, 141] as const;

const luma = (colour: readonly number[]): number =>
  (colour[0] as number) * 0.3 + (colour[1] as number) * 0.59 + (colour[2] as number) * 0.11;

describe("dilateMask / erodeMask", () => {
  it("grows a single pixel into a square of the structuring element", () => {
    const mask = new Uint8Array(11 * 11);
    mask[5 * 11 + 5] = 1;
    const grown = dilateMask(mask, 11, 11, 2);
    let count = 0;
    for (const value of grown) if (value === 1) count += 1;
    expect(count).toBe(25);
    expect(grown[3 * 11 + 3]).toBe(1);
    expect(grown[2 * 11 + 5]).toBe(0);
  });

  it("is the identity at radius zero and leaves the input untouched", () => {
    const mask = new Uint8Array([0, 1, 0, 0]);
    expect([...dilateMask(mask, 2, 2, 0)]).toEqual([0, 1, 0, 0]);
    dilateMask(mask, 2, 2, 3);
    expect([...mask]).toEqual([0, 1, 0, 0]);
  });

  it("erodes as the dual of dilation: a block loses exactly its rim", () => {
    const mask = new Uint8Array(11 * 11);
    for (let row = 3; row < 8; row += 1) for (let col = 3; col < 8; col += 1) mask[row * 11 + col] = 1;
    const eroded = erodeMask(mask, 11, 11, 1);
    let count = 0;
    for (const value of eroded) if (value === 1) count += 1;
    expect(count).toBe(9);
    expect(eroded[5 * 11 + 5]).toBe(1);
    expect(eroded[3 * 11 + 3]).toBe(0);
  });
});

describe("minimumStroke", () => {
  it("widens a one-pixel line to the minimum stroke without moving its centreline", () => {
    const width = 21;
    const mask = new Uint8Array(width * width);
    for (let col = 0; col < width; col += 1) mask[10 * width + col] = 1;
    const widened = minimumStroke(mask, width, width, 3);
    // Every original pixel survives -- the path is untouched.
    for (let col = 0; col < width; col += 1) expect(widened[10 * width + col]).toBe(1);
    // And the stroke is symmetric about it, so the centre of the widened band is the real path.
    let thickness = 0;
    for (let row = 0; row < width; row += 1) if (widened[row * width + 10] === 1) thickness += 1;
    expect(thickness).toBe(2 * 3 + 1);
    expect(widened[7 * width + 10]).toBe(1);
    expect(widened[13 * width + 10]).toBe(1);
    expect(widened[6 * width + 10]).toBe(0);
  });

  it("leaves a feature that is ALREADY thick enough completely untouched", () => {
    const width = 31;
    const mask = new Uint8Array(width * width);
    for (let row = 10; row < 21; row += 1) {
      for (let col = 10; col < 21; col += 1) mask[row * width + col] = 1;
    }
    const widened = minimumStroke(mask, width, width, 3);
    expect([...widened]).toEqual([...mask]);
  });

  it("never spills outside the bounds it is given", () => {
    const width = 21;
    const mask = new Uint8Array(width * width);
    for (let col = 0; col < width; col += 1) mask[10 * width + col] = 1;
    const bounds = new Uint8Array(width * width);
    for (let row = 9; row <= 11; row += 1) {
      for (let col = 0; col < width; col += 1) bounds[row * width + col] = 1;
    }
    const widened = minimumStroke(mask, width, width, 3, bounds);
    expect(widened[8 * width + 10]).toBe(0);
    expect(widened[11 * width + 10]).toBe(1);
  });
});

describe("generalizeMapInset -- linear features survive the downscale", () => {
  it("gives a sub-threshold river a minimum stroke, centred on its real course", () => {
    const image = surface(80, 60, GRASS);
    paint(image, 0, 30, 80, 32, WATER);
    const result = generalizeMapInset(image);
    expect(result.waterPx).toBe(80 * 2);
    expect(result.widenedWaterPx).toBeGreaterThanOrEqual(80 * (2 * MAP_WATER_STROKE_RADIUS_PX + 2));
    let thickness = 0;
    for (let row = 0; row < 60; row += 1) if (result.water[row * 80 + 40] === 1) thickness += 1;
    expect(thickness).toBeGreaterThanOrEqual(2 * MAP_WATER_STROKE_RADIUS_PX + 1);
    // Symmetric about the real course: the widening reaches equally far either side.
    expect(result.water[(30 - MAP_WATER_STROKE_RADIUS_PX) * 80 + 40]).toBe(1);
    expect(result.water[(31 + MAP_WATER_STROKE_RADIUS_PX) * 80 + 40]).toBe(1);
  });

  it("does NOT fatten a lake that is already legible", () => {
    const image = surface(80, 60, GRASS);
    paint(image, 20, 20, 60, 45, WATER);
    const result = generalizeMapInset(image);
    expect(result.widenedWaterPx).toBe(result.waterPx);
  });

  it("pushes the river away from its own banks until it holds at map scale", () => {
    const image = surface(80, 60, GRASS);
    paint(image, 0, 30, 80, 32, WATER);
    const before = luma(WATER) - luma(GRASS);
    const result = generalizeMapInset(image);
    expect(result.waterContrastGain).toBeGreaterThan(1);
    expect(result.waterContrastGain).toBeLessThanOrEqual(WATER_CONTRAST_MAX_GAIN);
    const after = luma(at(image, 40, 31)) - luma(GRASS);
    // Further from the bank, in the direction it already differed. Never the other way.
    expect(Math.sign(after)).toBe(Math.sign(before));
    expect(Math.abs(after)).toBeGreaterThan(Math.abs(before));
  });

  it("reads a cool-toned MATERIAL as material, not as a flooded island", () => {
    // nirvana_west's whole plot is a purple-slate field. Classifying that as water would repaint
    // the region.
    const image = surface(80, 60, [100, 92, 130]);
    const result = generalizeMapInset(image);
    expect(result.waterPx).toBe(0);
    expect(result.widenedWaterPx).toBe(0);
  });

  it("keeps what the river flows under: a bridge deck is not swallowed by the widening", () => {
    const image = surface(80, 60, GRASS);
    paint(image, 0, 24, 80, 38, WATER);
    const deck = [140, 90, 50] as const;
    paint(image, 40, 20, 42, 42, deck);
    const result = generalizeMapInset(image);
    expect(result.crossingPx).toBeGreaterThan(0);
    // Mid-river, mid-deck is still timber, not water.
    const centre = at(image, 41, 31);
    expect(Math.abs((centre[0] as number) - (deck[0] as number))).toBeLessThan(60);
    expect(centre[0] as number).toBeGreaterThan(centre[2] as number);
    // And the deck got a minimum stroke of its own, so it survives the downscale too.
    expect(result.widenedCrossingPx).toBeGreaterThan(result.crossingPx);
  });
});

describe("generalizeMapInset -- a uniform field is composed, not invented", () => {
  it("amplifies the tone variation a flat kit field really carries", () => {
    const image = surface(120, 100, SAND);
    jitter(image, 3);
    const readSpread = (): Readonly<{ mean: number; deviation: number }> => {
      let sum = 0;
      let squares = 0;
      for (let index = 0; index < 120 * 100; index += 1) {
        const value = image.data[index * 4] as number;
        sum += value;
        squares += value * value;
      }
      const mean = sum / (120 * 100);
      return { mean, deviation: Math.sqrt(Math.max(0, squares / (120 * 100) - mean * mean)) };
    };
    const before = readSpread();
    const result = generalizeMapInset(image);
    const after = readSpread();
    expect(result.uniformField).toBe(true);
    expect(result.fieldToneGain).toBeGreaterThan(1);
    expect(result.fieldToneGain).toBeLessThanOrEqual(FIELD_TONE_MAX_GAIN);
    expect(after.deviation).toBeGreaterThan(before.deviation * 1.4);
    // Amplified about the field's own mean, so the island's colour does not drift.
    expect(after.mean).toBeCloseTo(before.mean, 0);
  });

  it("leaves authored terrain's tone alone -- it is already well past the threshold", () => {
    const image = surface(120, 100, GRASS);
    jitter(image, 45);
    const result = generalizeMapInset(image);
    expect(result.uniformField).toBe(false);
    expect(result.fieldToneGain).toBe(1);
  });

  it("widens a faint path on a uniform field and pushes it to hold against the field", () => {
    const image = surface(120, 100, SAND);
    for (let row = 0; row < 100; row += 1) paint(image, 60, row, 61, row + 1, PATH);
    const before = Math.abs(luma(PATH) - luma(SAND));
    const result = generalizeMapInset(image);
    expect(result.widenedLinePx).toBeGreaterThanOrEqual(100 * (2 * MAP_LINE_STROKE_RADIUS_PX + 1));
    const after = Math.abs(luma(at(image, 60, 50)) - luma(SAND));
    expect(after).toBeGreaterThan(before);
    // The widened pixels carry the path's colour, not the field's.
    expect(Math.abs(luma(at(image, 60 + MAP_LINE_STROKE_RADIUS_PX, 50)) - luma(SAND)))
      .toBeGreaterThan(before * 0.5);
  });

  it("does NOT push a blob that is already legible -- only the thin linework earns it", () => {
    const image = surface(120, 100, SAND);
    const cluster = [90, 60, 40] as const;
    paint(image, 20, 20, 50, 50, cluster);
    generalizeMapInset(image);
    // The middle of the cluster is untouched: pushing a sprite's colour just turns a map garish.
    expect(at(image, 35, 35).slice(0, 3)).toEqual([...cluster]);
  });
});

describe("generalizeMapInset -- degenerate and deterministic", () => {
  it("returns an empty result for an empty or fully transparent raster", () => {
    expect(generalizeMapInset(surface(0, 0, GRASS)).waterPx).toBe(0);
    const blank = surface(20, 20, GRASS);
    for (let index = 0; index < 400; index += 1) blank.data[index * 4 + 3] = 0;
    const result = generalizeMapInset(blank);
    expect(result.waterPx).toBe(0);
    expect(result.uniformField).toBe(false);
  });

  it("is deterministic: the same raster generalizes to the same pixels", () => {
    const build = (): ImageData => {
      const image = surface(90, 70, GRASS);
      jitter(image, 4);
      paint(image, 0, 30, 90, 33, WATER);
      return image;
    };
    const first = build();
    const second = build();
    generalizeMapInset(first);
    generalizeMapInset(second);
    expect([...second.data]).toEqual([...first.data]);
  });
});
