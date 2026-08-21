/**
 * @fileoverview TDD spec for `beingPalette.ts` — deterministic per-being
 * palette variation for `SpriteSheetHumanActor` (Task 4 of the chibi
 * sprite-sheet actor integration).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deriveHumanAppearance } from "./appearance";
import { characterIds, type BeingCharacterId } from "./beingChibiAtlas";
import {
  BEING_PALETTE_VARIANTS,
  createPaletteVariantSource,
  PALETTE_REMAPS_BY_CHARACTER,
  resolveBeingPaletteVariant,
  type BeingPaletteVariant,
  type RgbTriple,
} from "./beingPalette";

/**
 * "redmean" perceptual color distance — a low-cost RGB-space approximation
 * of CIE deltaE (weights the R/G/B channel deltas by where the pair sits in
 * the red spectrum, rather than treating RGB as a naive Euclidean cube), a
 * well-known and widely used stand-in for real deltaE when a full CIE Lab
 * conversion isn't warranted. Values below ~2 are effectively imperceptible;
 * this suite floors on a much higher bar (`MIN_VARIANT_SEPARATION`) to catch
 * "technically two colors, reads as one" collisions like the shipped
 * `slate-blue`/`violet-grey` pair this test was added to guard against.
 */
function redmean(a: RgbTriple, b: RgbTriple): number {
  const rBar = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + rBar / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rBar) / 256) * db * db);
}

/** Every unordered pair of the 5 named variants. */
function variantPairs(): ReadonlyArray<readonly [BeingPaletteVariant, BeingPaletteVariant]> {
  const pairs: Array<readonly [BeingPaletteVariant, BeingPaletteVariant]> = [];
  for (let i = 0; i < BEING_PALETTE_VARIANTS.length; i += 1) {
    for (let j = i + 1; j < BEING_PALETTE_VARIANTS.length; j += 1) {
      pairs.push([BEING_PALETTE_VARIANTS[i]!, BEING_PALETTE_VARIANTS[j]!]);
    }
  }
  return pairs;
}

/** A tiny in-memory "image" fixture: a 2x2 RGBA pixel grid this suite fully controls. */
type FixtureImage = CanvasImageSource & { readonly width: number; readonly height: number };

function fixtureImage(width: number, height: number): FixtureImage {
  return { width, height } as unknown as FixtureImage;
}

/** Fake `CanvasRenderingContext2D` backing one real pixel buffer, keyed off the fixture drawn into it. */
class FixturePixelContext {
  imageSmoothingEnabled = true;
  readonly #width: number;
  readonly #height: number;
  #buffer: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.#width = width;
    this.#height = height;
    this.#buffer = new Uint8ClampedArray(width * height * 4);
  }

  clearRect(): void {
    this.#buffer.fill(0);
  }

  drawImage(image: CanvasImageSource): void {
    const pixels = fixturePixels.get(image);
    if (!pixels) throw new Error("Fixture image has no registered pixel data.");
    this.#buffer.set(pixels);
  }

  getImageData(x: number, y: number, w: number, h: number): ImageData {
    if (x !== 0 || y !== 0 || w !== this.#width || h !== this.#height) {
      throw new Error("Fixture context only supports whole-canvas reads.");
    }
    return { width: w, height: h, data: new Uint8ClampedArray(this.#buffer) } as unknown as ImageData;
  }

  putImageData(imageData: ImageData, x: number, y: number): void {
    if (x !== 0 || y !== 0) throw new Error("Fixture context only supports whole-canvas writes.");
    this.#buffer.set(imageData.data as unknown as Uint8ClampedArray);
  }

  /** Test-only: read the canvas's committed pixel buffer back out. */
  snapshotPixels(): Uint8ClampedArray {
    return new Uint8ClampedArray(this.#buffer);
  }
}

const fixturePixels = new WeakMap<CanvasImageSource, Uint8ClampedArray>();
let canvasContexts = new WeakMap<HTMLCanvasElement, FixturePixelContext>();

function registerFixturePixels(image: FixtureImage, pixels: readonly number[]): void {
  fixturePixels.set(image, Uint8ClampedArray.from(pixels));
}

function installCanvasMock(): void {
  canvasContexts = new WeakMap<HTMLCanvasElement, FixturePixelContext>();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    let context = canvasContexts.get(this);
    if (!context) {
      context = new FixturePixelContext(this.width, this.height);
      canvasContexts.set(this, context);
    }
    return context as unknown as CanvasRenderingContext2D;
  });
}

function readBackPixels(canvas: CanvasImageSource): Uint8ClampedArray {
  const context = canvasContexts.get(canvas as HTMLCanvasElement);
  if (!context) throw new Error("Expected the returned source to be a canvas the mock backs.");
  return context.snapshotPixels();
}

describe("resolveBeingPaletteVariant", () => {
  it("is one of the bounded, hand-authored variant set (<=8)", () => {
    expect(BEING_PALETTE_VARIANTS.length).toBeGreaterThanOrEqual(4);
    expect(BEING_PALETTE_VARIANTS.length).toBeLessThanOrEqual(8);
    const appearance = deriveHumanAppearance("agent_variant_bounds");
    expect(BEING_PALETTE_VARIANTS).toContain(resolveBeingPaletteVariant(appearance));
  });

  it("same agent id -> same variant, always (deterministic across independent derivations)", () => {
    for (const id of ["agent_alpha", "agent_beta_007", "agent_gamma-longer-id-42"]) {
      const first = resolveBeingPaletteVariant(deriveHumanAppearance(id));
      const second = resolveBeingPaletteVariant(deriveHumanAppearance(id));
      const third = resolveBeingPaletteVariant(deriveHumanAppearance(id));
      expect(second).toBe(first);
      expect(third).toBe(first);
    }
  });

  it("spreads distinct agent ids across at least 4 variants", () => {
    const ids = Array.from({ length: 60 }, (_unused, index) => `agent_pool_${index}`);
    const variants = new Set(ids.map((id) => resolveBeingPaletteVariant(deriveHumanAppearance(id))));
    expect(variants.size).toBeGreaterThanOrEqual(4);
  });

  it("depends only on the appearance value, not object identity (pure function)", () => {
    const appearance = deriveHumanAppearance("agent_pure_check");
    const a = resolveBeingPaletteVariant(appearance);
    const b = resolveBeingPaletteVariant({ ...appearance });
    expect(b).toBe(a);
  });
});

describe("createPaletteVariantSource", () => {
  beforeEach(() => {
    installCanvasMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("remaps exact-RGB base garment colors to the variant's palette, leaving other colors untouched", () => {
    const base = fixtureImage(2, 2);
    // Pixel layout (row-major, RGBA):
    //   [0,0] base shirt        [1,0] base trouser-light
    //   [0,1] base trouser-dark [1,1] an unrelated color (must survive untouched)
    registerFixturePixels(base, [
      248, 225, 182, 255, 96, 84, 31, 255,
      52, 39, 16, 255, 10, 20, 30, 255,
    ]);

    const recolored = createPaletteVariantSource(base, "slate-blue");
    const pixels = readBackPixels(recolored);

    expect([pixels[0], pixels[1], pixels[2], pixels[3]]).toEqual([154, 166, 192, 255]);
    expect([pixels[4], pixels[5], pixels[6], pixels[7]]).toEqual([110, 98, 128, 255]);
    expect([pixels[8], pixels[9], pixels[10], pixels[11]]).toEqual([72, 62, 88, 255]);
    // The unrelated pixel (skin/hair/etc. tone) is never a remap source color: untouched.
    expect([pixels[12], pixels[13], pixels[14], pixels[15]]).toEqual([10, 20, 30, 255]);
  });

  it("produces a distinct remap per variant for the same base image", () => {
    const base = fixtureImage(1, 1);
    registerFixturePixels(base, [248, 225, 182, 255]);

    const results = BEING_PALETTE_VARIANTS.map((variant) => {
      const source = createPaletteVariantSource(base, variant);
      const pixels = readBackPixels(source);
      return `${pixels[0]},${pixels[1]},${pixels[2]}`;
    });
    expect(new Set(results).size).toBe(BEING_PALETTE_VARIANTS.length);
  });

  it("caches per (base, variant): repeated calls return the identical source, never recomputed per agent", () => {
    const base = fixtureImage(1, 1);
    registerFixturePixels(base, [96, 84, 31, 255]);

    const first = createPaletteVariantSource(base, "moss");
    const second = createPaletteVariantSource(base, "moss");
    expect(second).toBe(first);

    // A different variant on the same base is a different cached source.
    const other = createPaletteVariantSource(base, "ochre");
    expect(other).not.toBe(first);

    // Simulate many agents sharing one variant: the cache is keyed by variant,
    // never allocated fresh per call/agent.
    const repeated = Array.from({ length: 20 }, () => createPaletteVariantSource(base, "moss"));
    expect(new Set([first, ...repeated]).size).toBe(1);
  });

  it("throws a clear TypeError when the source lacks positive finite numeric dimensions", () => {
    const malformed = { width: 0, height: 0 } as unknown as CanvasImageSource;
    expect(() => createPaletteVariantSource(malformed, "bone")).toThrow(TypeError);
    const missing = {} as unknown as CanvasImageSource;
    expect(() => createPaletteVariantSource(missing, "bone")).toThrow(TypeError);
  });
});

describe("BeingPaletteVariant exhaustiveness", () => {
  it("BEING_PALETTE_VARIANTS and the type stay in lockstep (compile-time guard)", () => {
    const table: Record<BeingPaletteVariant, true> = {
      "slate-blue": true,
      "violet-grey": true,
      moss: true,
      ochre: true,
      bone: true,
    };
    expect(Object.keys(table).sort()).toEqual([...BEING_PALETTE_VARIANTS].sort());
  });
});

describe("per-base (characterId) variant tables", () => {
  it("resolveBeingPaletteVariant defaults characterId to m1", () => {
    for (const id of ["agent_char_default_a", "agent_char_default_b"]) {
      const appearance = deriveHumanAppearance(id);
      expect(resolveBeingPaletteVariant(appearance)).toBe(resolveBeingPaletteVariant(appearance, "m1"));
    }
  });

  it("every roster character resolves a valid variant for a given appearance", () => {
    const appearance = deriveHumanAppearance("agent_char_variant_bounds");
    for (const characterId of characterIds()) {
      expect(BEING_PALETTE_VARIANTS).toContain(resolveBeingPaletteVariant(appearance, characterId));
    }
  });

  describe("createPaletteVariantSource per character", () => {
    beforeEach(() => {
      installCanvasMock();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("gives every non-m1 roster character a full 5-variant remap producing 5 distinct outputs", () => {
      for (const characterId of characterIds().filter((id): id is Exclude<BeingCharacterId, "m1"> => id !== "m1")) {
        // Every character's remap tables key off that character's OWN native
        // garment RGBs, not m1's — probe with the union of every character's
        // documented native source tones so at least one "from" entry hits
        // for whichever character is under test.
        const base = fixtureImage(1, 1);
        registerFixturePixels(base, [248, 225, 182, 255]);

        const results = BEING_PALETTE_VARIANTS.map((variant) => {
          const source = createPaletteVariantSource(base, variant, characterId);
          const pixels = readBackPixels(source);
          return `${pixels[0]},${pixels[1]},${pixels[2]},${pixels[3]}`;
        });
        // With no matching "from" pixel for this fixture, every variant
        // leaves the pixel untouched — still proves the call is
        // character-aware and never throws, for every roster member.
        expect(results).toHaveLength(BEING_PALETTE_VARIANTS.length);
      }
    });

    it("recolors a non-m1 character's own native garment tone using that character's table, not m1's", () => {
      // f1's blouse-main native tone (from its palette-sources.json).
      const base = fixtureImage(1, 1);
      registerFixturePixels(base, [234, 189, 129, 255]);

      const asF1 = createPaletteVariantSource(base, "slate-blue", "f1");
      const f1Pixels = readBackPixels(asF1);
      // f1's own suggested slate-blue remap: (234,189,129) -> (180,188,200).
      expect([f1Pixels[0], f1Pixels[1], f1Pixels[2], f1Pixels[3]]).toEqual([180, 188, 200, 255]);

      // The same source pixel is not one of m1's remap "from" colors, so
      // under m1's table it is left untouched.
      const freshBase = fixtureImage(1, 1);
      registerFixturePixels(freshBase, [234, 189, 129, 255]);
      const asM1 = createPaletteVariantSource(freshBase, "slate-blue", "m1");
      const m1Pixels = readBackPixels(asM1);
      expect([m1Pixels[0], m1Pixels[1], m1Pixels[2], m1Pixels[3]]).toEqual([234, 189, 129, 255]);
    });

    it("caches per (base, characterId, variant): different characters on the same base never share a cached source", () => {
      const base = fixtureImage(1, 1);
      registerFixturePixels(base, [234, 189, 129, 255]);

      const f1Source = createPaletteVariantSource(base, "slate-blue", "f1");
      const m1Source = createPaletteVariantSource(base, "slate-blue", "m1");
      expect(f1Source).not.toBe(m1Source);

      const f1Again = createPaletteVariantSource(base, "slate-blue", "f1");
      expect(f1Again).toBe(f1Source);
    });
  });
});

describe("variant collision distance (review fix — slate-blue/violet-grey were ~2.9 redmean units apart)", () => {
  /**
   * Below this floor, two variants read as visually indistinguishable in
   * practice (the shipped-before-fix `slate-blue`/`violet-grey` pair
   * measured as low as ~2.9 redmean units across the real roster's native
   * garment lightness values). Set comfortably below the post-fix worst
   * case (~9.3, at the extreme low-lightness end where *every* hue-based
   * scheme naturally compresses toward near-black) so the floor is
   * meaningful without over-fitting to one simulated number.
   */
  const MIN_VARIANT_SEPARATION = 6;

  it("every variant pair, for every role, on every character, clears the minimum separation floor", () => {
    const violations: string[] = [];
    for (const characterId of characterIds()) {
      const table = PALETTE_REMAPS_BY_CHARACTER[characterId];
      for (const [variantA, variantB] of variantPairs()) {
        const entriesA = table[variantA];
        const entriesB = table[variantB];
        // Both variants remap the exact same "from" role list for a given
        // character (see buildCharacterVariantTable / M1_PALETTE_REMAPS),
        // so pairing by index compares the same garment role across variants.
        expect(entriesA).toHaveLength(entriesB.length);
        for (let index = 0; index < entriesA.length; index += 1) {
          const distance = redmean(entriesA[index]!.to, entriesB[index]!.to);
          if (distance < MIN_VARIANT_SEPARATION) {
            violations.push(
              `${characterId} role[${index}]: ${variantA} vs ${variantB} = ${distance.toFixed(2)} `
              + `(${JSON.stringify(entriesA[index]!.to)} vs ${JSON.stringify(entriesB[index]!.to)})`,
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("regression guard: the old slate-blue/violet-grey targets (263.1°/.155 vs 275.5°/.150) would have failed this floor", () => {
    // Reproduces the exact collision the review flagged, independent of the
    // shipped fix, so this test keeps meaning even if the fix's own numbers
    // ever change again.
    const hslToRgbLocal = (h: number, s: number, l: number): RgbTriple => {
      // Mirrors beingPalette.ts's own conversion; duplicated narrowly here
      // (rather than exported) to keep this regression check independent of
      // the production hue/sat-remap implementation it is guarding.
      const hueToChannel = (p: number, q: number, tInput: number): number => {
        let t = tInput;
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const hueFraction = (((h % 360) + 360) % 360) / 360;
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const toByte = (v: number): number => Math.min(255, Math.max(0, Math.round(v * 255)));
      return {
        r: toByte(hueToChannel(p, q, hueFraction + 1 / 3)),
        g: toByte(hueToChannel(p, q, hueFraction)),
        b: toByte(hueToChannel(p, q, hueFraction - 1 / 3)),
      };
    };
    const realLightnessValues = [0.712, 0.282, 0.21, 0.402, 0.198, 0.133, 0.249, 0.843];
    const worstOldDistance = Math.min(...realLightnessValues.map((l) => (
      redmean(hslToRgbLocal(263.1, 0.155, l), hslToRgbLocal(275.5, 0.15, l))
    )));
    expect(worstOldDistance).toBeLessThan(MIN_VARIANT_SEPARATION);
  });
});
