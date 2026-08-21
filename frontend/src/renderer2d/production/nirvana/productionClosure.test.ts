import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const FRONTEND_ROOT = process.cwd();
const NIRVANA_HTML = resolve(FRONTEND_ROOT, "nirvana.html");
const ENTRY = resolve(
  FRONTEND_ROOT,
  "src/renderer2d/production/nirvana/entry.tsx",
);

describe("production Nirvana scenery closure", () => {
  it("builds a real production entry without QA, character, Chronicle, or backend dependencies", () => {
    expect(existsSync(NIRVANA_HTML), "production Nirvana HTML entry must exist").toBe(true);
    expect(existsSync(ENTRY), "production Nirvana React entry must exist").toBe(true);

    const html = readFileSync(NIRVANA_HTML, "utf8");
    expect(html).toMatch(/<main[^>]+id=["']root["']/);
    expect(html).toMatch(
      /src=["']\/src\/renderer2d\/production\/nirvana\/entry\.tsx["']/,
    );

    const closure = productionClosure(ENTRY);
    const imports = closure.flatMap(({ imports: moduleImports }) => moduleImports);
    expect(imports.join("\n")).not.toMatch(
      /\/qa\/|LayeredHumanActor|HomeActor|Chronicle|\/api\/|backend|ollama|gemini|provider/i,
    );
    expect(closure.map(({ path }) => path).join("\n")).not.toMatch(/\/src\/qa\//);
    expect(closure.map(({ source }) => source).join("\n")).not.toMatch(/\/api\//);

    const viteConfig = readFileSync(resolve(FRONTEND_ROOT, "vite.config.ts"), "utf8");
    expect(viteConfig).toMatch(/rollupOptions/);
    expect(viteConfig).toMatch(/index\.html/);
    expect(viteConfig).toMatch(/nirvana\.html/);
  });
});

interface ClosureModule {
  readonly path: string;
  readonly source: string;
  readonly imports: readonly string[];
}

function productionClosure(entry: string): readonly ClosureModule[] {
  const pending = [entry];
  const seen = new Set<string>();
  const result: ClosureModule[] = [];

  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    const source = readFileSync(path, "utf8");
    const imports = importSpecifiers(source);
    result.push({ path, source, imports });

    for (const specifier of imports) {
      if (!specifier.startsWith(".")) continue;
      const target = resolveModule(dirname(path), specifier);
      if (target !== null && [".ts", ".tsx"].includes(extname(target))) pending.push(target);
    }
  }

  return result;
}

function importSpecifiers(source: string): readonly string[] {
  const results: string[] = [];
  const pattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1] !== undefined) results.push(match[1]);
  }
  return results;
}

function resolveModule(parent: string, specifier: string): string | null {
  const candidate = resolve(parent, specifier);
  for (const path of [candidate, `${candidate}.ts`, `${candidate}.tsx`]) {
    if (existsSync(path)) return path;
  }
  return null;
}
