import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = resolve(process.cwd(), "src");
const ROOTS = [
  resolve(SOURCE_ROOT, "renderer2d/production/CanvasPresentationRenderer.ts"),
  resolve(SOURCE_ROOT, "renderer2d/production/PresentationWorldStage.tsx"),
] as const;

const FORBIDDEN = [
  /(?:^|\/)three(?:\/|$)/i,
  /WorldRenderer/,
  /LivingAtlasApp/,
  /ThreeObserverAdapter/,
  /CanvasWorldRenderer/,
  /CanvasWorldStage/,
  /(?:^|\/)demoScene/,
  /DEMO_/,
  /(?:^|\/)actors\/HumanActor/,
  /(?:^|\/)homes\/ShelterActor/,
  /(?:^|\/)assets\/(?:atlasStore|demoManifest|tileManifest|shelterManifest)/,
  /human-body-atlas|human-face-atlas|human-held-atlas|shelter-slice-atlas|nirvana-tile-atlas/,
  /(?:^|\/)app\/(?:App|rendererMode|client|store|useLiveRun)/,
  /Vivarium2DApp/,
  /window\.location|URLSearchParams/,
  /SerializedEvent|PresentationSession/,
  /(?:^|\/)(?:backend|providers?|ollama|gemini|projectors?)(?:\/|\.|$)/i,
  /characterPilot|character-pilot|(?:^|\/)qa\/characterPilot/i,
] as const;

const FORBIDDEN_RUNTIME_SPECIFIER =
  /(?:backend|ollama|gemini|projector|characterPilot|character-pilot)|(?:^|[/@.-])providers?(?:[/@.-]|$)/i;

describe("production Canvas source closure", () => {
  it.each(ROOTS)("has the required standalone production root %s", (root) => {
    expect(existsSync(root), `Production root is missing: ${root}`).toBe(true);
  });

  it("recursively excludes demo, route, Three, backend, provider, and projector modules", () => {
    const closure = runtimeClosure(ROOTS);
    const violations: string[] = [];
    for (const file of closure) {
      const relative = file.slice(SOURCE_ROOT.length + 1);
      const source = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(relative) || pattern.test(source)) {
          violations.push(`${relative} matched ${pattern}`);
        }
      }
      for (const specifier of runtimeSpecifiers(source)) {
        if (FORBIDDEN_RUNTIME_SPECIFIER.test(specifier)) {
          violations.push(
            `${relative} imports forbidden runtime dependency ${specifier}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("allows local renderer provider nouns but rejects provider, model, and pilot boundaries", () => {
    expect([
      "./nirvana/NirvanaStaticSceneProvider",
      "./staticScene/ProductionStaticScene",
    ].filter(isForbiddenRuntimeSpecifier)).toEqual([]);
    expect([
      "../providers/GeminiDecider",
      "@vivarium/backend",
      "ollama/client",
      "./projection/EventProjector",
      "../../qa/characterPilot/entry",
      "/character-pilot.html",
    ].filter(isForbiddenRuntimeSpecifier)).toEqual([
      "../providers/GeminiDecider",
      "@vivarium/backend",
      "ollama/client",
      "./projection/EventProjector",
      "../../qa/characterPilot/entry",
      "/character-pilot.html",
    ]);
  });

  it("keeps the Stage route-independent and the production debug surface observer-only", () => {
    const stage = readFileSync(ROOTS[1], "utf8");
    expect(stage).not.toMatch(/window\.location|URLSearchParams|rendererMode|Vivarium2DApp|App\.tsx/);
    expect(stage).not.toMatch(/useLiveRun|PresentationSession|ReplayArtifact|Archive/);
    const debugPath = resolve(SOURCE_ROOT, "renderer2d/production/debug.ts");
    expect(existsSync(debugPath), "Production observer-only debug module is missing").toBe(true);
    const debug = readFileSync(debugPath, "utf8");
    expect(debug).not.toMatch(/\b(?:pause|resume|restart|seek|advanceBy|setScene)\s*\(/);
  });

  it("uses the production manifest and concrete Task 8 classes without slice placeholders", () => {
    const closure = [...runtimeClosure(ROOTS)].map((file) => file.slice(SOURCE_ROOT.length + 1));
    expect(closure).toContain("renderer2d/production/assets/productionManifest.ts");
    // The production actor factory (Task 5) constructs `SpriteSheetHumanActor`,
    // not the retired `LayeredHumanActor` — that class stays in the repo for a
    // later cleanup pass, but only type-only imports reference it now, so it
    // no longer belongs to the runtime closure this test enumerates.
    expect(closure).toContain("renderer2d/production/actors/SpriteSheetHumanActor.ts");
    expect(closure).not.toContain("renderer2d/production/actors/LayeredHumanActor.ts");
    expect(closure).toContain("renderer2d/production/homes/HomeActor.ts");
    expect(closure).toContain("renderer2d/production/environment/EnvironmentSystem.ts");
  });
});

function runtimeClosure(roots: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    if (!existsSync(file)) throw new Error(`Production root/import is missing: ${file}`);
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const specifier of runtimeSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveModule(dirname(file), specifier);
      if (resolved !== null && resolved.startsWith(SOURCE_ROOT)) visit(resolved);
    }
  };
  roots.forEach(visit);
  return seen;
}

function runtimeSpecifiers(source: string): string[] {
  const values: string[] = [];
  const staticImport = /import\s+(?!type\b)[\s\S]*?\sfrom\s+["']([^"']+)["']/g;
  const sideEffectImport = /import\s+["']([^"']+)["']/g;
  const dynamicImport = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [staticImport, sideEffectImport, dynamicImport]) {
    for (const match of source.matchAll(pattern)) values.push(match[1]!);
  }
  return values;
}

function isForbiddenRuntimeSpecifier(specifier: string): boolean {
  return FORBIDDEN_RUNTIME_SPECIFIER.test(specifier);
}

function resolveModule(parent: string, specifier: string): string | null {
  const candidate = resolve(parent, specifier);
  const extensions = extname(candidate).length > 0
    ? [""]
    : [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];
  return extensions.map((extension) => `${candidate}${extension}`).find(existsSync) ?? null;
}
