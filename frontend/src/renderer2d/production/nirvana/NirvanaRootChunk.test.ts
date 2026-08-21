import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  NIRVANA_ROOT_CAMERA_START,
  createNirvanaRootChunk,
  createNirvanaRootWoodlandVisuals,
} from "./NirvanaRootChunk";

const APPROVED_ROAD_DIGEST = "ac6e3145961a98eb87f9a6a16114746db097e2743caeff44059adb2effaaddd7";
const APPROVED_COLLISION_DIGEST = "a70744bb1ca81e66b1e5a88347a134483d2416e95a30e010401f247599808452";

describe("Nirvana production root chunk", () => {
  it("preserves the approved road, collision, connector, clearing, and camera contract", () => {
    const root = createNirvanaRootChunk();

    expect(root.coord).toEqual({ column: 0, row: 0 });
    expect(root).toMatchObject({ columns: 48, rows: 32 });
    expect(stableDigest(root.roadCells)).toBe(APPROVED_ROAD_DIGEST);
    expect(stableDigest(root.collision)).toBe(APPROVED_COLLISION_DIGEST);
    expect(root.connectors).toEqual([
      { edge: "west", offset: 14 },
      { edge: "east", offset: 16 },
      { edge: "south", offset: 25 },
    ]);
    expect(root.roadHub).toEqual({ column: 25, row: 18 });
    expect(root.quietClearings).toEqual([
      { id: "social-meadow", bounds: { column: 21, row: 12, columns: 8, rows: 6 } },
      { id: "western-home", bounds: { column: 10, row: 19, columns: 9, rows: 5 } },
      { id: "eastern-home", bounds: { column: 30, row: 19, columns: 9, rows: 5 } },
      { id: "southern-growth", bounds: { column: 21, row: 27, columns: 8, rows: 4 } },
    ]);
    expect(NIRVANA_ROOT_CAMERA_START).toEqual({ x: 896, y: 270 });
    expect(Object.isFrozen(root)).toBe(true);
  });

  it("pins the approved landmark identities, bounds, frames, and hero placements", () => {
    const landmarks = createNirvanaRootChunk().landmarks;

    expect(landmarks.map(({ id, frameId, bounds }) => ({ id, frameId, bounds }))).toEqual([
      landmark("woodland-top-west-outer", "landmark.forest-edge.cluster.0", 0, 0, 8, 5),
      landmark("woodland-top-west-inner", "landmark.forest-edge.cluster.1", 8, 0, 7, 4),
      landmark("woodland-top-oak", "landmark.forest-edge.cluster.0", 15, 0, 8, 5),
      landmark("woodland-top-center", "landmark.forest-edge.cluster.1", 23, 0, 9, 4),
      landmark("woodland-top-garden", "landmark.forest-edge.cluster.0", 32, 0, 7, 5),
      landmark("woodland-top-east", "landmark.forest-edge.cluster.1", 39, 0, 9, 4),
      landmark("woodland-west-upper", "landmark.forest-edge.cluster.1", 0, 5, 4, 6),
      landmark("woodland-west-gate-cap", "landmark.forest-edge.cluster.0", 0, 11, 3, 3),
      landmark("woodland-west-lower", "landmark.forest-edge.cluster.0", 0, 16, 4, 7),
      landmark("woodland-west-bottom", "landmark.forest-edge.cluster.1", 0, 23, 6, 9),
      landmark("woodland-east-upper", "landmark.forest-edge.cluster.0", 44, 4, 4, 10),
      landmark("woodland-east-lower", "landmark.forest-edge.cluster.1", 44, 18, 4, 7),
      landmark("woodland-east-bottom", "landmark.forest-edge.cluster.0", 42, 25, 6, 7),
      landmark("woodland-bottom-west", "landmark.forest-edge.cluster.0", 6, 28, 8, 4),
      landmark("woodland-bottom-midwest", "landmark.forest-edge.cluster.1", 14, 29, 7, 3),
      landmark("woodland-bottom-mideast", "landmark.forest-edge.cluster.1", 29, 29, 7, 3),
      landmark("woodland-bottom-east", "landmark.forest-edge.cluster.0", 36, 28, 6, 4),
      landmark("hero-ancient-oak", "landmark.hero-oak", 14, 5, 8, 7),
      landmark("reclaimed-ruined-garden", "landmark.ruined-garden", 34, 5, 8, 8),
    ]);
    expect(landmarks.at(-2)?.visuals).toEqual([{
      id: "hero-ancient-oak-visual",
      frameId: "landmark.hero-oak",
      at: { x: 448, y: 160 },
      scale: 2,
    }]);
    expect(landmarks.at(-1)?.visuals).toEqual([{
      id: "reclaimed-ruined-garden-visual",
      frameId: "landmark.ruined-garden",
      at: { x: 1088, y: 160 },
      scale: 2,
    }]);
  });

  it("keeps coordinate-seeded woodland placements stable when a world segment expands", () => {
    const original = createNirvanaRootWoodlandVisuals({
      column: 0,
      row: 0,
      columns: 8,
      rows: 5,
    });
    const expanded = new Map(createNirvanaRootWoodlandVisuals({
      column: 0,
      row: 0,
      columns: 16,
      rows: 5,
    }).map((placement) => [placement.id, placement]));

    expect(original.length).toBeGreaterThan(0);
    for (const placement of original) {
      expect(expanded.get(placement.id), placement.id).toEqual(placement);
    }
  });

  it("owns semantic authoring throughout a production-only import closure", () => {
    const entryPath = resolve(
      process.cwd(),
      "src/renderer2d/production/nirvana/NirvanaRootChunk.ts",
    );
    const closure = productionImportClosure(entryPath);

    expect(closure.map(({ filePath }) => basename(filePath))).toEqual(expect.arrayContaining([
      "NirvanaRootChunk.ts",
      "NirvanaRegionV2.ts",
    ]));
    for (const module of closure) {
      expect(module.filePath).not.toMatch(/(?:\/|\\)qa(?:\/|\\)/);
      for (const specifier of module.importSpecifiers) {
        expect(specifier.split(/[\\/]/)).not.toContain("qa");
      }
    }
    expect(closure.find(({ filePath }) => filePath === entryPath)?.source)
      .toContain("createNirvanaChunk");
  });
});

interface ProductionSourceModule {
  readonly filePath: string;
  readonly source: string;
  readonly importSpecifiers: readonly string[];
}

function productionImportClosure(entryPath: string): readonly ProductionSourceModule[] {
  const modules: ProductionSourceModule[] = [];
  const pending = [entryPath];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const filePath = pending.pop();
    if (filePath === undefined || visited.has(filePath)) continue;
    visited.add(filePath);

    const source = readFileSync(filePath, "utf8");
    const importSpecifiers = staticImportSpecifiers(source);
    modules.push({ filePath, source, importSpecifiers });
    for (const specifier of importSpecifiers) {
      if (!specifier.startsWith(".")) continue;
      pending.push(resolveTypeScriptImport(filePath, specifier));
    }
  }

  return modules;
}

function staticImportSpecifiers(source: string): readonly string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.add(specifier);
    }
  }
  return [...specifiers];
}

function resolveTypeScriptImport(importerPath: string, specifier: string): string {
  const basePath = resolve(dirname(importerPath), specifier);
  const candidates = [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    basePath,
    resolve(basePath, "index.ts"),
    resolve(basePath, "index.tsx"),
  ];
  const resolvedPath = candidates.find((candidate) => existsSync(candidate));
  if (resolvedPath === undefined) {
    throw new Error(`Unable to resolve production import ${specifier} from ${importerPath}`);
  }
  return resolvedPath;
}

function stableDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function landmark(
  id: string,
  frameId: string,
  column: number,
  row: number,
  columns: number,
  rows: number,
): Readonly<Record<string, unknown>> {
  return { id, frameId, bounds: { column, row, columns, rows } };
}
