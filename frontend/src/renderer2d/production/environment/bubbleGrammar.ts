import type {
  OverlayFamily,
  OverlayGlyph,
} from "../../../presentation/eventLegibilityMap";

/**
 * The pixel craft behind the world's legibility overlay
 * (`docs/frontend/BUBBLE_UI.md`).
 *
 * Everything here is authored in **world pixels at 1x** and rasterised into a
 * {@link PixelSurface}; the caller blits that surface at an integer scale, so
 * chrome is never sub-pixel at any camera zoom. Nothing in this module touches
 * a real canvas until blit time, and **nothing measures text**: layout is a
 * fixed 6px advance over a hand-authored 5x8 bitmap font, so wrapping is
 * byte-identical in jsdom and in a browser (the deterministic-wrap constraint
 * the previous overlay established and this one keeps).
 *
 * A system font is deliberately not used: at 5-8px hinting is unreliable, and a
 * system font instantly reads as "UI" rather than "world".
 */

// ---------------------------------------------------------------------------
// palette
// ---------------------------------------------------------------------------

/**
 * The bubble body is **always** this cream vellum. Family colour appears only
 * as a thin accent (stem, edge bar, glyph ink). Six saturated fills would read
 * as a candy HUD; one vellum chip with a coloured detail reads as a painted
 * sign in a warm, muted world.
 */
export const OVERLAY_PALETTE = Object.freeze({
  ink: "#12180f",
  inkSoft: "#2f3a2b",
  vellum: "#f3ebce",
  vellumHigh: "#fdf8e6",
  vellumLow: "#d6c69c",
  bone: "#e8dcc0",
  /** Unlit gather dot: present but not yet filled. */
  gatherIdle: "#e0d3ab",
});

/** Accent per family. Colour is the coarse channel; the glyph is the fine one. */
export const OVERLAY_FAMILY_ACCENT: Readonly<Record<OverlayFamily, string>> = Object.freeze({
  exchange: "#b8801f",
  bond: "#a35f69",
  harm: "#9c3b26",
  dwell: "#57783f",
  body: "#5f7285",
  world: "#8a8270",
});

/**
 * Identity hues, chosen to read against both moss grass (`#b4bc6c`) and sand
 * (`#d4bc94`) — no greens, nothing that sinks into terrain. Derived from a
 * being's id alone; it colours exactly two things (the speech tail and a
 * receiver cap's core) and **claims nothing about who the being is**.
 */
const IDENTITY_HUES = Object.freeze([
  "#9c4a33", "#74506e", "#43607f", "#8a5a12",
  "#2f6b66", "#7a2f35", "#3d4a78", "#6b4426",
]);

/** FNV-1a over a being id — stable across sessions, machines and replays. */
function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** The stable identity hue for one being id. */
export function identityHue(id: string): string {
  return IDENTITY_HUES[stableHash(id) % IDENTITY_HUES.length]!;
}

// ---------------------------------------------------------------------------
// type + glyphs
// ---------------------------------------------------------------------------

/** Glyph cell metrics, in world px at 1x. */
export const FONT_WIDTH = 5;
export const FONT_HEIGHT = 8;
/** 5px cell + 1px letterspace. Fixed advance is what makes layout deterministic. */
export const FONT_ADVANCE = 6;
export const FONT_LINE_HEIGHT = 9;
/** Verb glyphs are 9x9 — the readable unit at 1x. */
export const GLYPH_SIZE = 9;

/**
 * Hand-authored 5x8 1-bit type. Rows are `/`-separated, `#` is ink.
 * Cap height rows 0-6, baseline row 6, descender row 7.
 */
const FONT_ROWS: Readonly<Record<string, string>> = {
  " ": "...../...../...../...../...../...../...../.....",
  A: ".###./#...#/#...#/#####/#...#/#...#/#...#/.....",
  B: "####./#...#/#...#/####./#...#/#...#/####./.....",
  C: ".###./#...#/#..../#..../#..../#...#/.###./.....",
  D: "####./#...#/#...#/#...#/#...#/#...#/####./.....",
  E: "#####/#..../#..../####./#..../#..../#####/.....",
  F: "#####/#..../#..../####./#..../#..../#..../.....",
  G: ".###./#...#/#..../#.###/#...#/#...#/.###./.....",
  H: "#...#/#...#/#...#/#####/#...#/#...#/#...#/.....",
  I: ".###./..#../..#../..#../..#../..#../.###./.....",
  J: "..###/...#./...#./...#./...#./#..#./.##../.....",
  K: "#...#/#..#./#.#../##.../#.#../#..#./#...#/.....",
  L: "#..../#..../#..../#..../#..../#..../#####/.....",
  M: "#...#/##.##/#.#.#/#...#/#...#/#...#/#...#/.....",
  N: "#...#/##..#/#.#.#/#..##/#...#/#...#/#...#/.....",
  O: ".###./#...#/#...#/#...#/#...#/#...#/.###./.....",
  P: "####./#...#/#...#/####./#..../#..../#..../.....",
  Q: ".###./#...#/#...#/#...#/#.#.#/#..#./.##.#/.....",
  R: "####./#...#/#...#/####./#.#../#..#./#...#/.....",
  S: ".####/#..../#..../.###./....#/....#/####./.....",
  T: "#####/..#../..#../..#../..#../..#../..#../.....",
  U: "#...#/#...#/#...#/#...#/#...#/#...#/.###./.....",
  V: "#...#/#...#/#...#/#...#/#...#/.#.#./..#../.....",
  W: "#...#/#...#/#...#/#...#/#.#.#/##.##/#...#/.....",
  X: "#...#/#...#/.#.#./..#../.#.#./#...#/#...#/.....",
  Y: "#...#/#...#/.#.#./..#../..#../..#../..#../.....",
  Z: "#####/....#/...#./..#../.#.../#..../#####/.....",
  a: "...../...../.###./....#/.####/#...#/.####/.....",
  b: "#..../#..../####./#...#/#...#/#...#/####./.....",
  c: "...../...../.###./#..../#..../#..../.###./.....",
  d: "....#/....#/.####/#...#/#...#/#...#/.####/.....",
  e: "...../...../.###./#...#/#####/#..../.###./.....",
  f: "..##./.#.../####./.#.../.#.../.#.../.#.../.....",
  g: "...../...../.####/#...#/#...#/.####/....#/.###.",
  h: "#..../#..../####./#...#/#...#/#...#/#...#/.....",
  i: "..#../...../.##../..#../..#../..#../.###./.....",
  j: "...#./...../..##./...#./...#./...#./...#./.##..",
  k: "#..../#..../#..#./#.#../##.../#.#../#..#./.....",
  l: ".##../..#../..#../..#../..#../..#../.###./.....",
  m: "...../...../##.#./#.#.#/#.#.#/#.#.#/#.#.#/.....",
  n: "...../...../####./#...#/#...#/#...#/#...#/.....",
  o: "...../...../.###./#...#/#...#/#...#/.###./.....",
  p: "...../...../####./#...#/#...#/####./#..../#....",
  q: "...../...../.####/#...#/#...#/.####/....#/....#",
  r: "...../...../#.##./##.../#..../#..../#..../.....",
  s: "...../...../.####/#..../.###./....#/####./.....",
  t: ".#.../.#.../####./.#.../.#.../.#.../..##./.....",
  u: "...../...../#...#/#...#/#...#/#...#/.####/.....",
  v: "...../...../#...#/#...#/#...#/.#.#./..#../.....",
  w: "...../...../#.#.#/#.#.#/#.#.#/#.#.#/.#.#./.....",
  x: "...../...../#...#/.#.#./..#../.#.#./#...#/.....",
  y: "...../...../#...#/#...#/#...#/.####/....#/.###.",
  z: "...../...../#####/...#./..#../.#.../#####/.....",
  "0": ".###./#...#/#..##/#.#.#/##..#/#...#/.###./.....",
  "1": "..#../.##../..#../..#../..#../..#../.###./.....",
  "2": ".###./#...#/....#/...#./..#../.#.../#####/.....",
  "3": "#####/...#./..##./....#/....#/#...#/.###./.....",
  "4": "...#./..##./.#.#./#..#./#####/...#./...#./.....",
  "5": "#####/#..../####./....#/....#/#...#/.###./.....",
  "6": "..##./.#.../#..../####./#...#/#...#/.###./.....",
  "7": "#####/....#/...#./..#../.#.../.#.../.#.../.....",
  "8": ".###./#...#/#...#/.###./#...#/#...#/.###./.....",
  "9": ".###./#...#/#...#/.####/....#/...#./.##../.....",
  ".": "...../...../...../...../...../...../..#../.....",
  ",": "...../...../...../...../...../..#../..#../.#...",
  "'": "..#../..#../...../...../...../...../...../.....",
  '"': ".#.#./.#.#./...../...../...../...../...../.....",
  "?": ".###./#...#/....#/...#./..#../...../..#../.....",
  "!": "..#../..#../..#../..#../..#../...../..#../.....",
  "-": "...../...../...../.###./...../...../...../.....",
  ":": "...../...../..#../...../...../..#../...../.....",
  ";": "...../...../..#../...../...../..#../..#../.#...",
  "(": "...#./..#../.#.../.#.../.#.../..#../...#./.....",
  ")": ".#.../..#../...#./...#./...#./..#../.#.../.....",
  "/": "....#/....#/...#./..#../.#.../#..../#..../.....",
  "+": "...../..#../..#../#####/..#../..#../...../.....",
  "=": "...../...../#####/...../#####/...../...../.....",
  "%": "##..#/##.#./...#./..#../.#.../#.##./#..##/.....",
  "*": "...../#.#.#/.###./#####/.###./#.#.#/...../.....",
  "…": "...../...../...../...../...../...../#.#.#/.....",
  "→": "...../..#../...#./#####/...#./..#../...../.....",
  "—": "...../...../...../#####/...../...../...../.....",
  "–": "...../...../...../.###./...../...../...../.....",
  "’": "..#../..#../...../...../...../...../...../.....",
  "“": ".#.#./.#.#./...../...../...../...../...../.....",
  "”": ".#.#./.#.#./...../...../...../...../...../.....",
};

/**
 * The 25 verb glyphs, 9x9 1-bit, `,`-separated rows. Designed to read as
 * silhouettes at 9 physical px (1x zoom). `join`/`depart` and
 * `scavenge`/`collapse` are deliberate mirror pairs; `outward`/`inward` are
 * double chevrons, distinct from the single chevron + doorway of join/depart.
 *
 * Typed as a total `Record<OverlayGlyph, string>`: a glyph added to the
 * grammar's vocabulary fails to compile until it is drawn.
 */
const GLYPH_ROWS: Readonly<Record<OverlayGlyph, string>> = {
  // exchange
  give: ".........,.........,###...#..,###...##.,###...###,###...##.,###...#..,.........,.........",
  gather: "....#....,..#.#.#..,.#..#..#.,..#.#.#..,.#..#..#.,....#....,...###...,..#####..,.........",
  hoard: ".........,.........,...###...,...###...,.#######.,.#######.,#########,#########,.........",
  // bond
  propose: ".........,.........,.##...##.,#..#.#..#,#..###..#,.##...##.,.........,.........,.........",
  refuse: ".........,...###...,..#...#..,.#.#...#.,.#..#..#.,.#...#.#.,..#...#..,...###...,.........",
  lapse: ".........,.#######.,..#####..,...###...,....#....,...###...,..#####..,.#######.,.........",
  birth: "....#....,..#.#.#..,...###...,.##.#.##.,...###...,..#.#.#..,....#....,.........,.........",
  // harm
  strike: ".....###.,....##...,...##....,..#####..,.....##..,....##...,...##....,..##.....,.........",
  breach: "###...###,##.....##,#.......#,##.....##,####.####,#########,##.###.##,#########,.........",
  thieve: "######...,#....#...,#......#.,#....####,#......#.,#....#...,######...,.........,.........",
  fell: "....#....,....#....,....#....,..#####..,...###...,....#....,.........,.........,#########",
  decay: "....#....,..#...#..,.#.....#.,....#....,..#...#..,.........,..#####..,.#######.,.........",
  // dwell
  build: "..#####..,..#####..,..#####..,....#....,....#....,....#....,....#....,....#....,.........",
  hearth: "....#....,...###...,..##.##..,.##...##.,.#..#..#.,.#.###.#.,..#####..,...###...,.........",
  join: ".....####,.#...#..#,..#..#..#,...#.#..#,..#..#..#,.#...#..#,.....####,.........,.........",
  depart: ".....####,...#.#..#,..#..#..#,.#...#..#,..#..#..#,...#.#..#,.....####,.........,.........",
  claim: "..######.,..######.,..####...,..#......,..#......,..#......,..#......,.###.....,#####....",
  scavenge: "....#....,...###...,..#####..,.........,.........,.#..##...,###.####.,#########,.........",
  collapse: ".#######.,..#####..,...###...,....#....,.........,.#..##...,###.####.,#########,.........",
  // body
  halt: ".........,..##.##..,..##.##..,..##.##..,..##.##..,..##.##..,..##.##..,.........,.........",
  rise: ".........,....#....,...###...,..#####..,.#######.,....#....,....#....,....#....,.........",
  // world
  outward: ".........,.#...#...,..#...#..,...#...#.,..#...#..,.#...#...,.........,.........,.........",
  inward: ".........,...#...#.,..#...#..,.#...#...,..#...#..,...#...#.,.........,.........,.........",
  dawn: ".........,....#....,#..###..#,.#######.,..#####..,.#######.,.........,#########,.........",
  // utility — the low-zoom studs for the three text kinds
  quote: ".........,..##.##..,..##.##..,..##.##..,..#..#...,.#..#....,.........,.........,.........",
  ellipsis: ".........,.........,.........,.........,.##.##.##,.##.##.##,.........,.........,.........",
};

function decodeBits(source: string, separator: string): readonly (readonly boolean[])[] {
  return source.split(separator).map((row) => [...row].map((cell) => cell === "#"));
}

const FONT_BITS: ReadonlyMap<string, readonly (readonly boolean[])[]> = new Map(
  Object.entries(FONT_ROWS).map(([key, rows]) => [key, decodeBits(rows, "/")]),
);
const GLYPH_BITS: ReadonlyMap<string, readonly (readonly boolean[])[]> = new Map(
  Object.entries(GLYPH_ROWS).map(([key, rows]) => [key, decodeBits(rows, ",")]),
);

/** Every glyph name the grammar can draw — used by tests to prove full coverage. */
export const OVERLAY_GLYPH_NAMES = Object.freeze(Object.keys(GLYPH_ROWS) as OverlayGlyph[]);

/** True when a character has an authored bitmap (an unmapped char renders as `?`). */
export function hasFontGlyph(character: string): boolean {
  return FONT_BITS.has(character);
}

// ---------------------------------------------------------------------------
// pixel surface
// ---------------------------------------------------------------------------

/** Empty pixel sentinel in {@link PixelSurface}'s index buffer. */
const EMPTY = -1;

/**
 * A rasterised 1x chrome sprite: an indexed pixel buffer plus its own small
 * palette, with the anchor pixel that must land on the world point it belongs
 * to.
 *
 * It is deliberately *not* a canvas. A canvas cannot be created in the jsdom
 * test environment, and the surface must be inspectable pixel-by-pixel in unit
 * tests. The browser fast path materialises a canvas lazily on first blit and
 * caches it; the fallback path paints run-length spans with `fillRect`, and
 * both are generated from this one buffer, so their geometry is identical by
 * construction.
 */
export class PixelSurface {
  readonly width: number;
  readonly height: number;
  /** Anchor x, in surface px: the column that lands on the world anchor. */
  ax = 0;
  /** Anchor y, in surface px: the row that lands on the world anchor. */
  ay = 0;
  private readonly indices: Int16Array;
  private readonly palette: string[] = [];
  private readonly paletteIndex = new Map<string, number>();
  private canvasCache: HTMLCanvasElement | null = null;
  private canvasAttempted = false;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.indices = new Int16Array(this.width * this.height).fill(EMPTY);
  }

  /** Paint one pixel. Out-of-bounds writes are dropped, never clamped. */
  set(x: number, y: number, color: string): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    let index = this.paletteIndex.get(color);
    if (index === undefined) {
      index = this.palette.length;
      this.palette.push(color);
      this.paletteIndex.set(color, index);
    }
    this.indices[py * this.width + px] = index;
  }

  /** The colour at one pixel, or `null` when empty. Test/inspection surface. */
  at(x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    const index = this.indices[y * this.width + x]!;
    return index === EMPTY ? null : this.palette[index]!;
  }

  /** Count of painted pixels — a cheap non-emptiness assertion for tests. */
  get paintedCount(): number {
    let total = 0;
    for (const index of this.indices) if (index !== EMPTY) total += 1;
    return total;
  }

  /**
   * Draw this surface with its anchor pixel at `(anchorX, anchorY)` device px,
   * magnified by an integer `scale`.
   *
   * Uses a cached offscreen canvas when the host provides one (browsers), and
   * run-length `fillRect` spans otherwise (jsdom). Both produce the same
   * pixels; the span path is what unit tests observe.
   */
  blit(
    context: CanvasRenderingContext2D,
    anchorX: number,
    anchorY: number,
    scale: number,
    alpha = 1,
  ): void {
    const step = Math.max(1, Math.round(scale));
    const originX = Math.round(anchorX) - this.ax * step;
    const originY = Math.round(anchorY) - this.ay * step;
    const previousAlpha = context.globalAlpha;
    if (alpha !== 1) context.globalAlpha = previousAlpha * alpha;
    const canvas = this.toCanvas(context);
    if (canvas !== null) {
      context.drawImage(
        canvas,
        0, 0, this.width, this.height,
        originX, originY, this.width * step, this.height * step,
      );
    } else {
      this.paintSpans(context, originX, originY, step);
    }
    if (alpha !== 1) context.globalAlpha = previousAlpha;
  }

  /** Row-wise run-length span painting — one `fillRect` per run of one colour. */
  private paintSpans(
    context: CanvasRenderingContext2D,
    originX: number,
    originY: number,
    step: number,
  ): void {
    for (let y = 0; y < this.height; y += 1) {
      let runStart = -1;
      let runIndex = EMPTY;
      for (let x = 0; x <= this.width; x += 1) {
        const index = x === this.width ? EMPTY : this.indices[y * this.width + x]!;
        if (index === runIndex) continue;
        if (runIndex !== EMPTY && runStart >= 0) {
          context.fillStyle = this.palette[runIndex]!;
          context.fillRect(
            originX + runStart * step,
            originY + y * step,
            (x - runStart) * step,
            step,
          );
        }
        runIndex = index;
        runStart = index === EMPTY ? -1 : x;
      }
    }
  }

  /**
   * Materialise (once) an offscreen 1x canvas of this surface.
   *
   * Only attempted when the destination context exposes `getTransform`, which
   * is the same capability probe the screen-space blit path uses: it is true in
   * every real browser and false for the recording stub used by unit tests, so
   * jsdom never tries (and never logs) an unimplemented `getContext("2d")`.
   */
  private toCanvas(context: CanvasRenderingContext2D): HTMLCanvasElement | null {
    if (this.canvasAttempted) return this.canvasCache;
    this.canvasAttempted = true;
    if (typeof document === "undefined" || typeof context.getTransform !== "function") return null;
    let target: CanvasRenderingContext2D | null = null;
    let element: HTMLCanvasElement;
    try {
      element = document.createElement("canvas");
      element.width = this.width;
      element.height = this.height;
      target = element.getContext("2d");
    } catch {
      return null;
    }
    if (target === null) return null;
    const image = target.createImageData(this.width, this.height);
    const rgba = new Map<number, readonly [number, number, number]>();
    for (let index = 0; index < this.palette.length; index += 1) {
      rgba.set(index, parseHexColor(this.palette[index]!));
    }
    for (let pixel = 0; pixel < this.indices.length; pixel += 1) {
      const index = this.indices[pixel]!;
      if (index === EMPTY) continue;
      const [r, g, b] = rgba.get(index)!;
      const offset = pixel * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = 255;
    }
    target.putImageData(image, 0, 0);
    this.canvasCache = element;
    return element;
  }
}

function parseHexColor(color: string): readonly [number, number, number] {
  const hex = color.startsWith("#") ? color.slice(1) : color;
  if (hex.length === 3) {
    return [
      parseInt(hex[0]! + hex[0]!, 16),
      parseInt(hex[1]! + hex[1]!, 16),
      parseInt(hex[2]! + hex[2]!, 16),
    ];
  }
  return [
    parseInt(hex.slice(0, 2), 16) || 0,
    parseInt(hex.slice(2, 4), 16) || 0,
    parseInt(hex.slice(4, 6), 16) || 0,
  ];
}

// ---------------------------------------------------------------------------
// mask painting
// ---------------------------------------------------------------------------

type Mask = (x: number, y: number) => boolean;

interface PaintOptions {
  readonly body: string;
  readonly edge: string;
  /** Dotted outline — whisper and thought. */
  readonly dash?: boolean;
  /** 1px inner bevel, so the chip reads as physical vellum. Off for bursts/pips. */
  readonly bevel?: boolean;
  readonly high?: string;
  readonly low?: string;
}

/**
 * Fill a mask, outline it, then add a 1px inner bevel (light on top, shade on
 * the bottom). Three passes over the surface, deterministic, no antialiasing.
 */
function paintMask(surface: PixelSurface, inside: Mask, options: PaintOptions): void {
  const { width, height } = surface;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (inside(x, y)) surface.set(x, y, options.body);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inside(x, y)) continue;
      if (!isMaskEdge(inside, x, y)) continue;
      if (options.dash === true && (x + y) % 5 < 2) continue;
      surface.set(x, y, options.edge);
    }
  }
  if (options.bevel === false) return;
  const high = options.high ?? OVERLAY_PALETTE.vellumHigh;
  const low = options.low ?? OVERLAY_PALETTE.vellumLow;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inside(x, y) || isMaskEdge(inside, x, y)) continue;
      if (!inside(x, y - 2)) surface.set(x, y, high);
      else if (!inside(x, y + 2)) surface.set(x, y, low);
    }
  }
}

function isMaskEdge(inside: Mask, x: number, y: number): boolean {
  return !inside(x, y - 1) || !inside(x, y + 1) || !inside(x - 1, y) || !inside(x + 1, y);
}

/** Rounded rectangle with pixel-stepped corners of radius `r`. */
function roundRectMask(width: number, height: number, radius: number): Mask {
  return (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const cx = x < radius ? radius - x : (x >= width - radius ? x - (width - 1 - radius) : 0);
    const cy = y < radius ? radius - y : (y >= height - radius ? y - (height - 1 - radius) : 0);
    return cx + cy <= radius;
  };
}

/** An inscribed ellipse unioned with a deterministic ring of bumps. */
function cloudMask(width: number, height: number): Mask {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const rx = width / 2 - 3.2;
  const ry = height / 2 - 3.2;
  const bumpCount = Math.max(7, Math.round((width + height) / 9));
  const bumps: Array<readonly [number, number, number]> = [];
  for (let index = 0; index < bumpCount; index += 1) {
    const angle = (index / bumpCount) * Math.PI * 2;
    bumps.push([
      cx + Math.cos(angle) * rx,
      cy + Math.sin(angle) * ry,
      3.1 + (index % 3) * 0.55,
    ]);
  }
  return (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    if (dx * dx + dy * dy <= 1) return true;
    for (const [bx, by, br] of bumps) {
      const ax = x - bx;
      const ay = y - by;
      if (ax * ax + ay * ay <= br * br) return true;
    }
    return false;
  };
}

/**
 * Flat top and bottom, both ends chamfered to a point at mid-height.
 * Deliberately neither balloon nor rectangle — it reads as a planted sign.
 */
function bannerMask(width: number, height: number, taper: number): Mask {
  const mid = (height - 1) / 2;
  return (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const inset = Math.round(taper * (Math.abs(y - mid) / mid));
    return x >= inset && x <= width - 1 - inset;
  };
}

/** Spiked star for the violent and terminal beats. */
function burstMask(width: number, height: number, spikes: number, seed: number): Mask {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const outer = width / 2;
  const inner = width * 0.33;
  const jitter = (index: number): number => {
    const raw = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
    return 0.86 + 0.28 * (((raw % 1) + 1) % 1);
  };
  return (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const dx = x - cx;
    const dy = (y - cy) * (width / height);
    const angle = Math.atan2(dy, dx);
    const k = ((angle + Math.PI) / (Math.PI * 2)) * spikes;
    const f = 1 - Math.abs((k % 1) - 0.5) * 2;
    const radius = (inner + (outer - inner) * f) * jitter(Math.floor(k));
    return Math.hypot(dx, dy) <= radius;
  };
}

// ---------------------------------------------------------------------------
// type rendering
// ---------------------------------------------------------------------------

/** Draw one string of 5x8 type at a fixed 6px advance. */
export function drawPixelText(
  surface: PixelSurface,
  text: string,
  x: number,
  y: number,
  color: string,
): void {
  let cursor = x;
  for (const character of text) {
    const bits = FONT_BITS.get(character) ?? FONT_BITS.get("?")!;
    for (let row = 0; row < FONT_HEIGHT; row += 1) {
      const line = bits[row]!;
      for (let column = 0; column < FONT_WIDTH; column += 1) {
        if (line[column] === true) surface.set(cursor + column, y + row, color);
      }
    }
    cursor += FONT_ADVANCE;
  }
}

/** Draw one 9x9 verb glyph. */
export function drawGlyph(
  surface: PixelSurface,
  glyph: OverlayGlyph,
  x: number,
  y: number,
  color: string,
): void {
  const bits = GLYPH_BITS.get(glyph);
  if (bits === undefined) return;
  for (let row = 0; row < GLYPH_SIZE; row += 1) {
    const line = bits[row]!;
    for (let column = 0; column < GLYPH_SIZE; column += 1) {
      if (line[column] === true) surface.set(x + column, y + row, color);
    }
  }
}

/** Width in world px of a string at the fixed advance (no `measureText`, ever). */
export function pixelTextWidth(text: string): number {
  return text.length === 0 ? 0 : text.length * FONT_ADVANCE - 1;
}

// ---------------------------------------------------------------------------
// excerpting — the answer to 385-character messages
// ---------------------------------------------------------------------------

export interface ExcerptLayout {
  readonly lines: readonly string[];
  /** Characters actually shown, after sentence-boundary trimming. */
  readonly shown: number;
  /** Characters in the whitespace-normalised source message. */
  readonly total: number;
  readonly truncated: boolean;
}

/**
 * Fit a real message into a bubble as an **opening excerpt**, preferring to end
 * on a sentence boundary.
 *
 * Real payload messages measure a median of 385 characters (max 1153, over
 * 3,363 samples); a bubble above a 22px sprite cannot be a transcript, so it is
 * not one — it is a presence, and the fullness bar reports how much was left
 * unsaid. The complete text keeps its home in the DOM dialogue panel.
 *
 * A sentence boundary is honoured only when it falls in the last 40% of the
 * filled text: a clause that *ends* is far more beautiful than a clause that
 * stops, but cutting at the first period would throw away most of the budget.
 * The ellipsis is never appended mid-word and never after a period.
 */
export function layoutExcerpt(text: string, maxChars: number, maxLines: number): ExcerptLayout {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length === 0) return { lines: [""], shown: 0, total: 0, truncated: false };
  const lines: string[] = [];
  let current = "";
  let done = false;
  for (const rawWord of clean.split(" ")) {
    let word = rawWord;
    while (word.length > maxChars) {
      const head = `${word.slice(0, maxChars - 1)}-`;
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }
      if (lines.length >= maxLines) {
        done = true;
        break;
      }
      lines.push(head);
      word = word.slice(maxChars - 1);
    }
    if (done) break;
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length >= maxLines) {
      done = true;
      break;
    }
  }
  if (!done && current.length > 0) lines.push(current);
  let shown = lines.join(" ").length;
  const truncated = shown < clean.length;

  if (truncated) {
    const flat = lines.join(" ");
    const boundaries = [...flat.matchAll(/[.!?…](?=\s|$)/g)];
    const last = boundaries.length > 0
      ? boundaries[boundaries.length - 1]!.index + 1
      : -1;
    if (last > 0 && last >= flat.length * 0.6) {
      const kept = flat.slice(0, last);
      const rewrapped: string[] = [];
      let line = "";
      for (const word of kept.split(" ")) {
        const candidate = line.length === 0 ? word : `${line} ${word}`;
        if (candidate.length <= maxChars) line = candidate;
        else {
          rewrapped.push(line);
          line = word;
        }
      }
      if (line.length > 0) rewrapped.push(line);
      lines.length = 0;
      lines.push(...rewrapped);
      shown = kept.length;
    }
  }
  if (truncated && lines.length > 0) {
    const index = lines.length - 1;
    const line = lines[index]!;
    if (!/[.!?…]$/.test(line)) {
      if (line.length + 1 <= maxChars) lines[index] = `${line}…`;
      else {
        const cut = line.lastIndexOf(" ");
        lines[index] = `${cut > 0 ? line.slice(0, cut) : line.slice(0, maxChars - 1)}…`;
      }
    }
  }
  return { lines, shown, total: clean.length, truncated };
}

// ---------------------------------------------------------------------------
// the five silhouettes
// ---------------------------------------------------------------------------

/** Fat tail height in world px — 3x the rejected overlay's 5px stepped tail. */
const TAIL_HEIGHT = 10;
/** Tail base width — 5x the rejected overlay's 1-3px. */
const TAIL_BASE = 15;
/** The hard ink chip pinned on the crown of the head. */
const STUD = 3;
/** Thought puffs descend further than a tail: they are detached. */
const THOUGHT_CONNECTOR = 22;
/** Tail lean is clamped to this many world px toward the addressee. */
export const MAX_TAIL_LEAN = 14;

/** Line budget per text kind. Thought is deliberately the narrowest. */
export const TEXT_KIND_METRICS = Object.freeze({
  speech: { maxChars: 18, padX: 5, padY: 4, alpha: 1 },
  whisper: { maxChars: 16, padX: 5, padY: 4, alpha: 1 },
  thought: { maxChars: 14, padX: 8, padY: 7, alpha: 0.88 },
});

export type TextBubbleKind = keyof typeof TEXT_KIND_METRICS;

export const TEXT_MAX_LINES = 3;

export interface TextBubbleSpec {
  readonly kind: TextBubbleKind;
  readonly text: string;
  /** Identity hue of the speaker; fills the tail. Thought has no tail. */
  readonly hue: string;
  /** Fullness-bar fill colour. */
  readonly accent: string;
  /** World px of tail lean toward the addressee, clamped to ±14. */
  readonly lean?: number;
}

export interface BuiltSurface {
  readonly surface: PixelSurface;
  /** Excerpt metadata, when the surface carries type. */
  readonly excerpt?: ExcerptLayout;
}

/**
 * Build one speech / whisper / thought bubble.
 *
 * The **connector** is what proves ownership and is the direct fix for the
 * rejected overlay's disappearing tail: a fat tapering wedge filled with the
 * speaker's own identity hue, terminated by a hard 3px stud pinned on the crown
 * of the head. A thought has no stud and no tail — three detached shrinking
 * puffs instead. It is the one kind with no physical link to the world.
 */
export function buildTextBubble(spec: TextBubbleSpec): BuiltSurface {
  const metrics = TEXT_KIND_METRICS[spec.kind];
  const isThought = spec.kind === "thought";
  const isDashed = spec.kind !== "speech";
  const excerpt = layoutExcerpt(spec.text, metrics.maxChars, TEXT_MAX_LINES);

  const longest = excerpt.lines.reduce((max, line) => Math.max(max, line.length), 0);
  const contentWidth = Math.max(28, pixelTextWidth("".padEnd(longest, "x")));
  const contentHeight = excerpt.lines.length * FONT_LINE_HEIGHT - 1;
  const barHeight = 2;
  const barGap = 2;
  const extra = excerpt.truncated ? barHeight + barGap : 0;
  // A cloud is an inscribed ellipse, so the text rect must fit INSIDE it: grow
  // the box on each axis or the corners clip the words.
  const boxWidth = isThought
    ? Math.round((contentWidth + metrics.padX * 2) * 1.3) + 2
    : contentWidth + metrics.padX * 2 + 2;
  const boxHeight = isThought
    ? Math.round((contentHeight + extra + metrics.padY * 2) * 1.42) + 2
    : contentHeight + metrics.padY * 2 + 2 + extra;

  const lean = clamp(Math.round(spec.lean ?? 0), -MAX_TAIL_LEAN, MAX_TAIL_LEAN);
  const connector = isThought ? THOUGHT_CONNECTOR : TAIL_HEIGHT;
  const totalHeight = boxHeight + connector + STUD;
  const surface = new PixelSurface(boxWidth + Math.abs(lean) + 4, totalHeight);
  const originX = lean < 0 ? Math.abs(lean) + 2 : 2;
  const tailX = originX + Math.round(boxWidth / 2);

  const box = isThought ? cloudMask(boxWidth, boxHeight) : roundRectMask(boxWidth, boxHeight, 2);
  const inside: Mask = (x, y) => {
    const bx = x - originX;
    if (y < boxHeight) return box(bx, y);
    if (isThought) return false;
    const t = y - boxHeight;
    if (t >= TAIL_HEIGHT) return false;
    const half = Math.max(0, Math.round((TAIL_BASE / 2) * (1 - t / TAIL_HEIGHT)));
    const centre = tailX + Math.round(lean * (t / TAIL_HEIGHT));
    return Math.abs(x - centre) <= half;
  };
  paintMask(surface, inside, {
    body: OVERLAY_PALETTE.vellum,
    edge: OVERLAY_PALETTE.ink,
    dash: isDashed,
  });

  // The tail carries the speaker's identity hue: attribution without a
  // nameplate, and a solid contrasting wedge that survives downscaling.
  if (!isThought) {
    for (let y = boxHeight; y < boxHeight + TAIL_HEIGHT; y += 1) {
      for (let x = 0; x < surface.width; x += 1) {
        if (!inside(x, y) || isMaskEdge(inside, x, y)) continue;
        surface.set(x, y, spec.hue);
      }
    }
  } else {
    let puffY = boxHeight - 1;
    for (const radius of [4, 3, 2]) {
      const centre = tailX + Math.round(lean * ((puffY - boxHeight) / TAIL_HEIGHT));
      const puff: Mask = (x, y) => {
        const dx = x - radius + 0.5;
        const dy = y - radius + 0.5;
        return dx * dx + dy * dy <= radius * radius;
      };
      for (let y = 0; y < radius * 2; y += 1) {
        for (let x = 0; x < radius * 2; x += 1) {
          if (!puff(x, y)) continue;
          const edge = isMaskEdge(puff, x, y);
          surface.set(centre - radius + x, puffY + y, edge ? OVERLAY_PALETTE.ink : OVERLAY_PALETTE.vellum);
        }
      }
      puffY += radius * 2 + 2;
    }
  }

  const textX = originX + Math.round((boxWidth - contentWidth) / 2);
  let textY = Math.round((boxHeight - (contentHeight + extra)) / 2);
  for (const line of excerpt.lines) {
    drawPixelText(surface, line, textX, textY, OVERLAY_PALETTE.ink);
    textY += FONT_LINE_HEIGHT;
  }

  // The fullness bar: how much of a real message this excerpt represents.
  // Derived only from payload length; it invents nothing, and it means the
  // *size* of a being's inner life is visible without reading a word.
  if (excerpt.truncated) {
    const barY = Math.round((boxHeight - (contentHeight + extra)) / 2) + contentHeight + barGap;
    for (let i = 0; i < contentWidth; i += 1) {
      surface.set(textX + i, barY, OVERLAY_PALETTE.vellumLow);
    }
    const fill = Math.max(1, Math.round(contentWidth * (excerpt.shown / Math.max(1, excerpt.total))));
    for (let i = 0; i < fill; i += 1) {
      surface.set(textX + i, barY, spec.accent);
      surface.set(textX + i, barY + 1, spec.accent);
    }
  }

  const studX = tailX + lean;
  if (!isThought) {
    for (let i = 0; i < STUD; i += 1) surface.set(studX - 1 + i, totalHeight - STUD + 1, OVERLAY_PALETTE.ink);
    surface.set(studX, totalHeight - STUD, OVERLAY_PALETTE.ink);
    surface.set(studX, totalHeight - STUD + 2, OVERLAY_PALETTE.ink);
  }

  surface.ax = studX;
  surface.ay = totalHeight - 1;
  return { surface, excerpt };
}

export interface MarkSpec {
  readonly glyph: OverlayGlyph;
  readonly accent: string;
  /** Exact number or short word from the payload. Never invented. */
  readonly micro?: string;
}

/**
 * Build one action mark: a tapered banner hung from a **rigid post and foot
 * bar**. Mechanical, unmistakably not a mouth — the connector alone separates
 * "this being did a thing" from "this being said a thing" before a glyph is
 * read.
 */
export function buildMark(spec: MarkSpec): BuiltSurface {
  const micro = spec.micro ?? "";
  const barWidth = 2;
  const spacing = 3;
  const taper = 4;
  const microWidth = pixelTextWidth(micro);
  const contentWidth = barWidth + spacing + GLYPH_SIZE + (micro.length > 0 ? spacing + microWidth : 0);
  const boxWidth = contentWidth + taper * 2 + 8;
  const boxHeight = 15;
  const postHeight = 11;
  const footWidth = 9;

  const surface = new PixelSurface(boxWidth, boxHeight + postHeight + STUD);
  const banner = bannerMask(boxWidth, boxHeight, taper);
  paintMask(surface, (x, y) => y < boxHeight && banner(x, y), {
    body: OVERLAY_PALETTE.vellum,
    edge: OVERLAY_PALETTE.ink,
  });

  const contentX = taper + 4;
  for (let y = 3; y < boxHeight - 3; y += 1) {
    for (let i = 0; i < barWidth; i += 1) surface.set(contentX + i, y, spec.accent);
  }
  drawGlyph(surface, spec.glyph, contentX + barWidth + spacing, 3, spec.accent);
  if (micro.length > 0) {
    drawPixelText(
      surface,
      micro,
      contentX + barWidth + spacing + GLYPH_SIZE + spacing,
      4,
      OVERLAY_PALETTE.ink,
    );
  }

  const postX = Math.round(boxWidth / 2);
  for (let y = boxHeight; y < boxHeight + postHeight; y += 1) {
    for (let i = -1; i <= 1; i += 1) {
      surface.set(postX + i, y, i === 0 ? spec.accent : OVERLAY_PALETTE.ink);
    }
  }
  for (let i = 0; i < footWidth; i += 1) {
    surface.set(postX - 4 + i, boxHeight + postHeight, OVERLAY_PALETTE.ink);
  }
  for (let i = 0; i < STUD; i += 1) {
    surface.set(postX - 1 + i, boxHeight + postHeight + 1, OVERLAY_PALETTE.ink);
  }

  surface.ax = postX;
  surface.ay = surface.height - 1;
  return { surface };
}

export interface BurstSpec {
  readonly glyph: OverlayGlyph;
  readonly accent: string;
  /** Ink field, bone glyph, no bevel. Death and home collapse only. */
  readonly invert?: boolean;
  /** The larger star. */
  readonly big?: boolean;
  readonly spikes?: number;
  readonly seed?: number;
}

/**
 * Build one impact burst. It has **no connector**: it sits *on* the thing it
 * happened to — a victim's torso, a breached wall — never above a head.
 * Inverting the field is reserved for death and home collapse, which is
 * precisely why those two carry weight.
 */
export function buildBurst(spec: BurstSpec): BuiltSurface {
  const width = spec.big === true ? 46 : 34;
  const height = spec.big === true ? 40 : 30;
  const surface = new PixelSurface(width, height);
  const invert = spec.invert === true;
  paintMask(surface, burstMask(width, height, spec.spikes ?? 11, spec.seed ?? 3), {
    body: invert ? OVERLAY_PALETTE.ink : OVERLAY_PALETTE.vellum,
    edge: invert ? OVERLAY_PALETTE.bone : OVERLAY_PALETTE.ink,
    bevel: false,
  });
  drawGlyph(
    surface,
    spec.glyph,
    Math.round((width - GLYPH_SIZE) / 2),
    Math.round((height - GLYPH_SIZE) / 2),
    invert ? OVERLAY_PALETTE.bone : spec.accent,
  );
  surface.ax = Math.round(width / 2);
  surface.ay = Math.round(height / 2);
  return { surface };
}

/**
 * Build the gather cloud — a bubble's **first phase**.
 *
 * The owner's complaint about the rejected overlay was that a bubble had "no
 * correlation to whether the thought is even being generated". The answer is
 * that a bubble is not an object that appears; it is a gesture with a
 * beginning. Three dots fill left to right, then the bubble resolves into
 * speech, thought or a banner. `phase` runs 0..1.
 */
export function buildGather(phase: number): BuiltSurface {
  const width = 27;
  const height = 18;
  const surface = new PixelSurface(width, height + 9 + STUD);
  paintMask(surface, cloudMask(width, height), {
    body: OVERLAY_PALETTE.vellum,
    edge: OVERLAY_PALETTE.ink,
    dash: true,
    bevel: false,
  });
  const lit = Math.min(3, Math.max(0, Math.floor(clamp(phase, 0, 1) * 4)));
  for (let dot = 0; dot < 3; dot += 1) {
    const color = dot < lit ? OVERLAY_PALETTE.ink : OVERLAY_PALETTE.gatherIdle;
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) surface.set(5 + dot * 6 + x, 7 + y, color);
    }
  }
  let puffY = height;
  for (const radius of [3, 2]) {
    for (let y = 0; y < radius * 2; y += 1) {
      for (let x = 0; x < radius * 2; x += 1) {
        surface.set(Math.round(width / 2) - radius + x, puffY + y, OVERLAY_PALETTE.ink);
      }
    }
    puffY += radius * 2 + 1;
  }
  surface.ax = Math.round(width / 2);
  surface.ay = surface.height - 1;
  return { surface };
}

/**
 * Build one residue pip — what a bubble collapses into when it expires, so a
 * viewer who looked away for two seconds is not lost.
 *
 * A pip must punch at 13px, so it carries the family colour as its **fill**
 * rather than as thin ink on vellum.
 */
export function buildPip(glyph: OverlayGlyph, accent: string, invert = false): BuiltSurface {
  const size = GLYPH_SIZE + 4;
  const surface = new PixelSurface(size, size);
  paintMask(surface, roundRectMask(size, size, 1), {
    body: invert ? OVERLAY_PALETTE.ink : accent,
    edge: OVERLAY_PALETTE.ink,
    bevel: false,
  });
  drawGlyph(surface, glyph, 2, 2, OVERLAY_PALETTE.vellum);
  surface.ax = 0;
  surface.ay = 0;
  return { surface };
}

/**
 * Build a receiver cap — a chevron that sits above the being an event was aimed
 * at, pointing down at them. "Who it happened to" never needs a label.
 */
export function buildCap(accent: string): BuiltSurface {
  const width = 17;
  const height = 9;
  const surface = new PixelSurface(width, height);
  const mid = (width - 1) / 2;
  const band = (low: number, high: number): Mask => (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const t = Math.round(Math.abs(x - mid) * 0.5);
    return y >= t + low && y <= t + high;
  };
  paintMask(surface, band(0, 4), {
    body: OVERLAY_PALETTE.vellum,
    edge: OVERLAY_PALETTE.ink,
    bevel: false,
  });
  const core = band(1, 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) if (core(x, y)) surface.set(x, y, accent);
  }
  surface.ax = Math.round(width / 2);
  surface.ay = 0;
  return { surface };
}

/**
 * Build the low-zoom form: a glyph stud on a short stem, still visibly owned by
 * one being. Below zoom 1.5 the world reads as a field of coloured intent
 * rather than a wall of unreadable type.
 */
export function buildStud(glyph: OverlayGlyph, accent: string): BuiltSurface {
  const pip = buildPip(glyph, accent).surface;
  const stemHeight = 4;
  const surface = new PixelSurface(pip.width, pip.height + stemHeight);
  for (let y = 0; y < pip.height; y += 1) {
    for (let x = 0; x < pip.width; x += 1) {
      const color = pip.at(x, y);
      if (color !== null) surface.set(x, y, color);
    }
  }
  const stemX = Math.round(pip.width / 2);
  for (let y = 0; y < stemHeight; y += 1) surface.set(stemX, pip.height + y, OVERLAY_PALETTE.ink);
  surface.ax = stemX;
  surface.ay = surface.height - 1;
  return { surface };
}

// ---------------------------------------------------------------------------
// zoom + helpers
// ---------------------------------------------------------------------------

/**
 * Chrome is authored at 1x and blitted at this integer scale, so it is never
 * sub-pixel at any camera zoom. This is the structural fix for the rejected
 * overlay's connector eroding to nothing.
 */
export function bubbleScale(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return clamp(Math.round(zoom), 1, 4);
}

/** Below this camera zoom every bubble collapses to its glyph stud. */
export const TEXT_ZOOM_THRESHOLD = 1.5;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
