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
 * Ink for the bracketed addressee tag (`[to Joe]`) that opens directed speech.
 *
 * **The palette's one COOL accent, deliberately.** Every other colour the
 * overlay owns is warm — ink is a near-black green, the body is cream vellum,
 * and five of the six family accents are warm (amber, rose, rust, moss, and a
 * grey-brown). A cool slate on warm vellum is the one hue in the set that reads
 * instantly as *a label about the message* rather than as words in it, which is
 * exactly what a tag has to do.
 *
 * Chosen against the alternatives by eye at the type FLOOR (blit scale 2, a
 * 10x16 CSS-px glyph cell — the scale the story-framing default zoom of 2
 * already produces, so the floor is the common case, not the edge one):
 * `world` (#8a8270, speech's own family accent) is only ~3.2:1 on vellum and
 * reads as faded ink rather than as colour; `exchange` is dimmer still;
 * `dwell` green sinks into the terrain it is drawn over; `harm` red shouts
 * violence over a civil sentence; `bond` rose would paint every directed line —
 * hostile ones included — in the mating family's colour, and directed speech is
 * far too frequent for that to survive. This slate is ~4.2:1 on vellum, the
 * highest of the accents that are not semantically loaded.
 *
 * It borrows the `body` family's hue, which costs almost nothing: family colour
 * is only ever worn by a mark's post/bar/glyph or a burst, never by a bubble, so
 * a tag inside a balloon cannot be mistaken for a `halt`/`rise` banner beside a
 * being.
 */
export const TAG_INK = OVERLAY_FAMILY_ACCENT.body;

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
  // `_`, `[` and `]` earn their cells from the corpus: 219 underscores (region
  // ids a being names aloud, e.g. `warm_springs`) and 43 bracket pairs across
  // 3,363 real messages. They were rendering as `?` — invisible while a bubble
  // showed a three-line excerpt, and a visible defect now that it shows all of it.
  "_": "...../...../...../...../...../...../...../#####",
  "[": ".###./.#.../.#.../.#.../.#.../.#.../.###./.....",
  "]": ".###./...#./...#./...#./...#./...#./.###./.....",
  "`": "..#../...#./...../...../...../...../...../.....",
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
// message layout — the answer to 385-character messages
// ---------------------------------------------------------------------------

/**
 * One same-coloured stretch of type inside a wrapped line.
 *
 * The overlay's font is FIXED-ADVANCE, so a colour change costs nothing to
 * position: a run's pen x is simply the sum of the character counts before it.
 * That is the whole reason a bubble can carry mixed colour inside a wrapped
 * line without ever measuring text.
 */
export interface TextRun {
  /** Exactly the characters drawn, brackets included. */
  readonly text: string;
  /**
   * True when this run is a bracketed reference to a being — `[Joe]` — and is
   * therefore drawn in {@link TAG_INK} rather than in the message's own ink.
   */
  readonly reference: boolean;
}

export interface MessageLayout {
  /** Every line of the WHOLE message. Never an excerpt, never an ellipsis. */
  readonly lines: readonly string[];
  /**
   * The same lines as coloured runs, in draw order.
   *
   * `runs[i].map((run) => run.text).join("")` is always exactly `lines[i]`;
   * `lines` is the text, `runs` is the text plus its colour.
   */
  readonly runs: readonly (readonly TextRun[])[];
  /** Columns the message was wrapped to. */
  readonly columns: number;
  /**
   * Characters in the whitespace-normalised source message — the WORDS SAID.
   *
   * Brackets added around a being's name are chrome and are deliberately NOT
   * counted, exactly as the `[to <Name>]` tag is not: this number is the one
   * the 5-7s utterance band is computed from, and `shared/speechLifetime.ts`
   * holds it in mechanical lockstep with the SCENE the being plays while
   * speaking (Safi, 2026-08-26). Counting chrome here would silently desync
   * the two clocks that module exists to keep together.
   */
  readonly total: number;
}

/**
 * The text block's target width:height ratio, used to pick a column count.
 *
 * A message wrapped to a fixed narrow measure becomes a column of scraps as it
 * grows; wrapped to one fixed wide measure a two-word line becomes a stripe.
 * Choosing columns from the message's own length instead keeps every bubble
 * roughly this shape, so a long line reads as a paragraph and a short one as a
 * remark.
 */
const MESSAGE_ASPECT = 2.2;

/**
 * Columns for one message of `total` characters, inside a kind's own band.
 *
 * `FONT_LINE_HEIGHT / FONT_ADVANCE` converts the character grid into pixels:
 * a block of `c` columns and `total / c` lines is `6c` wide and `9 total / c`
 * tall, so `c = sqrt(1.5 x aspect x total)` hits {@link MESSAGE_ASPECT}. Past a
 * kind's `maxColumns` the block stops widening and grows downward instead —
 * a measure wider than ~44 characters is harder to read, not easier.
 */
export function messageColumns(total: number, minColumns: number, maxColumns: number): number {
  if (!Number.isFinite(total) || total <= 0) return minColumns;
  const ideal = Math.round(Math.sqrt((FONT_LINE_HEIGHT / FONT_ADVANCE) * MESSAGE_ASPECT * total));
  return clamp(ideal, minColumns, maxColumns);
}

/**
 * Wrap a real message into a bubble **in full**.
 *
 * Real payload messages measure a median of 385 characters (max 1153, over
 * 3,363 samples). The overlay used to answer that with a three-line excerpt
 * plus a fullness bar; the owner's decision (2026-08-21) is that a bubble
 * carries the whole thing — "they should show full messages" — so nothing here
 * truncates, and no ellipsis is ever appended. The size of a being's inner life
 * is still visible at a glance, but now because the bubble itself is that size.
 *
 * Wrapping is greedy over whitespace-normalised words at a fixed 6px advance
 * (never `measureText`), so it is byte-identical in jsdom and in a browser. A
 * single token longer than the measure is hard-broken with a hyphen rather than
 * allowed to overflow the box.
 */
export function layoutMessage(
  text: string,
  columns: number,
  names: readonly string[] = [],
): MessageLayout {
  const width = Math.max(1, Math.floor(columns));
  const clean = text.replace(/\s+/gu, " ").trim();
  if (clean.length === 0) return { lines: [""], runs: [[]], columns: width, total: 0 };
  const wrapped = wrapRuns(tokeniseRuns(markBeingReferences(clean, names)), width);
  return {
    lines: wrapped.map(runsText),
    runs: wrapped,
    columns: width,
    total: clean.length,
  };
}

// ---------------------------------------------------------------------------
// in-message references — "[Joe], [Dick], [Allen]—it is as I feared."
// ---------------------------------------------------------------------------

/** The brackets that turn a spoken name into a visible reference. */
const REFERENCE_OPEN = "[";
const REFERENCE_CLOSE = "]";

/**
 * Shortest roster name that may be bracketed inside a message body.
 *
 * A one-character name would paint the pronoun `I` and the article `A` in every
 * sentence in the world, which is a catastrophe by eye and cannot be worth the
 * one being it would serve. The addressee tag has no such floor: it is derived
 * from an id, never matched against prose.
 */
const MIN_BODY_REFERENCE_CHARS = 2;

/**
 * What counts as "inside a word", for the boundary test.
 *
 * Letters and digits only, so punctuation, quotes, spaces and the em-dashes
 * these beings are fond of all end a name — and `Maeve` never yields `[Mae]ve`.
 */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Bracket every reference to a real being inside one normalised message.
 *
 * **Why a roster and not a regex.** Safi's own example — *"Joe, Dick, Allen—it
 * is as I feared. Both the East and West are incredibly sparse."* — is exactly
 * the case a capitalised-word heuristic gets wrong: `East` and `West` are
 * REGIONS, and a proper-noun rule would paint them as beings. So the only thing
 * that makes a word a being is the frame's own roster, which upstream has
 * already scrubbed through the same public-copy guard the `[to <Name>]` tag
 * uses. An id or an unsafe name never reaches this function, and a name that is
 * not on the roster is left exactly as it was spoken.
 *
 * **The rules, and why:**
 * - **Case-sensitive.** Load-bearing, not fussiness: beings are named from
 *   ordinary words, and a being called `Will` must not paint every "will", nor
 *   `Rose` every "rose". A name is a proper noun; a proper noun is capitalised.
 * - **Whole words only.** Both neighbours must be non-word characters, so
 *   `Joe,` `Joe.` `Joe—it` and `(Joe)` all bracket the NAME and leave the
 *   punctuation outside, `Joe's` becomes `[Joe]'s` (the possessive is grammar,
 *   not part of the name), and `Maeve` is never `[Mae]ve`.
 * - **Longest first, non-overlapping.** `Allen` is claimed before `Al`, and a
 *   claimed span is dead to every later candidate, so a roster containing both
 *   cannot produce `[Al]len`.
 * - **The speaker's own name is bracketed too.** One uniform rule: a being who
 *   says its own name has made a reference to a being, third-person lines
 *   ("Dick told Allen…") stay whole, and no surface has to know who is talking.
 *
 * @param text - One whitespace-normalised, trimmed message.
 * @param names - Public display names of the beings in the current frame.
 * @returns The message as coloured runs; a single plain run when nothing matched.
 */
export function markBeingReferences(
  text: string,
  names: readonly string[],
): readonly TextRun[] {
  const plain: readonly TextRun[] = [{ text, reference: false }];
  const candidates = Array.from(new Set(names.map((name) => name.trim())))
    .filter((name) => name.length >= MIN_BODY_REFERENCE_CHARS)
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  if (candidates.length === 0) return plain;

  const claimed: Array<{ readonly start: number; readonly end: number; readonly name: string }> = [];
  for (const name of candidates) {
    for (let from = 0; ; ) {
      const start = text.indexOf(name, from);
      if (start < 0) break;
      from = start + 1;
      const end = start + name.length;
      if (start > 0 && WORD_CHARACTER.test(text[start - 1]!)) continue;
      if (end < text.length && WORD_CHARACTER.test(text[end]!)) continue;
      if (claimed.some((range) => start < range.end && range.start < end)) continue;
      claimed.push({ start, end, name });
    }
  }
  if (claimed.length === 0) return plain;

  claimed.sort((a, b) => a.start - b.start);
  const runs: TextRun[] = [];
  let cursor = 0;
  for (const range of claimed) {
    if (range.start > cursor) runs.push({ text: text.slice(cursor, range.start), reference: false });
    runs.push({ text: `${REFERENCE_OPEN}${range.name}${REFERENCE_CLOSE}`, reference: true });
    cursor = range.end;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), reference: false });
  return runs;
}

/** Concatenated text of one line's runs — what actually lands on the surface. */
function runsText(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join("");
}

/** Drawn character count of a run list, brackets included. */
function runsLength(runs: readonly TextRun[]): number {
  return runs.reduce((total, run) => total + run.text.length, 0);
}

/** Fold neighbouring runs of the same colour together, so the draw pass is tight. */
function mergeRuns(runs: readonly TextRun[]): readonly TextRun[] {
  const merged: TextRun[] = [];
  for (const run of runs) {
    if (run.text.length === 0) continue;
    const previous = merged[merged.length - 1];
    if (previous !== undefined && previous.reference === run.reference) {
      merged[merged.length - 1] = { text: previous.text + run.text, reference: run.reference };
      continue;
    }
    merged.push(run);
  }
  return merged;
}

/** The `[from, to)` character window of a run list, colours preserved. */
function sliceRuns(runs: readonly TextRun[], from: number, to: number): readonly TextRun[] {
  const sliced: TextRun[] = [];
  let cursor = 0;
  for (const run of runs) {
    const end = cursor + run.text.length;
    const start = Math.max(from, cursor);
    const stop = Math.min(to, end);
    if (stop > start) {
      sliced.push({ text: run.text.slice(start - cursor, stop - cursor), reference: run.reference });
    }
    cursor = end;
  }
  return sliced;
}

/**
 * Split one run list into whitespace-delimited wrap tokens.
 *
 * A **reference run is atomic**: it is never split on an internal space and
 * never handed to the wrap in pieces, which is what guarantees a bracketed name
 * cannot break across two lines. Only plain runs are split on spaces, so
 * `[Joe],` stays one token and `[Joe]` glues to the comma that follows it.
 */
function tokeniseRuns(runs: readonly TextRun[]): readonly (readonly TextRun[])[] {
  const tokens: Array<readonly TextRun[]> = [];
  let current: TextRun[] = [];
  const flush = (): void => {
    if (current.length > 0) tokens.push(current);
    current = [];
  };
  for (const run of runs) {
    if (run.reference) {
      current.push(run);
      continue;
    }
    const parts = run.text.split(" ");
    parts.forEach((part, index) => {
      if (index > 0) flush();
      if (part.length > 0) current.push({ text: part, reference: false });
    });
  }
  flush();
  return tokens;
}

/**
 * Greedy-wrap tokens to `width` characters, colours intact.
 *
 * This is the one wrap engine in the module: {@link layoutMessage} is a thin
 * plain-text adapter over it, so a message with no roster wraps BYTE-IDENTICALLY
 * to the way it always did. Bracket characters are counted like any other, so
 * adding a reference can move a word down a line — which is the honest result,
 * and the reason the wrap was not left measuring the un-bracketed string.
 *
 * A token wider than the whole measure is hard-broken with a hyphen exactly as
 * before, and the hyphen inherits the colour of the run it broke inside, so a
 * name too wide for the bubble degrades into two tinted halves rather than into
 * a colour seam.
 */
function wrapRuns(
  tokens: readonly (readonly TextRun[])[],
  width: number,
): readonly (readonly TextRun[])[] {
  // `width - 1` leaves room for the hyphen; the floor of 1 keeps a degenerate
  // one-column measure from looping forever on a token it can never shrink.
  const breakAt = Math.max(1, width - 1);
  const lines: Array<readonly TextRun[]> = [];
  let current: TextRun[] = [];
  let currentLength = 0;
  const push = (runs: readonly TextRun[]): void => {
    lines.push(mergeRuns(runs));
  };
  for (const token of tokens) {
    let rest = token;
    while (runsLength(rest) > width) {
      if (currentLength > 0) {
        push(current);
        current = [];
        currentLength = 0;
      }
      const head = sliceRuns(rest, 0, breakAt);
      const tail = head[head.length - 1];
      push([...head, { text: "-", reference: tail?.reference ?? false }]);
      rest = sliceRuns(rest, breakAt, runsLength(rest));
    }
    const restLength = runsLength(rest);
    const candidateLength = currentLength === 0 ? restLength : currentLength + 1 + restLength;
    if (candidateLength <= width) {
      if (currentLength > 0) current.push({ text: " ", reference: false });
      current.push(...rest);
      currentLength = candidateLength;
      continue;
    }
    if (currentLength > 0) push(current);
    current = [...rest];
    currentLength = restLength;
  }
  if (currentLength > 0) push(current);
  return lines;
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

/**
 * Measure band and padding per text kind. Thought is deliberately the narrowest.
 *
 * `minColumns` is the measure a short remark is wrapped to; `maxColumns` is the
 * widest a long one ever grows before it starts growing downward instead. The
 * ordering thought < whisper < speech is what keeps a private thought the
 * quietest silhouette on screen at every message length.
 */
export const TEXT_KIND_METRICS = Object.freeze({
  speech: { minColumns: 18, maxColumns: 44, padX: 5, padY: 4, alpha: 1 },
  whisper: { minColumns: 16, maxColumns: 40, padX: 5, padY: 4, alpha: 1 },
  thought: { minColumns: 14, maxColumns: 38, padX: 8, padY: 7, alpha: 0.88 },
});

export type TextBubbleKind = keyof typeof TEXT_KIND_METRICS;

/**
 * The smallest blit scale a message's own LENGTH may drive the type down to.
 *
 * The authored face is 5x8 world px, so scale 2 puts a glyph cell at 10x16
 * screen px (the canvas is CSS-px 1:1, no device-pixel scaling). That is
 * exactly the size {@link TEXT_ZOOM_THRESHOLD} already certifies as the first
 * legible one — below it the grammar shows no words at all — which makes it the
 * honest floor. Past this floor a longer message grows the BUBBLE; it never
 * shrinks the type further. Only a viewport too small to hold the bubble at
 * this scale may go lower (see `textBubbleScale`).
 */
export const TEXT_SCALE_FLOOR = 2;

/** Message lengths at which the type steps down one blit scale. */
const TEXT_SCALE_STEP_CHARS = Object.freeze([110, 260]);

/**
 * The largest blit scale a message of `total` characters may be typed at.
 *
 * A remark can afford the biggest type the camera offers; a 385-character
 * confession cannot, or the bubble would cover the world it belongs to. The
 * ladder steps 4 -> 3 -> 2 and stops: {@link TEXT_SCALE_FLOOR} is a floor, not
 * a waypoint.
 */
export function textScaleForLength(total: number): number {
  if (!Number.isFinite(total) || total <= TEXT_SCALE_STEP_CHARS[0]!) return 4;
  return total <= TEXT_SCALE_STEP_CHARS[1]! ? 3 : TEXT_SCALE_FLOOR;
}

/**
 * The blit scale one text bubble is drawn at.
 *
 * Three limits, smallest wins: the camera's own integer chrome scale, the
 * length ladder, and — only when the built surface cannot fit the viewer's safe
 * frame at that scale — a step down far enough that it does. The last one is
 * what a phone viewport uses, and it is the ONLY thing allowed below
 * {@link TEXT_SCALE_FLOOR}, because a bubble taller than the screen is less
 * readable than a small one that fits.
 */
export function textBubbleScale(
  zoom: number,
  total: number,
  surface: Readonly<{ width: number; height: number }>,
  frame: Readonly<{ width: number; height: number }>,
): number {
  let scale = Math.min(bubbleScale(zoom), textScaleForLength(total));
  while (
    scale > 1
    && (surface.width * scale > frame.width || surface.height * scale > frame.height)
  ) scale -= 1;
  return scale;
}

/** Gap in world px between the addressee tag and the first line of the message. */
const TAG_GAP = 3;
/**
 * A tag longer than this is not a name — it is a payload; keep the bubble sane.
 *
 * 26, not the 24 it was before the brackets: `[to ` and `]` are five characters
 * of structure, where the bare `to ` was three, so 26 leaves a name exactly the
 * same 21-character budget it had. The cap moved so the NAME's budget would not.
 */
export const MAX_TAG_CHARS = 26;

/** The bracketed tag's fixed structure: `[to ` opens it, `]` closes it. */
const TAG_OPEN = "[to ";
const TAG_CLOSE = "]";

/**
 * Compose the bracketed addressee tag for one directed line, or `undefined`.
 *
 * The brackets are what turn `to Dick` from the opening WORDS of a sentence into
 * a tag ABOUT the sentence (Safi, 2026-08-26: "color code the and use [] for
 * the [to dick] etc messages"). They are structure, so they are never the thing
 * that gets cut: an over-long name is clamped and the pair still closes.
 *
 * Args:
 *   name: The addressee's public display name, already scrubbed for public copy
 *     upstream. `undefined`, empty, or whitespace-only means the payload named
 *     nobody safe — and a bubble with nobody to address gets no tag at all,
 *     never an empty `[to ]`.
 *
 * Returns:
 *   `[to <name>]`, at most {@link MAX_TAG_CHARS} characters, or `undefined`.
 */
export function addresseeTag(name: string | undefined): string | undefined {
  const trimmed = name === undefined ? "" : name.trim();
  if (trimmed.length === 0) return undefined;
  const budget = MAX_TAG_CHARS - TAG_OPEN.length - TAG_CLOSE.length;
  return `${TAG_OPEN}${trimmed.slice(0, budget)}${TAG_CLOSE}`;
}

/**
 * Clamp any tag to {@link MAX_TAG_CHARS} without amputating a closing bracket.
 *
 * {@link addresseeTag} already respects the cap, so this only fires for a tag
 * composed elsewhere; it exists because a plain `slice` would leave `[to Verylo`
 * open, and a tag that has lost its bracket has lost the one thing that makes it
 * a tag.
 */
function clampTag(tag: string): string {
  if (tag.length <= MAX_TAG_CHARS) return tag;
  const clipped = tag.slice(0, MAX_TAG_CHARS);
  return tag.endsWith(TAG_CLOSE)
    ? `${clipped.slice(0, -TAG_CLOSE.length)}${TAG_CLOSE}`
    : clipped;
}

export interface TextBubbleSpec {
  readonly kind: TextBubbleKind;
  readonly text: string;
  /** Identity hue of the speaker; fills the tail. Thought has no tail. */
  readonly hue: string;
  /** Accent for this bubble's family; reserved for future edge detail. */
  readonly accent: string;
  /** World px of tail lean toward the addressee, clamped to ±14. */
  readonly lean?: number;
  /**
   * The addressee line drawn above the message, e.g. `"[to Joe]"`.
   *
   * Bracketed and drawn in {@link TAG_INK} so it reads as a tag ABOUT the line
   * rather than as the line's opening words. Compose it with
   * {@link addresseeTag}, which is where that grammar lives.
   *
   * Present only when the event payload actually named a target. Undirected
   * speech and private self-talk carry no tag — a thought addressed to nobody
   * must not be captioned as if it were.
   */
  readonly tag?: string;
  /**
   * Public display names of the beings in the current frame.
   *
   * Every one of them that the message actually says is bracketed and drawn in
   * the same {@link TAG_INK} as the addressee tag, so the bubble has ONE
   * reference colour: `[to Allen]` above, `[Allen]` in the words below. Applies
   * to every kind, self-talk included — a private thought can name another
   * being, and that is still a reference.
   *
   * Left empty when the caller has no roster, which is simply a message with no
   * references. See {@link markBeingReferences} for the matching rules.
   */
  readonly names?: readonly string[];
}

export interface BuiltSurface {
  readonly surface: PixelSurface;
  /** Message metadata, when the surface carries type. */
  readonly layout?: MessageLayout;
}

/**
 * Build one speech / whisper / thought bubble around the WHOLE message.
 *
 * The **connector** is what proves ownership and is the direct fix for the
 * rejected overlay's disappearing tail: a fat tapering wedge filled with the
 * speaker's own identity hue, terminated by a hard 3px stud pinned on the crown
 * of the head. A thought has no stud and no tail — three detached shrinking
 * puffs instead. It is the one kind with no physical link to the world.
 *
 * The box is sized to whatever {@link layoutMessage} produced, so a long message
 * makes a large bubble. Nothing is clipped or excerpted here; the draw pass
 * chooses the blit scale ({@link textBubbleScale}) and keeps the result inside
 * the viewer's safe frame.
 */
export function buildTextBubble(spec: TextBubbleSpec): BuiltSurface {
  const metrics = TEXT_KIND_METRICS[spec.kind];
  const isThought = spec.kind === "thought";
  const isDashed = spec.kind !== "speech";
  const normalisedTotal = spec.text.replace(/\s+/gu, " ").trim().length;
  const layout = layoutMessage(
    spec.text,
    // Columns are chosen from the WORDS SAID, never from the bracketed result:
    // the bubble's shape is a property of the utterance, so adding a reference
    // makes the block a little taller rather than silently reshaping it.
    messageColumns(normalisedTotal, metrics.minColumns, metrics.maxColumns),
    spec.names ?? [],
  );
  const tag = spec.tag === undefined ? null : clampTag(spec.tag);

  const longest = layout.lines.reduce((max, line) => Math.max(max, line.length), 0);
  const contentWidth = Math.max(
    28,
    pixelTextWidth("".padEnd(longest, "x")),
    tag === null ? 0 : pixelTextWidth(tag),
  );
  const tagHeight = tag === null ? 0 : FONT_HEIGHT + TAG_GAP;
  const contentHeight = tagHeight + layout.lines.length * FONT_LINE_HEIGHT - 1;
  // A cloud is an inscribed ellipse, so the text rect must fit INSIDE it: grow
  // the box on each axis or the corners clip the words.
  const boxWidth = isThought
    ? Math.round((contentWidth + metrics.padX * 2) * 1.3) + 2
    : contentWidth + metrics.padX * 2 + 2;
  const boxHeight = isThought
    ? Math.round((contentHeight + metrics.padY * 2) * 1.42) + 2
    : contentHeight + metrics.padY * 2 + 2;

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
  let textY = Math.round((boxHeight - contentHeight) / 2);
  // The addressee tag opens the bubble on its OWN line — never folded into the
  // message's wrap, so it can neither break across `[` and `]` nor be carried
  // away from the words it belongs to — bracketed and in cool tag ink, so it
  // reads as an address line rather than as the first words spoken.
  if (tag !== null) {
    drawPixelText(surface, tag, textX, textY, TAG_INK);
    textY += tagHeight;
  }
  // The message is drawn run by run rather than line by line: every being the
  // words name wears the SAME cool slate as the address line, so one glance
  // finds every reference in the bubble (Safi, 2026-08-26 — "with a different
  // color, it should name that reference"). The fixed 6px advance is what makes
  // this free: a run's pen x is its character offset, never a measurement.
  for (const line of layout.runs) {
    let runX = textX;
    for (const run of line) {
      drawPixelText(surface, run.text, runX, textY, run.reference ? TAG_INK : OVERLAY_PALETTE.ink);
      runX += run.text.length * FONT_ADVANCE;
    }
    textY += FONT_LINE_HEIGHT;
  }

  const studX = tailX + lean;
  if (!isThought) {
    for (let i = 0; i < STUD; i += 1) surface.set(studX - 1 + i, totalHeight - STUD + 1, OVERLAY_PALETTE.ink);
    surface.set(studX, totalHeight - STUD, OVERLAY_PALETTE.ink);
    surface.set(studX, totalHeight - STUD + 2, OVERLAY_PALETTE.ink);
  }

  surface.ax = studX;
  surface.ay = totalHeight - 1;
  return { surface, layout };
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
