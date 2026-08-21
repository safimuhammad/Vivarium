import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = resolve(process.cwd(), "src");
const ROOT = resolve(SOURCE_ROOT, "app/Vivarium2DApp.tsx");
const FORBIDDEN = [
  /(?:^|\/)three(?:\/|$)/i,
  /(?:from\s+|import\s*\(\s*)["']three(?:\/[^"']*)?["']/i,
  /WorldRenderer/,
  /LivingAtlasApp/,
  /CanvasWorldStage/,
  /eventDemoSource|demoScene|DEMO_/,
  /productionCaptureTestSeam|productionCaptureEntry/,
  /(?:^|\/)(?:backend|providers?|ollama|gemini)(?:\/|\.|$)/i,
  /(?:from\s+|import\s*\(\s*)["'][^"']*(?:backend|ollama|gemini)[^"']*["']/i,
  // `provider` means an LLM-backend provider MODULE -- a path segment named
  // `provider`/`providers`, the same semantics the path regex two lines above
  // already uses. It was previously a bare `provider` substring in the pattern
  // above, which also matched the production renderer's *static scene* providers
  // (`./nirvana/NirvanaStaticSceneProvider` and its three siblings) once they
  // entered this closure through PresentationWorldStage. Those are scene
  // composition, not model backends. Segment-anchoring drops the false positive
  // while still blocking `./providers/ollama` and `../provider`.
  /(?:from\s+|import\s*\(\s*)["'](?:[^"']*\/)?providers?(?:\/[^"']*)?["']/i,
] as const;

describe("Vivarium2DApp production closure", () => {
  it("recursively excludes legacy/3D/demo/provider branches", () => {
    const violations: string[] = [];
    for (const file of runtimeClosure(ROOT)) {
      const relative = file.slice(SOURCE_ROOT.length + 1);
      const source = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(relative) || pattern.test(source)) violations.push(`${relative} matched ${pattern}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("contains no simulation-mutation request verb or endpoint", () => {
    const violations: string[] = [];
    for (const file of runtimeClosure(ROOT)) {
      const source = readFileSync(file, "utf8");
      if (/method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i.test(source)) {
        violations.push(`${file} declares a mutation HTTP method`);
      }
      if (/\/api\/(?:tools?|actions?|commands?|config)(?:\/|["'`?])/i.test(source)) {
        violations.push(`${file} references a simulation mutation endpoint`);
      }
    }
    expect(violations).toEqual([]);
  });
});

function runtimeClosure(root: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    if (!existsSync(file)) throw new Error(`Observer root/import is missing: ${file}`);
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const specifier of runtimeSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveModule(dirname(file), specifier);
      if (resolved !== null && resolved.startsWith(SOURCE_ROOT)) visit(resolved);
    }
  };
  visit(root);
  return seen;
}

function runtimeSpecifiers(source: string): string[] {
  const values: string[] = [];
  const patterns = [
    /import\s+(?!type\b)[\s\S]*?\sfrom\s+["']([^"']+)["']/g,
    /import\s+["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) values.push(match[1]!);
  }
  return values;
}

function resolveModule(parent: string, specifier: string): string | null {
  const candidate = resolve(parent, specifier);
  const extensions = extname(candidate).length > 0
    ? [""]
    : [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];
  return extensions.map((extension) => `${candidate}${extension}`).find(existsSync) ?? null;
}
