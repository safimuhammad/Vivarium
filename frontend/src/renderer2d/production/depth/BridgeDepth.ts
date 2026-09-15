/**
 * Trusted 2.5D presentation for Nirvana's authored north-channel timber bridge.
 *
 * The simulation keeps its ordinary flat navigation coordinates. This module only
 * derives a visual surface from the exact sidecar retained by a trusted Nirvana
 * recipe, then supplies small depth-sortable foreground rail segments.
 */

import type { Rect, Vec2 } from "../../contracts";
import type { RegionMapRecipeV1 } from "../maps/RegionMapRecipe";
import { nirvanaInitialRegionSidecar } from "../nirvana/NirvanaRegionMapRecipe";
import {
  NIRVANA_CHUNK_COLUMNS,
  NIRVANA_CHUNK_ROWS,
  NIRVANA_TILE_SIZE,
  type NirvanaChunk,
  type NirvanaScenerySprite,
} from "../nirvana/NirvanaRegionV2";

const TARGET_BRIDGE_ID = "north-channel-bridge";
const BRIDGE_HEIGHT = 18;
const EMPTY_RAIL_SLICES: readonly BridgeRailSlice[] = Object.freeze([]);
const sceneCache = new WeakMap<RegionMapRecipeV1, BridgeDepthScene | null>();
const geometryByScene = new WeakMap<BridgeDepthScene, BridgeGeometry>();

/** One logical-depth rail section. Both bridge sides paint during this single pass. */
export interface BridgeRailSlice {
  readonly feetY: number;
}

/** Immutable visual geometry derived only from the exact authored source. */
export interface BridgeDepthScene {
  /** Bounds of deck, fascia, supports, and rope rails for cache and viewport culling. */
  readonly bounds: Rect;
  /** Half-open logical walking corridor, before the display-only height projection. */
  readonly deckBounds: Rect;
  /** Logical tile edge where the rising ramp begins. */
  readonly startY: number;
  /** Logical tile edge immediately after the descending ramp. */
  readonly endY: number;
  /** Maximum screen-pixel lift of feet on the central deck. */
  readonly height: number;
  /** Native static-scene operations superseded by the depth presentation. */
  readonly replacedOperationIds: ReadonlySet<string>;
}

type AuthoredPartKind = "deck" | "post" | "pier";

interface AuthoredBridgePart {
  readonly id: string;
  readonly kind: AuthoredPartKind;
  readonly frameId: string;
  readonly tile: Readonly<{ column: number; row: number }>;
  readonly feet: Vec2;
  readonly stableId: string;
}

interface BridgeBoard {
  readonly id: string;
  readonly topY: number;
  readonly bottomY: number;
  readonly feetY: number;
  readonly ramp: boolean;
  readonly paintSeed: number;
}

interface BridgeGeometry {
  readonly boards: readonly BridgeBoard[];
  readonly boardByFeetY: ReadonlyMap<number, BridgeBoard>;
  readonly postFeetY: ReadonlySet<number>;
  readonly pierFeetY: readonly number[];
  readonly railSlices: readonly BridgeRailSlice[];
  readonly sideEntries: readonly BridgeSideEntry[];
}

interface BridgeSideEntry {
  readonly side: "left" | "right";
  readonly xStart: number;
  readonly xEnd: number;
  readonly yStart: number;
  readonly yEnd: number;
}

/**
 * Resolve the north-channel pilot from the trusted authored Nirvana sidecar.
 *
 * Untrusted lookalike recipes intentionally return `null`: public recipe fields
 * alone cannot authorize a visual replacement of authored scenery.
 */
export function bridgeDepthScene(recipe: RegionMapRecipeV1): BridgeDepthScene | null {
  const cached = sceneCache.get(recipe);
  if (cached !== undefined) return cached;

  const initial = nirvanaInitialRegionSidecar(recipe);
  const parts = initial === null ? null : collectAuthoredBridgeParts(initial.region.chunks.values());
  const scene = parts === null ? null : sceneFromAuthoredParts(parts, recipe);
  sceneCache.set(recipe, scene);
  return scene;
}

/**
 * Return the display-only height at logical feet, retaining the half-open deck corridor.
 */
export function bridgeElevationAt(scene: BridgeDepthScene | null, feet: Vec2): number {
  if (scene === null || !Number.isFinite(feet.x) || !Number.isFinite(feet.y)) return 0;
  if (feet.y <= scene.startY || feet.y >= scene.endY) return 0;
  const coverage = bridgeHorizontalCoverage(scene, feet);
  if (coverage === 0) return 0;

  // A one-tile ramp gives a 32 px smooth entry/exit in the native 32 px grid.
  const rampLength = Math.min(48, Math.max(32, scene.deckBounds.width));
  const plateauStart = scene.startY + rampLength;
  const plateauEnd = scene.endY - rampLength;
  if (plateauStart >= plateauEnd) return 0;
  if (feet.y < plateauStart) return scene.height * smoothstep((feet.y - scene.startY) / rampLength) * coverage;
  if (feet.y > plateauEnd) return scene.height * smoothstep((scene.endY - feet.y) / rampLength) * coverage;
  return scene.height * coverage;
}

/** Project a logical foot onto the bridge surface without changing navigation coordinates. */
export function projectBridgeFeet(scene: BridgeDepthScene | null, feet: Vec2): Vec2 {
  const elevation = bridgeElevationAt(scene, feet);
  return Object.freeze({ x: feet.x, y: feet.y - elevation });
}

/** Return immutable, unique foreground passes sorted by their logical foot depth. */
export function bridgeRailSlices(scene: BridgeDepthScene): readonly BridgeRailSlice[] {
  return geometryByScene.get(scene)?.railSlices ?? EMPTY_RAIL_SLICES;
}

/**
 * Paint the cacheable bridge body behind beings: banks, recessed water, timber deck,
 * right fascia, and the authored end supports.
 */
export function drawBridgeBase(
  context: CanvasRenderingContext2D,
  scene: BridgeDepthScene,
  view?: Rect,
): void {
  const geometry = geometryByScene.get(scene);
  if (geometry === undefined || !rectsOverlap(scene.bounds, view)) return;

  context.save();
  try {
    context.imageSmoothingEnabled = false;
    drawSideEntryRamps(context, scene, geometry.sideEntries);
    drawBridgeBanks(context, scene);
    for (const board of geometry.boards) drawBridgeBoard(context, scene, board);
    drawBridgeFascia(context, scene, geometry.boards);
    drawBridgeSupports(context, scene, geometry.pierFeetY, geometry.postFeetY);
  } finally {
    context.restore();
  }
}

/**
 * Paint one short foreground rope-rail segment at its logical depth.
 *
 * Both sides draw together so callers merge one stream of unique row slices with
 * actors, homes, and depth props rather than issuing a late whole-bridge pass.
 */
export function drawBridgeRail(
  context: CanvasRenderingContext2D,
  scene: BridgeDepthScene,
  logicalFeetY: number,
  view?: Rect,
): void {
  const geometry = geometryByScene.get(scene);
  const board = geometry?.boardByFeetY.get(logicalFeetY);
  if (geometry === undefined || board === undefined || !Number.isFinite(logicalFeetY)) return;
  const segment = projectedSegment(scene, board);
  const railBounds: Rect = {
    x: scene.deckBounds.x - 7,
    y: Math.floor(segment.top - 27),
    width: scene.deckBounds.width + 14,
    height: Math.max(1, Math.ceil(segment.bottom - segment.top + 32)),
  };
  if (!rectsOverlap(railBounds, view)) return;

  context.save();
  try {
    context.imageSmoothingEnabled = false;
    // The prior slice is already behind a being; this short slice is the rail at its feet.
    drawRailSide(context, scene.deckBounds.x + 3, segment, false);
    drawRailSide(context, scene.deckBounds.x + scene.deckBounds.width - 3, segment, true);
    if (geometry.postFeetY.has(board.feetY)) {
      const footY = deckScreenY(scene, board.feetY);
      drawRailPost(context, scene.deckBounds.x + 3, footY, false);
      drawRailPost(context, scene.deckBounds.x + scene.deckBounds.width - 3, footY, true);
    }
  } finally {
    context.restore();
  }
}

function sceneFromAuthoredParts(
  parts: readonly AuthoredBridgePart[],
  recipe: RegionMapRecipeV1,
): BridgeDepthScene | null {
  const deckParts = parts.filter(({ kind }) => kind === "deck");
  const postParts = parts.filter(({ kind }) => kind === "post");
  const pierParts = parts.filter(({ kind }) => kind === "pier");
  if (deckParts.length < 3 || postParts.length === 0 || pierParts.length < 2) return null;
  if (new Set(parts.map(({ id }) => id)).size !== parts.length) return null;

  const column = deckParts[0]!.tile.column;
  if (!deckParts.every((part) => part.tile.column === column)) return null;
  const orderedDeck = [...deckParts].sort((left, right) => left.tile.row - right.tile.row);
  const first = orderedDeck[0]!;
  const last = orderedDeck.at(-1)!;
  if (!first.frameId.startsWith("s.bridgerampv.") || !last.frameId.startsWith("s.bridgerampv.")) return null;
  for (let index = 0; index < orderedDeck.length; index += 1) {
    const part = orderedDeck[index]!;
    if (part.tile.row !== first.tile.row + index) return null;
    if (index > 0 && index < orderedDeck.length - 1 && part.frameId.startsWith("s.bridgerampv.")) return null;
  }
  if (!postParts.every((part) => part.tile.column === column
    && part.tile.row > first.tile.row && part.tile.row < last.tile.row)) return null;
  if (!pierParts.every((part) => part.tile.column === column)) return null;
  const pierRows = new Set(pierParts.map((part) => part.tile.row));
  if (!pierRows.has(first.tile.row) || !pierRows.has(last.tile.row)) return null;

  const deckBounds = freezeRect({
    x: column * NIRVANA_TILE_SIZE,
    y: first.tile.row * NIRVANA_TILE_SIZE,
    width: NIRVANA_TILE_SIZE,
    height: (last.tile.row - first.tile.row + 1) * NIRVANA_TILE_SIZE,
  });
  const startY = deckBounds.y;
  const endY = deckBounds.y + deckBounds.height;
  const boards = Object.freeze(orderedDeck.map((part) => Object.freeze({
    id: part.id,
    topY: part.tile.row * NIRVANA_TILE_SIZE,
    bottomY: (part.tile.row + 1) * NIRVANA_TILE_SIZE,
    feetY: part.feet.y,
    ramp: part.frameId.startsWith("s.bridgerampv."),
    paintSeed: paintHash(part.id),
  })));
  const railSlices = Object.freeze(boards.map(({ feetY }) => Object.freeze({ feetY })));
  const sideEntries = sideEntriesFor(recipe, column, first.tile.row, last.tile.row);
  const visualLeft = Math.min(
    deckBounds.x - 16,
    ...sideEntries.map(({ xStart }) => xStart - 3),
  );
  const visualRight = Math.max(
    deckBounds.x + deckBounds.width + 16,
    ...sideEntries.map(({ xEnd }) => xEnd + 3),
  );
  const replaced = new Set<string>();
  for (const part of parts) {
    replaced.add(part.stableId);
    replaced.add(`grounding:${part.stableId}`);
  }
  const scene: BridgeDepthScene = Object.freeze({
    bounds: freezeRect({
      x: visualLeft,
      y: startY - 34,
      width: visualRight - visualLeft,
      height: deckBounds.height + 68,
    }),
    deckBounds,
    startY,
    endY,
    height: BRIDGE_HEIGHT,
    replacedOperationIds: Object.freeze(replaced),
  });
  const boardByFeetY = new Map<number, BridgeBoard>();
  for (const board of boards) boardByFeetY.set(board.feetY, board);
  geometryByScene.set(scene, Object.freeze({
    boards,
    boardByFeetY,
    postFeetY: new Set(postParts.map((part) => part.feet.y)),
    pierFeetY: Object.freeze(pierParts.map((part) => part.feet.y).sort((left, right) => left - right)),
    railSlices,
    sideEntries,
  }));
  return scene;
}

/**
 * Discover collision-open lateral approaches along the authored bridge span.
 *
 * A riverbank can meet the ramp or a dry deck edge from the side even when its
 * north/south neighbour is water. Extending the visual lift across only those
 * true open tiles avoids a projection jump without creating a fictional
 * navigable bridge shoulder.
 */
function sideEntriesFor(
  recipe: RegionMapRecipeV1,
  column: number,
  firstRow: number,
  lastRow: number,
): readonly BridgeSideEntry[] {
  const entries: BridgeSideEntry[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (const side of [-1, 1] as const) {
      const neighbourColumn = column + side;
      if (!isOpenRecipeTile(recipe, neighbourColumn, row)) continue;
      entries.push(Object.freeze({
        side: side < 0 ? "left" : "right",
        xStart: neighbourColumn * NIRVANA_TILE_SIZE,
        xEnd: (neighbourColumn + 1) * NIRVANA_TILE_SIZE,
        yStart: row * NIRVANA_TILE_SIZE,
        yEnd: (row + 1) * NIRVANA_TILE_SIZE,
      }));
    }
  }
  return Object.freeze(entries);
}

function isOpenRecipeTile(recipe: RegionMapRecipeV1, column: number, row: number): boolean {
  if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row)
    || column < 0 || row < 0 || column >= recipe.grid.columns || row >= recipe.grid.rows) return false;
  return recipe.grid.collision[row * recipe.grid.columns + column] === 0;
}

function collectAuthoredBridgeParts(chunks: Iterable<NirvanaChunk>): readonly AuthoredBridgePart[] | null {
  const result: AuthoredBridgePart[] = [];
  for (const chunk of chunks) {
    for (const sprite of chunk.scenery) {
      const candidate = authoredBridgePart(chunk, sprite);
      if (candidate === "invalid") return null;
      if (candidate !== null) result.push(candidate);
    }
  }
  return Object.freeze(result);
}

function authoredBridgePart(
  chunk: NirvanaChunk,
  sprite: NirvanaScenerySprite,
): AuthoredBridgePart | "invalid" | null {
  const targetPrefix = /^(?:bridge|post|pier):north-channel-bridge:/;
  const match = /^(bridge|post|pier):north-channel-bridge:(-?\d+),(-?\d+)$/.exec(sprite.id);
  if (match === null) return targetPrefix.test(sprite.id) ? "invalid" : null;
  const rawKind = match[1]!;
  const kind: AuthoredPartKind = rawKind === "bridge" ? "deck"
    : rawKind === "post" ? "post" : "pier";
  const column = Number(match[2]);
  const row = Number(match[3]);
  const worldColumn = chunk.coord.column * NIRVANA_CHUNK_COLUMNS + sprite.tile.column;
  const worldRow = chunk.coord.row * NIRVANA_CHUNK_ROWS + sprite.tile.row;
  if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row)
    || column !== worldColumn || row !== worldRow
    || sprite.foot.x !== worldColumn * NIRVANA_TILE_SIZE + NIRVANA_TILE_SIZE / 2
    || sprite.foot.y !== worldRow * NIRVANA_TILE_SIZE + NIRVANA_TILE_SIZE - 1
    || !matchesExpectedVerticalFrame(kind, sprite.frameId)) return "invalid";
  return Object.freeze({
    id: sprite.id,
    kind,
    frameId: sprite.frameId,
    tile: Object.freeze({ column, row }),
    feet: Object.freeze({
      x: chunk.coord.column * NIRVANA_CHUNK_COLUMNS * NIRVANA_TILE_SIZE + sprite.foot.x,
      y: chunk.coord.row * NIRVANA_CHUNK_ROWS * NIRVANA_TILE_SIZE + sprite.foot.y,
    }),
    stableId: `scenery:${chunk.coord.column},${chunk.coord.row}:${sprite.id}`,
  });
}

function matchesExpectedVerticalFrame(kind: AuthoredPartKind, frameId: string): boolean {
  if (kind === "deck") return /^s\.bridge(?:deck|worn|ramp)v\.\d+$/.test(frameId);
  if (kind === "post") return /^s\.bridgepostv\.\d+$/.test(frameId);
  return /^s\.bridgepier\.\d+$/.test(frameId);
}

/** Paint a small timber shoulder wherever the trusted grid actually permits a side approach. */
function drawSideEntryRamps(
  context: CanvasRenderingContext2D,
  scene: BridgeDepthScene,
  entries: readonly BridgeSideEntry[],
): void {
  const plankCount = 6;
  for (const entry of entries) {
    const seed = paintHash(`${entry.side}:${entry.xStart},${entry.yStart}`);
    for (let plank = 0; plank < plankCount; plank += 1) {
      const logicalTop = entry.yStart + Math.floor(plank * NIRVANA_TILE_SIZE / plankCount);
      const logicalBottom = entry.yStart + Math.floor((plank + 1) * NIRVANA_TILE_SIZE / plankCount);
      const topOuter = sideRampScreenY(scene, entry, logicalTop, false);
      const topInner = sideRampScreenY(scene, entry, logicalTop, true);
      const bottomOuter = sideRampScreenY(scene, entry, logicalBottom, false);
      const bottomInner = sideRampScreenY(scene, entry, logicalBottom, true);
      const outerX = entry.side === "left" ? entry.xStart : entry.xEnd;
      const innerX = entry.side === "left" ? entry.xEnd : entry.xStart;
      context.fillStyle = ["#665b40", "#5a533d", "#716648", "#514d39"][(seed + plank) % 4]!;
      context.beginPath();
      context.moveTo(outerX, Math.round(topOuter));
      context.lineTo(innerX, Math.round(topInner));
      context.lineTo(innerX, Math.round(bottomInner));
      context.lineTo(outerX, Math.round(bottomOuter));
      context.closePath();
      context.fill();
      context.strokeStyle = "rgba(34, 42, 31, 0.48)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(outerX, Math.round(bottomOuter) - 1);
      context.lineTo(innerX, Math.round(bottomInner) - 1);
      context.stroke();
      if ((seed + plank) % 2 === 0) {
        const nailX = Math.round((outerX + innerX) / 2);
        const nailY = Math.round((bottomOuter + bottomInner) / 2);
        context.fillStyle = "rgba(35, 40, 30, 0.7)";
        context.fillRect(nailX, nailY, 1, 1);
      }
    }
  }
}

function sideRampScreenY(
  scene: BridgeDepthScene,
  entry: BridgeSideEntry,
  logicalY: number,
  inner: boolean,
): number {
  const x = entry.side === "left"
    ? (inner ? entry.xEnd : entry.xStart)
    : (inner ? entry.xStart : entry.xEnd);
  return logicalY - bridgeElevationAt(scene, { x, y: logicalY });
}

function drawBridgeBanks(context: CanvasRenderingContext2D, scene: BridgeDepthScene): void {
  const x = scene.deckBounds.x;
  const width = scene.deckBounds.width;
  const start = Math.round(deckScreenY(scene, scene.startY));
  const end = Math.round(deckScreenY(scene, scene.endY));
  // A narrow diagonal cast keeps the deck set into the water without outlining it.
  context.fillStyle = "rgba(22, 43, 43, 0.2)";
  context.beginPath();
  context.moveTo(x + width + 3, start + 8);
  context.lineTo(x + width + 9, start + 13);
  context.lineTo(x + width + 5, end + 4);
  context.lineTo(x + width, end - 1);
  context.closePath();
  context.fill();
  context.fillStyle = "rgba(24, 43, 43, 0.28)";
  context.fillRect(x - 7, start + 3, width + 16, 4);
  context.fillRect(x - 7, end - 7, width + 16, 4);
  context.fillStyle = "#5d593b";
  context.fillRect(x - 5, start - 2, width + 10, 7);
  context.fillRect(x - 5, end - 5, width + 10, 7);
  context.fillStyle = "#938858";
  context.fillRect(x - 2, start, width + 4, 2);
  context.fillRect(x - 2, end - 3, width + 4, 2);
}

function drawBridgeBoard(
  context: CanvasRenderingContext2D,
  scene: BridgeDepthScene,
  board: BridgeBoard,
): void {
  const segment = projectedSegment(scene, board);
  const x = scene.deckBounds.x;
  const width = scene.deckBounds.width;
  const top = Math.round(segment.top);
  const bottom = Math.max(top + 1, Math.round(segment.bottom));
  const height = bottom - top;
  const shade = ["#4e4934", "#474231", "#554e37", "#403d2e"][board.paintSeed % 4]!;

  context.fillStyle = "rgba(18, 37, 38, 0.22)";
  context.fillRect(x + width + 1, top + 4, 5, Math.max(4, height + 3));
  context.fillStyle = shade;
  context.beginPath();
  context.moveTo(x, top);
  context.lineTo(x + width, top);
  context.lineTo(x + width + 3, bottom + 3);
  context.lineTo(x - 1, bottom);
  context.closePath();
  context.fill();
  // The authored 32 px board tile is a short span of many crosswise planks, not one slab.
  const plankCount = 6;
  for (let plank = 0; plank < plankCount; plank += 1) {
    const logicalTop = board.topY + Math.floor(plank * NIRVANA_TILE_SIZE / plankCount);
    const logicalBottom = board.topY + Math.floor((plank + 1) * NIRVANA_TILE_SIZE / plankCount);
    const plankTop = Math.round(deckScreenY(scene, logicalTop));
    const plankBottom = Math.max(plankTop + 1, Math.round(deckScreenY(scene, logicalBottom)));
    const plankHeight = plankBottom - plankTop;
    const tone = ["#716345", "#655a40", "#796a49", "#5c543e"][(board.paintSeed + plank) % 4]!;
    context.fillStyle = tone;
    context.fillRect(x + 2, plankTop, width - 5, plankHeight);
    context.fillStyle = "rgba(38, 43, 31, 0.55)";
    context.fillRect(x + 2, plankBottom - 1, width - 5, 1);
    if (plankHeight >= 2 && (board.paintSeed + plank) % 3 !== 0) {
      context.fillStyle = "rgba(49, 45, 31, 0.5)";
      context.fillRect(x + 8 + (board.paintSeed + plank) % 7, plankTop + 1, 7, 1);
    }
    if (plankHeight >= 2 && (board.paintSeed + plank) % 2 === 0) {
      context.fillStyle = "rgba(37, 39, 30, 0.78)";
      context.fillRect(x + 5, plankTop + 1, 1, 1);
      context.fillRect(x + width - 7, plankTop + 1, 1, 1);
    }
  }
}

/** The right edge reaches toward the original ground plane, making the 18 px lift legible. */
function drawBridgeFascia(
  context: CanvasRenderingContext2D,
  scene: BridgeDepthScene,
  boards: readonly BridgeBoard[],
): void {
  const x = scene.deckBounds.x + scene.deckBounds.width - 2;
  const plankCount = 6;
  for (const board of boards) {
    for (let plank = 0; plank < plankCount; plank += 1) {
      const logicalBottom = board.topY + Math.floor((plank + 1) * NIRVANA_TILE_SIZE / plankCount);
      const liftedBottom = Math.round(deckScreenY(scene, logicalBottom));
      const groundBottom = logicalBottom;
      const height = Math.max(2, groundBottom - liftedBottom + 1);
      context.fillStyle = (board.paintSeed + plank) % 2 === 0 ? "#3c4030" : "#454530";
      context.fillRect(x, liftedBottom, 7, height);
      context.fillStyle = "rgba(151, 140, 79, 0.32)";
      context.fillRect(x + 1, liftedBottom + 1, 1, Math.max(1, height - 2));
      context.fillStyle = "rgba(25, 33, 28, 0.56)";
      context.fillRect(x + 1, groundBottom - 1, 6, 1);
    }
  }
}

function drawBridgeSupports(
  context: CanvasRenderingContext2D,
  scene: BridgeDepthScene,
  pierFeetY: readonly number[],
  postFeetY: ReadonlySet<number>,
): void {
  const x = scene.deckBounds.x + scene.deckBounds.width + 2;
  for (const feetY of pierFeetY) {
    const y = Math.round(deckScreenY(scene, feetY));
    const groundY = Math.round(feetY + 12);
    context.fillStyle = "rgba(22, 35, 37, 0.36)";
    context.fillRect(x + 2, y + 4, 6, Math.max(20, groundY - y));
    context.fillStyle = "#4b392d";
    context.fillRect(x, y + 1, 6, Math.max(17, groundY - y - 2));
    context.fillStyle = "#8c6a4d";
    context.fillRect(x + 1, y + 2, 2, Math.max(14, groundY - y - 5));
    context.fillStyle = "rgba(30, 47, 48, 0.48)";
    context.fillRect(x - 3, groundY - 1, 13, 3);
  }
  for (const feetY of postFeetY) {
    const y = Math.round(deckScreenY(scene, feetY));
    const groundY = Math.round(feetY + 7);
    context.fillStyle = "rgba(24, 37, 36, 0.34)";
    context.fillRect(x + 2, y + 2, 4, Math.max(12, groundY - y));
    context.fillStyle = "#4d4935";
    context.fillRect(x, y + 1, 3, Math.max(10, groundY - y - 1));
    context.fillStyle = "rgba(145, 133, 74, 0.35)";
    context.fillRect(x, y + 2, 1, Math.max(7, groundY - y - 4));
  }
}

function drawRailSide(
  context: CanvasRenderingContext2D,
  x: number,
  segment: Readonly<{ top: number; bottom: number }>,
  foreground: boolean,
): void {
  const top = Math.round(segment.top);
  const bottom = Math.round(segment.bottom);
  context.strokeStyle = foreground ? "#43291d" : "#563827";
  context.lineWidth = foreground ? 2 : 1.5;
  context.beginPath();
  context.moveTo(x, top - 4);
  context.lineTo(x, bottom - 4);
  context.stroke();
  context.strokeStyle = foreground ? "rgba(210, 158, 102, 0.72)" : "rgba(187, 139, 91, 0.48)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x - 1, top - 16);
  context.lineTo(x - 1, bottom - 16);
  context.stroke();
}

function drawRailPost(
  context: CanvasRenderingContext2D,
  x: number,
  footY: number,
  foreground: boolean,
): void {
  const y = Math.round(footY);
  context.fillStyle = foreground ? "#40261b" : "#553426";
  context.fillRect(x - 2, y - 25, 5, 28);
  context.fillStyle = foreground ? "#a7784d" : "#8d6544";
  context.fillRect(x - 1, y - 23, 1, 24);
  context.fillStyle = "#302018";
  context.fillRect(x - 3, y + 1, 7, 3);
}

function projectedSegment(
  scene: BridgeDepthScene,
  board: BridgeBoard,
): Readonly<{ top: number; bottom: number }> {
  return Object.freeze({
    top: deckScreenY(scene, board.topY),
    bottom: deckScreenY(scene, board.bottomY),
  });
}

function deckScreenY(scene: BridgeDepthScene, logicalY: number): number {
  return logicalY - bridgeElevationAt(scene, {
    x: scene.deckBounds.x + scene.deckBounds.width / 2,
    y: logicalY,
  });
}

function bridgeHorizontalCoverage(scene: BridgeDepthScene, feet: Vec2): number {
  const deckRight = scene.deckBounds.x + scene.deckBounds.width;
  if (feet.x >= scene.deckBounds.x && feet.x < deckRight) return 1;
  const entry = geometryByScene.get(scene)?.sideEntries.find((candidate) => (
    feet.x >= candidate.xStart && feet.x < candidate.xEnd
    && feet.y >= candidate.yStart && feet.y < candidate.yEnd
  ));
  if (entry === undefined) return 0;
  const progress = entry.side === "left"
    ? (feet.x - entry.xStart) / (entry.xEnd - entry.xStart)
    : (entry.xEnd - feet.x) / (entry.xEnd - entry.xStart);
  return smoothstep(progress);
}

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function rectsOverlap(bounds: Rect, view: Rect | undefined): boolean {
  if (view === undefined) return true;
  return bounds.x < view.x + view.width
    && bounds.x + bounds.width > view.x
    && bounds.y < view.y + view.height
    && bounds.y + bounds.height > view.y;
}

function freezeRect(rect: Rect): Rect {
  return Object.freeze({ ...rect });
}

function paintHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
