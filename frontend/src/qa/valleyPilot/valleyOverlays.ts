/**
 * QA-only overlay rasterisers for the valley pilot viewer.
 *
 * These do not touch the painter, the scene builder, or the navigator: they
 * read the SAME `ValleyScene.collision` / `ValleyScene.bridges` the real
 * navigator (and the Node capture script's `tintBlockedCells`, in
 * `scripts/render-nirvana-valley-pilot.mjs`) read, and rasterise a
 * transparent RGBA buffer the viewer composites over the terrain canvas with
 * the browser's own alpha blending. Nothing here decides what is walkable or
 * where a bridge is; it only draws what the scene already says, so the
 * overlay can never drift from the mask the navigator actually uses.
 */

import type { ValleyScene } from "../nirvanaValleyPilot/valleyScene";

/** A raw RGBA buffer, row-major, ready to hand to `new ImageData(...)`. */
export interface OverlayBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

const BLOCKED_COLOR: readonly [number, number, number] = [226, 44, 62];
const BRIDGE_COLOR: readonly [number, number, number] = [255, 196, 60];

const BLOCKED_BORDER_ALPHA = 0.92;
const BLOCKED_HATCH_ALPHA = 0.46;
const BLOCKED_FILL_ALPHA = 0.24;
const BRIDGE_BORDER_ALPHA = 0.95;
const BRIDGE_FILL_ALPHA = 0.55;

function isBlockedTile(scene: ValleyScene, column: number, row: number): boolean {
  if (column < 0 || row < 0 || column >= scene.columns || row >= scene.rows) return true;
  return scene.collision[row * scene.columns + column] === 1;
}

function paintTile(
  buffer: Uint8ClampedArray,
  bufferWidth: number,
  tileSize: number,
  column: number,
  row: number,
  color: readonly [number, number, number],
  alphaAt: (localX: number, localY: number) => number,
): void {
  for (let localY = 0; localY < tileSize; localY += 1) {
    const py = row * tileSize + localY;
    for (let localX = 0; localX < tileSize; localX += 1) {
      const px = column * tileSize + localX;
      const alpha = alphaAt(localX, localY);
      if (alpha <= 0) continue;
      const index = (py * bufferWidth + px) * 4;
      buffer[index] = color[0];
      buffer[index + 1] = color[1];
      buffer[index + 2] = color[2];
      buffer[index + 3] = Math.round(alpha * 255);
    }
  }
}

/**
 * Rasterise the same blocked-tile tint the Node capture script paints into
 * `valley-walkable.png` — a solid border on the run's exposed edge, a
 * hatched fill inside it — into a transparent buffer instead of baking the
 * colour into a copy of the art. Composited over the terrain canvas, the
 * result matches the captured reference to within alpha-blend rounding.
 */
export function computeWalkabilityOverlay(scene: ValleyScene): OverlayBuffer {
  const { columns, rows, tileSize, widthPixels: width, heightPixels: height } = scene;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (!isBlockedTile(scene, column, row)) continue;
      const edgeN = !isBlockedTile(scene, column, row - 1);
      const edgeS = !isBlockedTile(scene, column, row + 1);
      const edgeW = !isBlockedTile(scene, column - 1, row);
      const edgeE = !isBlockedTile(scene, column + 1, row);
      paintTile(data, width, tileSize, column, row, BLOCKED_COLOR, (x, y) => {
        const onBorder = (edgeN && y === 0)
          || (edgeS && y === tileSize - 1)
          || (edgeW && x === 0)
          || (edgeE && x === tileSize - 1);
        if (onBorder) return BLOCKED_BORDER_ALPHA;
        const hatch = ((x + y) % 8) < 2;
        return hatch ? BLOCKED_HATCH_ALPHA : BLOCKED_FILL_ALPHA;
      });
    }
  }
  return { width, height, data };
}

/** Rasterise a translucent highlight over every bridge deck tile, border picked out. */
export function computeBridgeOverlay(scene: ValleyScene): OverlayBuffer {
  const { tileSize, widthPixels: width, heightPixels: height } = scene;
  const data = new Uint8ClampedArray(width * height * 4);
  for (const bridge of scene.bridges) {
    for (const tile of bridge.deck) {
      paintTile(data, width, tileSize, tile.column, tile.row, BRIDGE_COLOR, (x, y) => {
        const onBorder = x === 0 || y === 0 || x === tileSize - 1 || y === tileSize - 1;
        return onBorder ? BRIDGE_BORDER_ALPHA : BRIDGE_FILL_ALPHA;
      });
    }
  }
  return { width, height, data };
}

export interface ValleySceneStats {
  readonly totalTiles: number;
  readonly walkableTiles: number;
  readonly blockedTiles: number;
  readonly crossings: number;
  readonly bridges: number;
  readonly bridgeDeckTiles: number;
}

/** Summarise the scene's walkability numbers for the viewer's readout panel. */
export function computeSceneStats(scene: ValleyScene): ValleySceneStats {
  let blockedTiles = 0;
  for (const cell of scene.collision) blockedTiles += cell;
  const bridgeDeckTiles = scene.bridges.reduce((total, bridge) => total + bridge.deck.length, 0);
  return {
    totalTiles: scene.collision.length,
    walkableTiles: scene.collision.length - blockedTiles,
    blockedTiles,
    crossings: scene.crossings.length,
    bridges: scene.bridges.length,
    bridgeDeckTiles,
  };
}
