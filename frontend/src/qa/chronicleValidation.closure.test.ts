import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const FRONTEND_ROOT = process.cwd();
const SOURCE_ROOT = resolve(FRONTEND_ROOT, "src");
const DEFAULT_ROOT = resolve(SOURCE_ROOT, "main.tsx");
const QA_ROOT = resolve(SOURCE_ROOT, "qa/chronicleValidationEntry.tsx");
const QA_ROUTE = resolve(SOURCE_ROOT, "qa/chronicleValidationRoute.tsx");
const QA_HTML = resolve(FRONTEND_ROOT, "qa-chronicle.html");
const BUILD_MANIFEST = resolve(FRONTEND_ROOT, "dist/.vite/manifest.json");
const POST_BUILD_CLOSURE = process.env.VIVARIUM_QA_POST_BUILD === "1";
const qaAvailable = existsSync(QA_ROOT) && existsSync(QA_HTML);
const qaIt = it.skipIf(!qaAvailable);
const postBuildIt = it.skipIf(!POST_BUILD_CLOSURE);

describe("Chronicle QA dependency closure", () => {
  it("keeps the default source and default Vite build entry free of QA fixtures", () => {
    const closure = runtimeClosure(DEFAULT_ROOT);
    const violations = [...closure].filter((file) => {
      const name = portable(relative(FRONTEND_ROOT, file));
      return /(?:^|\/)qa(?:\/|$)/.test(name)
        || /presentation\/fixtures/.test(name)
        || /fixtures\/chronicles\/data/.test(name);
    });
    const index = readFileSync(resolve(FRONTEND_ROOT, "index.html"), "utf8");
    const viteConfig = readFileSync(resolve(FRONTEND_ROOT, "vite.config.ts"), "utf8");

    expect(violations.map((file) => portable(relative(FRONTEND_ROOT, file)))).toEqual([]);
    expect(index).toMatch(/src="\/src\/main\.tsx"/);
    expect(index).not.toMatch(/qa-chronicle|chronicleValidation|chronicleCatalog/);
    expect(viteConfig).not.toMatch(/rollupOptions[\s\S]*qa-chronicle|qa-chronicle[\s\S]*rollupOptions/);
  });

  postBuildIt("proves a fresh explicitly post-build default artifact closure excludes QA fixtures", () => {
    expect(existsSync(BUILD_MANIFEST), "run the default Vite build before the closure contract")
      .toBe(true);
    const buildInputs = freshBuildInputs();
    const newestInputMtime = Math.max(...buildInputs.map((file) => statSync(file).mtimeMs));
    expect(statSync(BUILD_MANIFEST).mtimeMs).toBeGreaterThanOrEqual(newestInputMtime);
    const manifest = parseBuildManifest(readFileSync(BUILD_MANIFEST, "utf8"));
    const keys = buildManifestClosure(manifest, "index.html");
    expect(keys).not.toContain("qa-chronicle.html");
    const violations: string[] = [];
    const inspectedOutputs = new Set<string>();
    for (const [key, record] of Object.entries(manifest)) {
      if (/qa-chronicle|chronicleValidation|chronicleCatalog|fixtures\/chronicles\/data/i.test(key)) {
        violations.push(`manifest:${key}`);
      }
      for (const output of [record.file, ...(record.css ?? []), ...(record.assets ?? [])]) {
        if (inspectedOutputs.has(output)) continue;
        inspectedOutputs.add(output);
        const outputPath = resolve(FRONTEND_ROOT, "dist", output);
        expect(statSync(outputPath).mtimeMs, `${output} must be from this post-build gate`)
          .toBeGreaterThanOrEqual(newestInputMtime);
        const chunk = readFileSync(outputPath, "utf8");
        if (/qa-chronicle|chronicleValidation|mock-c(?:0[0-9]|1[0-7])-v1|fixtures\/chronicles\/data/i.test(chunk)) {
          violations.push(`chunk:${output}`);
        }
      }
    }
    for (const outputPath of filesUnder(resolve(FRONTEND_ROOT, "dist"))) {
      const output = portable(relative(resolve(FRONTEND_ROOT, "dist"), outputPath));
      if (/qa-chronicle|chronicleValidation|chronicleCatalog|fixtures\/chronicles\/data/i.test(output)) {
        violations.push(`asset:${output}`);
      }
      if (!/\.(?:html|css|js|json|svg|txt|webmanifest)$/i.test(output)) continue;
      const contents = readFileSync(outputPath, "utf8");
      if (/qa-chronicle|chronicleValidation|mock-c(?:0[0-9]|1[0-7])-v1|fixtures\/chronicles\/data/i.test(contents)) {
        violations.push(`asset-content:${output}`);
      }
    }
    const builtIndex = resolve(FRONTEND_ROOT, "dist/index.html");
    expect(statSync(builtIndex).mtimeMs).toBeGreaterThanOrEqual(newestInputMtime);
    expect(violations).toEqual([]);
  });

  it("discovers export-from, source aliases, templates, and computed literal dynamic imports", () => {
    expect(runtimeSpecifiers(`
      export { App } from "@/app/App";
      export * from '~/presentation/StoryDirector';
      import("./" + "gamma");
      import(\`./delta\`);
      import(\`./${"${notStatic}"}\`);
    `)).toEqual([
      "@/app/App",
      "~/presentation/StoryDirector",
      "./gamma",
      "./delta",
    ]);
    expect(resolveModule(SOURCE_ROOT, "@/app/App"))
      .toBe(resolve(SOURCE_ROOT, "app/App.tsx"));
    expect(resolveModule(SOURCE_ROOT, "~/presentation/StoryDirector"))
      .toBe(resolve(SOURCE_ROOT, "presentation/StoryDirector.ts"));
  });

  qaIt("keeps the QA entry development-only and source-bound to production 2D plus fixtures", () => {
    expect(existsSync(QA_ROUTE), "the repeatable Chronicle route must be a side-effect-free module")
      .toBe(true);
    if (!existsSync(QA_ROUTE)) return;
    const closure = runtimeClosure(QA_ROOT);
    const names = [...closure].map((file) => portable(relative(FRONTEND_ROOT, file)));
    const html = readFileSync(QA_HTML, "utf8");

    expect(names).toContain("src/app/Vivarium2DApp.tsx");
    expect(names).toContain("src/app/observer2d/observerShellRuntime.ts");
    expect(names).toContain("src/app/observer2d/createProductionObserverSession.ts");
    expect(names).toContain("src/presentation/fixtures/chronicleCatalog.ts");
    expect(names).toContain("src/presentation/fixtures/FixtureTransport.ts");
    expect(names).toContain("src/presentation/CheckpointFeed.ts");
    expect(names).toContain("src/app/replayArtifactClient.ts");
    expect(names).toContain("src/app/replaySession.ts");
    expect(importedRuntimeBindingReferenceCount(
      QA_ROUTE,
      resolve(SOURCE_ROOT, "app/Vivarium2DApp.tsx"),
      "Vivarium2DApp",
    )).toBeGreaterThan(0);
    expect(importedRuntimeBindingReferenceCount(
      QA_ROOT,
      QA_ROUTE,
      "bootChronicleValidationRoute",
    )).toBeGreaterThan(0);
    expect(runtimeSpecifiers(readFileSync(QA_ROOT, "utf8"))).toEqual([
      "./chronicleValidationRoute",
    ]);
    expect(importedRuntimeBindingReferenceCount(
      QA_ROOT,
      resolve(SOURCE_ROOT, "app/Vivarium2DApp.tsx"),
      "Vivarium2DApp",
    )).toBe(0);
    expect(topLevelCallCount(QA_ROOT, "bootChronicleValidationRoute")).toBe(1);
    expect(topLevelCallCount(QA_ROUTE, "bootChronicleValidationRoute")).toBe(0);
    expect(html).toMatch(/src="\/src\/qa\/chronicleValidationEntry\.tsx"/);
    expect(html).toMatch(/<script[^>]+type="module"[^>]+src="\/src\/qa\/chronicleValidationEntry\.tsx"/);
    expect(html).toMatch(/<main[^>]+id="root"/);
  });

  qaIt("excludes legacy 3D, capture, providers, network calls, and direct renderer mutation from QA ownership", () => {
    const closure = runtimeClosure(QA_ROOT);
    const pathViolations = [...closure]
      .map((file) => portable(relative(FRONTEND_ROOT, file)))
      .filter((name) => (
        /(?:^|\/)(?:renderer\/WorldRenderer|app\/LivingAtlasApp|renderer2d\/CanvasWorldStage)/.test(name)
        || /(?:^|\/)capture(?:\/|$)/.test(name)
        || /(?:^|\/)(?:backend|providers?|ollama|gemini)(?:\/|\.|$)/i.test(name)
      ));
    const scannedFiles: string[] = [];
    const sourceViolations: string[] = [];
    for (const file of closure) {
      const source = readFileSync(file, "utf8");
      const name = portable(relative(FRONTEND_ROOT, file));
      scannedFiles.push(name);
      const networkPattern = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/;
      const mutationPattern = /\.(?:placeAgent|placeHome|commit|mutateWorld|setActorPosition)\s*\(/;
      // Legacy-3D / capture / LLM-backend module specifiers. These names are
      // distinctive enough to ban as substrings.
      const bannedModulePattern =
        /(?:from\s+|import\s*\(\s*)["'][^"']*(?:capture|WorldRenderer|LivingAtlasApp|CanvasWorldStage|ollama|gemini)[^"']*["']/i;
      // "providers" means an LLM-backend provider MODULE -- a path segment named
      // `provider`/`providers`, exactly the semantics the sibling `pathViolations`
      // regex above already uses. It was previously a bare `provider` substring
      // alternative in the pattern above, which also matched the production
      // renderer's *static scene* providers (`./nirvana/NirvanaStaticSceneProvider`
      // and its three siblings) once they entered the QA runtime closure via
      // PresentationWorldStage's dynamic import of ProductionCanvasSceneFactory.
      // Those are scene composition, not model backends. Segment-anchoring removes
      // the false positive without letting any real provider module through:
      // "./providers/ollama" and "../provider" still match.
      const providerModulePattern =
        /(?:from\s+|import\s*\(\s*)["'](?:[^"']*\/)?providers?(?:\/[^"']*)?["']/i;
      const patterns = [
        bannedModulePattern,
        providerModulePattern,
        ...(!sanctionedProductionNetworkOwner(name) ? [networkPattern] : []),
        ...(!sanctionedProductionMutationOwner(name) ? [mutationPattern] : []),
      ];
      for (const pattern of patterns) {
        if (pattern.test(source)) sourceViolations.push(`${name} matched ${pattern}`);
      }
    }

    expect(pathViolations).toEqual([]);
    expect(scannedFiles.sort()).toEqual(
      [...closure].map((file) => portable(relative(FRONTEND_ROOT, file))).sort(),
    );
    expect(sourceViolations).toEqual([]);
  });
});

function runtimeClosure(root: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    if (!existsSync(file)) throw new Error(`runtime root/import is missing: ${file}`);
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const specifier of runtimeSpecifiers(source)) {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/") && !specifier.startsWith("~/")) continue;
      const resolved = resolveModule(dirname(file), specifier);
      if (resolved === null) throw new Error(`unresolved runtime import ${specifier} from ${file}`);
      if (resolved.startsWith(FRONTEND_ROOT)) visit(resolved);
    }
  };
  visit(root);
  return seen;
}

function sanctionedProductionNetworkOwner(name: string): boolean {
  return [
    "src/app/client.ts",
    "src/app/checkpointClient.ts",
    "src/app/replayArtifactClient.ts",
    "src/renderer2d/assets/atlasStore.ts",
    "src/renderer2d/production/assets/SharedAtlasPool.ts",
  ].includes(name);
}

function sanctionedProductionMutationOwner(name: string): boolean {
  return name.startsWith("src/renderer2d/production/")
    || name === "src/presentation/RecoveryCoordinator.ts";
}

function runtimeSpecifiers(source: string): string[] {
  const values: string[] = [];
  const file = ts.createSourceFile("closure.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && importDeclarationIsRuntime(node)) {
      if (ts.isStringLiteralLike(node.moduleSpecifier)) values.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && exportDeclarationIsRuntime(node)) {
      if (ts.isStringLiteralLike(node.moduleSpecifier)) values.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const value = node.arguments[0] === undefined ? null : staticString(node.arguments[0]);
      if (value !== null) values.push(value);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return values;
}

function importDeclarationIsRuntime(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name !== undefined) return true;
  if (clause.namedBindings === undefined || ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
}

function exportDeclarationIsRuntime(node: ts.ExportDeclaration): node is ts.ExportDeclaration & {
  readonly moduleSpecifier: ts.Expression;
} {
  if (node.moduleSpecifier === undefined || node.isTypeOnly) return false;
  if (node.exportClause === undefined || ts.isNamespaceExport(node.exportClause)) return true;
  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

function staticString(expression: ts.Expression): string | null {
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (
    ts.isBinaryExpression(expression)
    && expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticString(expression.left);
    const right = staticString(expression.right);
    return left === null || right === null ? null : left + right;
  }
  if (ts.isParenthesizedExpression(expression)) return staticString(expression.expression);
  return null;
}

function importedRuntimeBindingReferenceCount(
  filePath: string,
  expectedModulePath: string,
  exportedName: string,
): number {
  const source = readFileSync(filePath, "utf8");
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let localName: string | null = null;
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !importDeclarationIsRuntime(statement)
      || !ts.isStringLiteralLike(statement.moduleSpecifier)
      || resolveModule(dirname(filePath), statement.moduleSpecifier.text) !== expectedModulePath) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    const binding = bindings.elements.find((element) => (
      (element.propertyName?.text ?? element.name.text) === exportedName
      && !element.isTypeOnly
    ));
    if (binding !== undefined) localName = binding.name.text;
  }
  if (localName === null) return 0;

  let references = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === localName && !hasImportDeclarationAncestor(node)) {
      references += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return references;
}

function topLevelCallCount(filePath: string, functionName: string): number {
  const source = readFileSync(filePath, "utf8");
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let calls = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) return;
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === functionName) calls += 1;
    ts.forEachChild(node, visit);
  };
  for (const statement of file.statements) visit(statement);
  return calls;
}

function hasImportDeclarationAncestor(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isImportDeclaration(current)) return true;
    current = current.parent;
  }
  return false;
}

function resolveModule(parent: string, specifier: string): string | null {
  const candidate = specifier.startsWith("@/") || specifier.startsWith("~/")
    ? resolve(SOURCE_ROOT, specifier.slice(2))
    : resolve(parent, specifier);
  const extensions = extname(candidate).length > 0
    ? [""]
    : [".ts", ".tsx", ".js", ".jsx", ".json", "/index.ts", "/index.tsx"];
  return extensions.map((extension) => `${candidate}${extension}`).find(existsSync) ?? null;
}

function freshBuildInputs(): readonly string[] {
  const viteConfig = resolve(FRONTEND_ROOT, "vite.config.ts");
  const rootMetadata = readdirSync(FRONTEND_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (
      /^\.env(?:\.|$)/.test(entry.name)
      || /^package(?:-lock)?\.json$/.test(entry.name)
      || /^tsconfig(?:\.[^.]+)?\.json$/.test(entry.name)
      || /\.config\.(?:ts|js|mjs|cjs)$/.test(entry.name)
    ))
    .map(({ name }) => resolve(FRONTEND_ROOT, name));
  const staticAssets = ["public", "static"]
    .flatMap((directory) => filesUnder(resolve(FRONTEND_ROOT, directory)));
  return [...new Set([
    ...runtimeClosure(DEFAULT_ROOT),
    ...runtimeClosure(viteConfig),
    resolve(FRONTEND_ROOT, "index.html"),
    ...rootMetadata,
    ...staticAssets,
  ])];
}

function filesUnder(root: string): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

interface BuildManifestRecord {
  readonly file: string;
  readonly imports?: readonly string[];
  readonly dynamicImports?: readonly string[];
  readonly css?: readonly string[];
  readonly assets?: readonly string[];
}

function parseBuildManifest(source: string): Readonly<Record<string, BuildManifestRecord>> {
  const value: unknown = JSON.parse(source);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Vite manifest must be an object");
  }
  for (const [key, record] of Object.entries(value)) {
    if (typeof record !== "object" || record === null || Array.isArray(record)
      || typeof (record as Record<string, unknown>).file !== "string") {
      throw new Error(`Vite manifest record ${key} is invalid`);
    }
  }
  return value as Readonly<Record<string, BuildManifestRecord>>;
}

function buildManifestClosure(
  manifest: Readonly<Record<string, BuildManifestRecord>>,
  root: string,
): readonly string[] {
  const seen = new Set<string>();
  const visit = (key: string): void => {
    if (seen.has(key)) return;
    const record = manifest[key];
    if (record === undefined) throw new Error(`Vite manifest import ${key} is missing`);
    seen.add(key);
    for (const child of [...(record.imports ?? []), ...(record.dynamicImports ?? [])]) visit(child);
  };
  visit(root);
  return [...seen];
}

function portable(path: string): string {
  return path.replaceAll("\\", "/");
}
