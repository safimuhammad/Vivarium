/**
 * RED contract for deterministic V3 snapshots across asynchronous composition.
 *
 * The public builders must copy accepted caller data once, before their first
 * asynchronous boundary. Every ordinary post-call caller change must resolve
 * from the initial detached clean snapshot with exactly equal bytes, receipts,
 * and provenance.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import ts from "typescript";

import {
  REGIONAL_R5_V3_ATOMIC_LITERAL_AUTHORITY,
} from "./fixtures/regional-art-r5-v3-atomic-literal-authority.mjs";
import {
  buildRegionalR5V3AtomicSourceMastersInternal,
} from "./regional-art-r5-v3-atomic-source.mjs";
import * as productionPacker from "./pack-2d-production-assets.mjs";

const AUTHORITY = REGIONAL_R5_V3_ATOMIC_LITERAL_AUTHORITY;
const KITS = Object.freeze([
  "ash-waste",
  "dry-scrub",
  "neutral-temperate",
  "spring-terraces",
  "worn-heartland",
]);
const UNTOUCHED_CELL_LAYER_KEY = "neutral-temperate-terrain:0";
const NATIVE_SOURCE_ROOT = new URL(
  "../../scratchpad/2d-production-art/source/native/",
  import.meta.url,
);
const PACKER_URL = new URL("./pack-2d-production-assets.mjs", import.meta.url);
const PACKER_SOURCE = await readFile(PACKER_URL, "utf8");
const ATOMIC_SOURCE = await readFile(
  new URL("./regional-art-r5-v3-atomic-source.mjs", import.meta.url),
  "utf8",
);
const ATLAS_SOURCE = await readFile(
  new URL("./regional-art-r5-atlas-only-scene.mjs", import.meta.url),
  "utf8",
);
const DYNAMIC_SOURCE = await readFile(
  new URL("./regional-art-r5-dynamic-presentation.mjs", import.meta.url),
  "utf8",
);
const INTAKE_MODULE_URL = new URL(
  "./regional-art-r5-composition-intake.mjs",
  import.meta.url,
);
const INTAKE_SOURCE = await readFile(INTAKE_MODULE_URL, "utf8").catch(() => null);
const BASELINE_MASTER_PNG_SHA256 = Object.freeze({
  "ash-waste-home-yards": "434ac4f67869661e3b2b93afc92c4181fb515a2dc23657425579a63a09cb9102",
  "ash-waste-landmarks": "b53c379927e7ae2a49ad2302db98a6caca10de009ceb71fae8ce510422d1abea",
  "ash-waste-scenery": "9c9da56ef160b91522a851941a61ae6cca037cdec189e9c07d0cd0bf798ffb6f",
  "ash-waste-terrain": "a89d5f52c896ce5aab2e036f0ee7e109b6020222f7d2ae9d18f72c47a29407f1",
  "dry-scrub-home-yards": "5663ea6f8292fb4d17ddc556246570d2ab18f6ad41b0e5381f59bcc5432ab460",
  "dry-scrub-landmarks": "ed8d75cbc64d90413d8228ac13efd4fc2211f6a73a70f2b63f4effc4cd135d0e",
  "dry-scrub-scenery": "5cfc442fc39e668281a9889cc591681a9b1ff2dddab5b64b9b0a502d6a898c92",
  "dry-scrub-terrain": "e52ca60c85ae04ce3ea5d6ade2b0601cd33c8e83580ac60cc1ed49c005031af9",
  "neutral-temperate-home-yards": "13e17622f3375d1242c8d9881ccd4205f78ec6df55464f0df615ae3a4f8242c2",
  "neutral-temperate-landmarks": "768332e554ac37af9f4069c35865c165fc1568912d25a1fae93297295a7dc1a2",
  "neutral-temperate-scenery": "e6d8fb85b951f0a22e4817482d0b95b279fcdd9e9612ad84cd561f0fb8af0b40",
  "neutral-temperate-terrain": "94e1c955959376363d6f4ad1757bae3ab0f08765b3816f8072d4e2722af23f12",
  "spring-terraces-home-yards": "587c46cd7bfe54fcb96ca0e36dd34732d63b15b74c8c14b3ee260b720281451e",
  "spring-terraces-landmarks": "f8e7e6e6f22310ac1db95324493ef5d3bb39b5d9b4864d1be23ff2f82cfd61b1",
  "spring-terraces-scenery": "37b3a2db70a0da16a6bba4f48bc3be66f985edcff62bd1e9da2c746d1021c12a",
  "spring-terraces-terrain": "e00b7a9078030be6de36563b581b3a8f2944d0100b58d76f046dcffa0da349f5",
  "worn-heartland-home-yards": "bdadc63113ecd94e517cf12c3b279a9f581a09b7ca84a057ef4ac0259af09dae",
  "worn-heartland-landmarks": "3ffe17aa59c5a1be858a747af9137caf4481b67aadac7db0b50fd4c5d843a6ed",
  "worn-heartland-scenery": "36804d363d8113e4e2af548fea1dd1927e0fdc94af8cc05a6ca14cb2f73d7281",
  "worn-heartland-terrain": "4746a72bc80088fdfbee37786b5b084223a2cddb96d064d26e74e4d58c6eb2c4",
});
const BASELINE_STATIC_RGBA_SHA256 = Object.freeze({
  "ash-waste": "bf14dbcbc01a10ccfdab23edd9ea375d402525b6dbe1b2be8de85c835ca8e931",
  "dry-scrub": "407de9b74feea4be51ac693a44f3112dda517dfc5b9fb6e300ebf510afc9dce6",
  "neutral-temperate": "7b612328402c0373564fcb0a8f558dc2a5ba159f3fdbc5b8208a1bccf468cb80",
  "spring-terraces": "40deb5eb01e2e1ba22128ecabd1af33d6bf427476f2452f217534fa6905df9a0",
  "worn-heartland": "f5b63461f4452673b02caabaedf8f2d25cbcb389641066fbb9a0b1f87f40737b",
});
const BASELINE_DYNAMIC_RGBA_SHA256 = Object.freeze({
  "ash-waste": "fa98d7674081a82d1cb9cb3f57e7a3511b207425dcb97d7f286657a946711bd2",
  "dry-scrub": "a5cee576e1f32f34d5d7c76fedbc8f3d9bb3c3561b4873ec3f7943534846884a",
  "neutral-temperate": "3735f7bbc3806c87bd4316c15a9e1b494f078b37177023ac25e245e100b17b84",
  "spring-terraces": "078c7ffff02786d335b7e58e25eaf886710423b75d459b9c2bf07068d9b94306",
  "worn-heartland": "776fc172bde9d0233942e1315667de467b5bc1011a6cbff69a34fd2627a2c159",
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort(compareText).map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalDigest(value) {
  return sha256(Buffer.from(canonicalJson(value)));
}

function cloneValue(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Map) {
    return new Map([...value].map(([key, child]) => [cloneValue(key), cloneValue(child)]));
  }
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
  }
  return value;
}

function withoutCanonicalSha256(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "canonicalSha256"));
}

function valueAtPath(root, path) {
  return path.reduce((value, step) => (
    step.kind === "map-key" ? step.key
      : step.kind === "map-value" ? value.get(step.key) : value[step.key]
  ), root);
}

function pathLabel(path) {
  if (path.length === 0) return "<root>";
  return path.map((step) => (
    step.kind === "map-value" ? `<map-value:${JSON.stringify(step.key)}>`
      : step.kind === "map-key" ? `<map-key:${JSON.stringify(step.key)}>`
        : step.arrayIndex ? `[${step.key}]` : JSON.stringify(step.key)
  )).join(".");
}

function containerKind(value) {
  if (Buffer.isBuffer(value)) return "Buffer";
  if (value instanceof Map) return "Map";
  if (Array.isArray(value)) return "Array";
  return "Object";
}

function traversalChildren(value) {
  if (Buffer.isBuffer(value)) return [];
  if (value instanceof Map) {
    return [...value].flatMap(([key, child]) => {
      const entries = [];
      if (key !== null && typeof key === "object") {
        entries.push({ child: key, step: { kind: "map-key", key } });
      }
      if (child !== null && typeof child === "object") {
        entries.push({ child, step: { kind: "map-value", key } });
      }
      return entries;
    });
  }
  return Reflect.ownKeys(value).flatMap((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return [];
    const child = descriptor.value;
    return child !== null && typeof child === "object"
      ? [{ child, step: { kind: "property", key, arrayIndex: Array.isArray(value) } }]
      : [];
  });
}

function traversalDerivedContainerSites(root) {
  const sites = [];
  function visit(value, path, ancestors) {
    if (value === null || typeof value !== "object") return;
    if (ancestors.has(value)) throw new TypeError(`cycle in accepted input at ${pathLabel(path)}`);
    sites.push({ path, kind: containerKind(value) });
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);
    for (const { child, step } of traversalChildren(value)) {
      visit(child, [...path, step], nextAncestors);
    }
  }
  visit(root, [], new Set());
  return sites;
}

function decorateContainer(root, path, representation, label) {
  const target = valueAtPath(root, path);
  const metadataKey = `__intake_metadata_${label.replaceAll(/[^a-z0-9]/giu, "_")}`;
  let accessorReads = 0;
  let restore;
  if (representation === "non-enumerable") {
    Object.defineProperty(target, metadataKey, {
      configurable: true,
      enumerable: false,
      value: "not-authority",
    });
    restore = () => { delete target[metadataKey]; };
  } else if (representation === "symbol") {
    const symbol = Symbol(metadataKey);
    target[symbol] = "not-authority";
    restore = () => { delete target[symbol]; };
  } else if (representation === "accessor") {
    Object.defineProperty(target, metadataKey, {
      configurable: true,
      enumerable: true,
      get() {
        accessorReads += 1;
        return accessorReads;
      },
    });
    restore = () => { delete target[metadataKey]; };
  } else if (representation === "non-plain-prototype") {
    const originalPrototype = Object.getPrototypeOf(target);
    const prototype = Object.create(originalPrototype);
    Object.defineProperty(prototype, "__intake_inherited_metadata", {
      configurable: true,
      enumerable: true,
      value: "not-authority",
    });
    Object.setPrototypeOf(target, prototype);
    restore = () => { Object.setPrototypeOf(target, originalPrototype); };
  } else {
    throw new Error(`unknown closure representation ${representation}`);
  }
  return { accessorReads: () => accessorReads, restore };
}

function transferableBuffer(bytes) {
  const backing = new ArrayBuffer(bytes.length);
  const buffer = Buffer.from(backing);
  bytes.copy(buffer);
  return { backing, buffer };
}

async function assertExactResolution(operation, expected, label) {
  const actual = await operation;
  assert.equal(
    isDeepStrictEqual(actual, expected),
    true,
    `${label}: must resolve from the initial detached snapshot`,
  );
  return actual;
}

async function assertTypeError(operation, label) {
  await assert.rejects(operation, (error) => {
    assert.equal(error instanceof Error, true, `${label}: rejection must be a real Error`);
    assert.equal(error?.constructor, TypeError, `${label}: exact TypeError required`);
    assert.equal(error.name, "TypeError", `${label}: exact TypeError name required`);
    return true;
  }, label);
}

async function assertProductError(operation, expectedName, expectedCode, label) {
  await assert.rejects(operation, (error) => {
    assert.equal(error instanceof Error, true, `${label}: rejection must be a real Error`);
    assert.equal(error?.name, expectedName, `${label}: exact product error name required`);
    assert.equal(error?.code, expectedCode, `${label}: exact product error code required`);
    return true;
  }, label);
}

function assertNoSharedObjectReferences(output, callerInput, label) {
  const callerObjects = new WeakSet();
  const callerBufferRanges = [];
  function collect(value, seen) {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    callerObjects.add(value);
    if (Buffer.isBuffer(value)) {
      callerBufferRanges.push({
        backing: value.buffer,
        start: value.byteOffset,
        end: value.byteOffset + value.byteLength,
      });
    }
    for (const { child } of traversalChildren(value)) collect(child, seen);
  }
  function inspect(value, seen) {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    assert.equal(callerObjects.has(value), false, `${label}: returned graph aliases caller input`);
    if (Buffer.isBuffer(value)) {
      const start = value.byteOffset;
      const end = value.byteOffset + value.byteLength;
      assert.equal(
        callerBufferRanges.some((range) => (
          range.backing === value.buffer && start < range.end && range.start < end
        )),
        false,
        `${label}: returned Buffer overlaps a caller-owned backing store`,
      );
    }
    seen.add(value);
    for (const { child } of traversalChildren(value)) inspect(child, seen);
  }
  collect(callerInput, new WeakSet());
  inspect(output, new WeakSet());
}

async function recordReadinessProbe(gaps, label, operation) {
  try {
    await operation();
  } catch (error) {
    const code = typeof error?.code === "string" ? `/${error.code}` : "";
    gaps.push(`${label}: ${error?.name ?? "Error"}${code}`);
  }
}

async function recordContractCase(failures, label, operation) {
  try {
    await operation();
  } catch (error) {
    const code = typeof error?.code === "string" ? `/${error.code}` : "";
    failures.push(`${label}: ${error?.name ?? "Error"}${code}: ${error?.message ?? String(error)}`);
  }
}

function assertNoContractFailures(failures, label) {
  assert.equal(failures.length, 0, `${label}:\n${failures.join("\n")}`);
}

function exportedAsyncFunctionSource(source, functionName, sourceLabel) {
  const sourceFile = ts.createSourceFile(
    sourceLabel,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const matches = sourceFile.statements.filter((statement) => (
    ts.isFunctionDeclaration(statement)
      && statement.name?.text === functionName
      && statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)
  ));
  assert.equal(
    matches.length,
    1,
    `${functionName}: exactly one exported function declaration required`,
  );
  const [declaration] = matches;
  assert.equal(
    declaration.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.AsyncKeyword),
    true,
    `${functionName}: exported function must be async`,
  );
  assert.ok(declaration.body, `${functionName}: exported function body required`);
  return Object.freeze({
    declaration: source.slice(declaration.getStart(sourceFile), declaration.end),
    body: source.slice(declaration.body.getStart(sourceFile), declaration.body.end),
  });
}

function exportedAsyncFunctionSourceContract() {
  const exactName = "buildExact";
  const syntheticSource = `
    // export async function buildExact() { return "comment spoof"; }
    const text = "export async function buildExact() { return 'string spoof'; }";
    export async function buildExactLonger() { return "longer prefix spoof"; }
    export async function buildExact() { return "exact declaration"; }
  `;
  const extracted = exportedAsyncFunctionSource(syntheticSource, exactName, "synthetic-exact.mjs");
  assert.equal(
    extracted.declaration,
    'export async function buildExact() { return "exact declaration"; }',
    "AST export lookup must select only the exact declaration token",
  );
  assert.equal(
    extracted.body,
    '{ return "exact declaration"; }',
    "AST export lookup must extract exactly the selected function body",
  );
  assert.doesNotMatch(
    extracted.declaration,
    /spoof/u,
    "comments, strings, and longer-prefix identifiers must not spoof export lookup",
  );
  assert.throws(
    () => exportedAsyncFunctionSource(`
      export async function duplicate() {}
      export async function duplicate() {}
    `, "duplicate", "synthetic-duplicate.mjs"),
    /exactly one exported function declaration required/u,
    "duplicate exact declarations must not produce an ambiguous source slice",
  );
}

const INTAKE_PRIMITIVE_NAME = "snapshotRegionalR5CompositionInput";
const MODULE_ID_BY_SPECIFIER = Object.freeze({
  "./regional-art-r5-v3-atomic-source.mjs": "atomic",
  "./regional-art-r5-atlas-only-scene.mjs": "atlas",
  "./regional-art-r5-dynamic-presentation.mjs": "dynamic",
  "./regional-art-r5-composition-intake.mjs": "intake",
});

function isFunctionNode(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}

function parseCallGraphModule(moduleId, source) {
  const sourceFile = ts.createSourceFile(
    `${moduleId}.mjs`,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const functions = new Map();
  const aliases = new Map();
  const imports = new Map();
  const namespaces = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const importedModule = MODULE_ID_BY_SPECIFIER[statement.moduleSpecifier.text];
      const bindings = statement.importClause?.namedBindings;
      if (importedModule && bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          imports.set(element.name.text, {
            moduleId: importedModule,
            functionName: element.propertyName?.text ?? element.name.text,
          });
        }
      } else if (importedModule && bindings && ts.isNamespaceImport(bindings)) {
        namespaces.set(bindings.name.text, importedModule);
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
        functions.set(declaration.name.text, declaration.initializer);
      } else if (ts.isIdentifier(declaration.initializer)) {
        aliases.set(declaration.name.text, declaration.initializer.text);
      }
    }
  }
  return { moduleId, sourceFile, functions, aliases, imports, namespaces };
}

function resolveCallTarget(moduleGraph, expression) {
  if (ts.isIdentifier(expression)) {
    let name = expression.text;
    const seen = new Set();
    while (moduleGraph.aliases.has(name) && !seen.has(name)) {
      seen.add(name);
      name = moduleGraph.aliases.get(name);
    }
    if (moduleGraph.functions.has(name)) return `${moduleGraph.moduleId}:${name}`;
    const imported = moduleGraph.imports.get(name);
    return imported ? `${imported.moduleId}:${imported.functionName}` : null;
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    const moduleId = moduleGraph.namespaces.get(expression.expression.text);
    return moduleId ? `${moduleId}:${expression.name.text}` : null;
  }
  return null;
}

const REPEATING_CALLBACK_METHODS = new Set([
  "every", "filter", "find", "findIndex", "flatMap", "forEach", "map", "reduce",
  "reduceRight", "some",
]);

function functionCallEdges(moduleGraph, functionNode, stopAtFirstAwait) {
  const edges = [];
  let suspended = false;
  function visit(node, context = { repeating: false, conditional: false }) {
    if (suspended || (node !== functionNode && isFunctionNode(node))) return;
    if (ts.isAwaitExpression(node)) {
      visit(node.expression, context);
      suspended = stopAtFirstAwait;
      return;
    }
    if (ts.isForStatement(node)) {
      if (node.initializer) visit(node.initializer, context);
      const repeating = { ...context, repeating: true };
      if (node.condition) visit(node.condition, repeating);
      if (node.incrementor) visit(node.incrementor, repeating);
      visit(node.statement, repeating);
      return;
    }
    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      visit(node.expression, context);
      visit(node.statement, { ...context, repeating: true });
      return;
    }
    if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      const repeating = { ...context, repeating: true };
      visit(node.expression, repeating);
      visit(node.statement, repeating);
      return;
    }
    if (ts.isIfStatement(node)) {
      visit(node.expression, context);
      const conditional = { ...context, conditional: true };
      visit(node.thenStatement, conditional);
      if (node.elseStatement) visit(node.elseStatement, conditional);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      visit(node.condition, context);
      const conditional = { ...context, conditional: true };
      visit(node.whenTrue, conditional);
      visit(node.whenFalse, conditional);
      return;
    }
    if (ts.isBinaryExpression(node)
        && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
      visit(node.left, context);
      visit(node.right, { ...context, conditional: true });
      return;
    }
    if (ts.isSwitchStatement(node)) {
      visit(node.expression, context);
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause)) visit(clause.expression, { ...context, conditional: true });
        for (const statement of clause.statements) {
          visit(statement, { ...context, conditional: true });
        }
      }
      return;
    }
    if (ts.isTryStatement(node)) {
      visit(node.tryBlock, context);
      if (node.catchClause) {
        visit(node.catchClause.block, { ...context, conditional: true });
      }
      if (node.finallyBlock) visit(node.finallyBlock, context);
      return;
    }
    if (ts.isCallExpression(node)) {
      const target = resolveCallTarget(moduleGraph, node.expression);
      const callContext = node.questionDotToken
        ? { ...context, conditional: true } : context;
      if (target) edges.push({ target, ...callContext });
      const repeatingCallback = ts.isPropertyAccessExpression(node.expression)
        && REPEATING_CALLBACK_METHODS.has(node.expression.name.text);
      visit(node.expression, context);
      for (const argument of node.arguments) {
        if (repeatingCallback && (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) {
          visit(argument.body, { ...callContext, repeating: true, conditional: true });
          continue;
        }
        if (repeatingCallback && ts.isIdentifier(argument)) {
          const callbackTarget = resolveCallTarget(moduleGraph, argument);
          if (callbackTarget) {
            edges.push({
              target: callbackTarget,
              repeating: true,
              conditional: true,
            });
            continue;
          }
        }
        visit(argument, callContext);
      }
      return;
    }
    ts.forEachChild(node, (child) => visit(child, context));
  }
  visit(functionNode.body);
  return edges;
}

function buildProductionCallGraph() {
  assert.notEqual(
    INTAKE_SOURCE,
    null,
    "missing production regional-art-r5-composition-intake.mjs module",
  );
  const modules = new Map([
    ["packer", parseCallGraphModule("packer", PACKER_SOURCE)],
    ["atomic", parseCallGraphModule("atomic", ATOMIC_SOURCE)],
    ["atlas", parseCallGraphModule("atlas", ATLAS_SOURCE)],
    ["dynamic", parseCallGraphModule("dynamic", DYNAMIC_SOURCE)],
    ["intake", parseCallGraphModule("intake", INTAKE_SOURCE)],
  ]);
  return modules;
}

const INTAKE_BUILDER_ROOTS = Object.freeze([
  "packer:buildRegionalR5V3AtomicSourceMasters",
  "atomic:buildRegionalR5V3AtomicSourceMastersInternal",
  "packer:buildRegionalR5AtlasOnlyScenes",
  "packer:buildRegionalR5DynamicPresentationScenes",
]);

function primitiveExecutions(
  modules,
  functionKey,
  stopAtFirstAwait,
  origin = functionKey,
  stack = [],
) {
  if (stack.includes(functionKey)) return { executions: [], recursive: true };
  const separator = functionKey.indexOf(":");
  const moduleId = functionKey.slice(0, separator);
  const functionName = functionKey.slice(separator + 1);
  const moduleGraph = modules.get(moduleId);
  const functionNode = moduleGraph?.functions.get(functionName);
  assert.ok(functionNode, `${functionKey}: call-graph function missing`);
  const result = { executions: [], recursive: false };
  for (const edge of functionCallEdges(moduleGraph, functionNode, stopAtFirstAwait)) {
    const { target } = edge;
    if (target === `intake:${INTAKE_PRIMITIVE_NAME}`) {
      result.executions.push({ repeating: edge.repeating, conditional: edge.conditional });
      continue;
    }
    const targetSeparator = target.indexOf(":");
    const targetModule = modules.get(target.slice(0, targetSeparator));
    const targetName = target.slice(targetSeparator + 1);
    if (target !== origin && INTAKE_BUILDER_ROOTS.includes(target)) continue;
    if (targetModule?.functions.has(targetName)) {
      const nested = primitiveExecutions(
        modules,
        target,
        stopAtFirstAwait,
        origin,
        [...stack, functionKey],
      );
      result.recursive ||= nested.recursive;
      result.executions.push(...nested.executions.map((execution) => ({
        repeating: edge.repeating || execution.repeating,
        conditional: edge.conditional || execution.conditional,
      })));
    }
  }
  return result;
}

function assertOneUnconditionalPrimitiveExecution(analysis, label) {
  assert.equal(analysis.recursive, false, `${label}: recursive intake reachability is forbidden`);
  assert.equal(analysis.executions.length, 1, `${label}: exactly one intake execution required`);
  assert.equal(
    analysis.executions[0].repeating,
    false,
    `${label}: intake execution under repeating control flow is forbidden`,
  );
  assert.equal(
    analysis.executions[0].conditional,
    false,
    `${label}: intake execution must be unconditional`,
  );
}

function assertNoPrimitiveAliasEscape(modules) {
  for (const moduleGraph of modules.values()) {
    function visit(node) {
      if (ts.isIdentifier(node) && node.text === INTAKE_PRIMITIVE_NAME) {
        const parent = node.parent;
        const directCall = ts.isCallExpression(parent) && parent.expression === node;
        const declaration = ts.isFunctionDeclaration(parent) && parent.name === node;
        const importReference = ts.isImportSpecifier(parent);
        const exportReference = ts.isExportSpecifier(parent);
        const namespaceMember = ts.isPropertyAccessExpression(parent) && parent.name === node;
        assert.equal(
          directCall || declaration || importReference || exportReference || namespaceMember,
          true,
          `${moduleGraph.moduleId}: intake primitive alias or value escape is forbidden`,
        );
      }
      ts.forEachChild(node, visit);
    }
    visit(moduleGraph.sourceFile);
  }
}

function sharedIntakeCallGraphContract() {
  const modules = buildProductionCallGraph();
  assert.ok(
    modules.get("intake").functions.has(INTAKE_PRIMITIVE_NAME),
    "shared intake module must declare the production snapshot primitive",
  );
  assertNoPrimitiveAliasEscape(modules);
  for (const root of INTAKE_BUILDER_ROOTS) {
    assertOneUnconditionalPrimitiveExecution(
      primitiveExecutions(modules, root, false),
      `${root}: full call graph`,
    );
    assertOneUnconditionalPrimitiveExecution(
      primitiveExecutions(modules, root, true),
      `${root}: pre-await call graph`,
    );
  }
}

function callGraphAnalyzerContract() {
  const intake = parseCallGraphModule("intake", `
    export function ${INTAKE_PRIMITIVE_NAME}(value) { return value; }
  `);
  const atomic = parseCallGraphModule("atomic", `
    import { ${INTAKE_PRIMITIVE_NAME} } from "./regional-art-r5-composition-intake.mjs";
    export function helper(value) { return ${INTAKE_PRIMITIVE_NAME}(value); }
  `);
  const before = parseCallGraphModule("packer", `
    import { helper } from "./regional-art-r5-v3-atomic-source.mjs";
    export async function root(value) {
      const snapshot = helper(value);
      await Promise.resolve();
      return snapshot;
    }
  `);
  const after = parseCallGraphModule("packer", `
    import { helper } from "./regional-art-r5-v3-atomic-source.mjs";
    export async function root(value) {
      await Promise.resolve();
      return helper(value);
    }
  `);
  const beforeModules = new Map([
    ["packer", before], ["atomic", atomic], ["intake", intake],
  ]);
  const afterModules = new Map([
    ["packer", after], ["atomic", atomic], ["intake", intake],
  ]);
  assertOneUnconditionalPrimitiveExecution(
    primitiveExecutions(beforeModules, "packer:root", false),
    "analyzer imported-helper full graph",
  );
  assertOneUnconditionalPrimitiveExecution(
    primitiveExecutions(beforeModules, "packer:root", true),
    "analyzer imported-helper pre-await graph",
  );
  assert.equal(
    primitiveExecutions(afterModules, "packer:root", true).executions.length,
    0,
    "call graph must reject a helper moved after the first await",
  );

  const renamedBefore = parseCallGraphModule("packer", `
    import { helper as renamedHelper } from "./regional-art-r5-v3-atomic-source.mjs";
    export async function root(value) {
      const snapshot = renamedHelper(value);
      await Promise.resolve();
      return snapshot;
    }
  `);
  const renamedAfter = parseCallGraphModule("packer", `
    import { helper as renamedHelper } from "./regional-art-r5-v3-atomic-source.mjs";
    export async function root(value) {
      await Promise.resolve();
      return renamedHelper(value);
    }
  `);
  const renamedBeforeModules = new Map([
    ["packer", renamedBefore], ["atomic", atomic], ["intake", intake],
  ]);
  const renamedAfterModules = new Map([
    ["packer", renamedAfter], ["atomic", atomic], ["intake", intake],
  ]);
  assertOneUnconditionalPrimitiveExecution(
    primitiveExecutions(renamedBeforeModules, "packer:root", false),
    "analyzer renamed named-import helper full graph",
  );
  assertOneUnconditionalPrimitiveExecution(
    primitiveExecutions(renamedBeforeModules, "packer:root", true),
    "analyzer renamed named-import helper pre-await graph",
  );
  assert.equal(
    primitiveExecutions(renamedAfterModules, "packer:root", true).executions.length,
    0,
    "renamed named-import helper after first await must not count as pre-await",
  );

  const namespaceBefore = parseCallGraphModule("packer", `
    import * as atomicHelpers from "./regional-art-r5-v3-atomic-source.mjs";
    export async function root(value) {
      const snapshot = atomicHelpers.helper(value);
      await Promise.resolve();
      return snapshot;
    }
  `);
  const namespaceAfter = parseCallGraphModule("packer", `
    import * as atomicHelpers from "./regional-art-r5-v3-atomic-source.mjs";
    export async function root(value) {
      await Promise.resolve();
      return atomicHelpers.helper(value);
    }
  `);
  const namespaceBeforeModules = new Map([
    ["packer", namespaceBefore], ["atomic", atomic], ["intake", intake],
  ]);
  const namespaceAfterModules = new Map([
    ["packer", namespaceAfter], ["atomic", atomic], ["intake", intake],
  ]);
  assertOneUnconditionalPrimitiveExecution(
    primitiveExecutions(namespaceBeforeModules, "packer:root", false),
    "analyzer namespace-import helper full graph",
  );
  assertOneUnconditionalPrimitiveExecution(
    primitiveExecutions(namespaceBeforeModules, "packer:root", true),
    "analyzer namespace-import helper pre-await graph",
  );
  assert.equal(
    primitiveExecutions(namespaceAfterModules, "packer:root", true).executions.length,
    0,
    "namespace-import helper after first await must not count as pre-await",
  );

  const recursiveAtomic = parseCallGraphModule("atomic", `
    import { ${INTAKE_PRIMITIVE_NAME} } from "./regional-art-r5-composition-intake.mjs";
    export function recursiveHelper(value) {
      const snapshot = ${INTAKE_PRIMITIVE_NAME}(value);
      if (value) recursiveHelper(null);
      return snapshot;
    }
  `);
  const recursivePacker = parseCallGraphModule("packer", `
    import { recursiveHelper } from "./regional-art-r5-v3-atomic-source.mjs";
    export function root(value) { return recursiveHelper(value); }
  `);
  const recursive = primitiveExecutions(new Map([
    ["packer", recursivePacker], ["atomic", recursiveAtomic], ["intake", intake],
  ]), "packer:root", false);
  assert.equal(recursive.recursive, true, "recursive helper reachability must be detected");
  assert.throws(
    () => assertOneUnconditionalPrimitiveExecution(recursive, "recursive analyzer fixture"),
    /recursive intake reachability is forbidden/u,
    "recursive helper reachability must be rejected by the exactly-once assertion",
  );

  const twoPrimitiveSites = parseCallGraphModule("packer", `
    import { ${INTAKE_PRIMITIVE_NAME} } from "./regional-art-r5-composition-intake.mjs";
    export function root(value) {
      const first = ${INTAKE_PRIMITIVE_NAME}(value);
      const second = ${INTAKE_PRIMITIVE_NAME}(value);
      return [first, second];
    }
  `);
  const distinctPrimitiveExecutions = primitiveExecutions(new Map([
    ["packer", twoPrimitiveSites], ["intake", intake],
  ]), "packer:root", false);
  assert.equal(
    distinctPrimitiveExecutions.executions.length,
    2,
    "two distinct primitive executions must both be counted",
  );
  assert.throws(
    () => assertOneUnconditionalPrimitiveExecution(
      distinctPrimitiveExecutions,
      "two-site analyzer fixture",
    ),
    /exactly one intake execution required/u,
    "two distinct primitive executions must be rejected",
  );

  const repeatedHelper = parseCallGraphModule("packer", `
    import { helper } from "./regional-art-r5-v3-atomic-source.mjs";
    export function root(value) {
      const first = helper(value);
      const second = helper(value);
      return [first, second];
    }
  `);
  const repeatedHelperExecutions = primitiveExecutions(new Map([
    ["packer", repeatedHelper], ["atomic", atomic], ["intake", intake],
  ]), "packer:root", false);
  assert.equal(
    repeatedHelperExecutions.executions.length,
    2,
    "one primitive reached twice through the helper graph must be counted twice",
  );
  assert.throws(
    () => assertOneUnconditionalPrimitiveExecution(
      repeatedHelperExecutions,
      "repeated-helper analyzer fixture",
    ),
    /exactly one intake execution required/u,
    "one primitive reached twice through the helper graph must be rejected",
  );

  const repeatingBodies = [
    "for (let index = 0; index < values.length; index += 1) { helper(values[index]); }",
    "for (const key in values) { helper(values[key]); }",
    "for (const value of values) { helper(value); }",
    "while (values.length > 0) { helper(values[0]); break; }",
    "do { helper(values[0]); } while (false);",
    "values.forEach(helper);",
  ];
  for (const [index, body] of repeatingBodies.entries()) {
    const loopModule = parseCallGraphModule("packer", `
      import { helper } from "./regional-art-r5-v3-atomic-source.mjs";
      export function root(values) { ${body} }
    `);
    const analysis = primitiveExecutions(new Map([
      ["packer", loopModule], ["atomic", atomic], ["intake", intake],
    ]), "packer:root", false);
    assert.equal(analysis.executions.length, 1, `loop analyzer case ${index}: site missing`);
    assert.equal(
      analysis.executions[0].repeating,
      true,
      `loop analyzer case ${index}: repeating reachability must be detected`,
    );
  }

  const inlineCallbackModule = parseCallGraphModule("packer", `
    import { ${INTAKE_PRIMITIVE_NAME} } from "./regional-art-r5-composition-intake.mjs";
    export function root(values) {
      return values.map((value) => ${INTAKE_PRIMITIVE_NAME}(value));
    }
  `);
  const inlineCallback = primitiveExecutions(new Map([
    ["packer", inlineCallbackModule], ["intake", intake],
  ]), "packer:root", false);
  assert.equal(inlineCallback.executions.length, 1, "inline callback analyzer site missing");
  assert.equal(
    inlineCallback.executions[0].repeating,
    true,
    "inline array callback primitive reachability must be repeating",
  );

  const conditionalModule = parseCallGraphModule("packer", `
    import { helper } from "./regional-art-r5-v3-atomic-source.mjs";
    export function root(value) { if (value) helper(value); }
  `);
  const conditional = primitiveExecutions(new Map([
    ["packer", conditionalModule], ["atomic", atomic], ["intake", intake],
  ]), "packer:root", false);
  assert.equal(conditional.executions.length, 1, "conditional analyzer site missing");
  assert.equal(
    conditional.executions[0].conditional,
    true,
    "conditional primitive reachability must not count as unconditional execution",
  );
}

let cleanBuildPromise;
function cleanBuild() {
  cleanBuildPromise ??= productionPacker.buildRegionalR5V3AtomicSourceMasters({ authority: AUTHORITY });
  return cleanBuildPromise;
}

let cleanStaticPromise;
async function cleanStatic() {
  if (!cleanStaticPromise) {
    cleanStaticPromise = (async () => {
      const built = await cleanBuild();
      return productionPacker.buildRegionalR5AtlasOnlyScenes({
        masterBuffers: built.masterBuffers,
        placements: built.placements,
        authoringIdentity: built.authoringIdentity,
      });
    })();
  }
  return cleanStaticPromise;
}

let cleanDynamicSourcesPromise;
async function cleanDynamicSources() {
  if (!cleanDynamicSourcesPromise) {
    cleanDynamicSourcesPromise = (async () => {
      const built = await cleanBuild();
      const buffers = {};
      for (const kit of KITS) {
        buffers[`${kit}-home-yards`] = Buffer.from(built.masterBuffers[`${kit}-home-yards`]);
        buffers[`${kit}-home-components`] = await readFile(
          new URL(`homes/${kit}/components.png`, NATIVE_SOURCE_ROOT),
        );
      }
      for (const name of [
        "human-body-rigs",
        "human-face-planes",
        "human-hair",
        "human-clothing-00",
      ]) {
        buffers[`core-${name}`] = await readFile(new URL(`core/${name}.png`, NATIVE_SOURCE_ROOT));
      }
      return buffers;
    })();
  }
  return cleanDynamicSourcesPromise;
}

let cleanDynamicPromise;
async function cleanDynamic() {
  if (!cleanDynamicPromise) {
    cleanDynamicPromise = (async () => productionPacker.buildRegionalR5DynamicPresentationScenes({
      staticScenes: await cleanStatic(),
      dynamicSourceBuffers: await cleanDynamicSources(),
      placements: productionPacker.regionalR5DynamicPresentationPlacements(),
    }))();
  }
  return cleanDynamicPromise;
}

function staticInput(built) {
  return {
    masterBuffers: cloneValue(built.masterBuffers),
    placements: cloneValue(built.placements),
    authoringIdentity: cloneValue(built.authoringIdentity),
  };
}

async function dynamicInput() {
  return {
    staticScenes: cloneValue(await cleanStatic()),
    dynamicSourceBuffers: cloneValue(await cleanDynamicSources()),
    placements: cloneValue(productionPacker.regionalR5DynamicPresentationPlacements()),
  };
}

function syntheticAtomicInput(encodeRaw) {
  const rawMasters = {};
  for (const [atlasId, [width, height]] of Object.entries(AUTHORITY.masterBoundary.pngExpectations)) {
    rawMasters[atlasId] = {
      data: Buffer.alloc(width * height * 4),
      width,
      height,
      channels: 4,
    };
  }
  const sourceIds = new Set([
    ...Object.values(AUTHORITY.landmarks).flatMap((entries) => entries.map(([, sourceId]) => sourceId)),
    ...Object.values(AUTHORITY.supportPlacements)
      .flatMap((entries) => entries.flatMap(([, , , , ids]) => ids)),
  ]);
  const fragments = new Map();
  const patches = new Map();
  const explicitSources = new Map();
  const sourceMaps = [fragments, patches, explicitSources];
  let color = 1;
  let sourceIndex = 0;
  for (const sourceId of sourceIds) {
    const data = Buffer.alloc(128 * 128 * 4);
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = color;
      data[offset + 1] = 255 - color;
      data[offset + 2] = color * 7 % 255;
      data[offset + 3] = 255;
    }
    sourceMaps[sourceIndex % sourceMaps.length]
      .set(sourceId, { data, width: 128, height: 128, channels: 4 });
    color = color % 250 + 1;
    sourceIndex += 1;
  }
  const basePlacements = { scenes: {} };
  for (const kit of KITS) {
    basePlacements.scenes[kit] = {
      kit,
      identities: {},
      visibleStaticLayers: AUTHORITY.supportPlacements[kit]
        .map(([_cell, x, y, role], index) => ({
          id: `synthetic/${kit}/support/${index}`,
          role,
          atlasId: `${kit}-scenery`,
          cell: index,
          destination: { x, y },
        })),
    };
  }
  const historyRaw = {
    data: Buffer.alloc(128 * 128 * 4, 17),
    width: 128,
    height: 128,
    channels: 4,
  };
  const untouchedRaw = {
    data: Buffer.alloc(32 * 32 * 4, 23),
    width: 32,
    height: 32,
    channels: 4,
  };
  const cellLayersByAtlas = new Map([
    [
      "worn-heartland-landmarks:0",
      [{
        id: "synthetic/prior-layer",
        z: 0,
        kind: "synthetic-history",
        sourceId: "synthetic-history-source",
        role: "landmark-anatomy",
        raw: historyRaw,
      }],
    ],
    [
      UNTOUCHED_CELL_LAYER_KEY,
      [{
        id: "synthetic/untouched-layer",
        z: 0,
        kind: "synthetic-untouched",
        sourceId: "synthetic-untouched-source",
        role: "terrain-history",
        raw: untouchedRaw,
      }],
    ],
  ]);
  const reauthorReceipt = {
    schema: "synthetic-reauthor-receipt/v1",
    cells: [{
      atlasId: "worn-heartland-landmarks",
      cell: 0,
      beforeRgbaSha256: "1".repeat(64),
      afterRgbaSha256: "2".repeat(64),
      supersededBlindRepairId: "synthetic-prior-repair",
    }],
  };
  return {
    rawMasters,
    fragments,
    patches,
    explicitSources,
    basePlacements,
    cellLayersByAtlas,
    reauthorReceipt,
    encodeRaw,
  };
}

async function publicAtomicSnapshotContract() {
  const expected = await cleanBuild();
  const authority = cloneValue(AUTHORITY);
  const initialAuthority = cloneValue(authority);
  // The first public await is a pair of file reads. Mutate in the same turn so
  // the caller change races those pending reads rather than a later internal seam.
  const operation = productionPacker.buildRegionalR5V3AtomicSourceMasters({ authority });
  authority.schema = "changed-after-public-call";
  authority.masterBoundary.pngExpectations["ash-waste-terrain"][0] += 1;
  const actual = await operation;
  assert.deepEqual(actual.authority, initialAuthority, "public result must retain the initial authority");
  assert.equal(isDeepStrictEqual(actual, expected), true, "public build must resolve the exact clean result");
}

async function internalAtomicSnapshotContract() {
  const cleanArgs = {
    input: { authority: cloneValue(AUTHORITY) },
    ...syntheticAtomicInput(async (raw) => Buffer.from(raw.data)),
  };
  const baseline = await buildRegionalR5V3AtomicSourceMastersInternal(cleanArgs);
  const failures = [];

  const rawAtlasId = "worn-heartland-terrain";
  const sourceMapCases = ["fragments", "patches", "explicitSources"];
  const cases = [
    {
      label: "input wrapper replacement",
      mutate(args) { args.input = { authority: { schema: "replacement" } }; },
    },
    {
      label: "input authority replacement",
      mutate(args) { args.input.authority = { schema: "replacement" }; },
    },
    {
      label: "input authority in-place mutation",
      mutate(args) { args.input.authority.schema = "changed-after-internal-call"; },
    },
    {
      label: "rawMasters record replacement",
      mutate(args) { args.rawMasters = {}; },
    },
    {
      label: "rawMasters entry replacement",
      mutate(args) { args.rawMasters[rawAtlasId] = { data: Buffer.alloc(0) }; },
    },
    {
      label: "rawMasters in-place byte mutation",
      mutate(args) { args.rawMasters[rawAtlasId].data[0] ^= 1; },
    },
    {
      label: "rawMasters backing-store transfer",
      prepare(args) {
        const transferred = transferableBuffer(args.rawMasters[rawAtlasId].data);
        args.rawMasters[rawAtlasId].data = transferred.buffer;
        return transferred;
      },
      mutate(_args, transferred) {
        structuredClone(transferred.backing, { transfer: [transferred.backing] });
      },
    },
    {
      label: "basePlacements record replacement",
      mutate(args) { args.basePlacements = { scenes: {} }; },
    },
    {
      label: "basePlacements scene replacement",
      mutate(args) { args.basePlacements.scenes["worn-heartland"] = { kit: "replacement" }; },
    },
    {
      label: "basePlacements in-place destination mutation",
      mutate(args) {
        args.basePlacements.scenes["worn-heartland"].visibleStaticLayers[0].destination.x += 19;
      },
    },
    {
      label: "cellLayersByAtlas Map replacement",
      mutate(args) { args.cellLayersByAtlas = new Map(); },
    },
    {
      label: "cellLayersByAtlas untouched entry replacement",
      mutate(args) { args.cellLayersByAtlas.set(UNTOUCHED_CELL_LAYER_KEY, []); },
    },
    {
      label: "cellLayersByAtlas untouched layer in-place metadata mutation",
      mutate(args) {
        args.cellLayersByAtlas.get(UNTOUCHED_CELL_LAYER_KEY)[0].role = "changed";
      },
    },
    {
      label: "cellLayersByAtlas untouched raw in-place Buffer mutation",
      mutate(args) {
        args.cellLayersByAtlas.get(UNTOUCHED_CELL_LAYER_KEY)[0].raw.data[0] ^= 1;
      },
    },
    {
      label: "cellLayersByAtlas untouched raw Buffer backing-store transfer",
      prepare(args) {
        const raw = args.cellLayersByAtlas.get(UNTOUCHED_CELL_LAYER_KEY)[0].raw;
        const transferred = transferableBuffer(raw.data);
        raw.data = transferred.buffer;
        return transferred;
      },
      mutate(_args, transferred) {
        structuredClone(transferred.backing, { transfer: [transferred.backing] });
      },
    },
    {
      label: "reauthorReceipt object replacement",
      mutate(args) { args.reauthorReceipt = { schema: "replacement", cells: [] }; },
    },
    {
      label: "reauthorReceipt cells replacement",
      mutate(args) { args.reauthorReceipt.cells = []; },
    },
    {
      label: "reauthorReceipt in-place entry mutation",
      mutate(args) { args.reauthorReceipt.cells[0].afterRgbaSha256 = "f".repeat(64); },
    },
  ];
  for (const mapName of sourceMapCases) {
    cases.push(
      {
        label: `${mapName} Map replacement`,
        mutate(args) { args[mapName] = new Map(); },
      },
      {
        label: `${mapName} entry replacement`,
        mutate(args) {
          const [sourceId] = args[mapName].keys();
          args[mapName].set(sourceId, {
            data: Buffer.alloc(128 * 128 * 4), width: 128, height: 128, channels: 4,
          });
        },
      },
      {
        label: `${mapName} in-place raw metadata mutation`,
        mutate(args) {
          const [, raw] = args[mapName].entries().next().value;
          raw.width = 127;
        },
      },
      {
        label: `${mapName} in-place Buffer mutation`,
        mutate(args) {
          const [, raw] = args[mapName].entries().next().value;
          raw.data[0] ^= 1;
        },
      },
      {
        label: `${mapName} Buffer backing-store transfer`,
        prepare(args) {
          const [, raw] = args[mapName].entries().next().value;
          const transferred = transferableBuffer(raw.data);
          raw.data = transferred.buffer;
          return transferred;
        },
        mutate(_args, transferred) {
          structuredClone(transferred.backing, { transfer: [transferred.backing] });
        },
      },
    );
  }

  for (const contractCase of cases) {
    await recordContractCase(failures, contractCase.label, async () => {
      let signalEntered;
      let releaseEncoding;
      const entered = new Promise((resolve) => { signalEntered = resolve; });
      const released = new Promise((resolve) => { releaseEncoding = resolve; });
      let first = true;
      const args = {
        input: { authority: cloneValue(AUTHORITY) },
        ...syntheticAtomicInput(async (raw) => {
          if (first) {
            first = false;
            signalEntered();
            await released;
          }
          return Buffer.from(raw.data);
        }),
      };
      const prepared = contractCase.prepare?.(args);
      const acceptedProvenance = {
        cellLayersByAtlas: args.cellLayersByAtlas,
        reauthorReceipt: args.reauthorReceipt,
      };
      const operation = buildRegionalR5V3AtomicSourceMastersInternal(args);
      await entered;
      contractCase.mutate(args, prepared);
      releaseEncoding();
      const actual = await operation;
      const verificationFailures = [];
      for (const verification of [
        {
          label: "exact full result",
          run() {
            assert.equal(
              isDeepStrictEqual(actual, baseline),
              true,
              `${contractCase.label}: must resolve from the initial detached snapshot`,
            );
          },
        },
        {
          label: "cellLayersByAtlas alias closure",
          run() {
            assertNoSharedObjectReferences(
              actual.cellLayersByAtlas,
              acceptedProvenance,
              `internal promise-barrier ${contractCase.label} / cellLayersByAtlas`,
            );
          },
        },
        {
          label: "receipt alias closure",
          run() {
            assertNoSharedObjectReferences(
              actual.result.receipt,
              acceptedProvenance,
              `internal promise-barrier ${contractCase.label} / receipt`,
            );
          },
        },
        {
          label: "untouched cell-layer value",
          run() {
            assert.equal(
              isDeepStrictEqual(actual.cellLayersByAtlas, baseline.cellLayersByAtlas),
              true,
              `${contractCase.label}: untouched cell-layer output must retain clean snapshot bytes`,
            );
          },
        },
        {
          label: "receipt value",
          run() {
            assert.equal(
              isDeepStrictEqual(actual.result.receipt, baseline.result.receipt),
              true,
              `${contractCase.label}: atomic receipt must retain clean snapshot history`,
            );
          },
        },
      ]) {
        try {
          verification.run();
        } catch (error) {
          verificationFailures.push(`${verification.label}: ${error?.message ?? String(error)}`);
        }
      }
      assertNoContractFailures(
        verificationFailures,
        `internal resolved snapshot ${contractCase.label}`,
      );
    });
  }
  assertNoContractFailures(failures, "internal promise-barrier caller-owned input matrix");
}

async function atlasSnapshotContract() {
  const built = await cleanBuild();
  const expected = await cleanStatic();
  const failures = [];

  await recordContractCase(failures, "post-call atlas master replacement", async () => {
    const input = staticInput(built);
    const operation = productionPacker.buildRegionalR5AtlasOnlyScenes(input);
    input.masterBuffers["worn-heartland-terrain"] = Buffer.from(
      input.masterBuffers["dry-scrub-terrain"],
    );
    await assertExactResolution(operation, expected, "post-call atlas master replacement");
  });
  await recordContractCase(failures, "post-call atlas master in-place byte change", async () => {
    const input = staticInput(built);
    const acceptedBytes = input.masterBuffers["worn-heartland-terrain"];
    const operation = productionPacker.buildRegionalR5AtlasOnlyScenes(input);
    acceptedBytes[0] ^= 1;
    await assertExactResolution(operation, expected, "post-call atlas master in-place byte change");
  });
  await recordContractCase(failures, "post-call atlas master backing-store transfer", async () => {
    const input = staticInput(built);
    const atlasId = "worn-heartland-terrain";
    const transferred = transferableBuffer(input.masterBuffers[atlasId]);
    input.masterBuffers[atlasId] = transferred.buffer;
    const operation = productionPacker.buildRegionalR5AtlasOnlyScenes(input);
    structuredClone(transferred.backing, { transfer: [transferred.backing] });
    await assertExactResolution(operation, expected, "post-call atlas master backing-store transfer");
  });
  await recordContractCase(failures, "post-call atlas placement change", async () => {
    const input = staticInput(built);
    const operation = productionPacker.buildRegionalR5AtlasOnlyScenes(input);
    input.placements.scenes["worn-heartland"].visibleStaticLayers[0].destination.x += 32;
    await assertExactResolution(operation, expected, "post-call atlas placement change");
  });
  await recordContractCase(failures, "post-call atlas authoring identity change", async () => {
    const input = staticInput(built);
    const operation = productionPacker.buildRegionalR5AtlasOnlyScenes(input);
    input.authoringIdentity.receiptSha256 = "0".repeat(64);
    await assertExactResolution(operation, expected, "post-call atlas authoring identity change");
  });
  assertNoContractFailures(failures, "atlas snapshot contract");
}

async function dynamicSnapshotContract() {
  const expected = await cleanDynamic();
  const sourceId = "worn-heartland-home-yards";
  const failures = [];
  await recordContractCase(failures, "post-call dynamic static-scene Buffer replacement", async () => {
    const input = await dynamicInput();
    const operation = productionPacker.buildRegionalR5DynamicPresentationScenes(input);
    input.staticScenes.scenes["worn-heartland"].raw.data = Buffer.alloc(
      input.staticScenes.scenes["worn-heartland"].raw.data.length,
    );
    await assertExactResolution(operation, expected, "post-call dynamic static-scene Buffer replacement");
  });
  await recordContractCase(failures, "post-call dynamic static-pixel change", async () => {
    const input = await dynamicInput();
    const operation = productionPacker.buildRegionalR5DynamicPresentationScenes(input);
    input.staticScenes.scenes["worn-heartland"].raw.data[0] ^= 1;
    await assertExactResolution(operation, expected, "post-call dynamic static-pixel change");
  });
  await recordContractCase(failures, "post-call dynamic static-scene backing-store transfer", async () => {
    const input = await dynamicInput();
    const raw = input.staticScenes.scenes["worn-heartland"].raw;
    const transferred = transferableBuffer(raw.data);
    raw.data = transferred.buffer;
    const operation = productionPacker.buildRegionalR5DynamicPresentationScenes(input);
    structuredClone(transferred.backing, { transfer: [transferred.backing] });
    await assertExactResolution(
      operation,
      expected,
      "post-call dynamic static-scene backing-store transfer",
    );
  });
  await recordContractCase(failures, "post-call dynamic source in-place byte change", async () => {
    const input = await dynamicInput();
    const acceptedBytes = input.dynamicSourceBuffers[sourceId];
    const operation = productionPacker.buildRegionalR5DynamicPresentationScenes(input);
    acceptedBytes[0] ^= 1;
    await assertExactResolution(operation, expected, "post-call dynamic source in-place byte change");
  });
  await recordContractCase(failures, "post-call dynamic source backing-store transfer", async () => {
    const input = await dynamicInput();
    const transferred = transferableBuffer(input.dynamicSourceBuffers[sourceId]);
    input.dynamicSourceBuffers[sourceId] = transferred.buffer;
    const operation = productionPacker.buildRegionalR5DynamicPresentationScenes(input);
    structuredClone(transferred.backing, { transfer: [transferred.backing] });
    await assertExactResolution(operation, expected, "post-call dynamic source backing-store transfer");
  });
  await recordContractCase(failures, "post-call dynamic placement change", async () => {
    const input = await dynamicInput();
    const operation = productionPacker.buildRegionalR5DynamicPresentationScenes(input);
    input.placements.scenes["worn-heartland"].humans[0].destination.x -= 1;
    await assertExactResolution(operation, expected, "post-call dynamic placement change");
  });
  assertNoContractFailures(failures, "dynamic snapshot contract");
}

async function portDigestContract() {
  const [built, staticScenes] = await Promise.all([cleanBuild(), cleanStatic()]);
  const portReceipt = productionPacker.regionalR5V3LandmarkPortReceipt();
  const portSha256 = canonicalDigest(withoutCanonicalSha256(portReceipt));
  assert.equal(portReceipt.canonicalSha256, portSha256, "port receipt canonical digest");

  assert.equal(built.receipt.landmarkPortReceiptSha256, portSha256,
    "atomic receipt must name the independently recomputed port digest");
  assert.equal(
    built.receipt.canonicalSha256,
    canonicalDigest(withoutCanonicalSha256(built.receipt)),
    "atomic receipt canonical digest must include the port field",
  );
  assert.equal(built.authoringIdentity.receiptSha256, built.receipt.canonicalSha256,
    "authoring receipt pointer must name the complete atomic receipt");
  assert.equal(built.authoringIdentity.landmarkPortReceiptSha256, portSha256,
    "authoring identity must name the independently recomputed port digest");

  const authoringIdentitySha256 = canonicalDigest(built.authoringIdentity);
  assert.equal(staticScenes.authoringIdentitySha256, authoringIdentitySha256,
    "static authoring identity digest must cover the complete authoring identity");
  assert.equal(staticScenes.trustedV3.authoringIdentitySha256, authoringIdentitySha256,
    "trusted V3 must carry the independently recomputed authoring identity digest");
  assert.equal(staticScenes.trustedV3.landmarkPortReceiptSha256, portSha256,
    "trusted V3 must name the independently recomputed port digest");
  assert.equal(
    staticScenes.trustedV3.canonicalSha256,
    canonicalDigest(withoutCanonicalSha256(staticScenes.trustedV3)),
    "trusted V3 canonical digest must include the port field",
  );
}

const CLOSURE_REPRESENTATIONS = Object.freeze([
  "non-enumerable",
  "symbol",
  "accessor",
  "non-plain-prototype",
]);

const ATLAS_ERROR_NAME = "RegionalR5AtlasOnlySceneError";
const DYNAMIC_ERROR_NAME = "RegionalR5DynamicPresentationError";

function assertTraversalKinds(label, sites, expectedKinds) {
  const kinds = new Set(sites.map(({ kind }) => kind));
  for (const kind of expectedKinds) {
    assert.equal(kinds.has(kind), true, `${label}: traversal must explicitly cover ${kind}`);
  }
}

function traversalInventory(sites) {
  const entries = sites.map(({ path, kind }) => `${pathLabel(path)}::${kind}`);
  const kindCounts = Object.fromEntries(
    ["Object", "Array", "Map", "Buffer"].map((kind) => [
      kind,
      sites.filter((site) => site.kind === kind).length,
    ]),
  );
  return Object.freeze({
    count: entries.length,
    kindCounts: Object.freeze(kindCounts),
    canonicalSha256: canonicalDigest(entries),
  });
}

const EXPECTED_TRAVERSAL_INVENTORIES = Object.freeze({
  "public-atomic": Object.freeze({
    count: 280,
    kindCounts: Object.freeze({ Object: 17, Array: 263, Map: 0, Buffer: 0 }),
    canonicalSha256: "f7ec2dbb6e8620e6286e179784c7521c6f0b183c690c383998406d118d8d9766",
  }),
  "internal-atomic": Object.freeze({
    count: 726,
    kindCounts: Object.freeze({ Object: 323, Array: 271, Map: 4, Buffer: 128 }),
    canonicalSha256: "79cc85a34fe9dcf6fbe92d218e38803412f17098357e4552aa314b2b4b3327de",
  }),
  atlas: Object.freeze({
    count: 4120,
    kindCounts: Object.freeze({ Object: 4095, Array: 5, Map: 0, Buffer: 20 }),
    canonicalSha256: "01e02f07547d28fe04edd75a57ea134df6558b1bbe8499084a1950782bba881c",
  }),
  dynamic: Object.freeze({
    count: 10308,
    kindCounts: Object.freeze({ Object: 10278, Array: 11, Map: 0, Buffer: 19 }),
    canonicalSha256: "8659036e7a481c510998239658937f343cafa09064dd8b6c0245cc0d6341af64",
  }),
});

function installPathValue(root, path, replacement) {
  if (path.length === 0) return { root: replacement, restore() {} };
  const parent = valueAtPath(root, path.slice(0, -1));
  const step = path.at(-1);
  if (step.kind === "map-value") {
    const original = parent.get(step.key);
    parent.set(step.key, replacement);
    return { root, restore() { parent.set(step.key, original); } };
  }
  if (step.kind === "map-key") {
    throw new TypeError("object-valued Map keys are not legal in the accepted V3 inputs");
  }
  const descriptor = Object.getOwnPropertyDescriptor(parent, step.key);
  assert.ok(descriptor && "value" in descriptor, `${pathLabel(path)}: data property required`);
  Object.defineProperty(parent, step.key, { ...descriptor, value: replacement });
  return { root, restore() { Object.defineProperty(parent, step.key, descriptor); } };
}

function statefulContainerProxy(target) {
  let trapExecutions = 0;
  const valueReads = new Map();
  const proxy = new Proxy(target, {
    ownKeys(value) {
      trapExecutions += 1;
      const keys = Reflect.ownKeys(value);
      return trapExecutions === 1 ? keys : [...keys, "__late_proxy_key"];
    },
    getOwnPropertyDescriptor(value, key) {
      trapExecutions += 1;
      if (key === "__late_proxy_key") {
        return { configurable: true, enumerable: true, value: "changed", writable: false };
      }
      return Reflect.getOwnPropertyDescriptor(value, key);
    },
    get(value, key) {
      trapExecutions += 1;
      const reads = (valueReads.get(key) ?? 0) + 1;
      valueReads.set(key, reads);
      if (value instanceof Map && key === "get") {
        return (mapKey) => {
          trapExecutions += 1;
          const original = value.get(mapKey);
          return trapExecutions % 2 === 0 ? original : { __late_proxy_value: true };
        };
      }
      const original = Reflect.get(value, key, value);
      if (reads === 1) return original;
      if (typeof original === "number") return original + 1;
      if (typeof original === "string") return `${original}__late_proxy_value`;
      if (original !== null && typeof original === "object") return { __late_proxy_value: true };
      return original;
    },
    getPrototypeOf(value) {
      trapExecutions += 1;
      return Reflect.getPrototypeOf(value);
    },
    has(value, key) {
      trapExecutions += 1;
      return Reflect.has(value, key);
    },
    isExtensible(value) {
      trapExecutions += 1;
      return Reflect.isExtensible(value);
    },
  });
  return { proxy, trapExecutions: () => trapExecutions };
}

function schemaBoundaryFactories(built) {
  return [
    {
      label: "public-atomic",
      expectedKinds: ["Object", "Array"],
      async create() { return { authority: cloneValue(AUTHORITY) }; },
    },
    {
      label: "internal-atomic",
      expectedKinds: ["Object", "Array", "Map", "Buffer"],
      async create() {
        return {
          input: { authority: cloneValue(AUTHORITY) },
          ...syntheticAtomicInput(async (raw) => Buffer.from(raw.data)),
        };
      },
    },
    {
      label: "atlas",
      expectedKinds: ["Object", "Array", "Buffer"],
      async create() { return staticInput(built); },
    },
    {
      label: "dynamic",
      expectedKinds: ["Object", "Array", "Buffer"],
      async create() { return dynamicInput(); },
    },
  ];
}

function requireSharedIntakePrimitive() {
  const primitive = productionPacker.snapshotRegionalR5CompositionInput;
  assert.equal(
    typeof primitive,
    "function",
    "missing production snapshotRegionalR5CompositionInput export",
  );
  return primitive;
}

function snapshotSynchronously(primitive, input, label) {
  const snapshot = primitive(input);
  assert.equal(
    snapshot instanceof Promise,
    false,
    `${label}: shared intake primitive must be synchronous`,
  );
  return snapshot;
}

function representativeClosureInput() {
  return {
    object: { value: 1 },
    array: [{ value: 2 }],
    map: new Map([["entry", { value: 3 }]]),
    buffer: Buffer.from([4, 5, 6, 7]),
  };
}

const REPRESENTATIVE_CLOSURE_PATHS = Object.freeze([
  Object.freeze({ kind: "Object", path: Object.freeze([
    Object.freeze({ kind: "property", key: "object", arrayIndex: false }),
  ]) }),
  Object.freeze({ kind: "Array", path: Object.freeze([
    Object.freeze({ kind: "property", key: "array", arrayIndex: false }),
  ]) }),
  Object.freeze({ kind: "Map", path: Object.freeze([
    Object.freeze({ kind: "property", key: "map", arrayIndex: false }),
  ]) }),
  Object.freeze({ kind: "Buffer", path: Object.freeze([
    Object.freeze({ kind: "property", key: "buffer", arrayIndex: false }),
  ]) }),
]);

function sharedIntakeClosureContract() {
  const primitive = requireSharedIntakePrimitive();
  const clean = representativeClosureInput();
  const cleanSnapshot = snapshotSynchronously(primitive, clean, "clean representative closure");
  assert.equal(isDeepStrictEqual(cleanSnapshot, clean), true, "clean closure snapshot value drifted");
  assertNoSharedObjectReferences(cleanSnapshot, clean, "clean representative closure");

  for (const acceptedAccessorCase of [
    {
      label: "accepted object property accessor",
      prepare(input) {
        const accepted = input.object;
        let reads = 0;
        Object.defineProperty(input, "object", {
          configurable: true,
          enumerable: true,
          get() {
            reads += 1;
            return reads === 1 ? accepted : { value: "changed" };
          },
        });
        return () => reads;
      },
    },
    {
      label: "accepted Array index accessor",
      prepare(input) {
        const accepted = input.array[0];
        let reads = 0;
        Object.defineProperty(input.array, "0", {
          configurable: true,
          enumerable: true,
          get() {
            reads += 1;
            return reads === 1 ? accepted : { value: "changed" };
          },
        });
        return () => reads;
      },
    },
  ]) {
    const input = representativeClosureInput();
    const reads = acceptedAccessorCase.prepare(input);
    assert.throws(
      () => snapshotSynchronously(primitive, input, acceptedAccessorCase.label),
      (error) => error instanceof Error
        && error.constructor === TypeError && error.name === "TypeError",
      `${acceptedAccessorCase.label}: descriptor-first TypeError required`,
    );
    assert.equal(
      reads(),
      0,
      `${acceptedAccessorCase.label}: accepted value must not be read before rejection`,
    );
  }

  {
    const input = representativeClosureInput();
    const stateful = statefulContainerProxy(input);
    assert.throws(
      () => snapshotSynchronously(primitive, stateful.proxy, "root / stateful Proxy"),
      (error) => error instanceof Error
        && error.constructor === TypeError && error.name === "TypeError",
      "root stateful Proxy: exact synchronous TypeError required",
    );
    assert.equal(
      stateful.trapExecutions(),
      0,
      "root stateful Proxy: reflective traps must not execute during rejection",
    );
  }

  for (const { kind, path } of REPRESENTATIVE_CLOSURE_PATHS) {
    for (const representation of CLOSURE_REPRESENTATIONS) {
      const input = representativeClosureInput();
      const label = `${kind} / ${representation}`;
      const decoration = decorateContainer(input, path, representation, label);
      try {
        assert.throws(
          () => snapshotSynchronously(primitive, input, label),
          (error) => error instanceof Error
            && error.constructor === TypeError && error.name === "TypeError",
          `${label}: exact synchronous TypeError required`,
        );
        if (representation === "accessor") {
          assert.equal(
            decoration.accessorReads(),
            0,
            `${label}: rejected accessor must not execute`,
          );
        }
      } finally {
        decoration.restore();
      }
    }

    const input = representativeClosureInput();
    const target = valueAtPath(input, path);
    const stateful = statefulContainerProxy(target);
    const installed = installPathValue(input, path, stateful.proxy);
    const label = `${kind} / stateful Proxy`;
    try {
      assert.throws(
        () => snapshotSynchronously(primitive, installed.root, label),
        (error) => error instanceof Error
          && error.constructor === TypeError && error.name === "TypeError",
        `${label}: exact synchronous TypeError required`,
      );
      assert.equal(
        stateful.trapExecutions(),
        0,
        `${label}: Proxy traps must not execute during rejection`,
      );
    } finally {
      installed.restore();
    }
  }
}

async function sharedIntakeSchemaSnapshotContract() {
  const primitive = requireSharedIntakePrimitive();
  const built = await cleanBuild();
  let acceptedContainerCount = 0;
  for (const boundary of schemaBoundaryFactories(built)) {
    const input = await boundary.create();
    const sites = traversalDerivedContainerSites(input);
    const expectedInventory = EXPECTED_TRAVERSAL_INVENTORIES[boundary.label];
    assert.deepEqual(
      traversalInventory(sites),
      expectedInventory,
      `${boundary.label}: concrete accepted-container path inventory drifted`,
    );
    const concretePaths = sites.map(({ path, kind }) => `${pathLabel(path)}::${kind}`);
    assert.equal(
      new Set(concretePaths).size,
      concretePaths.length,
      `${boundary.label}: every concrete accepted-container path must be unique`,
    );
    assertTraversalKinds(boundary.label, sites, boundary.expectedKinds);
    const snapshot = snapshotSynchronously(primitive, input, `${boundary.label} full schema`);
    assert.equal(
      isDeepStrictEqual(snapshot, input),
      true,
      `${boundary.label}: shared intake changed accepted schema values`,
    );
    assert.deepEqual(
      traversalInventory(traversalDerivedContainerSites(snapshot)),
      expectedInventory,
      `${boundary.label}: shared intake omitted an accepted container path`,
    );
    assertNoSharedObjectReferences(snapshot, input, `${boundary.label} full schema`);
    acceptedContainerCount += sites.length;
  }
  assert.equal(
    acceptedContainerCount,
    15_434,
    "shared intake must snapshot the complete independently pinned V3 container inventory",
  );
}

async function statefulAccessorContract() {
  const built = await cleanBuild();

  const authority = cloneValue(AUTHORITY);
  const authoritySchema = authority.schema;
  let authorityReads = 0;
  Object.defineProperty(authority, "schema", {
    configurable: true,
    enumerable: true,
    get() {
      authorityReads += 1;
      return authorityReads === 1 ? authoritySchema : "changed-by-stateful-accessor";
    },
  });
  await assertTypeError(
    () => productionPacker.buildRegionalR5V3AtomicSourceMasters({ authority }),
    "stateful atomic authority accessor",
  );
  assert.equal(authorityReads, 0, "stateful public atomic accessor must reject without execution");

  const internal = {
    input: { authority: cloneValue(AUTHORITY) },
    ...syntheticAtomicInput(async (raw) => Buffer.from(raw.data)),
  };
  const internalAuthority = internal.input.authority;
  let internalReads = 0;
  Object.defineProperty(internal.input, "authority", {
    configurable: true,
    enumerable: true,
    get() {
      internalReads += 1;
      return internalReads === 1 ? internalAuthority : { schema: "changed-by-stateful-accessor" };
    },
  });
  await assertTypeError(
    () => buildRegionalR5V3AtomicSourceMastersInternal(internal),
    "stateful internal atomic authority accessor",
  );
  assert.equal(internalReads, 0, "stateful internal atomic accessor must reject without execution");

  const atlasInput = staticInput(built);
  const atlasId = "worn-heartland-terrain";
  const initialAtlasBytes = atlasInput.masterBuffers[atlasId];
  const laterAtlasBytes = atlasInput.masterBuffers["dry-scrub-terrain"];
  let atlasReads = 0;
  Object.defineProperty(atlasInput.masterBuffers, atlasId, {
    configurable: true,
    enumerable: true,
    get() {
      atlasReads += 1;
      return atlasReads === 1 ? initialAtlasBytes : laterAtlasBytes;
    },
  });
  await assertProductError(
    () => productionPacker.buildRegionalR5AtlasOnlyScenes(atlasInput),
    ATLAS_ERROR_NAME,
    "MASTER_INVENTORY_INVALID",
    "stateful atlas master accessor",
  );
  assert.equal(atlasReads, 0, "stateful atlas accessor must reject without execution");

  const dynamic = await dynamicInput();
  const initialScene = dynamic.staticScenes.scenes["ash-waste"];
  const laterScene = cloneValue(initialScene);
  laterScene.raw.data[0] ^= 1;
  let dynamicReads = 0;
  Object.defineProperty(dynamic.staticScenes.scenes, "ash-waste", {
    configurable: true,
    enumerable: true,
    get() {
      dynamicReads += 1;
      return dynamicReads === 1 ? initialScene : laterScene;
    },
  });
  await assertProductError(
    () => productionPacker.buildRegionalR5DynamicPresentationScenes(dynamic),
    DYNAMIC_ERROR_NAME,
    "STATIC_SCENE_INVALID",
    "stateful dynamic static-scene accessor",
  );
  assert.equal(dynamicReads, 0, "stateful dynamic accessor must reject without execution");
}

async function preCallBufferBoundaryContract() {
  const internalBufferCases = [
    {
      label: "internal rawMasters",
      select(args) { return args.rawMasters["worn-heartland-terrain"]; },
    },
    ...["fragments", "patches", "explicitSources"].map((mapName) => ({
      label: `internal ${mapName} source`,
      select(args) { return args[mapName].entries().next().value[1]; },
    })),
    {
      label: "internal cellLayersByAtlas source",
      select(args) {
        return args.cellLayersByAtlas.get(UNTOUCHED_CELL_LAYER_KEY)[0].raw;
      },
    },
  ];
  for (const internalCase of internalBufferCases) {
    const args = {
      input: { authority: cloneValue(AUTHORITY) },
      ...syntheticAtomicInput(async (raw) => Buffer.from(raw.data)),
    };
    const raw = internalCase.select(args);
    const detached = transferableBuffer(raw.data);
    raw.data = detached.buffer;
    structuredClone(detached.backing, { transfer: [detached.backing] });
    await assertTypeError(
      () => buildRegionalR5V3AtomicSourceMastersInternal(args),
      `pre-call transferred ${internalCase.label} Buffer`,
    );
  }

  const built = await cleanBuild();
  const atlasId = "worn-heartland-terrain";
  for (const representation of ["zero-length", "transferred"]) {
    const input = staticInput(built);
    if (representation === "zero-length") {
      input.masterBuffers[atlasId] = Buffer.alloc(0);
    } else {
      const detached = transferableBuffer(input.masterBuffers[atlasId]);
      input.masterBuffers[atlasId] = detached.buffer;
      structuredClone(detached.backing, { transfer: [detached.backing] });
    }
    await assertProductError(
      () => productionPacker.buildRegionalR5AtlasOnlyScenes(input),
      ATLAS_ERROR_NAME,
      "V3_MASTER_SET_IDENTITY_MISMATCH",
      `pre-call ${representation} atlas Buffer`,
    );
  }

  const sourceId = "worn-heartland-home-yards";
  for (const representation of ["zero-length", "transferred"]) {
    const input = await dynamicInput();
    if (representation === "zero-length") {
      input.dynamicSourceBuffers[sourceId] = Buffer.alloc(0);
    } else {
      const detached = transferableBuffer(input.dynamicSourceBuffers[sourceId]);
      input.dynamicSourceBuffers[sourceId] = detached.buffer;
      structuredClone(detached.backing, { transfer: [detached.backing] });
    }
    await assertProductError(
      () => productionPacker.buildRegionalR5DynamicPresentationScenes(input),
      DYNAMIC_ERROR_NAME,
      "DYNAMIC_SOURCE_HASH_MISMATCH",
      `pre-call ${representation} dynamic Buffer`,
    );
  }
}

function deadBindContract() {
  exportedAsyncFunctionSourceContract();
  const {
    declaration: builderSource,
    body: builderBody,
  } = exportedAsyncFunctionSource(
    PACKER_SOURCE,
    "buildRegionalR5V3AtomicSourceMasters",
    "pack-2d-production-assets.mjs",
  );
  const binderReferenceLines = PACKER_SOURCE.split("\n")
    .map((line) => line.trim())
    .filter((line) => /\bbindRegionalR5AuthoringResult\b/u.test(line));
  assert.deepEqual(
    binderReferenceLines,
    [
      "if (bindResult) bindRegionalR5AuthoringResult(authoring);",
      "function bindRegionalR5AuthoringResult(authoring) {",
    ],
    "the module may reference the authoring binder only in the established guarded V2 trust path and its declaration",
  );
  assert.match(
    builderSource,
    /buildRegionalR5SourceMastersInternal\(\{ sourceBuffers \}, false\)/u,
    "the V3 path must keep the established source-authoring binder explicitly disabled",
  );
  assert.doesNotMatch(
    builderSource,
    /\bbindRegionalR5AuthoringResult\b/u,
    "public V3 builder must not reference the authoring binder directly or through an alias",
  );
  assert.doesNotMatch(
    PACKER_SOURCE,
    /\bv3Authoring\b|\bv3AtomicReceipt\b|buffers\s*:\s*built\.result\.masterBuffers|rawMasters\s*:\s*built\.rawMasters/u,
    "the module must not construct or retain a discarded V3 authoring aggregate",
  );
  assert.match(
    builderBody,
    /const built = await buildRegionalR5V3AtomicSourceMastersInternal\(\{[\s\S]*?\n\s*\}\);\s*return built\.result;\s*\}/u,
    "the public V3 call graph must return the atomic result directly with no post-build helper or alias escape",
  );
}

async function closureSentinelContract() {
  const built = await cleanBuild();
  const failures = [];

  await recordContractCase(failures, "atomic closure sentinel", async () => {
    const authority = cloneValue(AUTHORITY);
    Object.defineProperty(authority, "__hidden_metadata", { enumerable: false, value: true });
    await assertTypeError(
      () => productionPacker.buildRegionalR5V3AtomicSourceMasters({ authority }),
      "atomic closure sentinel",
    );
  });
  await recordContractCase(failures, "atlas closure sentinel", async () => {
    const input = staticInput(built);
    input.masterBuffers[Symbol("metadata")] = true;
    await assertProductError(
      () => productionPacker.buildRegionalR5AtlasOnlyScenes(input),
      ATLAS_ERROR_NAME,
      "MASTER_INVENTORY_INVALID",
      "atlas closure sentinel",
    );
  });
  await recordContractCase(failures, "dynamic closure sentinel", async () => {
    const input = await dynamicInput();
    Object.defineProperty(input.staticScenes.scenes["ash-waste"], "__hidden_metadata", {
      enumerable: false,
      value: true,
    });
    await assertProductError(
      () => productionPacker.buildRegionalR5DynamicPresentationScenes(input),
      DYNAMIC_ERROR_NAME,
      "STATIC_SCENE_INVALID",
      "dynamic closure sentinel",
    );
  });
  assertNoContractFailures(failures, "recursive-closure sentinels");
}

async function collectReadinessGaps() {
  const gaps = [];
  for (const api of [
    "buildRegionalR5V3AtomicSourceMasters",
    "buildRegionalR5AtlasOnlyScenes",
    "buildRegionalR5DynamicPresentationScenes",
    "regionalR5V3LandmarkPortReceipt",
  ]) {
    if (typeof productionPacker[api] !== "function") gaps.push(`missing public ${api}`);
  }
  if (gaps.length > 0) return gaps;

  await recordReadinessProbe(gaps, "clean V3 pixel baseline", async () => {
    const [built, staticScenes, dynamicScenes] = await Promise.all([
      cleanBuild(),
      cleanStatic(),
      cleanDynamic(),
    ]);
    assert.deepEqual(built.receipt.masterPngSha256, BASELINE_MASTER_PNG_SHA256);
    assert.deepEqual(
      Object.fromEntries(KITS.map((kit) => [kit, staticScenes.scenes[kit].rgbaSha256])),
      BASELINE_STATIC_RGBA_SHA256,
    );
    assert.deepEqual(
      Object.fromEntries(KITS.map((kit) => [kit, dynamicScenes.scenes[kit].rgbaSha256])),
      BASELINE_DYNAMIC_RGBA_SHA256,
    );
  });
  await recordReadinessProbe(gaps, "public V3 builder dead-bind check", async () => deadBindContract());
  await recordReadinessProbe(gaps, "landmark-port digest chain", portDigestContract);
  await recordReadinessProbe(gaps, "public atomic authority snapshot", publicAtomicSnapshotContract);
  await recordReadinessProbe(gaps, "internal atomic promise-barrier snapshot", internalAtomicSnapshotContract);
  await recordReadinessProbe(gaps, "atlas async snapshot", atlasSnapshotContract);
  await recordReadinessProbe(gaps, "dynamic async snapshot", dynamicSnapshotContract);
  await recordReadinessProbe(gaps, "shared synchronous intake architecture", async () => {
    callGraphAnalyzerContract();
    sharedIntakeCallGraphContract();
    sharedIntakeClosureContract();
    await sharedIntakeSchemaSnapshotContract();
  });
  await recordReadinessProbe(gaps, "recursive-closure sentinel", closureSentinelContract);

  // Boundary-only invalid-input checks become reachable after the shared linear
  // intake architecture is present. This preserves one bounded aggregate RED.
  if (gaps.length === 0) {
    await recordReadinessProbe(gaps, "stateful accessor rejection", statefulAccessorContract);
    await recordReadinessProbe(gaps, "pre-call Buffer rejection", preCallBufferBoundaryContract);
  }
  return gaps;
}

const READINESS_GAPS = await collectReadinessGaps();
const READINESS_SKIP = READINESS_GAPS.length === 0
  ? false
  : "V3_ATOMIC_INTAKE_RED/DEPENDENT_ON_READINESS";

test("V3 asynchronous composition intake is snapshot-ready", () => {
  assert.equal(
    READINESS_GAPS.length,
    0,
    `V3_ATOMIC_INTAKE_RED/READINESS_MISSING: ${READINESS_GAPS.join("; ")}`,
  );
});

test("clean V3 inputs preserve every established master, static, and dynamic pixel identity", {
  skip: READINESS_SKIP,
}, async () => {
  const [built, staticScenes, dynamicScenes] = await Promise.all([
    cleanBuild(),
    cleanStatic(),
    cleanDynamic(),
  ]);
  assert.deepEqual(built.receipt.masterPngSha256, BASELINE_MASTER_PNG_SHA256);
  assert.deepEqual(
    Object.fromEntries(KITS.map((kit) => [kit, staticScenes.scenes[kit].rgbaSha256])),
    BASELINE_STATIC_RGBA_SHA256,
  );
  assert.deepEqual(
    Object.fromEntries(KITS.map((kit) => [kit, dynamicScenes.scenes[kit].rgbaSha256])),
    BASELINE_DYNAMIC_RGBA_SHA256,
  );
});

test("landmark port identity flows through atomic receipt, authoring identity, and static trust", {
  skip: READINESS_SKIP,
}, async () => {
  await portDigestContract();
});

test("public and internal atomic authority are captured before asynchronous work", {
  skip: READINESS_SKIP,
}, async () => {
  await publicAtomicSnapshotContract();
  await internalAtomicSnapshotContract();
});

test("atlas masters, placements, and authoring identity are captured before decoding", {
  skip: READINESS_SKIP,
}, async () => {
  await atlasSnapshotContract();
});

test("dynamic static scenes, source bytes, and placements are captured before decoding", {
  skip: READINESS_SKIP,
}, async () => {
  await dynamicSnapshotContract();
});

test("one synchronous intake primitive closes and snapshots all four builder schemas", {
  skip: READINESS_SKIP,
}, async () => {
  callGraphAnalyzerContract();
  sharedIntakeCallGraphContract();
  sharedIntakeClosureContract();
  await sharedIntakeSchemaSnapshotContract();
});

test("stateful accessors at atomic, atlas, and dynamic boundaries always reject", {
  skip: READINESS_SKIP,
}, async () => {
  await statefulAccessorContract();
});

test("zero-length and pre-call transferred internal, atlas, and dynamic buffers reject", {
  skip: READINESS_SKIP,
}, async () => {
  await preCallBufferBoundaryContract();
});

test("the V3 module call graph contains no discarded authoring bind or aggregate", {
  skip: READINESS_SKIP,
}, () => {
  deadBindContract();
});
