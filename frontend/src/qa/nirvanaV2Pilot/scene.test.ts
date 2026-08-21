import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import * as sceneModule from "./scene";
import type { LandmarkVisualPlacement, TileRectangle } from "./scene";

const {
  NIRVANA_V2_DEFAULT_VIEWPORT,
  createNirvanaV2PilotScene,
} = sceneModule;

interface TileCoordinate {
  readonly column: number;
  readonly row: number;
}

const CARDINAL_STEPS = [
  ["north", 0, -1],
  ["east", 1, 0],
  ["south", 0, 1],
  ["west", -1, 0],
] as const;

function tileKey(tile: TileCoordinate): string {
  return `${tile.column},${tile.row}`;
}

function connectedRoadComponent(
  start: TileCoordinate,
  roadKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  const visited = new Set<string>();
  const pending: TileCoordinate[] = [start];

  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined || visited.has(tileKey(current))) continue;
    if (!roadKeys.has(tileKey(current))) continue;

    visited.add(tileKey(current));
    for (const [, columnDelta, rowDelta] of CARDINAL_STEPS) {
      pending.push({
        column: current.column + columnDelta,
        row: current.row + rowDelta,
      });
    }
  }

  return visited;
}

function rectanglesOverlap(
  first: Readonly<{ column: number; row: number; columns: number; rows: number }>,
  second: Readonly<{ column: number; row: number; columns: number; rows: number }>,
): boolean {
  return first.column < second.column + second.columns
    && first.column + first.columns > second.column
    && first.row < second.row + second.rows
    && first.row + first.rows > second.row;
}

function stableDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function uncoveredWidths(
  intervals: readonly Readonly<{ start: number; end: number }>[],
  extent: number,
): readonly number[] {
  const sorted = intervals
    .map(({ start, end }) => ({
      start: Math.max(0, start),
      end: Math.min(extent, end),
    }))
    .filter(({ start, end }) => end > start)
    .sort((first, second) => first.start - second.start || first.end - second.end);
  const gaps: number[] = [];
  let coveredUntil = 0;

  for (const interval of sorted) {
    if (interval.start > coveredUntil) gaps.push(interval.start - coveredUntil);
    coveredUntil = Math.max(coveredUntil, interval.end);
  }
  if (coveredUntil < extent) gaps.push(extent - coveredUntil);
  return gaps;
}

type WoodlandVisualGenerator = (
  bounds: TileRectangle,
) => readonly LandmarkVisualPlacement[];

function woodlandVisualGenerator(): WoodlandVisualGenerator {
  const candidate = (sceneModule as unknown as Readonly<{
    createNirvanaV2WoodlandVisuals?: WoodlandVisualGenerator;
  }>).createNirvanaV2WoodlandVisuals;
  expect(candidate).toBeTypeOf("function");
  if (candidate === undefined) throw new Error("woodland visual generator is unavailable");
  return candidate;
}

describe("createNirvanaV2PilotScene", () => {
  it("is a thin adapter over production-owned root authoring", () => {
    const source = readFileSync(resolve(
      process.cwd(),
      "src/qa/nirvanaV2Pilot/scene.ts",
    ), "utf8");

    expect(source).toMatch(/renderer2d\/production\/nirvana\/NirvanaRootChunk/);
    expect(source).not.toMatch(/function createRoadTiles|function coordinateHash|function createLandmarks/);
  });

  it("returns one deterministic, complete terrain recipe larger than the default viewport", () => {
    const scene = createNirvanaV2PilotScene();

    expect(createNirvanaV2PilotScene()).toEqual(scene);
    expect(scene.dimensions.widthPixels).toBe(
      scene.dimensions.columns * scene.dimensions.tileSize,
    );
    expect(scene.dimensions.heightPixels).toBe(
      scene.dimensions.rows * scene.dimensions.tileSize,
    );
    expect(scene.dimensions.widthPixels).toBeGreaterThan(NIRVANA_V2_DEFAULT_VIEWPORT.width);
    expect(scene.dimensions.heightPixels).toBeGreaterThan(NIRVANA_V2_DEFAULT_VIEWPORT.height);
    expect(scene.terrainCells).toHaveLength(scene.dimensions.columns * scene.dimensions.rows);
    expect(new Set(scene.terrainCells.map(({ tile }) => tileKey(tile))).size)
      .toBe(scene.terrainCells.length);
    expect(scene.cameraStart.x).toBeGreaterThanOrEqual(0);
    expect(scene.cameraStart.x).toBeLessThan(scene.dimensions.widthPixels);
    expect(scene.cameraStart.y).toBeGreaterThanOrEqual(0);
    expect(scene.cameraStart.y).toBeLessThan(scene.dimensions.heightPixels);
  });

  it("joins the west, east, and south boundary exits to one central road component", () => {
    const scene = createNirvanaV2PilotScene();
    const roadKeys = new Set(scene.roadCells.map(({ tile }) => tileKey(tile)));
    const connected = connectedRoadComponent(scene.roadHub, roadKeys);

    expect(scene.routeExits.map(({ edge }) => edge).sort()).toEqual(["east", "south", "west"]);
    for (const exit of scene.routeExits) {
      expect(connected.has(tileKey(exit.tile)), `${exit.edge} exit is disconnected`).toBe(true);
      if (exit.edge === "west") expect(exit.tile.column).toBe(0);
      if (exit.edge === "east") expect(exit.tile.column).toBe(scene.dimensions.columns - 1);
      if (exit.edge === "south") expect(exit.tile.row).toBe(scene.dimensions.rows - 1);
    }

    expect(connected.size).toBe(roadKeys.size);
  });

  it("stores cardinal road connections for deterministic atlas-frame selection", () => {
    const scene = createNirvanaV2PilotScene();
    const roadKeys = new Set(scene.roadCells.map(({ tile }) => tileKey(tile)));

    for (const road of scene.roadCells) {
      const expectedConnections = CARDINAL_STEPS
        .filter(([, columnDelta, rowDelta]) => roadKeys.has(tileKey({
          column: road.tile.column + columnDelta,
          row: road.tile.row + rowDelta,
        })))
        .map(([direction]) => direction);
      expect(road.connections, tileKey(road.tile)).toEqual(expectedConnections);
    }
  });

  it("composes one hero oak, one transparent ruined garden, and perimeter woodland without prop scatter", () => {
    const scene = createNirvanaV2PilotScene();
    const landmarkIds = scene.landmarks.map(({ id }) => id);
    const heroOaks = scene.landmarks.filter(({ frameId }) => frameId === "landmark.hero-oak");
    const gardenParts = scene.landmarks.filter(({ feature }) => feature === "ruined-garden");
    const ruinedGarden = gardenParts.filter(({ frameId }) => frameId === "landmark.ruined-garden");
    const woodland = scene.landmarks.filter(({ feature }) => feature === "woodland");
    const roadKeys = new Set(scene.roadCells.map(({ tile }) => tileKey(tile)));
    const supportFrames = new Set([
      "landmark.flower-colony",
      "landmark.shrub",
      "landmark.tall-grass",
      "landmark.rocks",
      "landmark.log",
      "landmark.stump",
    ]);

    expect(new Set(landmarkIds).size).toBe(landmarkIds.length);
    expect(heroOaks).toHaveLength(1);
    expect(gardenParts).toHaveLength(1);
    expect(ruinedGarden).toHaveLength(1);
    expect(roadKeys.has("36,13")).toBe(true);
    expect(ruinedGarden[0].collisionTiles.some(({ column, row }) => column === 37 && row === 12))
      .toBe(false);
    expect(woodland.length).toBeGreaterThanOrEqual(8);
    expect(woodland.every(({ bounds }) =>
      bounds.column === 0
      || bounds.row === 0
      || bounds.column + bounds.columns === scene.dimensions.columns
      || bounds.row + bounds.rows === scene.dimensions.rows)).toBe(true);
    expect(scene.landmarks.filter(({ frameId }) => supportFrames.has(frameId))).toEqual([]);
  });

  it("runs one dry swale across the lower map and crosses it only at the ford", () => {
    const scene = createNirvanaV2PilotScene();
    const swale = scene.terrainCells.filter(({ kind }) => kind === "dry-swale");
    const fords = scene.terrainCells.filter(({ kind }) => kind === "ford");
    const roadKeys = new Set(scene.roadCells.map(({ tile }) => tileKey(tile)));
    const swaleColumns = new Set([...swale, ...fords].map(({ tile }) => tile.column));
    const roadSwaleCrossings = [...swale, ...fords]
      .filter(({ tile }) => roadKeys.has(tileKey(tile)));

    expect(swaleColumns.size).toBe(scene.dimensions.columns);
    expect(fords).toHaveLength(1);
    expect(roadSwaleCrossings).toEqual(fords);

    const swaleKeys = new Set([...swale, ...fords].map(({ tile }) => tileKey(tile)));
    for (const cell of [...swale, ...fords]) {
      const expectedConnections = CARDINAL_STEPS
        .filter(([, columnDelta, rowDelta]) => {
          const neighbor = {
            column: cell.tile.column + columnDelta,
            row: cell.tile.row + rowDelta,
          };
          if (neighbor.column < 0 || neighbor.column >= scene.dimensions.columns) return true;
          return swaleKeys.has(tileKey(neighbor));
        })
        .map(([direction]) => direction);
      expect(cell.connections, `swale ${tileKey(cell.tile)}`).toEqual(expectedConnections);
    }
  });

  it("keeps reservation rectangles independent from the visible terrain material", () => {
    const scene = createNirvanaV2PilotScene();
    const terrain = new Map(scene.terrainCells.map((cell) => [tileKey(cell.tile), cell.kind]));

    for (const clearing of scene.quietClearings) {
      const insideKinds = new Set<string>();
      const surroundingKinds = new Set<string>();
      for (let row = clearing.bounds.row - 1; row <= clearing.bounds.row + clearing.bounds.rows; row += 1) {
        for (
          let column = clearing.bounds.column - 1;
          column <= clearing.bounds.column + clearing.bounds.columns;
          column += 1
        ) {
          const kind = terrain.get(`${column},${row}`);
          if (kind === undefined) continue;
          const inside = column >= clearing.bounds.column
            && column < clearing.bounds.column + clearing.bounds.columns
            && row >= clearing.bounds.row
            && row < clearing.bounds.row + clearing.bounds.rows;
          (inside ? insideKinds : surroundingKinds).add(kind);
        }
      }
      // owner-authorised Option A re-baseline, plan §P3: "worn-grass" is retired -- the
      // field-free placeholder pass (what this pilot always renders, since it calls
      // `createNirvanaRootChunk()` with no terrain field) now paints everything "grass"
      // uniformly except authored channel cells. Re-expressed against that current
      // uniform kind, so this still catches a clearing painted as an exact card that
      // does not otherwise occur in its surroundings.
      expect(
        insideKinds.size === 1
          && insideKinds.has("grass")
          && !surroundingKinds.has("grass"),
        `${clearing.id} must not be painted as an exact single-material card`,
      ).toBe(false);
    }
  });

  it("keeps every reserved clearing free of blocking landmarks and collision", () => {
    const scene = createNirvanaV2PilotScene();
    const blockingLandmarks = scene.landmarks.filter(({ blocksMovement }) => blocksMovement);

    expect(scene.quietClearings.map(({ id }) => id).sort()).toEqual([
      "eastern-home",
      "social-meadow",
      "southern-growth",
      "western-home",
    ]);
    for (const clearing of scene.quietClearings) {
      expect(
        blockingLandmarks.some(({ bounds }) => rectanglesOverlap(clearing.bounds, bounds)),
        `${clearing.id} overlaps blocking scenery`,
      ).toBe(false);

      for (let row = clearing.bounds.row; row < clearing.bounds.row + clearing.bounds.rows; row += 1) {
        for (
          let column = clearing.bounds.column;
          column < clearing.bounds.column + clearing.bounds.columns;
          column += 1
        ) {
          expect(
            scene.collision.cells[row * scene.collision.columns + column],
            `${clearing.id} collision at ${column},${row}`,
          ).toBe(0);
        }
      }
    }
  });

  it("keeps landmark collision explicit while every authored road remains walkable", () => {
    const scene = createNirvanaV2PilotScene();

    expect(scene.collision.cells).toHaveLength(scene.collision.columns * scene.collision.rows);
    for (const landmark of scene.landmarks) {
      expect(landmark.blocksMovement).toBe(landmark.collisionTiles.length > 0);
      for (const tile of landmark.collisionTiles) {
        expect(scene.collision.cells[tile.row * scene.collision.columns + tile.column]).toBe(1);
      }
    }
    for (const road of scene.roadCells) {
      expect(scene.collision.cells[road.tile.row * scene.collision.columns + road.tile.column]).toBe(0);
    }
  });

  it("scatters native woodland visuals off the old 96-pixel placement lattice", () => {
    const scene = createNirvanaV2PilotScene();
    const woodlandVisuals = scene.landmarks
      .filter(({ feature }) => feature === "woodland")
      .flatMap(({ visuals }) => visuals);
    const horizontalResidues = new Set(
      woodlandVisuals.map(({ at }) => positiveModulo(at.x, 96)),
    );

    expect(horizontalResidues.size).toBeGreaterThan(8);
    expect(woodlandVisuals.every(({ at, scale }) =>
      Number.isInteger(at.x) && Number.isInteger(at.y) && scale === 1)).toBe(true);
  });

  it("keeps forest art within one tile of each blocking perimeter band's depth", () => {
    const scene = createNirvanaV2PilotScene();
    const forestFrameSize = 128;

    for (const landmark of scene.landmarks.filter(({ feature }) => feature === "woodland")) {
      const edges = [
        ...(landmark.bounds.row === 0 ? ["north"] as const : []),
        ...(landmark.bounds.column + landmark.bounds.columns === scene.dimensions.columns
          ? ["east"] as const
          : []),
        ...(landmark.bounds.row + landmark.bounds.rows === scene.dimensions.rows
          ? ["south"] as const
          : []),
        ...(landmark.bounds.column === 0 ? ["west"] as const : []),
      ];

      for (const edge of edges) {
        const edgeVisuals = landmark.visuals.filter(({ id }) => id.startsWith(`woodland-${edge}-`));
        const visibleDepth = Math.max(...edgeVisuals.map(({ at }) => {
          if (edge === "north") return at.y + forestFrameSize;
          if (edge === "east") return scene.dimensions.widthPixels - at.x;
          if (edge === "south") return scene.dimensions.heightPixels - at.y;
          return at.x + forestFrameSize;
        }));
        const collisionDepth = (
          edge === "north" || edge === "south"
            ? landmark.bounds.rows
            : landmark.bounds.columns
        ) * scene.dimensions.tileSize;

        expect(
          visibleDepth,
          `${landmark.id} ${edge} forest depth`,
        ).toBeGreaterThanOrEqual(collisionDepth - scene.dimensions.tileSize);
      }
    }
  });

  it("leaves multiple irregular visual breathing pockets along the blocked top perimeter", () => {
    const scene = createNirvanaV2PilotScene();
    const forestFrameSize = 128;
    const topEdgeIntervals = scene.landmarks
      .filter(({ feature, bounds }) => feature === "woodland" && bounds.row === 0)
      .flatMap(({ visuals }) => visuals)
      .filter(({ at }) => at.y <= 0 && at.y + forestFrameSize > 0)
      .map(({ at }) => ({ start: at.x, end: at.x + forestFrameSize }));
    const pockets = uncoveredWidths(topEdgeIntervals, scene.dimensions.widthPixels)
      .filter((width) => width >= 24);

    expect(pockets.length).toBeGreaterThanOrEqual(2);
    expect(new Set(pockets).size).toBeGreaterThan(1);

    for (let column = 0; column < scene.dimensions.columns; column += 1) {
      expect(scene.collision.cells[column], `open top boundary at ${column},0`).toBe(1);
    }
  });

  it("retains placements for an unchanged world-space segment when neighboring bounds expand", () => {
    const generate = woodlandVisualGenerator();
    const unchangedSegment: TileRectangle = Object.freeze({
      column: 0,
      row: 0,
      columns: 8,
      rows: 5,
    });
    const segmentWithEasternNeighbor: TileRectangle = Object.freeze({
      column: 0,
      row: 0,
      columns: 16,
      rows: 5,
    });
    const original = generate(unchangedSegment);
    const expandedById = new Map(
      generate(segmentWithEasternNeighbor).map((placement) => [placement.id, placement]),
    );

    expect(original.length).toBeGreaterThan(0);
    for (const placement of original) {
      expect(expandedById.get(placement.id), placement.id).toEqual(placement);
    }
  });

  it("preserves the approved road graph and hard-collision recipe", () => {
    const scene = createNirvanaV2PilotScene();

    expect(stableDigest(scene.roadCells))
      .toBe("ac6e3145961a98eb87f9a6a16114746db097e2743caeff44059adb2effaaddd7");
    expect(stableDigest([...scene.collision.cells]))
      .toBe("a70744bb1ca81e66b1e5a88347a134483d2416e95a30e010401f247599808452");
  });

  it("resolves every landmark to explicit native-scale atlas draws", () => {
    const scene = createNirvanaV2PilotScene();
    const visualIds = scene.landmarks.flatMap(({ visuals }) => visuals.map(({ id }) => id));

    expect(new Set(visualIds).size).toBe(visualIds.length);
    for (const landmark of scene.landmarks) {
      expect(landmark.visuals.length, landmark.id).toBeGreaterThan(0);
      expect(["visual-footprint", "boundary-barrier"]).toContain(landmark.collisionRole);
      for (const visual of landmark.visuals) {
        expect(Number.isInteger(visual.at.x), visual.id).toBe(true);
        expect(Number.isInteger(visual.at.y), visual.id).toBe(true);
        expect([1, 2]).toContain(visual.scale);
        expect(visual.frameId).toMatch(/^landmark\./);
      }
    }
  });
});
