/** Contract tests for the closed, inert R5 regional-art authoring authority. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";

import {
  REGIONAL_R4_SCENE_PLANS,
  REGIONAL_R4_VARIANT_RECIPES,
} from "./regional-art-r4-spec.mjs";
import {
  analyzeLandmarkMaterialDepth,
  analyzeLifecycleOverlayComposites,
  analyzeOverlayVisibility,
  analyzeYardCell,
  analyzeYardLifecycle,
  validateLandmarkMaterialDepth,
  validateLifecycleOverlayMetrics,
  validateOverlayVisibility,
  validateYardCell,
  validateYardLifecycle,
} from "./regional-art-r5-visual-contract.mjs";


const AUTHORING_MODULE_URL = new URL("./regional-art-r5-authoring-spec.mjs", import.meta.url);
const AUTHORING_SOURCE = await readFile(AUTHORING_MODULE_URL, "utf8");
const LITERAL_AUTHORITY_URL = new URL("./fixtures/regional-art-r5-literal-authority.json", import.meta.url);
const LITERAL_AUTHORITY_SOURCE = await readFile(LITERAL_AUTHORITY_URL, "utf8");
const LITERAL_AUTHORITY_SOURCE_ERRORS = rawJsonErrors(LITERAL_AUTHORITY_SOURCE);
if (LITERAL_AUTHORITY_SOURCE_ERRORS.length > 0) {
  throw new Error(`Unsafe literal authority JSON:\n${LITERAL_AUTHORITY_SOURCE_ERRORS.join("\n")}`);
}
const LITERAL_AUTHORITY = JSON.parse(LITERAL_AUTHORITY_SOURCE);
const LITERAL_AUTHORITY_SHA256 = "4e2e42ebf79da2c341629e17560368c3981b1a57f49fa7168b5aaface7ab4280";
const CANONICAL_DEEP_FREEZE_SOURCE = `function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}`;
const CANONICAL_DEEP_FREEZE_TEXT_SHA256 = "322133abc9476ff61af0e7ea677e3551df36549422054d7c641305ed73b7d5b8";
const CANONICAL_DEEP_FREEZE_AST_SHA256 = "9c55e965b621234fef0ee1a061bad4c4a1b627426872bca3e6795c0584620cee";
const MANUALLY_FROZEN_VALIDATOR_TEXT_SHA256 = "11b4d53e0878faa676cb2f9668750d56ece48b353afaa6372a90a4e4a0040f94";
const MANUALLY_FROZEN_VALIDATOR_AST_SHA256 = "3d18c9e97964a44bacca693e44f2f2462184d240e2561e393321ec381912fd43";

function rawSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function strictJsonLexicalErrors(source) {
  const errors = new Set();
  const tokens = [];
  const isWhitespace = (character) => character === " " || character === "\t"
    || character === "\n" || character === "\r";
  const isStructural = (character) => "{}[],:".includes(character);
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (isWhitespace(character)) {
      index += 1;
      continue;
    }
    if (isStructural(character)) {
      tokens.push(character);
      index += 1;
      continue;
    }
    if (character === '"') {
      const start = index;
      index += 1;
      let closed = false;
      while (index < source.length) {
        const current = source[index];
        if (current === '"') {
          index += 1;
          closed = true;
          break;
        }
        if (current === "\\") {
          const escape = source[index + 1];
          if (escape === "u") {
            const codePoint = source.slice(index + 2, index + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(codePoint)) {
              errors.add(`json:lex:${start}:invalid unicode escape`);
              index += 2;
            } else index += 6;
            continue;
          }
          if (!'"\\/bfnrt'.includes(escape ?? "")) {
            errors.add(`json:lex:${start}:invalid JSON string escape`);
          }
          index += 2;
          continue;
        }
        if (current.charCodeAt(0) <= 0x1f) errors.add(`json:lex:${start}:unescaped control character`);
        index += 1;
      }
      if (!closed) errors.add(`json:lex:${start}:unterminated JSON string`);
      tokens.push("string");
      continue;
    }
    if (character === "/") {
      if (source[index + 1] === "/") {
        errors.add(`json:lex:${index}:comments are forbidden`);
        index += 2;
        while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index += 1;
        continue;
      }
      if (source[index + 1] === "*") {
        errors.add(`json:lex:${index}:comments are forbidden`);
        const end = source.indexOf("*/", index + 2);
        if (end === -1) {
          errors.add(`json:lex:${index}:unterminated block comment`);
          index = source.length;
        } else index = end + 2;
        continue;
      }
      errors.add(`json:lex:${index}:unexpected slash`);
      index += 1;
      continue;
    }
    if (/[+\-.0-9]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && !isWhitespace(source[index])
        && !isStructural(source[index]) && source[index] !== "/" && source[index] !== '"') index += 1;
      const spelling = source.slice(start, index);
      if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(spelling)) {
        errors.add(`json:lex:${start}:strict JSON number required (${spelling})`);
      }
      tokens.push("number");
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
      const spelling = source.slice(start, index);
      if (!["true", "false", "null"].includes(spelling)) {
        errors.add(`json:lex:${start}:unexpected identifier ${spelling}`);
      }
      tokens.push("keyword");
      continue;
    }
    errors.add(`json:lex:${index}:unexpected character ${JSON.stringify(character)}`);
    index += 1;
  }
  for (let tokenIndex = 1; tokenIndex < tokens.length; tokenIndex += 1) {
    if ((tokens[tokenIndex] === "}" || tokens[tokenIndex] === "]")
      && tokens[tokenIndex - 1] === ",") errors.add("json:lex:trailing commas are forbidden");
  }
  return [...errors];
}

function rawJsonErrors(source) {
  const errors = new Set(strictJsonLexicalErrors(source));
  const sourceFile = ts.parseJsonText("regional-art-r5-literal-authority.json", source);
  for (const diagnostic of sourceFile.parseDiagnostics) {
    errors.add(`json:parse:${String(diagnostic.messageText)}`);
  }
  if (sourceFile.statements.length !== 1 || !ts.isExpressionStatement(sourceFile.statements[0])) {
    errors.add("json:root:exactly one JSON expression is required");
    return [...errors];
  }

  const visit = (node, path) => {
    if (ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword
      || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) return;
    if (ts.isNumericLiteral(node)) {
      if (!Number.isFinite(Number(node.text))) errors.add(`json:${path}:finite numeric literal required`);
      return;
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken
      && ts.isNumericLiteral(node.operand)) {
      if (!Number.isFinite(-Number(node.operand.text))) errors.add(`json:${path}:finite numeric literal required`);
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const [index, element] of node.elements.entries()) {
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
          errors.add(`json:${path}[${index}]:dense JSON array required`);
        } else visit(element, `${path}[${index}]`);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) {
          errors.add(`json:${path}:string-keyed JSON property required`);
          continue;
        }
        const name = property.name.text;
        if (keys.has(name)) errors.add(`json:${path}:duplicate cooked key ${name}`);
        keys.add(name);
        if (["__proto__", "prototype", "constructor"].includes(name)) {
          errors.add(`json:${path}:prototype-bearing key ${name} is forbidden`);
        }
        visit(property.initializer, `${path}.${name}`);
      }
      return;
    }
    errors.add(`json:${path}:${ts.SyntaxKind[node.kind]} is outside strict JSON data grammar`);
  };
  visit(sourceFile.statements[0].expression, "$fixture");
  return [...errors];
}

function astShape(node, sourceFile) {
  return [
    ts.SyntaxKind[node.kind],
    node.getChildCount(sourceFile) === 0 ? node.getText(sourceFile) : null,
    node.getChildren(sourceFile).map((child) => astShape(child, sourceFile)),
  ];
}

function actualAuthoringValidatorIdentityErrors(source, pins = {}) {
  const errors = new Set();
  const isConfiguredPin = (value) => typeof value === "string"
    && /^[0-9a-f]{64}$/.test(value) && value !== "0".repeat(64);
  const textPinConfigured = isConfiguredPin(pins.textSha256);
  const astPinConfigured = isConfiguredPin(pins.astSha256);
  if (!textPinConfigured) {
    errors.add("validator-identity: exact source-text SHA-256 pin is unset or placeholder");
  }
  if (!astPinConfigured) {
    errors.add("validator-identity: exact AST-shape SHA-256 pin is unset or placeholder");
  }

  const sourceFile = ts.createSourceFile("regional-art-r5-authoring-spec.mjs", source,
    ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const validators = sourceFile.statements.filter((statement) => (
    ts.isFunctionDeclaration(statement)
      && statement.name?.text === "validateRegionalR5AuthoringSpec"
  ));
  if (validators.length !== 1) {
    errors.add("validator-identity: exactly one top-level validateRegionalR5AuthoringSpec function is required");
    return [...errors];
  }

  const validator = validators[0];
  const validatorText = validator.getText(sourceFile);
  if (textPinConfigured && rawSha256(validatorText) !== pins.textSha256) {
    errors.add("validator-identity: canonical source text/hash drift");
  }
  const validatorAstHash = rawSha256(JSON.stringify(astShape(validator, sourceFile)));
  if (astPinConfigured && validatorAstHash !== pins.astSha256) {
    errors.add("validator-identity: canonical AST hash drift");
  }
  return [...errors];
}

function inertSourceErrors(source) {
  const errors = new Set();
  const sourceFile = ts.createSourceFile("regional-art-r5-authoring-spec.mjs", source,
    ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  for (const diagnostic of sourceFile.parseDiagnostics) errors.add(`parse:${diagnostic.messageText}`);

  const authorityExportNames = [
    "REGIONAL_R5_AUTHORING_KITS",
    "REGIONAL_R5_AUTHORING_SOURCES",
    "REGIONAL_R5_NORMALIZATION",
    "REGIONAL_R5_PALETTES",
    "REGIONAL_R5_CROPS",
    "REGIONAL_R5_LITERAL_PATCHES",
    "REGIONAL_R5_MECHANICS_BINDINGS",
    "REGIONAL_R5_ATLAS_AUTHORING_PLANS",
    "REGIONAL_R5_KEY_SCENES",
    "REGIONAL_R5_AUTHORING_SPEC",
  ];
  const exactModifiers = (node, expected) => {
    const actual = (node.modifiers ?? []).map(({ kind }) => kind);
    if (canonical(actual) === canonical(expected)) return true;
    errors.add(`ecmascript:${ts.SyntaxKind[node.kind]} has forbidden or missing modifiers`);
    return false;
  };
  const isExactConstDeclarationList = (declarationList) => (
    (declarationList.flags & ts.NodeFlags.BlockScoped) === ts.NodeFlags.Const
  );
  const inspectEcmaMetadata = (node) => {
    if (node.type || node.typeParameters?.length > 0 || node.typeArguments?.length > 0
      || (node.questionToken && !ts.isConditionalExpression(node))
      || node.exclamationToken || node.questionDotToken
      || node.decorators?.length > 0) {
      errors.add(`ecmascript:${ts.SyntaxKind[node.kind]} contains TypeScript or optional-chain metadata`);
    }
    ts.forEachChild(node, inspectEcmaMetadata);
  };
  inspectEcmaMetadata(sourceFile);

  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  const availableAuthorities = new Set();
  if (imports.length !== 1) errors.add("imports: exactly one static R4 import is allowed");
  const imported = imports[0];
  if (imported) {
    exactModifiers(imported, []);
    if (!ts.isStringLiteral(imported.moduleSpecifier)
      || imported.moduleSpecifier.text !== "./regional-art-r4-spec.mjs") {
      errors.add("imports: only ./regional-art-r4-spec.mjs is allowed");
    }
    if (imported.attributes || imported.assertClause || imported.importClause?.isTypeOnly
      || imported.importClause?.phaseModifier) {
      errors.add("imports: attributes, assertions, and type-only clauses are forbidden");
    }
    const named = imported.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named) || imported.importClause?.name) {
      errors.add("imports: exact named R4 import required");
    } else {
      const names = named.elements.map(({ name }) => name.text).sort();
      if (canonical(names) !== canonical(["REGIONAL_R4_SCENE_PLANS", "REGIONAL_R4_VARIANT_RECIPES"])) {
        errors.add("imports: exact R4 authority names required");
      }
      for (const specifier of named.elements) {
        const { name, propertyName } = specifier;
        if (propertyName) errors.add("imports: aliases are forbidden");
        if (specifier.isTypeOnly) errors.add("imports: type-only specifiers are forbidden");
        availableAuthorities.add(name.text);
      }
    }
  }

  const deepFreezeDeclarations = sourceFile.statements.filter((statement) => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === "deepFreeze"
  ));
  if (deepFreezeDeclarations.length !== 1) {
    errors.add("deepFreeze: exactly one canonical FunctionDeclaration is required");
  } else {
    const declaration = deepFreezeDeclarations[0];
    exactModifiers(declaration, []);
    const declarationText = declaration.getText(sourceFile);
    if (declarationText !== CANONICAL_DEEP_FREEZE_SOURCE
      || rawSha256(declarationText) !== CANONICAL_DEEP_FREEZE_TEXT_SHA256) {
      errors.add("deepFreeze: canonical source text/hash drift");
    }
    if (rawSha256(JSON.stringify(astShape(declaration, sourceFile))) !== CANONICAL_DEEP_FREEZE_AST_SHA256) {
      errors.add("deepFreeze: canonical AST hash drift");
    }
  }

  const checkLiteral = (node, path) => {
    if (ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword
      || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) return true;
    if (ts.isNumericLiteral(node)) {
      if (Number.isFinite(Number(node.text))) return true;
      errors.add(`literal:${path}: finite numeric literal required`);
      return false;
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken
      && ts.isNumericLiteral(node.operand)) {
      if (Number.isFinite(-Number(node.operand.text))) return true;
      errors.add(`literal:${path}: finite numeric literal required`);
      return false;
    }
    if (ts.isIdentifier(node)) {
      if (availableAuthorities.has(node.text)) return true;
      errors.add(`literal:${path}: unresolved or ambient identifier ${node.text}`);
      return false;
    }
    if (ts.isArrayLiteralExpression(node)) {
      let valid = true;
      for (const [index, element] of node.elements.entries()) {
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
          errors.add(`literal:${path}[${index}]: dense arrays without spread are required`);
          valid = false;
        } else if (!checkLiteral(element, `${path}[${index}]`)) valid = false;
      }
      return valid;
    }
    if (ts.isObjectLiteralExpression(node)) {
      let valid = true;
      const keys = new Set();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) {
          errors.add(`literal:${path}: only noncomputed PropertyAssignments are allowed`);
          valid = false;
          continue;
        }
        let name;
        if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          || ts.isNumericLiteral(property.name)) name = property.name.text;
        else {
          errors.add(`literal:${path}: identifier, string, or numeric property name required`);
          valid = false;
          continue;
        }
        if (keys.has(name)) {
          errors.add(`literal:${path}: duplicate cooked key ${name}`);
          valid = false;
        }
        keys.add(name);
        if (["__proto__", "prototype", "constructor"].includes(name)) {
          errors.add(`literal:${path}: prototype-bearing keys are forbidden`);
          valid = false;
        }
        if (!checkLiteral(property.initializer, `${path}.${name}`)) valid = false;
      }
      return valid;
    }
    errors.add(`literal:${path}: ${ts.SyntaxKind[node.kind]} is outside the positive data grammar`);
    return false;
  };

  const staticReadCalls = {
    Object: new Set([
      "keys", "hasOwn", "getPrototypeOf", "getOwnPropertyDescriptor",
      "getOwnPropertyNames", "getOwnPropertySymbols", "is",
      "isExtensible", "isFrozen", "isSealed",
    ]),
    Reflect: new Set(["ownKeys", "getOwnPropertyDescriptor", "getPrototypeOf", "isExtensible"]),
    Array: new Set(["isArray"]),
    Number: new Set(["isFinite", "isInteger"]),
  };
  const ambient = new Set([
    "globalThis", "global", "window", "self", "console", "eval", "Function", "Proxy", "Promise",
    "fetch", "require", "navigator", "document", "location", "process", "Deno", "Bun", "Math",
    "JSON", "Symbol", "Date", "RegExp", "Intl", "WebAssembly", "Atomics", "SharedArrayBuffer",
    "setTimeout", "setInterval", "setImmediate", "queueMicrotask", "requestAnimationFrame",
    "cancelAnimationFrame", "MessageChannel", "MutationObserver", "Worker", "SharedWorker",
    "XMLHttpRequest", "WebSocket", "EventSource",
  ]);
  for (const name of Reflect.ownKeys(globalThis)) {
    if (typeof name === "string") ambient.add(name);
  }
  for (const name of [
    "undefined", "NaN", "Infinity", "AggregateError", "ArrayBuffer", "BigInt", "BigInt64Array",
    "BigUint64Array", "Boolean", "DataView", "Error", "EvalError", "FinalizationRegistry",
    "Float32Array", "Float64Array", "Int8Array", "Int16Array", "Int32Array", "Map", "Number",
    "Object", "RangeError", "ReferenceError", "Set", "String", "SyntaxError", "TypeError",
    "URIError", "Uint8Array", "Uint8ClampedArray", "Uint16Array", "Uint32Array", "WeakMap",
    "WeakRef", "WeakSet", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent",
    "escape", "isFinite", "isNaN", "parseFloat", "parseInt", "unescape", "URL", "URLSearchParams",
    "structuredClone", "crypto", "performance", "arguments",
  ]) ambient.add(name);
  const reservedValidatorNames = new Set([
    ...Object.keys(staticReadCalls), ...ambient, "deepFreeze",
    "REGIONAL_R4_SCENE_PLANS", "REGIONAL_R4_VARIANT_RECIPES",
    ...authorityExportNames, "validateRegionalR5AuthoringSpec", "candidate",
  ]);
  const forbiddenProperties = new Set([
    "constructor", "prototype", "__proto__", "then", "call", "apply", "bind",
    "push", "pop", "splice", "sort", "reverse", "copyWithin", "fill", "shift", "unshift",
    "add", "set", "delete", "clear", "assign", "defineProperty", "defineProperties",
    "setPrototypeOf", "freeze", "seal", "preventExtensions",
  ]);
  const binaryOperators = new Set([
    ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
    ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.InKeyword,
    ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken,
    ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken,
  ]);

  const checkValidator = (validator) => {
    const localFunctions = new Map();
    if (!validator.body || !ts.isBlock(validator.body)) {
      errors.add("validator: exported validator requires a block body");
      return false;
    }
    for (const statement of validator.body.statements) {
      if (!ts.isFunctionDeclaration(statement)) continue;
      if (!statement.name || reservedValidatorNames.has(statement.name.text)
        || localFunctions.has(statement.name.text)) {
        errors.add("validator: local helper names must be unique, non-reserved identifiers");
        continue;
      }
      localFunctions.set(statement.name.text, {
        node: statement,
        results: new Map(),
        inProgress: new Set(),
        analyses: 0,
      });
    }
    const helperCallGraph = new Map([...localFunctions].map(([name]) => [name, new Set()]));
    for (const [name, helper] of localFunctions) {
      const collectHelperCalls = (node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
          && localFunctions.has(node.expression.text)) {
          helperCallGraph.get(name).add(node.expression.text);
        }
        ts.forEachChild(node, collectHelperCalls);
      };
      collectHelperCalls(helper.node.body);
    }
    const visitingHelpers = new Set();
    const visitedHelpers = new Set();
    const visitHelper = (name, path = []) => {
      if (visitingHelpers.has(name)) {
        errors.add(`validator: recursive helper call graph ${[...path, name].join(" -> ")} is forbidden`);
        return;
      }
      if (visitedHelpers.has(name)) return;
      visitingHelpers.add(name);
      for (const callee of helperCallGraph.get(name) ?? []) visitHelper(callee, [...path, name]);
      visitingHelpers.delete(name);
      visitedHelpers.add(name);
    };
    for (const name of localFunctions.keys()) visitHelper(name);
    const baseValues = () => new Map([...availableAuthorities].map((name) => [name, "trusted"]));
    const baseCallables = () => new Set(localFunctions.keys());
    let valueScopes = [baseValues()];
    let callableScopes = [baseCallables()];
    const returnCollectors = [];
    const pushScope = () => { valueScopes.push(new Map()); callableScopes.push(new Set()); };
    const popScope = () => { valueScopes.pop(); callableScopes.pop(); };
    const resolveIdentifier = (name) => {
      for (let index = valueScopes.length - 1; index >= 0; index -= 1) {
        if (valueScopes[index].has(name)) {
          return { kind: "value", provenance: valueScopes[index].get(name) };
        }
        if (callableScopes[index].has(name)) return { kind: "callable", provenance: "callable" };
      }
      return null;
    };
    const valueProvenance = (name) => {
      const resolved = resolveIdentifier(name);
      return resolved?.kind === "value" ? resolved.provenance : null;
    };
    const setValue = (name, provenance) => valueScopes.at(-1).set(name, provenance);
    const setResolvedValue = (name, provenance) => {
      for (let index = valueScopes.length - 1; index >= 0; index -= 1) {
        if (valueScopes[index].has(name)) {
          valueScopes[index].set(name, provenance);
          return true;
        }
      }
      return false;
    };
    const hasValue = (name) => resolveIdentifier(name)?.kind === "value";
    const hasCallable = (name) => resolveIdentifier(name)?.kind === "callable";
    const provenanceKinds = new Set([
      "scalar", "key", "ownKeyArray", "localArray", "trusted",
      "candidate", "descriptorMaybe", "descriptor", "descriptorValue", "prototype",
    ]);
    const descriptorProvenance = (provenance) => provenance === "descriptor";
    const safePropertyKey = (provenance) => provenance === "key" || provenance === "scalar";
    const readTarget = (provenance) => ["candidate", "trusted", "descriptorValue"].includes(provenance);
    const bindingName = (node, label, allowRootCandidate = false) => {
      if (ts.isIdentifier(node)) {
        if (reservedValidatorNames.has(node.text)
          && !(allowRootCandidate && node.text === "candidate")) {
          errors.add(`validator:${label}: reserved identifier ${node.text} may not be shadowed`);
          return null;
        }
        if (localFunctions.has(node.text) || resolveIdentifier(node.text)) {
          errors.add(`validator:${label}: duplicate or shadowed binding ${node.text} is forbidden`);
          return null;
        }
        return node.text;
      }
      errors.add(`validator:${label}: destructuring bindings are forbidden`);
      return null;
    };
    const descriptorFields = new Set(["value", "writable", "enumerable", "configurable"]);
    const ownKeyMethods = new Set(["keys", "getOwnPropertyNames", "getOwnPropertySymbols", "ownKeys"]);
    const descriptorMethods = new Set(["getOwnPropertyDescriptor"]);
    const mergeAlternatives = (provenances) => {
      if (provenances.length === 0) return "scalar";
      if (provenances.every((value) => value === provenances[0])) return provenances[0];
      if (provenances.every(safePropertyKey)) return "key";
      return "invalid";
    };
    const combineReturns = (provenances) => mergeAlternatives(
      provenances.length > 0 ? provenances : ["scalar"],
    );
    let checkFunction;
    let checkStatement;
    let checkExpression;
    let analyzeLocalFunction;
    const expressionProvenance = (node) => {
      if (!node) return "scalar";
      if (ts.isIdentifier(node)) return valueProvenance(node.text) ?? "invalid";
      if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
        || node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.TypeOfExpression) return "scalar";
      if (ts.isParenthesizedExpression(node)) return expressionProvenance(node.expression);
      if (ts.isArrayLiteralExpression(node)) {
        return node.elements.every((element) => expressionProvenance(element) === "scalar")
          ? "localArray" : "invalid";
      }
      if (ts.isObjectLiteralExpression(node)) return "invalid";
      if (ts.isPropertyAccessExpression(node)) {
        const receiver = expressionProvenance(node.expression);
        if (descriptorProvenance(receiver)) {
          if (node.name.text === "value") return "descriptorValue";
          if (descriptorFields.has(node.name.text)) return "scalar";
          return "invalid";
        }
        if (["ownKeyArray", "localArray"].includes(receiver) && node.name.text === "length") {
          return "scalar";
        }
        return "invalid";
      }
      if (ts.isElementAccessExpression(node)) return "invalid";
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && localFunctions.has(node.expression.text)) {
          const argumentProvenances = node.arguments.map(expressionProvenance);
          return analyzeLocalFunction(node.expression.text, argumentProvenances).returnProvenance;
        }
        if (ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression)) {
          const receiver = node.expression.expression.text;
          const method = node.expression.name.text;
          if ((receiver === "Reflect" || receiver === "Object") && ownKeyMethods.has(method)) {
            return "ownKeyArray";
          }
          if ((receiver === "Reflect" || receiver === "Object") && descriptorMethods.has(method)) {
            return "descriptorMaybe";
          }
          if (method === "getPrototypeOf") return "prototype";
          return "scalar";
        }
        return "invalid";
      }
      if (ts.isConditionalExpression(node)) {
        return mergeAlternatives([expressionProvenance(node.whenTrue), expressionProvenance(node.whenFalse)]);
      }
      if (ts.isBinaryExpression(node)) {
        if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
          return mergeAlternatives([
            expressionProvenance(node.left), expressionProvenance(node.right),
          ]);
        }
        return "scalar";
      }
      if (ts.isTemplateExpression(node)) {
        return node.templateSpans.every((span) => expressionProvenance(span.expression) === "scalar")
          ? "scalar" : "invalid";
      }
      if (node.kind === ts.SyntaxKind.TypeOfExpression || ts.isPrefixUnaryExpression(node)) return "scalar";
      return "invalid";
    };
    checkExpression = (node, callbackAllowed = false) => {
      if (!node) return true;
      if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)
        || ts.isNoSubstitutionTemplateLiteral(node)
        || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
        || node.kind === ts.SyntaxKind.NullKeyword) return true;
      if (ts.isIdentifier(node)) {
        if (hasValue(node.text) || Object.hasOwn(staticReadCalls, node.text)) return true;
        if (hasCallable(node.text)) {
          errors.add("validator: local callables may appear only as direct call targets");
          return false;
        }
        errors.add(ambient.has(node.text)
          ? `validator: ambient identifier ${node.text} is forbidden`
          : `validator: unresolved identifier ${node.text}`);
        return false;
      }
      if (ts.isArrayLiteralExpression(node)) {
        let valid = true;
        for (const element of node.elements) {
          if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
            errors.add("validator: sparse/spread arrays are forbidden"); valid = false;
          } else {
            if (!checkExpression(element)) valid = false;
            if (expressionProvenance(element) !== "scalar") {
              errors.add("validator: local arrays may contain proven scalars only");
              valid = false;
            }
          }
        }
        return valid;
      }
      if (ts.isObjectLiteralExpression(node)) {
        errors.add("validator: local object construction is outside the closed provenance lattice");
        return false;
      }
      if (ts.isPrefixUnaryExpression(node)) {
        if (![ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.MinusToken,
          ts.SyntaxKind.PlusToken, ts.SyntaxKind.TildeToken].includes(node.operator)) {
          errors.add("validator: mutating or unsupported unary expression is forbidden"); return false;
        }
        const valid = checkExpression(node.operand);
        if (node.operator !== ts.SyntaxKind.ExclamationToken
          && expressionProvenance(node.operand) !== "scalar") {
          errors.add("validator: unary coercion is restricted to proven scalars"); return false;
        }
        return valid;
      }
      if (node.kind === ts.SyntaxKind.TypeOfExpression) return checkExpression(node.expression);
      if (ts.isBinaryExpression(node)) {
        if (!binaryOperators.has(node.operatorToken.kind)) {
          errors.add("validator: assignments, comma expressions, and unsupported operators are forbidden");
          return false;
        }
        const valid = checkExpression(node.left) && checkExpression(node.right);
        const leftProvenance = expressionProvenance(node.left);
        const rightProvenance = expressionProvenance(node.right);
        if ([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)
          && (!safePropertyKey(leftProvenance) || !safePropertyKey(rightProvenance))) {
          errors.add("validator: loose equality over non-scalars is forbidden"); return false;
        }
        const coerciveOperators = new Set([
          ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
          ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken,
          ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken,
          ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken,
        ]);
        if (coerciveOperators.has(node.operatorToken.kind)
          && (leftProvenance !== "scalar" || rightProvenance !== "scalar")) {
          errors.add("validator: coercive operators are restricted to proven scalars"); return false;
        }
        if (node.operatorToken.kind === ts.SyntaxKind.InKeyword
          && (!safePropertyKey(leftProvenance)
            || rightProvenance !== "descriptor")) {
          errors.add("validator: reflective membership requires a safe key and descriptor target");
          return false;
        }
        return valid;
      }
      if (ts.isConditionalExpression(node)) {
        return checkExpression(node.condition) && checkExpression(node.whenTrue)
          && checkExpression(node.whenFalse);
      }
      if (ts.isParenthesizedExpression(node)) {
        if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
          errors.add("validator: parenthesized or dynamic call targets are forbidden"); return false;
        }
        return checkExpression(node.expression);
      }
      if (ts.isPropertyAccessExpression(node)) {
        if (forbiddenProperties.has(node.name.text)) {
          errors.add(`validator: property ${node.name.text} is forbidden`); return false;
        }
        if (ts.isIdentifier(node.expression) && Object.hasOwn(staticReadCalls, node.expression.text)
          && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
          errors.add("validator: built-in callables may not be aliased or extracted"); return false;
        }
        const valid = checkExpression(node.expression);
        const receiver = expressionProvenance(node.expression);
        if (receiver === "descriptorMaybe") {
          errors.add("validator: descriptor metadata requires explicit existence refinement on the same binding");
          return false;
        }
        if (descriptorProvenance(receiver) && !descriptorFields.has(node.name.text)) {
          errors.add(`validator: descriptor field ${node.name.text} is forbidden`); return false;
        }
        if (["ownKeyArray", "localArray"].includes(receiver) && node.name.text !== "length") {
          errors.add(`validator: proven-array property ${node.name.text} is forbidden`); return false;
        }
        if (descriptorProvenance(receiver)
          || (["ownKeyArray", "localArray"].includes(receiver) && node.name.text === "length")) {
          return valid;
        }
        errors.add("validator: property reads are restricted to descriptor metadata and proven-array length");
        return false;
      }
      if (ts.isElementAccessExpression(node)) {
        if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
          errors.add("validator: all element-access calls are forbidden"); return false;
        }
        checkExpression(node.expression);
        checkExpression(node.argumentExpression);
        errors.add("validator: computed reads are forbidden; iterate proven arrays instead");
        return false;
      }
      if (ts.isCallExpression(node)) {
        let valid = true;
        if (ts.isIdentifier(node.expression)) {
          if (!hasCallable(node.expression.text)) {
            errors.add(`validator: dynamic or unapproved call target ${node.expression.text}`); valid = false;
          } else if (localFunctions.has(node.expression.text)) {
            const result = analyzeLocalFunction(
              node.expression.text,
              node.arguments.map(expressionProvenance),
            );
            if (!result.valid) valid = false;
          } else {
            errors.add(`validator: recursive or external call target ${node.expression.text} is forbidden`);
            valid = false;
          }
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          const receiver = node.expression.expression;
          const method = node.expression.name.text;
          if (!ts.isIdentifier(receiver) || !staticReadCalls[receiver.text]?.has(method)) {
            errors.add(`validator: method call ${method} is outside the read-only whitelist`); valid = false;
          } else {
            const argumentsProvenance = node.arguments.map(expressionProvenance);
            const callName = `${receiver.text}.${method}`;
            const exactArity = (arity) => {
              if (node.arguments.length === arity) return true;
              errors.add(`validator: ${callName} requires exactly ${arity} arguments`);
              return false;
            };
            if (ownKeyMethods.has(method)) {
              if (!exactArity(1) || !readTarget(argumentsProvenance[0])) {
                errors.add(`validator: ${callName} target must be candidate or trusted plain data`);
                valid = false;
              }
            } else if (descriptorMethods.has(method)) {
              if (!exactArity(2) || !readTarget(argumentsProvenance[0])
                || !safePropertyKey(argumentsProvenance[1])) {
                errors.add(`validator: ${callName} requires a data target and scalar/own-key token`);
                valid = false;
              }
            } else if (method === "hasOwn") {
              if (!exactArity(2) || !readTarget(argumentsProvenance[0])
                || !safePropertyKey(argumentsProvenance[1])) {
                errors.add("validator: Object.hasOwn requires a data target and scalar/own-key token");
                valid = false;
              }
            } else if (["getPrototypeOf", "isExtensible", "isFrozen", "isSealed"].includes(method)) {
              if (!exactArity(1) || !readTarget(argumentsProvenance[0])) {
                errors.add(`validator: ${callName} requires one candidate or trusted data target`);
                valid = false;
              }
            } else if (receiver.text === "Object" && method === "is") {
              if (!exactArity(2)) valid = false;
            } else if (receiver.text === "Array" && method === "isArray") {
              if (!exactArity(1)) valid = false;
            } else if (receiver.text === "Number" && ["isFinite", "isInteger"].includes(method)) {
              if (!exactArity(1)) valid = false;
            }
          }
        } else {
          errors.add("validator: element-access, parenthesized, and dynamic call targets are forbidden");
          valid = false;
        }
        for (const argument of node.arguments) if (!checkExpression(argument)) valid = false;
        return valid;
      }
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        if (!callbackAllowed && !(ts.isVariableDeclaration(node.parent) && node.parent.initializer === node)) {
          errors.add("validator: function values require a local pure-helper binding or direct callback");
          return false;
        }
        return checkFunction(node);
      }
      if (ts.isTemplateExpression(node)) {
        let valid = true;
        for (const span of node.templateSpans) {
          if (!checkExpression(span.expression)) valid = false;
          if (expressionProvenance(span.expression) !== "scalar") {
            errors.add("validator: templates accept proven scalar substitutions only"); valid = false;
          }
        }
        return valid;
      }
      errors.add(`validator: ${ts.SyntaxKind[node.kind]} is outside the positive expression grammar`);
      return false;
    };
    const alwaysReturns = (node) => {
      if (ts.isReturnStatement(node)) return true;
      if (ts.isBlock(node)) return node.statements.some((statement) => alwaysReturns(statement));
      if (ts.isIfStatement(node)) {
        return Boolean(node.elseStatement) && alwaysReturns(node.thenStatement)
          && alwaysReturns(node.elseStatement);
      }
      return false;
    };
    const absentDescriptorGuardName = (node) => (
      ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken
        && ts.isIdentifier(node.operand) && valueProvenance(node.operand.text) === "descriptorMaybe"
        ? node.operand.text : null
    );
    checkStatement = (node) => {
      if (ts.isBlock(node)) {
        pushScope();
        let valid = true;
        for (const child of node.statements) if (!checkStatement(child)) valid = false;
        popScope();
        return valid;
      }
      if (ts.isVariableStatement(node)) {
        exactModifiers(node, []);
        if (!isExactConstDeclarationList(node.declarationList)) {
          errors.add("validator: only const local bindings are allowed"); return false;
        }
        let valid = true;
        for (const declaration of node.declarationList.declarations) {
          const name = bindingName(declaration.name, "local");
          if (!name || !declaration.initializer) { valid = false; continue; }
          if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
            errors.add("validator: callable variables are forbidden; use a direct local FunctionDeclaration");
            valid = false;
          } else {
            if (!checkExpression(declaration.initializer)) valid = false;
            const provenance = expressionProvenance(declaration.initializer);
            if (!provenanceKinds.has(provenance)) {
              errors.add(`validator: local ${name} has unproven provenance`);
              valid = false;
            }
            setValue(name, provenance);
          }
        }
        return valid;
      }
      if (ts.isFunctionDeclaration(node)) {
        if (!node.name || localFunctions.get(node.name.text)?.node !== node
          || node.parent !== validator.body) {
          errors.add("validator: helpers must be unique direct-child FunctionDeclarations");
          return false;
        }
        return true;
      }
      if (ts.isIfStatement(node)) {
        const refinedName = absentDescriptorGuardName(node.expression);
        const expressionValid = checkExpression(node.expression);
        const branchInput = valueScopes.map((scope) => new Map(scope));
        const thenValid = checkStatement(node.thenStatement);
        valueScopes = branchInput.map((scope) => new Map(scope));
        const elseValid = !node.elseStatement || checkStatement(node.elseStatement);
        valueScopes = branchInput;
        if (expressionValid && thenValid && !node.elseStatement
          && refinedName && alwaysReturns(node.thenStatement)) {
          setResolvedValue(refinedName, "descriptor");
        }
        return expressionValid && thenValid && elseValid;
      }
      if (ts.isReturnStatement(node)) {
        const valid = checkExpression(node.expression);
        returnCollectors.at(-1)?.push(expressionProvenance(node.expression));
        return valid;
      }
      if (ts.isForOfStatement(node)) {
        const iterable = expressionProvenance(node.expression);
        const declaration = ts.isVariableDeclarationList(node.initializer)
          ? node.initializer.declarations[0] : null;
        if (node.awaitModifier || !ts.isVariableDeclarationList(node.initializer)
          || !isExactConstDeclarationList(node.initializer)
          || node.initializer.declarations.length !== 1 || !checkExpression(node.expression)
          || declaration?.initializer
          || !["ownKeyArray", "localArray"].includes(iterable)) {
          errors.add("validator: for-of requires one const binding over a proven array");
          return false;
        }
        pushScope();
        const name = bindingName(node.initializer.declarations[0].name, "for-of");
        if (name) setValue(name, iterable === "ownKeyArray" ? "key" : "scalar");
        const valid = checkStatement(node.statement);
        popScope();
        return Boolean(name) && valid;
      }
      if (ts.isEmptyStatement(node)) return true;
      errors.add(`validator: statement ${ts.SyntaxKind[node.kind]} is outside the pure grammar`);
      return false;
    };
    checkFunction = (node, parameterProvenances, root = false) => {
      exactModifiers(node, root ? [ts.SyntaxKind.ExportKeyword] : []);
      if (node.asteriskToken || node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.AsyncKeyword)) {
        errors.add("validator: async/generator functions are forbidden");
        return { valid: false, returnProvenance: "invalid" };
      }
      if (node.parameters.some((parameter) => parameter.dotDotDotToken
        || (!root && parameter.initializer))) {
        errors.add("validator: helper rest/default parameters are forbidden");
        return { valid: false, returnProvenance: "invalid" };
      }
      pushScope();
      returnCollectors.push([]);
      let valid = true;
      for (const [index, parameter] of node.parameters.entries()) {
        exactModifiers(parameter, []);
        const name = bindingName(parameter.name, "parameter", root && index === 0);
        const provenance = parameterProvenances[index] ?? "invalid";
        if (!provenanceKinds.has(provenance)) {
          errors.add(`validator: parameter ${name ?? index} has unproven provenance`);
          valid = false;
        }
        if (name) setValue(name, provenance); else valid = false;
        if (parameter.initializer && !checkExpression(parameter.initializer)) valid = false;
      }
      if (ts.isBlock(node.body)) {
        if (!checkStatement(node.body)) valid = false;
      } else if (!checkExpression(node.body)) valid = false;
      if (ts.isBlock(node.body) && !alwaysReturns(node.body)) {
        errors.add("validator: every reachable function path must return explicitly");
        valid = false;
      }
      const returns = returnCollectors.pop();
      popScope();
      const returnProvenance = combineReturns(returns.length > 0 ? returns : ["scalar"]);
      if (!provenanceKinds.has(returnProvenance)) {
        errors.add("validator: function return paths have incompatible provenance");
        valid = false;
      }
      return {
        valid,
        returnProvenance,
      };
    };
    analyzeLocalFunction = (name, parameterProvenances) => {
      const helper = localFunctions.get(name);
      if (!helper || helper.node.parameters.length !== parameterProvenances.length) {
        errors.add(`validator: helper ${name} requires exact positional arity`);
        return { valid: false, returnProvenance: "invalid" };
      }
      const signature = parameterProvenances.join("|");
      if (helper.results.has(signature)) return helper.results.get(signature);
      if (helper.inProgress.has(signature)) {
        errors.add(`validator: recursive helper ${name} is forbidden`);
        return { valid: false, returnProvenance: "invalid" };
      }
      helper.inProgress.add(signature);
      helper.analyses += 1;
      const savedValues = valueScopes;
      const savedCallables = callableScopes;
      valueScopes = [baseValues()];
      callableScopes = [baseCallables()];
      const result = checkFunction(helper.node, parameterProvenances);
      valueScopes = savedValues;
      callableScopes = savedCallables;
      helper.inProgress.delete(signature);
      helper.results.set(signature, result);
      return result;
    };
    if (validator.parameters.length !== 1) {
      errors.add("validator: exported validator requires exactly one candidate parameter");
    }
    const rootParameter = validator.parameters[0];
    if (!rootParameter || !ts.isIdentifier(rootParameter.name) || rootParameter.name.text !== "candidate"
      || !rootParameter.initializer || !ts.isIdentifier(rootParameter.initializer)
      || rootParameter.initializer.text !== "REGIONAL_R5_AUTHORING_SPEC") {
      errors.add("validator: root must be candidate = REGIONAL_R5_AUTHORING_SPEC");
    }
    const rootResult = checkFunction(validator, ["candidate"], true);
    if (rootResult.returnProvenance !== "localArray") {
      errors.add("validator: exported validator must return a proven local scalar array on every path");
    }
    for (const [name, helper] of localFunctions) {
      if (helper.analyses === 0) errors.add(`validator: unused local helper ${name} is forbidden`);
    }
    return rootResult.valid;
  };

  let validator = null;
  let validatorSeen = false;
  const topLevelBindings = new Set(["deepFreeze", ...availableAuthorities]);
  const authorityStatements = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || statement === deepFreezeDeclarations[0]
      || ts.isEmptyStatement(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      if (validatorSeen) errors.add("top-level: authority declarations may not follow the validator");
      const exported = statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword);
      exactModifiers(statement, [ts.SyntaxKind.ExportKeyword]);
      if (!exported || !isExactConstDeclarationList(statement.declarationList)) {
        errors.add("top-level: every authority must be an exported const");
      }
      if (statement.declarationList.declarations.length !== 1) {
        errors.add("top-level: each authority requires one dedicated declaration");
      }
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          errors.add("top-level: authority names must be identifiers"); continue;
        }
        if (topLevelBindings.has(declaration.name.text)
          || declaration.name.text === "validateRegionalR5AuthoringSpec") {
          errors.add(`top-level: duplicate or reserved binding ${declaration.name.text}`);
          continue;
        }
        topLevelBindings.add(declaration.name.text);
        authorityStatements.push(declaration.name.text);
        const initializer = declaration.initializer;
        if (!initializer || !ts.isCallExpression(initializer)
          || !ts.isIdentifier(initializer.expression) || initializer.expression.text !== "deepFreeze"
          || initializer.arguments.length !== 1) {
          errors.add(`top-level:${declaration.name.text}: initializer must be exactly deepFreeze(literalData)`);
          continue;
        }
        if (checkLiteral(initializer.arguments[0], declaration.name.text)) {
          availableAuthorities.add(declaration.name.text);
        }
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement)
      && statement.name?.text === "validateRegionalR5AuthoringSpec"
      && statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) {
      exactModifiers(statement, [ts.SyntaxKind.ExportKeyword]);
      if (validator) errors.add("validator: exactly one exported validator is allowed");
      validator = statement;
      validatorSeen = true;
      topLevelBindings.add("validateRegionalR5AuthoringSpec");
      continue;
    }
    errors.add(`top-level: unsafe ${ts.SyntaxKind[statement.kind]} is forbidden`);
  }
  if (canonical(authorityStatements) !== canonical(authorityExportNames)) {
    errors.add("top-level: exact ten authority exports in canonical order are required");
  }
  if (!validator) errors.add("validator: one exported validateRegionalR5AuthoringSpec function is required");
  else checkValidator(validator);
  return [...errors];
}

const AUTHORING_SOURCE_ERRORS = [
  ...inertSourceErrors(AUTHORING_SOURCE),
  ...actualAuthoringValidatorIdentityErrors(AUTHORING_SOURCE, {
    textSha256: MANUALLY_FROZEN_VALIDATOR_TEXT_SHA256,
    astSha256: MANUALLY_FROZEN_VALIDATOR_AST_SHA256,
  }),
];
const authoring = AUTHORING_SOURCE_ERRORS.length === 0 ? await import(AUTHORING_MODULE_URL.href) : {};
const authorityTest = AUTHORING_SOURCE_ERRORS.length === 0 ? test : test.skip;

const {
  REGIONAL_R5_AUTHORING_KITS,
  REGIONAL_R5_AUTHORING_SOURCES,
  REGIONAL_R5_NORMALIZATION,
  REGIONAL_R5_PALETTES,
  REGIONAL_R5_CROPS,
  REGIONAL_R5_LITERAL_PATCHES,
  REGIONAL_R5_MECHANICS_BINDINGS,
  REGIONAL_R5_ATLAS_AUTHORING_PLANS,
  REGIONAL_R5_KEY_SCENES,
  REGIONAL_R5_AUTHORING_SPEC,
  validateRegionalR5AuthoringSpec,
} = authoring;

const KITS = [
  "worn-heartland",
  "spring-terraces",
  "dry-scrub",
  "ash-waste",
  "neutral-temperate",
];

const NEUTRAL_PALETTE_TOKEN_AUTHORITY = new Map([
  ...[
    "meadow-ledge-wide", "meadow-ledge-small", "field-boundary-ridge",
    "plain-boundary-gate", "sage-field-mass", "plain-boundary-rail", "plain-boundary-gap",
  ].map((name) => [
    `r5-regional/neutral-temperate/${name}`,
    ["sage-dark", "sage-mid", "pale-lane"],
  ]),
  ...[0, 1, 2, 3].map((ordinal) => [
    `r5-safe/neutral-temperate/broad-tree/${ordinal}`,
    ["sage-dark", "sage-mid", "blue-green"],
  ]),
  ...[0, 1, 2, 3].map((ordinal) => [
    `r5-safe/neutral-temperate/field-rock/${ordinal}`,
    ["sage-dark", "field-stone", "pale-lane"],
  ]),
  ...[0, 1, 2, 3].map((ordinal) => [
    `r5-safe/neutral-temperate/wildflower/${ordinal}`,
    ["sage-dark", "sage-mid", "wildflower"],
  ]),
]);
const ASH_WORLD_PALETTE_TOKENS = [
  "plum-ash", "charcoal", "oxidized-metal", "containment-concrete", "slag",
];
const NEUTRAL_HOME_PALETTE_TOKENS = [
  "sage-dark", "sage-mid", "blue-green", "pale-lane", "damp-verge", "field-stone",
  "wildflower", "window-amber",
];

function expectedPaletteTokens(row, family) {
  if (NEUTRAL_PALETTE_TOKEN_AUTHORITY.has(row.id)) return NEUTRAL_PALETTE_TOKEN_AUTHORITY.get(row.id);
  if (row.kit === "ash-waste" && ["safeGuideFragments", "regionalMacros"].includes(family)) {
    return ASH_WORLD_PALETTE_TOKENS;
  }
  if (row.kit === "ash-waste" && family === "homeMaterialFragments") return null;
  if (row.kit === "neutral-temperate" && family === "homeMaterialFragments") {
    return NEUTRAL_HOME_PALETTE_TOKENS;
  }
  return null;
}

const GROUND_CELL_SCHEDULES = {
  "ash-waste": [
    [["r5-regional/ash-waste/plum-ash-field", -14, -20], ["r5-regional/ash-waste/containment-dust-break", 24, 16]],
    [["r5-regional/ash-waste/plum-ash-field", -14, -19], ["r5-regional/ash-waste/containment-dust-break", 0, -8]],
    [["r5-regional/ash-waste/plum-ash-field", -21, -6], ["r5-regional/ash-waste/containment-dust-break", 24, 0]],
    [["r5-regional/ash-waste/plum-ash-field", -20, -9], ["r5-regional/ash-waste/containment-dust-break", 24, -16], ["r5-regional/ash-waste/fractured-slag-bank", -24, 24]],
    [["r5-regional/ash-waste/plum-ash-field", -14, -3], ["r5-regional/ash-waste/containment-dust-break", 0, 8], ["r5-regional/ash-waste/fractured-slag-bank", 24, -16]],
    [["r5-regional/ash-waste/plum-ash-field", -20, -11], ["r5-regional/ash-waste/containment-dust-break", 16, 16], ["r5-regional/ash-waste/fractured-slag-bank", -24, 0]],
    [["r5-regional/ash-waste/plum-ash-field", -21, -15], ["r5-regional/ash-waste/containment-dust-break", 16, -24]],
    [["r5-regional/ash-waste/plum-ash-field", -21, -17], ["r5-regional/ash-waste/containment-dust-break", 0, 24]],
  ],
  "neutral-temperate": [
    [["r5-regional/neutral-temperate/sage-field-mass", -10, -18], ["r5-regional/neutral-temperate/pale-field-break", 0, -8]],
    [["r5-regional/neutral-temperate/sage-field-mass", -2, -20], ["r5-regional/neutral-temperate/pale-field-break", 16, -8]],
    [["r5-regional/neutral-temperate/sage-field-mass", -6, -16], ["r5-regional/neutral-temperate/pale-field-break", 24, -8]],
    [["r5-regional/neutral-temperate/sage-field-mass", -7, -4], ["r5-regional/neutral-temperate/pale-field-break", 24, -16], ["r5-regional/neutral-temperate/meadow-bank-face", -24, 16]],
    [["r5-regional/neutral-temperate/sage-field-mass", -6, -7], ["r5-regional/neutral-temperate/pale-field-break", 8, -16], ["r5-regional/neutral-temperate/meadow-bank-face", -24, 16]],
    [["r5-regional/neutral-temperate/sage-field-mass", 0, -10], ["r5-regional/neutral-temperate/pale-field-break", 8, 16], ["r5-regional/neutral-temperate/meadow-bank-face", 24, -16]],
    [["r5-regional/neutral-temperate/sage-field-mass", -9, -8], ["r5-regional/neutral-temperate/pale-field-break", 0, 24]],
    [["r5-regional/neutral-temperate/sage-field-mass", -2, -3], ["r5-regional/neutral-temperate/pale-field-break", -8, -16]],
  ],
};

const FAMILY_DIGESTS = {
  safeGuideFragments: {
    aggregate: "4f66d35929e43b762ebe19f2cd63b9b052b080d32e112a48a953b0b19045b29b",
    kits: {
      "worn-heartland": "d7b6842b975c76626fdf13eaefcff08ed7f54afb631a185280eeadfff2e11267",
      "spring-terraces": "76fa4901daa8b1b49f68c79d3ae1cd111e4b1670cbc69713b710ac6dc7ff26d2",
      "dry-scrub": "5e0326d18461a72f0386f1ab732e1f60a88e7b8243f4c72e30f285acf5dab8f3",
      "ash-waste": "c7bd2753556e30c3a0d67f59a24774c70f80ff2095f5e07f971358889555f275",
      "neutral-temperate": "db001dd3fceb84c7282474c7a0816cdf014b0fb49dbd9cc69002fecc784a9026",
    },
  },
  regionalMacros: {
    aggregate: "40cdf417d8d1f16afb24106cd86067cd199a97e885cc610ca2846f806c34b4f2",
    kits: {
      "worn-heartland": "16b09514bf5b1e5914823dc19c6c6a49cd62219f19214c5a335dd1e30e93fa63",
      "spring-terraces": "bf68585f0f3f1dcc031f9da2ee244e498eb409ca6be4b74c7b39bff74138e276",
      "dry-scrub": "150c93ff5d3a8aa8f02496e3b8771a962636277cb241d54ce45f877d0a781f36",
      "ash-waste": "7f06af7f63b8df6dc020dcfff1525adc9c2a074afdba7f903fc45d38bf5cc2da",
      "neutral-temperate": "bfd8bf24dc70ff4b044961380a0ab192fb2bf8c57495f02fb52ab5c1ecc370c2",
    },
  },
  homeMaterialFragments: {
    aggregate: "6678152437e82a7f4e7684cf86c56b276188594dc059a280449262fa6c40acc2",
    kits: {
      "worn-heartland": "acba61bee0d1633e44eb3a2e71b588861d60c1760ebb5188e2c0aad215df64df",
      "spring-terraces": "57e2f591cccefb5ac9da1d81d70ed08615bc226336ac7144a3dfe4394599b227",
      "dry-scrub": "abe861add0b59cb26f0aa20d7fae062ebc6dd2f76b839b1efe31a5f64c15a299",
      "ash-waste": "4daeb15b68c5fabc25c4ab344d97faa6f66fa58470363f17c75f7e23e0dd6e66",
      "neutral-temperate": "9ed77cbc612bb3eb79f18e1991a6f0614cc38d728b227fa6c917314bc0f5cda7",
    },
  },
  forbiddenGuideCrops: "1893fb15fffaf631cd16c87a3999efbaf106a1db23c63c550a145be8462ef4ec",
  legalAliases: "93b3c4a7b55c77ea1de3c2e6e1f3ee24ad484c26688b7740ed8298aa45519ed1",
  palettes: {
    aggregate: "0e71bc173c1e75af44753dfcc3befde2496198ca557e695cb991e62932754e29",
    kits: {
      "worn-heartland": "74b745ff27350ad7a9d0238bce2804b7197f471f92c6d89bce25104b78c29176",
      "spring-terraces": "664bc8bec4884ae2167237985575cc9abab6dea446a4ac76b81dfe194c867770",
      "dry-scrub": "40e765e2671a6eb7b2c35cec9415f3c08e907db98c873bb752b36c135a7e8749",
      "ash-waste": "3666b491729e7a4de680a28addeed482f9551be6ceae1886eaaa53eac13137fe",
      "neutral-temperate": "0a9bbb3f03a7c60dc1ce20a4d9917271c3939add08f66706e19ca175bdb644f1",
    },
  },
  patches: "e494d6447664deeecfd4ed67180850b213678239c2b26f581903fa2203dd4709",
};

const R4_DIGESTS = {
  scenes: {
    aggregate: "246ba8473f139790ccc5d9e21a12affc1b9a4bc4a5aab0171c87aca86c95014f",
    kits: {
      "worn-heartland": "83a3a59282f25cd8a3d1ac9a6b4b42350151095cfde87e14b8464fed23b6e30c",
      "spring-terraces": "e049521adb7417f38a3884177bb9f65ada27699bc22878d0cbaea90faa474b49",
      "dry-scrub": "6c7e5f5c3a6eb5419333a38f40d335c31cf000c40d9ee38ebc86bcb10366a065",
      "ash-waste": "091a8e04e8b6fcaceb5666c0358aebbfa15a76574cfff00a4e7462507929f57d",
      "neutral-temperate": "5485ba39fe6041295c198592ca6068441569c87d298adf5ac3799a1a48f43d4c",
    },
  },
  recipes: {
    aggregate: "e105bb97ea2647fdb80caa8772fb06fb0271f891255cb4c44561369f0007a781",
    kits: {
      "worn-heartland": "d9a04e4076983714cca3bab96e16ed22a5cce2b43e196b32216f58ee96825b34",
      "spring-terraces": "2471cce41ab0b87a5450f4862215372d12a097cd8fb718ad4c959f168a5c840e",
      "dry-scrub": "cc4b0074aae0358348a53ec8dd589137089db4842e9cd9fb6845cd899aee5c3e",
      "ash-waste": "579f4bc5c97a877ea8858a712c854714eea51ce922dee80e5be288c3f725d984",
      "neutral-temperate": "99f2cc084321a899b94e6585bf714236759083208c9fb93b0b3d4a6e30a8f276",
    },
  },
};

const HOME_ACTOR_SOURCE_HASHES = {
  "worn-heartland": [
    "7ce0385755bdccf76d92324bdec1d1017d26a94c3dd68d8532ea16ecb1e3ab4b",
    "e8c3f933802dc3f15378ef8f6be3a7ecd8d8865685ed703b5dc7588023680932",
    "3856690a75ba888682c6311984f5352fca663bec867a82650f171ae8c5d14886",
  ],
  "spring-terraces": [
    "4f827b042cb4fa7164fe43bc9fedbc518ca2a3fd6799914fe78746ee32a2a14c",
    "a2d0f5765ba20b87e12a2a90b850a0f3e2619340d492ea32b328e39edb45949a",
    "af7661bcbf2ccb5f2f0a33d91f819571024251580ac84856c07716727c507208",
  ],
  "dry-scrub": [
    "17073e2d69cf1e8cc6b1252178881aa68c0865fb80a8fe7c66cdd492ff40c57e",
    "f368afac4b084e01c1f0aec6dc51eb3c8f75c9550ef5b09520b36bf405f58de3",
    "020922db3524c76ad2c9a48698e2b33cced0d93b9b85acbfc25eaacfc3b7b331",
  ],
  "ash-waste": [
    "0287d57855cae898155247f9cf2dad0fa323290a3dbe4d99ef3b134994c5e92f",
    "2737c83a4b759528747d322eb48fee77897c7e70d7a023cd3f2b76b40c68b440",
    "acd11f653df376f77a63eac4519a19b309dd1d99034f853a2d67ff378d61e039",
  ],
  "neutral-temperate": [
    "f1f834a02ffeef895addeab4c37baada636cf9a95dcd29235ba2c67a5e85cf4f",
    "3f8e6db9932d08b1b85dc11ed746b5119d373048d5855897a6ebe4dcddd1e652",
    "1038a72c985653abef13ac60705f9e227cd606df7eb897cd86ea9974b37a0738",
  ],
};

const LITERAL_CELL_PLAN_DIGESTS = {
  terrain: {
    aggregate: "ff5ac99e09ef549c633d8ba1be7a373b7399985b6230712fc4d5c92923844bae",
    kits: {
      "worn-heartland": "87ecac67d669abb37792e5ab040d20626eaaeee311621265b5392446feb1d698",
      "spring-terraces": "aaee139d8d1b175aa312aa92431798978898c853b7f7a89bf09ed2d9f13024e8",
      "dry-scrub": "b308154a60a9cbd78b989b22acb9cf39a63ccb79e6ccac969eefe0b240916ec5",
      "ash-waste": "87e8fd826fb335d70dd3ae8d70d0198b871281efe6136b3b284882d59f8a350f",
      "neutral-temperate": "ed245d6ee4e2f83167656658d079764fb5394c4488141b6c02e6bc11a3e673b7",
    },
  },
  scenery: {
    aggregate: "a35b8d897d8e7650ac0450382802d6d3a356658c80f19146942886df43e41cdd",
    kits: {
      "worn-heartland": "b8a5aa06a9f743cac73f8b67a2de1d689c686b84060814ca87c2454faa3ecfcf",
      "spring-terraces": "a0b5655d1de26d92e6ea2a048177413cf31872e2ac01a2d6ec55149e27f815cc",
      "dry-scrub": "56b419f407754dd0dbdd77488712cd072c8e6acedaf651b69a2e450eb196f553",
      "ash-waste": "a32999acc57da837abd5c4621e544ca8690c30d4aad0c9fa3f92a491cbd7ee2c",
      "neutral-temperate": "b497cb8fb7c236bd6b1d492c59e56eb046bd062adfb6ff70fd309b003c4f6c68",
    },
  },
  landmarks: {
    aggregate: "7634a19b9744f2dc21c7810bce948194edfce0dd58fa4ac0f77bb798e6e7b59f",
    kits: {
      "worn-heartland": "68bc4c5a0dec44a09bdee7433a9c4c8d376cb00ba0aed0fbf5a3ebc16faba471",
      "spring-terraces": "f29926dec9a0587523200fbf833702c0014c5060bab64731de9fb9fe70e60adf",
      "dry-scrub": "83502e1d00bcd09503936031a2e20aaf518706b90c1984cbb8916f94f7f21c12",
      "ash-waste": "5309a106eeea3a9f02bb96ab19faeea8c7c206d87a538e6bff204c48af708cf6",
      "neutral-temperate": "b359ca24239609b0bdd5aa7233b2f7dc93ffbbafb92b16a0b9d57b96448db03b",
    },
  },
  yards: {
    aggregate: "f99a8234d268edd52619b24e9757bca0c7e014cf1fd1c6a019927064676e69a8",
    kits: {
      "worn-heartland": "92328362ad4b665d102ff530a1934359006a324788944562b5e4aae69fba9feb",
      "spring-terraces": "c46ce2a44b0b66412ca002b413b7099d323c995b5ebe3ba988e3e05cf01da8c6",
      "dry-scrub": "332b160703903a3532f29b6b2df0d37871c60691871ce57c3ad57dfbc8bd997b",
      "ash-waste": "c0321e81e051adeb5772689c5602f12fccf552089c5a8a140918bb6d3d0411a3",
      "neutral-temperate": "b0bb83ad4987aad2ad6d30653ec0c72c9bfd6bd4a85bc7ad201b1ab3b7070f41",
    },
  },
};

const SCENERY_STYLE_ORDER = [
  "joined-anchor-a", "joined-anchor-b", "joined-anchor-c", "joined-anchor-d",
  "joined-left-a", "joined-right-a", "joined-top-a", "joined-bottom-a",
  "joined-left-b", "joined-right-b", "joined-top-b", "joined-bottom-b",
  "cluster-close-a", "cluster-close-b", "cluster-open-a", "cluster-open-b",
  "boundary-west-a", "boundary-east-a", "boundary-north-a", "boundary-south-a",
  "route-return-west", "route-return-east", "route-return-north", "route-return-south",
  "yard-join-west", "yard-join-east", "yard-join-north", "yard-join-south",
  "sparse-near", "sparse-mid", "dense-near", "dense-mid",
];

const SCENERY_KIND_ORDER = {
  "worn-heartland": ["old-oak", "worn-stone", "faded-flower", "fallen-fence"],
  "spring-terraces": ["terrace-rock", "willow", "spring-flower", "reed-bed"],
  "dry-scrub": ["sun-rock", "deadwood", "dry-grass", "thorn"],
  "ash-waste": ["charred-trunk", "slag-rock", "ash-pile", "bone-stone"],
  "neutral-temperate": ["broad-tree", "field-rock", "wildflower", "soft-grass"],
};

const ASH_PATCH_ROLES = {
  "ash:pylon-lattice-a": "pylon-lattice",
  "ash:pylon-lattice-b": "pylon-lattice",
  "ash:snapped-cross-member": "pylon-lattice",
  "ash:bent-rebar": "pylon-lattice",
  "ash:cable-run-a": "cable-run",
  "ash:cable-run-b": "cable-run",
  "ash:containment-relief": "containment-relief",
  "ash:world-sealed-filter-box": "containment-relief",
  "ash:sealed-filter-box": "containment-relief",
  "ash:service-conduit": "service-slab",
  "ash:scene-cold-ground-mass": "ash-ground-foundation",
  "ash:scene-containment-network": "ash-contamination-network",
};

const LITERAL_PATCH_ROLE_ORDER = [
  "pylon-lattice", "cable-run", "containment-relief", "service-slab",
  "ash-containment-basin", "ash-scrubber-module", "ash-cask-bank", "ash-hazard-panel",
  "neutral-lane-topology", "neutral-pond-water-topology", "neutral-pond-verge-topology",
  "neutral-joined-grove", "neutral-stone-boundary", "neutral-hedgerow-verge",
  "neutral-pond-foundation", "neutral-lane-foundation",
  "ash-ground-material", "ash-route-topology", "ash-runoff-topology", "ash-trench-topology",
  "ash-soil-material", "neutral-meadow-material", "ash-ground-foundation",
  "neutral-ground-foundation", "ash-contamination-network", "neutral-cluster-foundation",
  "spring-ground-foundation", "spring-connected-basin", "spring-wet-yard",
  "spring-ground-material", "spring-route-topology", "spring-water-topology",
  "spring-shore-topology", "spring-wet-soil", "spring-landmark-anatomy",
  "spring-scene-macro", "spring-route-surface", "spring-support-anatomy",
  "spring-route-tread", "spring-yard-overlay", "spring-home-context",
  "dry-ground-foundation", "dry-stratified-basin", "dry-open-thorn-passage",
  "dry-home-windbreak", "dry-permanent-home-shell", "dry-threshold-foreground",
  "dry-landmark-anatomy",
  "worn-ground-foundation", "worn-oak-root-foundation",
  "worn-worked-garden-foundation", "worn-trampled-lane",
  "worn-home-yard-history", "worn-landmark-anatomy",
];

const LITERAL_PATCH_ROLE_BINDINGS_DIGEST = "bcaa41e46159b154ef671af985fbdc8118214714c661ae83fb661d009583c1ab";
const LITERAL_PATCH_META_DIGEST = "f933c98ddfa4f851fa9a3a8ad2206d139ec75b09e40059ca2da89a5e42c55db8";
const LITERAL_PATCH_PALETTE_DIGEST_COUNTS = {
  "34b5b77b42ba6a0fb27c2d32d132ab34e29035c6298d5bfed87709b9c794f84e": 13,
  "410225db6126d943a1a06d072e1e048db6082b8b6b12754328b60a63fc039ebf": 72,
  "464159d55a45889f3dfe986eb4fde10c948facbc0ee3f20566de610128bfb247": 17,
  "5054d77cb4eb685d0dabe2e5ef509b646ead5ecc5662bcce329eeda5177a4843": 9,
  "52690e9ab7e0960df023074616c592c98ff5a72c10a6031f9265456d40d7ca22": 3,
  "64f0d7b01bc6dceab4f8bda2a93d327928a5853f4d44855c147f69c5a4c83e98": 20,
  "65a0d24cb3ba9f44dfe1b6312ff75d17b9096c8242b8df7d3bf0106dcdb06096": 54,
  "ef5e977fd0719a8e61e0b88d8c8d66f952aaa3b235531e3edb34d7a2b1997629": 14,
};

const LITERAL_PATCH_ROLE_BINDINGS = {
  "pylon-lattice": [
    "ash:pylon-lattice-a", "ash:pylon-lattice-b", "ash:snapped-cross-member", "ash:bent-rebar",
  ],
  "cable-run": ["ash:cable-run-a", "ash:cable-run-b"],
  "containment-relief": [
    "ash:containment-relief", "ash:sealed-filter-box", "ash:home-sealed-filter-box",
  ],
  "service-slab": ["ash:service-conduit"],
  "ash-containment-basin": [
    "ash:landmark-containment-basin-a", "ash:landmark-containment-basin-b",
  ],
  "ash-scrubber-module": ["ash:landmark-scrubber-a", "ash:landmark-scrubber-b"],
  "ash-cask-bank": ["ash:landmark-cask-bank-a", "ash:landmark-cask-bank-b"],
  "ash-hazard-panel": ["ash:landmark-hazard-panel-a", "ash:landmark-hazard-panel-b"],
  "neutral-lane-topology": [
    "neutral:pale-lane-ew", "neutral:pale-lane-ns", "neutral:pale-lane-ne", "neutral:pale-lane-es",
    "neutral:pale-lane-sw", "neutral:pale-lane-nw", "neutral:pale-lane-nesw", "neutral:pale-lane-none",
  ],
  "neutral-pond-water-topology": [
    "neutral:pond-water-ew", "neutral:pond-water-ns", "neutral:pond-water-ne", "neutral:pond-water-es",
    "neutral:pond-water-sw", "neutral:pond-water-nw", "neutral:pond-water-nesw", "neutral:pond-water-none",
  ],
  "neutral-pond-verge-topology": [
    "neutral:pond-verge-ew", "neutral:pond-verge-ns", "neutral:pond-verge-ne", "neutral:pond-verge-es",
    "neutral:pond-verge-sw", "neutral:pond-verge-nw", "neutral:pond-verge-nesw", "neutral:pond-verge-none",
  ],
  "neutral-joined-grove": [
    "neutral:landmark-joined-grove-a", "neutral:landmark-pond-frame-grove",
    "neutral:landmark-joined-grove-b", "neutral:scene-grove-understory",
  ],
  "neutral-stone-boundary": [
    "neutral:landmark-stone-boundary-a", "neutral:landmark-stone-boundary-b",
    "neutral:scene-stone-wall",
  ],
  "neutral-hedgerow-verge": [
    "neutral:landmark-hedgerow-verge-a", "neutral:landmark-hedgerow-verge-b",
    "neutral:landmark-hedgerow-verge-c",
  ],
  "neutral-pond-foundation": ["neutral:scene-pond-foundation"],
  "neutral-lane-foundation": ["neutral:scene-pale-lane"],
};

const LITERAL_PATCH_META = [
  ["ash:pylon-lattice-a", "ash-waste", 12, 88, "005c4dc9728f743fdd8f308a12c03fd2bc0442d6024891031fb32aae6e36642e"],
  ["ash:pylon-lattice-b", "ash-waste", 12, 88, "ca8bb385b3c9d78f8a2c6607319177632bd3b75c6d9318c149188d3fb77bdc8b"],
  ["ash:snapped-cross-member", "ash-waste", 72, 8, "f246a1ba4903e50d988dbb2d9e46b0e9c891bcf00f8200efa7390ba76ada56ec"],
  ["ash:cable-run-a", "ash-waste", 64, 4, "d1c8dca9ec9682c213a1b25f428304bb03677960203430ca3fb352880a254f0e"],
  ["ash:cable-run-b", "ash-waste", 48, 4, "d10b962f9f7bc1f08fc1fd2b06d77a9a74b77215296facdebe033045bfc991c3"],
  ["ash:containment-relief", "ash-waste", 28, 28, "85c7a426a81099bde1ab328f9d162facc3736ad33d67e35eaff526faa40284e2"],
  ["ash:service-conduit", "ash-waste", 72, 10, "f90e59acdd8797aa84517f87c237624a203e24cdcbd6aef4a20db6da079bbfd1"],
  ["ash:sealed-filter-box", "ash-waste", 16, 16, "1b1afcc04ff73405f076bc764d2767cea37ffe9c917488c47c5ca898e2901368"],
  ["ash:bent-rebar", "ash-waste", 64, 8, "c6a915b47e01176063c4ae527d7516922d92c3c29568b904dff4e7e3062c1135"],
  ["ash:home-sealed-filter-box", "ash-waste", 16, 16, "e6e0085ea6f5ddce5ad953d83ec851a4f90230435538cb33a6f3e88400db7659"],
  ["ash:landmark-containment-basin-a", "ash-waste", 128, 128, "2ebcde2f5e534e896ca6199744b68c6cbcd2a06509f38fe00963fd1a37c20505"],
  ["ash:landmark-containment-basin-b", "ash-waste", 128, 128, "e55065804893c50f5cbc9be4a144d9108a067b3044133b0d139cec493e12ef07"],
  ["ash:landmark-scrubber-a", "ash-waste", 128, 128, "2a641c7b00b92c16a3a328d09e35f3b23f29e9c1b7b6b7887c2ecdd773ec608c"],
  ["ash:landmark-scrubber-b", "ash-waste", 128, 128, "e55ea7d8197fb905e7d1f7e7a8fddeadf870558785949305fecb34a45c71757a"],
  ["ash:landmark-cask-bank-a", "ash-waste", 128, 128, "51a2a88cb0281ff1c7d9caff067a002b0fd75907832683e827d8153a9dc00750"],
  ["ash:landmark-cask-bank-b", "ash-waste", 128, 128, "d473656d6cf0dda7a9f68ce6d9789e4dde8b3ae1e252a49047c33c29916582ec"],
  ["ash:landmark-hazard-panel-a", "ash-waste", 128, 128, "fc4970048396e5712716c245be703e8c873d574542d677fe7991c7f97d31ae2a"],
  ["ash:landmark-hazard-panel-b", "ash-waste", 128, 128, "b7cec05d4392398f19335c32b3d8d7655949ce069a393467ce8c116f96c29162"],
  ["neutral:pale-lane-ew", "neutral-temperate", 32, 32, "d607461ba394a213b4e6b386ed2f8a45540f0c142f5b6f09e6ce8db773f1a68e"],
  ["neutral:pale-lane-ns", "neutral-temperate", 32, 32, "18f02f5005986086c98d3dfa72e5bf81ebc284c20f2737a0ca87b7e1b3758f1d"],
  ["neutral:pale-lane-ne", "neutral-temperate", 32, 32, "a5f45382707d0fdebb898992be20107ad8d0b330eb7561d425fcb35d1c3e00ed"],
  ["neutral:pale-lane-es", "neutral-temperate", 32, 32, "c73e50e7445af27ceeb33ce3bebea6775e116d5ae0eb81d78f486ddee1b4c377"],
  ["neutral:pale-lane-sw", "neutral-temperate", 32, 32, "942fac343622398b3cbb7552115ff8f1fc1573e6162ed1837a458ea3ca440806"],
  ["neutral:pale-lane-nw", "neutral-temperate", 32, 32, "1bab7689877f6aa7611c7ad5353aafcb38a32caa4982aaa747f83df0d0270aec"],
  ["neutral:pale-lane-nesw", "neutral-temperate", 32, 32, "46d1e26c7a995c87d8d51e7c227bff551cbd90169627813d4f5b6e64dcf816c8"],
  ["neutral:pale-lane-none", "neutral-temperate", 32, 32, "c42535ab076a31832bcd4afd9353d6ab1c14221f2a29cb8ddc898825bd299f76"],
  ["neutral:pond-water-ew", "neutral-temperate", 32, 32, "bb0e4cba275b8cc2d3d3280a1bfaa16f22aea6ec931ea521debe4d651b91b5f6"],
  ["neutral:pond-water-ns", "neutral-temperate", 32, 32, "a9848233958f61db71afa415ec541a3a5d510a0d480b02e00639ba801bbfbe30"],
  ["neutral:pond-water-ne", "neutral-temperate", 32, 32, "b3d90faff793e25369a2b9cf169ad685ead82683ae96b180d7e3c34556ebecb6"],
  ["neutral:pond-water-es", "neutral-temperate", 32, 32, "19efd01de5270bc1565cf7bbbfa5513dcadf109b4e34a5fff3f5d3a7daf90bf5"],
  ["neutral:pond-water-sw", "neutral-temperate", 32, 32, "04ca5eea73f4f234bdee2aa6f0b7b155624347b0743e19670f563098e1302db0"],
  ["neutral:pond-water-nw", "neutral-temperate", 32, 32, "a3a60467988004b6fbc3df5afadc75d09701b9845d56027d94ed6ea2a7e430a7"],
  ["neutral:pond-water-nesw", "neutral-temperate", 32, 32, "aa7c50a7a8d38cdfb8babc8d3b9fd327561d594a16fb574978dcf6bf3adcd03e"],
  ["neutral:pond-water-none", "neutral-temperate", 32, 32, "5a426b67323eeae51bf24bcf73b56a762102608815f9e260271faa29b2bc218d"],
  ["neutral:pond-verge-ew", "neutral-temperate", 32, 32, "b85ec27bdb4164c84a59528a63ec83c23d287186d1cfba8c62cbc7208bcf8ffe"],
  ["neutral:pond-verge-ns", "neutral-temperate", 32, 32, "54a6c9f2a06e25333066b0cecbc79bbe5f32a24ce423c053055876ee30eee722"],
  ["neutral:pond-verge-ne", "neutral-temperate", 32, 32, "6e84cdc627c3c0bbdf02c9d7796344fd8f9807735414cb80f1c1e994c75ede0b"],
  ["neutral:pond-verge-es", "neutral-temperate", 32, 32, "6bf9648dd25d0b7ae75a13d48386b5d66268141b9e2ece2472d74749916dc7a1"],
  ["neutral:pond-verge-sw", "neutral-temperate", 32, 32, "f7aef839ff519c02c44e06240ae1495666de34cf53929f116da8001afa7837f3"],
  ["neutral:pond-verge-nw", "neutral-temperate", 32, 32, "439b6edd5b89c1b9cb2a6c221dc477f58491ec7e35bac97bc7f31d9334bc3be0"],
  ["neutral:pond-verge-nesw", "neutral-temperate", 32, 32, "21d8bad8b915db68b7db6d43562b46d5e330189af1a78fcd569088d0e3f0241f"],
  ["neutral:pond-verge-none", "neutral-temperate", 32, 32, "8a10bdc9d22d3fe34591a1e587bcb0f6d1f7ce9bbec5dd5ce72d8b5a8d3e3ccd"],
  ["neutral:landmark-joined-grove-a", "neutral-temperate", 128, 128, "7a959d4c66106aa089add3160c66f15cbba7b179689b132294553c70a29265e3"],
  ["neutral:landmark-pond-frame-grove", "neutral-temperate", 128, 128, "7c805df8cd47020fbee9aa37c8d204ed0f8cf0d13af5244723f95e3f09f699f0"],
  ["neutral:landmark-joined-grove-b", "neutral-temperate", 128, 128, "1d9733efb5f9f0ea869845c7c9f81f4d134557bfb0f8e4818230acd0004b1748"],
  ["neutral:landmark-stone-boundary-a", "neutral-temperate", 128, 128, "080875258df1f8d8a56b65630bfbab301e16abd3a239a8e607fcaac211f1e832"],
  ["neutral:landmark-stone-boundary-b", "neutral-temperate", 128, 128, "947b988c9c21a62bf8fe5c8e7a6f890ebe29997acbfe3e133466d62de2e68cf7"],
  ["neutral:landmark-hedgerow-verge-a", "neutral-temperate", 128, 128, "8eeb48b84c4a83b0bacf65d1c4a63e745431b3395d22059ef7ebfa8186dfee0b"],
  ["neutral:landmark-hedgerow-verge-b", "neutral-temperate", 128, 128, "861f4c18105e3e55f5c8ce37b3e80dacbc7db94dae683160a9ab5fec9cd99c4b"],
  ["neutral:landmark-hedgerow-verge-c", "neutral-temperate", 128, 128, "0a597b1ce2dfd83590e8e8f1915594134b636a2cf94294d7022b206484892dd0"],
  ["neutral:scene-stone-wall", "neutral-temperate", 320, 32, "589dd250402d64d3c99761485d7b86dab186b30a6815a1c7bdbb0a83c3ed553f"],
  ["neutral:scene-grove-understory", "neutral-temperate", 192, 48, "fb43829c0204e134798e2258b42b017920a264c60e301a8ffc81cc3ac109fadf"],
  ["neutral:scene-pond-foundation", "neutral-temperate", 128, 96, "85e79a61d24a695a5cb65cd02d81d051dab81cac1a3121fbb8459769af3574fe"],
  ["neutral:scene-pale-lane", "neutral-temperate", 416, 512, "6d62faa62a2552cde2b15e1cd064c6682821e12f8ccfcba73ea3f3ea7585dfe5"],
];

const LITERAL_PATCH_PALETTE_GROUPS = [
  {
    ids: LITERAL_PATCH_META.slice(0, 9).map(([id]) => id)
      .concat(LITERAL_PATCH_META.slice(10, 18).map(([id]) => id)),
    palette: {
      "0": "transparent", "1": "outline", "2": "charcoal", "3": "plum-ash",
      "4": "containment-concrete", "5": "oxidized-metal", "6": "slag",
      "7": "warning-ochre", "8": "hazard-lime",
    },
  },
  {
    ids: ["ash:home-sealed-filter-box"],
    palette: {
      "0": "transparent", "1": "outline", "2": "charcoal", "3": "plum-ash",
      "4": "containment-concrete", "5": "coral-fissure", "6": "oxidized-metal", "7": "vent-warm",
    },
  },
  {
    ids: [
      ...LITERAL_PATCH_ROLE_BINDINGS["neutral-lane-topology"], "neutral:scene-pale-lane",
    ],
    palette: {
      "0": "transparent", "1": "outline", "2": "sage-dark", "3": "sage-mid",
      "4": "pale-lane", "5": "damp-verge", "6": "field-stone",
    },
  },
  {
    ids: [
      ...LITERAL_PATCH_ROLE_BINDINGS["neutral-pond-water-topology"],
      ...LITERAL_PATCH_ROLE_BINDINGS["neutral-pond-verge-topology"],
      "neutral:scene-pond-foundation",
    ],
    palette: {
      "0": "transparent", "1": "outline", "2": "pond-deep", "3": "pond-light",
      "4": "blue-green", "5": "damp-verge",
    },
  },
  {
    ids: [
      ...LITERAL_PATCH_ROLE_BINDINGS["neutral-joined-grove"].filter((id) => id !== "neutral:scene-grove-understory"),
      ...LITERAL_PATCH_ROLE_BINDINGS["neutral-stone-boundary"].filter((id) => id !== "neutral:scene-stone-wall"),
      ...LITERAL_PATCH_ROLE_BINDINGS["neutral-hedgerow-verge"],
      "neutral:scene-stone-wall", "neutral:scene-grove-understory",
    ],
    palette: {
      "0": "transparent", "1": "outline", "2": "sage-dark", "3": "sage-mid",
      "4": "blue-green", "5": "pale-lane", "6": "damp-verge", "7": "field-stone",
      "8": "stone-shadow", "9": "hedge-deep", "a": "meadow-timber", "b": "wildflower",
    },
  },
];

const LITERAL_REPLACED_CROP_DESTINATION_IDS = [
  "r5-regional/worn-heartland/cliff-rooted",
  "r5-regional/worn-heartland/cliff-small",
  "r5-regional/worn-heartland/cliff-wide",
  "r5-regional/spring-terraces/mint-field-mass",
  "r5-regional/spring-terraces/mineral-field-break",
  "r5-regional/spring-terraces/shallow-basin-bank",
  "r5-regional/spring-terraces/runnel-straight",
  "r5-regional/spring-terraces/pool-basin",
  "r5-regional/spring-terraces/shallow-junction",
  "r5-regional/spring-terraces/wet-ledge-wide",
  "r5-regional/spring-terraces/wet-ledge-small",
  "r5-regional/spring-terraces/wet-ledge-bank",
  "r5-regional/spring-terraces/basin-macro-band",
  "r5-regional/dry-scrub/sun-ledge-wide",
  "r5-regional/dry-scrub/sun-ledge-small",
  "r5-regional/dry-scrub/wind-cut-ridge",
  "r5-regional/ash-waste/slag-ledge-wide",
  "r5-regional/ash-waste/slag-ledge-small",
  "r5-regional/ash-waste/containment-ridge",
  "r5-regional/ash-waste/fracture-macro-band",
  "r5-regional/neutral-temperate/pale-lane-straight",
  "r5-regional/neutral-temperate/field-stone-cluster",
  "r5-regional/neutral-temperate/pale-lane-junction",
  "r5-regional/neutral-temperate/meadow-ledge-wide",
  "r5-regional/neutral-temperate/meadow-ledge-small",
  "r5-regional/neutral-temperate/field-boundary-ridge",
  "r5-home/spring-terraces/yard-wall-section",
  "r5-home/spring-terraces/wall-intact",
  "r5-home/spring-terraces/roof-intact",
  "r5-home/spring-terraces/hearth-lit-a",
  "r5-home/spring-terraces/hearth-lit-b",
  "r5-home/spring-terraces/salvaged-chimney-stack",
];

const ASH_ROLE_SCENE_BINDINGS = {
  "pylon-lattice": { clusterId: "ash-pylon-service", routeRelation: "service-route-adjacent" },
  "cable-run": { clusterId: "ash-pylon-service", routeRelation: "service-route-adjacent" },
  "containment-relief": { clusterId: "ash-pylon-service", routeRelation: "service-route-adjacent" },
  "service-slab": { clusterId: "ash-pylon-north", routeRelation: "service-route-junction" },
  "ash-ground-foundation": { clusterId: "ash-pylon-service", routeRelation: "ground-foundation" },
  "ash-contamination-network": { clusterId: "ash-pylon-service", routeRelation: "cluster-foundation" },
};

const KEY_SCENE_LANDMARKS = {
  "worn-heartland": [
    [0,"worn-heartland:broad-crown",128,0,"worn-oak-west","old-oak-anchor"],
    [1,"worn-heartland:split-crown",198,8,"worn-oak-home","homestead-frame"],
    [2,"worn-heartland:wind-worn-crown",172,24,"worn-oak-north","wind-worn-frame"],
    [3,"worn-heartland:open-south-gap",118,142,"worn-garden-gate","garden-route-gate"],
    [4,"worn-heartland:open-east-gap",228,142,"worn-garden-west","garden-east-return"],
    [5,"worn-heartland:diagonal-reclaimed-boundary",270,210,"worn-boundary-south","reclaimed-diagonal"],
    [6,"worn-heartland:left-right-shoulder",384,340,"worn-route-shoulder","eroded-route-band"],
    [7,"worn-heartland:top-bottom-shoulder",304,232,"worn-route-south","trampled-north-south"],
  ],
  "spring-terraces": [
    [0,"spring-terraces:curved-pool-rim",112,344,"spring-basin-west","connected-basin"],
    [1,"spring-terraces:stepped-pool-rim",24,200,"spring-upper-basin","connected-outlet"],
    [2,"spring-terraces:two-wet-stone-levels",272,228,"spring-upper-terrace","wet-stone-risers"],
    [3,"spring-terraces:broken-sight-gap",224,336,"spring-reed-outlet","shore-reed-bank"],
    [4,"spring-terraces:willow-left",8,328,"spring-willow-bank","bank-willow"],
    [5,"spring-terraces:willow-right",472,216,"spring-willow-east","bank-willow-return"],
    [6,"spring-terraces:north-south-planks",360,288,"spring-boardwalk-north","wet-dry-north-south"],
    [7,"spring-terraces:east-west-planks",88,232,"spring-boardwalk-crossing","wet-dry-crossing"],
  ],
  "dry-scrub": [
    [0,"dry-scrub:low-stepped-ridge",600,128,"dry-ridge-west","sandstone-west"],
    [1,"dry-scrub:split-outcrop",576,152,"dry-ridge-home","yard-windbreak-return"],
    [2,"dry-scrub:wind-cut-diagonal-ridge",512,56,"dry-outcrop-east","track-bend-outcrop"],
    [3,"dry-scrub:crescent-open-south",352,120,"dry-tangle-pass","thorn-opening"],
    [4,"dry-scrub:crescent-open-side",312,280,"dry-tangle-west","thorn-east-opening"],
    [5,"dry-scrub:horizontal-wind",296,240,"dry-wind-centre","horizontal-scrub"],
    [6,"dry-scrub:rising-diagonal-wind",416,208,"dry-scrub-band","one-direction-scrub"],
    [7,"dry-scrub:falling-diagonal-wind",592,232,"dry-wind-southwest","falling-scrub"],
  ],
  "ash-waste": [
    [0,"ash-waste:offset-crater-branching-fault",64,288,"ash-crater-edge","irradiated-crater"],
    [1,"ash-waste:split-crater-service-fracture",272,104,"ash-crater-north","split-service-fracture"],
    [2,"ash-waste:snapped-cross-member",288,140,"ash-pylon-service","containment-pylon"],
    [3,"ash-waste:leaning-fractured-lattice",160,32,"ash-pylon-north","leaning-containment-pylon"],
    [4,"ash-waste:slag-ridge-char-stumps",504,160,"ash-slag-north","charred-ridge"],
    [5,"ash-waste:industrial-aggregate-ridge",416,216,"ash-slag-crossing","slag-rebar-ridge"],
    [6,"ash-waste:narrow-directional-fan",536,344,"ash-debris-east","directional-debris"],
    [7,"ash-waste:joined-containment-debris-fan",544,264,"ash-shelter-debris","joined-containment-debris"],
  ],
  "neutral-temperate": [
    [0,"neutral-temperate:broad-crown",192,16,"neutral-grove-north","airy-grove-frame"],
    [1,"neutral-temperate:paired-trees",40,80,"neutral-grove-west","paired-grove"],
    [2,"neutral-temperate:sparse-open-grove",384,272,"neutral-grove-home","meadow-home-frame"],
    [3,"neutral-temperate:boundary-open-south",128,160,"neutral-wall-gate","lane-wall-gate"],
    [4,"neutral-temperate:boundary-open-side",408,192,"neutral-wall-east","field-wall-side-gap"],
    [5,"neutral-temperate:left-verge",112,136,"neutral-verge-west","left-wildflower-verge"],
    [6,"neutral-temperate:right-verge",312,344,"neutral-verge-south","right-wildflower-verge"],
    [7,"neutral-temperate:diagonal-verge",288,192,"neutral-lane-verge","damp-verge-return"],
  ],
};

const KEY_SCENE_MACRO_ANCHORS = {
  "worn-heartland": [[-12,16],[96,48],[520,-8],[64,112],[128,160],[176,200],[-8,272],[224,272],[384,408],[288,304],[448,352],[704,440]],
  "spring-terraces": [[301,177],[201,264],[253,335],[474,265]],
  "dry-scrub": [[-12,-8],[104,432],[216,360],[704,80],[608,128],[560,176],[464,232],[352,272],[240,336],[112,384],[400,400],[704,440]],
  "ash-waste": [[-12,432],[80,368],[704,-8],[288,152],[64,248],[304,196],[-8,-8],[520,40],[612,96],[344,214],[448,264],[704,440],[128,320]],
  "neutral-temperate": [[-12,224],[96,128],[224,40],[256,-8],[80,176],[352,192],[-8,432],[160,352],[320,288],[448,224],[576,304],[704,440]],
};

const ASH_SCENE_PATCH_RECTS = [
  ["ash:pylon-lattice-a",300,128,12,88],
  ["ash:pylon-lattice-b",360,128,12,88],
  ["ash:snapped-cross-member",300,136,72,8],
  ["ash:bent-rebar",304,168,64,8],
  ["ash:cable-run-a",372,144,64,4],
  ["ash:cable-run-b",372,148,48,4],
  ["ash:containment-relief",272,148,28,28],
  ["ash:world-sealed-filter-box",278,154,16,16],
  ["ash:service-conduit",300,216,72,10],
  ["ash:scene-cold-ground-mass",0,0,768,512],
  ["ash:scene-containment-network",0,0,768,512],
];

const NEUTRAL_SCENE_PATCH_LAYERS = [
  ["neutral:scene-meadow-ground-mass",0,0,768,512,"neutral-ground-foundation","neutral-lane-verge","ground-foundation"],
  ["neutral:scene-cluster-roots",0,0,768,512,"neutral-cluster-foundation","neutral-lane-verge","cluster-foundation"],
  ["neutral:scene-pond-foundation",64,96,128,96,"neutral-pond-foundation","neutral-grove-west","pond-foundation"],
  ["neutral:scene-grove-understory",40,0,240,112,"neutral-joined-grove","neutral-grove-west","pond-frame"],
  ["neutral:scene-pale-lane",160,0,416,512,"neutral-lane-foundation","neutral-lane-verge","lane-foundation"],
  ["neutral:scene-stone-wall",16,224,320,32,"neutral-stone-boundary","neutral-wall-gate","route-gate-clear"],
];

const SPRING_SCENE_PATCH_LAYERS = [
  ["spring:scene-mineral-ground-mass",0,0,768,512,"spring-ground-foundation","spring-terraces","ground-foundation"],
  ["spring:v10-route-surface",198,261,353,187,"spring-route-surface","spring-route","spring-route-surface"],
  ["spring:v10-route-tread",210,271,329,164,"spring-route-tread","spring-route","spring-route-tread"],
  ["spring:scene-connected-basin",198,232,21,128,"spring-connected-basin","spring-boardwalk-crossing","spring-bridge-water-return"],
];

const SPRING_COMPLETE_UNDERLAY_LAYERS = [
  ["spring:v10-home-vent-context",568,252,64,64,"spring-home-context"],
];

const DRY_SCENE_PATCH_LAYERS = [
  ["dry:v32-actorless-world",0,0,768,512,"dry-ground-foundation","dry-scrub","dry-v32-actorless-world"],
  ["dry:v32-stratified-basin-witness",0,0,768,512,"dry-stratified-basin","dry-basin","dry-v32-semantic-witness"],
  ["dry:v32-open-thorn-passage-witness",0,0,768,512,"dry-open-thorn-passage","dry-thorn-passage","dry-v32-semantic-witness"],
  ["dry:v32-home-windbreak-witness",480,234,283,178,"dry-home-windbreak","dry-ridge-home","dry-v32-semantic-witness"],
];

const DRY_COMPLETE_UNDERLAY_LAYERS = [
  ["dry:v32-permanent-home-shell",593,276,126,119,"dry-permanent-home-shell"],
];

const DRY_COMPLETE_FOREGROUND_LAYERS = [
  ["dry:v32-threshold-foreground",620,285,148,130,"dry-threshold-foreground"],
];

const WORN_SCENE_PATCH_LAYERS = [
  ["worn:r5-actorless-world",0,0,768,512,"worn-ground-foundation","worn-heartland","worn-r5-actorless-world"],
  ["worn:r5-oak-root-foundation",0,90,340,138,"worn-oak-root-foundation","worn-oak-root-foundation","worn-r5-semantic-witness"],
  ["worn:r5-worked-garden-foundation",0,0,506,363,"worn-worked-garden-foundation","worn-worked-garden-foundation","worn-r5-semantic-witness"],
  ["worn:r5-trampled-lane",0,100,679,352,"worn-trampled-lane","worn-trampled-lane","worn-r5-semantic-witness"],
  ["worn:r5-home-yard-history",483,305,267,181,"worn-home-yard-history","worn-home-yard-history","worn-r5-semantic-witness"],
];

const HUMAN_ANCHORS = {
  "worn-heartland": [[24,83],[72,99],[640,399]],
  "spring-terraces": [[24,211],[72,227],[608,367]],
  "dry-scrub": [[696,51],[552,99],[672,310]],
  "ash-waste": [[120,435],[328,195],[640,367]],
  "neutral-temperate": [[248,19],[168,195],[576,399]],
};

const KEY_SCENE_DIGESTS = {
  manifest: "a02f4711290ec8fb239ff76a4ebad00b37345f6a1526e1fb1d36839725a8bdd0",
  aggregate: "4bf36f99d3c7fcaf4c32a6a95deccf2063b2eba87be57e385efdc69a1e789935",
  kits: {
    "worn-heartland": "87b8a8ebe7bfe8279a6814fd2802832b600f1bee80d9a5a919aa2c617f0e5d91",
    "spring-terraces": "5637f6881cf644a0deb4d1ade075d47559026c439fc342a2060132bc1d9cf432",
    "dry-scrub": "dee2f4dd3ff082bd890bfca7c1e7e1c27b048fe58b9d45842aecff46fb7d8730",
    "ash-waste": "eae553a97b732965ea3ac58815b40e0266517a5a461a676e51abb148fa5173c2",
    "neutral-temperate": "35cef97beca34fb56c92e7c9f89a99099652e9a74ffea17b2ccd423c5c94b5de",
  },
};

const ATLAS_PLAN_DIGEST = "02e1c61df9d9005d0c592798d5c859ca949f53b2786b3a8749656a2ecbfcfdcb";
const CLUSTER_PROOFS_DIGEST = "b3a981c8bf65540bc3636e872f9976b0e6bf10be426340f89740a147ee6adb66";
const HOME_ACTOR_PROOFS_DIGEST = "758fd1ce180792f432cee3de3fa908a315fa7d952747849e4735e66459edcf69";
const HOME_ACTOR_RASTER_SUMMARY_DIGEST = "ceca7444d7beda7a75697bd1f1fa7693f0442de5ace483126d45303e988af114";
const OVERLAY_CHANGED_COMPONENT_COUNTS = {
  "worn-heartland": { warm: [1, 1], hoard: [1, 1] },
  "spring-terraces": { warm: [2, 3], hoard: [1, 1] },
  "dry-scrub": { warm: [1, 1], hoard: [1, 1] },
  "ash-waste": { warm: [2, 1], hoard: [1, 1] },
  "neutral-temperate": { warm: [1, 1], hoard: [1, 1] },
};
const ASH_LANDMARK_PROOF_DIGEST = "13162abc805249b7ebfda58e2b1569a52eca4c9201aa31acb649871546e5a93b";
const VISUAL_PROOF_BINDINGS_DIGEST = "a9d24d5e92585a3915cd60bded3885d002f43ebcfd05e8823c6dfc2ab3ce47a1";
const ASH_SOURCE_LEDGER_DIGEST = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
const ASH_PATCH_LEDGER_DIGEST = "acceaa684758db9abf8aa6b7493e66f8806a473c6c02060ea7002ed52b4e65fb";
const ASH_CELLS_DIGEST = "fec5040635f5189cc3e58e9f7ba799d91f63151c4e92e397e6513bc374c46143";
const ASH_SCHEDULE_DIGEST = "a7b2bd7b7735d622702be2af96fc2b3841e20bd5d058261fc18377f23fd70962";
const ASH_ATLAS_RGBA_SHA256 = "80d15a672fc059ea507d6914ac16fbed672700b931a1a80ff9ee8cda5da01c60";
const ASH_CELL_RGBA_SHA256 = [
  "67c6c39ea1cc288e5aba321393eec96ec45704c96d05112d8d8e436ca66af751",
  "b58a45d24990ce6e426a53d4ae354b4604d7913ab9edef51a567b7001620800c",
  "bcf67fb8a7f10461aac9ce3a44a1687894a311d934a09f3c1b8afb214f649d4d",
  "5f9a2578c00ed7afd9dbdda451a9422d1d145bd9f31786298ba5d05b19e8a78f",
  "c6db962ca560b814f3c9e5911bfc406d28598e4deb70591ffb30e3ba19044106",
  "35aab393a00443c1463e17e02e5bb5cd2638e0a7d7c66cc3bebd317ad0339733",
  "80671a01f26a228de421089b884732e56e04594c379ca0dd96008a78f79371dd",
  "2ddccdbd01f713be752b39af4a52a8fb533acadce1d114d7d1c6402b3d5373bd",
];

const FORBIDDEN_IDS = [
  "spring-terraces/willow[3]",
  "spring-terraces/reed-bed[2]",
  "spring-terraces/reed-bed[3]",
  "dry-scrub/sun-rock[2]",
  "dry-scrub/sun-rock[3]",
  "dry-scrub/thorn[0]",
  "dry-scrub/thorn[1]",
  "dry-scrub/thorn[2]",
  "dry-scrub/thorn[3]",
  "neutral-temperate/soft-grass[0]",
  "neutral-temperate/soft-grass[1]",
  "neutral-temperate/soft-grass[2]",
  "neutral-temperate/soft-grass[3]",
];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function rectKey(record) {
  return `${record.owner}:${record.sourceRect.join(",")}`;
}

function allUsageRecords(crops = REGIONAL_R5_CROPS) {
  return [
    ...crops.safeGuideFragments,
    ...crops.regionalMacros,
    ...crops.homeMaterialFragments,
  ];
}

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(value[key], seen);
}

function mutationSnapshot(value) {
  const records = [];
  const seen = new Set();
  const visit = (candidate, path) => {
    if (candidate === null || typeof candidate !== "object" || seen.has(candidate)) return;
    seen.add(candidate);
    const prototype = Object.getPrototypeOf(candidate);
    const prototypeKind = prototype === Array.prototype ? "Array.prototype"
      : prototype === Object.prototype ? "Object.prototype" : prototype === null ? "null" : "other";
    const descriptors = Reflect.ownKeys(candidate).map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      const keyText = typeof key === "symbol" ? `symbol:${String(key.description)}` : `string:${key}`;
      if ("value" in descriptor) {
        const primitive = descriptor.value === null || typeof descriptor.value !== "object"
          ? canonical(descriptor.value) : Array.isArray(descriptor.value) ? "[array]" : "{object}";
        return [keyText, "data", descriptor.enumerable, descriptor.configurable, descriptor.writable, primitive];
      }
      return [keyText, "accessor", descriptor.enumerable, descriptor.configurable,
        typeof descriptor.get, typeof descriptor.set];
    });
    records.push([path, prototypeKind, Object.isExtensible(candidate), Object.isFrozen(candidate),
      Object.isSealed(candidate), descriptors]);
    for (const key of Reflect.ownKeys(candidate)) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (descriptor && "value" in descriptor) visit(descriptor.value, `${path}.${String(key)}`);
    }
  };
  visit(value, "$candidate");
  return records;
}

function exactBoundarySnapshot(value, keys = Reflect.ownKeys(value)) {
  return {
    prototype: Object.getPrototypeOf(value),
    extensible: Object.isExtensible(value),
    frozen: Object.isFrozen(value),
    sealed: Object.isSealed(value),
    descriptors: keys.map((key) => [key, Object.getOwnPropertyDescriptor(value, key)]),
  };
}

function assertExactBoundaryUnchanged(value, before) {
  assert.equal(Object.getPrototypeOf(value), before.prototype);
  assert.equal(Object.isExtensible(value), before.extensible);
  assert.equal(Object.isFrozen(value), before.frozen);
  assert.equal(Object.isSealed(value), before.sealed);
  for (const [key, expected] of before.descriptors) {
    const actual = Object.getOwnPropertyDescriptor(value, key);
    assert.ok(actual, `descriptor ${String(key)} must remain present`);
    assert.equal(actual.configurable, expected.configurable);
    assert.equal(actual.enumerable, expected.enumerable);
    if ("value" in expected) {
      assert.ok("value" in actual);
      assert.equal(actual.value, expected.value);
      assert.equal(actual.writable, expected.writable);
    } else {
      assert.ok(!("value" in actual));
      assert.equal(actual.get, expected.get);
      assert.equal(actual.set, expected.set);
    }
  }
}

function freezeData(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) freezeData(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function hostileSpec() {
  return structuredClone(REGIONAL_R5_AUTHORING_SPEC);
}

function rejection(candidate, pattern) {
  const errors = validateRegionalR5AuthoringSpec(candidate);
  assert.ok(errors.length > 0, "hostile candidate must fail");
  assert.match(errors.join("\n"), pattern);
}

function rejectionCode(candidate, code) {
  const errors = validateRegionalR5AuthoringSpec(candidate);
  assert.ok(errors.includes(code), `${code} missing from ${errors.join(", ")}`);
}

function atlasFamily(plan) {
  if (plan.atlasId.endsWith("-home-yards")) return "yards";
  return plan.atlasId.slice(plan.kitId.length + 1);
}

function planForDestination(plans, kit, destination) {
  const suffix = destination.atlas === "yards" ? "home-yards" : destination.atlas;
  return plans[kit].find(({ atlasId }) => atlasId === `${kit}-${suffix}`);
}

function literalPlanAuthority(plan) {
  const { canonicalSha256: _canonicalSha256, ...authority } = plan;
  return authority;
}

function semanticCell(plan, cellIndex) {
  return plan.semanticCells.find(([candidate]) => candidate === cellIndex);
}

function assertKeySceneClusterProofs(authority, kit) {
  const bindings = authority.mechanicsBindings.visualProofBindings;
  const scene = authority.keyScenes[kit];
  const sceneryPlan = authority.atlasAuthoringPlans[kit][1];
  const patchById = new Map(authority.literalPatches.patches.map((patch) => [patch.id, patch]));
  const proofs = bindings.clusterProofs.records.filter((record) => record.kitId === kit);
  assert.equal(proofs.length, 8, `${kit} must have one literal proof per landmark cluster`);
  for (const landmark of scene.landmarkLayers) {
    const proof = proofs.find((record) => record.clusterId === landmark.clusterId
      && record.landmarkCell === landmark.cell);
    assert.ok(proof, `${kit}/${landmark.clusterId} proof must exist`);
    const { canonicalSha256, ...proofAuthority } = proof;
    assert.equal(sha256(proofAuthority), canonicalSha256,
      `${kit}/${landmark.clusterId} proof digest must close`);
    const expectedSupports = [proof.supportA, proof.supportB];
    const actualSupports = scene.supportLayers.filter((support) => (
      support.clusterId === landmark.clusterId && support.landmarkVariantId === landmark.variantId
    ));
    assert.equal(actualSupports.length, 2, `${kit}/${landmark.clusterId} needs two proof supports`);
    for (const expected of expectedSupports) {
      const support = actualSupports.find(({ id }) => id === expected.keySceneLayerId);
      assert.ok(support, `${expected.keySceneLayerId} must bind its literal proof record`);
      assert.deepEqual({
        keySceneLayerId: support.id,
        atlasId: support.atlasId,
        cell: support.cell,
        x: support.x,
        y: support.y,
      }, expected);
      assert.equal(support.presentationOnly, true);
      assert.deepEqual(support.routeTarget, proof.routeTarget);
      const supportPatch = support.patchId ? patchById.get(support.patchId) : null;
      assert.deepEqual({ width: support.width, height: support.height }, supportPatch
        ? { width: supportPatch.width, height: supportPatch.height }
        : { width: 32, height: 32 });
      if (kit === "spring-terraces") {
        assert.ok(supportPatch, `${expected.keySceneLayerId} must bind literal V10 support pixels`);
        assert.equal(supportPatch.ownerKit, kit);
        assert.ok(authority.literalPatches.roleBindings["spring-support-anatomy"]
          .includes(support.patchId));
      }
      const selectedCell = semanticCell(sceneryPlan, support.cell);
      assert.ok(selectedCell,
        `${expected.keySceneLayerId} must reference a literal scenery cell`);
      assert.equal(support.sceneryKind, selectedCell[1].split("/")[1],
        `${expected.keySceneLayerId} must name the selected scenery semantic kind`);
    }
    if (proof.routeTarget.kind === "ash-service-chain") {
      assert.deepEqual(proof.routeTarget,
        { kind: "ash-service-chain", tileX: 10, tileY: 7, terrainCell: 11 });
    } else {
      const targetTiles = proof.routeTarget.kind === "shore"
        ? REGIONAL_R4_SCENE_PLANS[kit].shoreTiles : REGIONAL_R4_SCENE_PLANS[kit].routeTiles;
      assert.equal(targetTiles.some(({ x, y }) => (
        x === proof.routeTarget.tileX && y === proof.routeTarget.tileY
      )), true, `${kit}/${landmark.clusterId} target must be on the declared topology`);
      assert.ok(Number.isInteger(proof.routeTarget.terrainCell));
    }
  }
}

function literalAuthorityErrors(authority) {
  const errors = new Set();
  const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
  const touches = (a, b) => a.x <= b.x + b.width && a.x + a.width >= b.x
    && a.y <= b.y + b.height && a.y + a.height >= b.y;
  const rect = ({ x, y, width, height }) => ({ x, y, width, height });
  const offsetSignature = (layers) => canonical(layers.map((layer) => [layer[5], layer[6]]));
  const macroById = new Map(authority.crops.regionalMacros.map((row) => [row.id, row]));
  const patchById = new Map(authority.literalPatches.patches.map((patch) => [patch.id, patch]));
  const macroGraphs = {};

  for (const kit of KITS) {
    const scene = authority.keyScenes[kit];
    const anchors = [];
    const anchorKeys = new Set();
    for (const [index, layer] of scene.macroLayers.entries()) {
      if (!Array.isArray(layer) || layer.length !== 5) {
        errors.add("R5_MACRO_TUPLE_ARITY");
        continue;
      }
      const [, sourceId, , x, y] = layer;
      anchors.push([x, y]);
      const anchorKey = `${x},${y}`;
      if (anchorKeys.has(anchorKey)) errors.add("R5_MACRO_ANCHOR_DUPLICATE");
      anchorKeys.add(anchorKey);
      if (canonical([x, y]) !== canonical(KEY_SCENE_MACRO_ANCHORS[kit][index])) {
        errors.add("R5_MACRO_ANCHOR_SCHEDULE");
      }
      const source = macroById.get(sourceId);
      const patch = patchById.get(sourceId);
      if (!source && !patch) {
        errors.add("R5_MACRO_SCENE_BOUNDS");
        continue;
      }
      const placed = {
        x,
        y,
        width: source ? source.normalizedRect[2] : patch.width,
        height: source ? source.normalizedRect[3] : patch.height,
      };
      if (!(placed.x < scene.width && placed.y < scene.height
        && placed.x + placed.width > 0 && placed.y + placed.height > 0)) {
        errors.add("R5_MACRO_SCENE_BOUNDS");
      }
    }
    if (anchors.length > 0) {
      const minX = Math.min(...anchors.map(([x]) => x));
      const minY = Math.min(...anchors.map(([, y]) => y));
      macroGraphs[kit] = new Set(anchors.map(([x, y]) => `${x - minX},${y - minY}`));
    }

    const landmarks = scene.landmarkLayers;
    const proofs = authority.mechanicsBindings.visualProofBindings?.clusterProofs?.records
      ?.filter(({ kitId }) => kitId === kit) ?? [];
    if (scene.supportLayers.length !== 16 || proofs.length !== 8
      || landmarks.some((landmark) => scene.supportLayers.filter((support) => (
        support.clusterId === landmark.clusterId && support.landmarkVariantId === landmark.variantId
      )).length !== 2)) errors.add("R5_SUPPORT_COUNT");
    for (const landmark of landmarks) {
      const proof = proofs.find(({ clusterId }) => clusterId === landmark.clusterId);
      const supports = scene.supportLayers.filter(({ clusterId }) => clusterId === landmark.clusterId);
      if (!proof || supports.length !== 2) {
        errors.add("R5_SUPPORT_COUNT");
        continue;
      }
      const expectedSupports = [proof.supportA, proof.supportB];
      for (const [index, support] of supports.entries()) {
        const expected = expectedSupports[index];
        if (support.presentationOnly !== true
          || support.id !== expected.keySceneLayerId
          || support.atlasId !== expected.atlasId
          || support.cell !== expected.cell
          || support.x !== expected.x
          || support.y !== expected.y) errors.add("R5_SUPPORT_ASSOCIATION");
        if (canonical(support.routeTarget) !== canonical(proof.routeTarget)) {
          errors.add("R5_SUPPORT_ROUTE_CHAIN");
        }
        const selectedCell = semanticCell(authority.atlasAuthoringPlans[kit][1], support.cell);
        if (!selectedCell || support.sceneryKind !== selectedCell[1].split("/")[1]) {
          errors.add("R5_SUPPORT_ASSOCIATION");
        }
        const supportPatch = support.patchId ? patchById.get(support.patchId) : null;
        const supportWidth = supportPatch?.width ?? 32;
        const supportHeight = supportPatch?.height ?? 32;
        if (!(Number.isInteger(support.x) && Number.isInteger(support.y)
          && support.x >= 0 && support.y >= 0 && support.x + supportWidth <= scene.width
          && support.y + supportHeight <= scene.height)) errors.add("R5_SUPPORT_SCENE_BOUNDS");
      }
      if (proof.routeTarget.kind === "ash-service-chain") {
        if (canonical(proof.routeTarget)
          !== canonical({ kind: "ash-service-chain", tileX: 10, tileY: 7, terrainCell: 11 })) {
          errors.add("R5_SUPPORT_ROUTE_CHAIN");
        }
      } else {
        const targetTiles = proof.routeTarget.kind === "shore"
          ? REGIONAL_R4_SCENE_PLANS[kit].shoreTiles : REGIONAL_R4_SCENE_PLANS[kit].routeTiles;
        if (!targetTiles.some(({ x, y }) => (
          x === proof.routeTarget.tileX && y === proof.routeTarget.tileY
        )) || !Number.isInteger(proof.routeTarget.terrainCell)) {
          errors.add("R5_SUPPORT_ROUTE_CHAIN");
        }
      }
    }

    const yards = authority.atlasAuthoringPlans[kit][3].semanticCells;
    const yardSignatures = yards.map(([, , layers]) => canonical(layers.map((layer) => layer.slice(2))));
    if (new Set(yardSignatures).size !== 5 || yardSignatures[2] === yardSignatures[3]) {
      errors.add("R5_YARD_SIGNATURE_COLLISION");
    }
  }

  for (let left = 0; left < KITS.length; left += 1) {
    for (let right = left + 1; right < KITS.length; right += 1) {
      const leftKit = KITS[left];
      const rightKit = KITS[right];
      const leftGraph = macroGraphs[leftKit];
      const rightGraph = macroGraphs[rightKit];
      if (leftGraph && rightGraph) {
        const overlap = [...leftGraph].filter((anchor) => rightGraph.has(anchor)).length;
        if (canonical([...leftGraph].sort()) === canonical([...rightGraph].sort())
          || overlap / Math.min(leftGraph.size, rightGraph.size) > 0.25) {
          errors.add("R5_MACRO_GRAPH_TEMPLATE");
        }
      }
      for (const [planIndex, limit, code] of [
        [0, 9, "R5_TERRAIN_OFFSET_TEMPLATE"], [1, 25, "R5_SCENERY_OFFSET_TEMPLATE"],
      ]) {
        const leftCells = authority.atlasAuthoringPlans[leftKit][planIndex].semanticCells;
        const rightCells = authority.atlasAuthoringPlans[rightKit][planIndex].semanticCells;
        const signature = [leftKit, rightKit].includes("spring-terraces")
          ? (layers) => canonical(layers.map((layer) => layer.slice(2)))
          : offsetSignature;
        const shared = leftCells.filter((cell, index) => (
          signature(cell[2]) === signature(rightCells[index][2])
        )).length;
        if (shared > limit) errors.add(code);
      }
    }
  }

  for (const kit of KITS) {
    const scenery = authority.atlasAuthoringPlans[kit][1].semanticCells;
    const banks = Array.from({ length: 4 }, (_unused, kindIndex) => (
      scenery.filter(([cellIndex]) => cellIndex % 4 === kindIndex)
    ));
    for (let left = 0; left < banks.length; left += 1) {
      for (let right = left + 1; right < banks.length; right += 1) {
        const shared = banks[left].filter((cell, index) => (
          offsetSignature(cell[2]) === offsetSignature(banks[right][index][2])
        )).length;
        if (shared > 8) errors.add("R5_SCENERY_KIND_TEMPLATE");
      }
    }
  }

  const ash = authority.keyScenes["ash-waste"];
  if (canonical(ash.literalPatchLayers.map(({ patchId, x, y, width, height }) => (
    [patchId, x, y, width, height]
  ))) !== canonical(ASH_SCENE_PATCH_RECTS)) errors.add("R5_ASH_ROUTE_CHAIN");
  for (const layer of ash.literalPatchLayers) {
    const expected = ASH_ROLE_SCENE_BINDINGS[layer.role];
    if (!expected || layer.clusterId !== expected.clusterId
      || layer.routeRelation !== expected.routeRelation) errors.add("R5_ASH_ROUTE_CHAIN");
  }
  const serviceProof = authority.mechanicsBindings.visualProofBindings?.clusterProofs?.records
    ?.find(({ kitId, clusterId }) => kitId === "ash-waste" && clusterId === "ash-pylon-north");
  if (!serviceProof || canonical(serviceProof.routeTarget)
    !== canonical({ kind: "ash-service-chain", tileX: 10, tileY: 7, terrainCell: 11 })) {
    errors.add("R5_ASH_ROUTE_CHAIN");
  }
  return [...errors].sort();
}

function geometryHostiles() {
  return [
    {
      code: "R5_MACRO_TUPLE_ARITY",
      mutate: (value) => { value.keyScenes["worn-heartland"].macroLayers[0].push("extra"); },
    },
    {
      code: "R5_MACRO_ANCHOR_DUPLICATE",
      mutate: (value) => {
        const macros = value.keyScenes["spring-terraces"].macroLayers;
        [macros[1][3], macros[1][4]] = [macros[0][3], macros[0][4]];
      },
    },
    {
      code: "R5_MACRO_ANCHOR_SCHEDULE",
      mutate: (value) => { value.keyScenes["neutral-temperate"].macroLayers[3][3] += 1; },
    },
    {
      code: "R5_MACRO_SCENE_BOUNDS",
      mutate: (value) => { value.keyScenes["ash-waste"].macroLayers[0][3] = 900; },
    },
    {
      code: "R5_MACRO_GRAPH_TEMPLATE",
      mutate: (value) => {
        const source = value.keyScenes["worn-heartland"].macroLayers;
        for (const [index, layer] of value.keyScenes["dry-scrub"].macroLayers.entries()) {
          [layer[3], layer[4]] = [source[index][3], source[index][4]];
        }
      },
    },
    {
      code: "R5_TERRAIN_OFFSET_TEMPLATE",
      mutate: (value) => {
        const source = value.atlasAuthoringPlans["worn-heartland"][0].semanticCells;
        const target = value.atlasAuthoringPlans["spring-terraces"][0].semanticCells;
        for (let index = 0; index < 10; index += 1) target[index][2] = structuredClone(source[index][2]);
      },
    },
    {
      code: "R5_SCENERY_OFFSET_TEMPLATE",
      mutate: (value) => {
        const source = value.atlasAuthoringPlans["worn-heartland"][1].semanticCells;
        const target = value.atlasAuthoringPlans["spring-terraces"][1].semanticCells;
        for (let index = 0; index < 26; index += 1) target[index][2] = structuredClone(source[index][2]);
      },
    },
    {
      code: "R5_SCENERY_KIND_TEMPLATE",
      mutate: (value) => {
        const scenery = value.atlasAuthoringPlans["dry-scrub"][1].semanticCells;
        const source = scenery.filter(([cellIndex]) => cellIndex % 4 === 0);
        const target = scenery.filter(([cellIndex]) => cellIndex % 4 === 1);
        for (let index = 0; index < 9; index += 1) target[index][2] = structuredClone(source[index][2]);
      },
    },
    {
      code: "R5_YARD_SIGNATURE_COLLISION",
      mutate: (value) => {
        const cells = value.atlasAuthoringPlans["neutral-temperate"][3].semanticCells;
        cells[3][2] = cells[2][2].map((layer, index) => [
          `hostile-yard-collision/${index}`, index, ...layer.slice(2),
        ]);
      },
    },
    {
      code: "R5_SUPPORT_COUNT",
      mutate: (value) => { value.keyScenes["worn-heartland"].supportLayers.pop(); },
    },
    {
      code: "R5_SUPPORT_ASSOCIATION",
      mutate: (value) => { value.keyScenes["spring-terraces"].supportLayers[8].x += 1; },
    },
    {
      code: "R5_SUPPORT_SCENE_BOUNDS",
      mutate: (value) => { value.keyScenes["neutral-temperate"].supportLayers[8].x = 900; },
    },
    {
      code: "R5_SUPPORT_ASSOCIATION",
      mutate: (value) => { value.keyScenes["dry-scrub"].supportLayers[9].presentationOnly = false; },
    },
    {
      code: "R5_SUPPORT_ROUTE_CHAIN",
      mutate: (value) => {
        value.keyScenes["worn-heartland"].supportLayers[9].routeTarget.tileX = 0;
      },
    },
    {
      code: "R5_ASH_ROUTE_CHAIN",
      mutate: (value) => { value.keyScenes["ash-waste"].literalPatchLayers[8].x += 1; },
    },
  ];
}

function expectedTerrainRows(plan) {
  const directions = [
    [false, true, false, true], [true, false, true, false], [true, true, false, false],
    [false, true, true, false], [false, false, true, true], [true, false, false, true],
    [true, true, true, true], [false, false, false, false],
  ];
  const key = ({ x, y }) => `${x},${y}`;
  const connectedVariant = (tiles, x, y) => {
    const occupied = new Set(tiles.map(key));
    const mask = [occupied.has(`${x},${y - 1}`), occupied.has(`${x + 1},${y}`),
      occupied.has(`${x},${y + 1}`), occupied.has(`${x - 1},${y}`)];
    const exact = directions.findIndex((candidate) => candidate.every((value, index) => value === mask[index]));
    return exact === -1 ? 6 : exact;
  };
  const route = new Set(plan.routeTiles.map(key));
  const water = new Set(plan.waterTiles.map(key));
  const shore = new Set(plan.shoreTiles.map(key));
  const bridge = new Set(plan.bridgeTiles.map(key));
  const soil = new Set(plan.terrainPatches.flatMap(({ tiles }) => tiles).map(key));
  return plan.groundRecipeGrid.map((row, y) => row.map((ground, x) => {
    const tile = `${x},${y}`;
    let cell = ground;
    if (soil.has(tile)) cell = 32 + (x + y) % 4;
    if (shore.has(tile)) cell = 24 + connectedVariant(plan.shoreTiles, x, y);
    if (water.has(tile)) cell = 16 + connectedVariant(plan.waterTiles, x, y);
    if (route.has(tile) || bridge.has(tile)) cell = 8 + connectedVariant(plan.routeTiles, x, y);
    return cell.toString(16).padStart(2, "0").toUpperCase();
  }).join(""));
}

function expectedSemanticIds(kit, family) {
  const topologyMasks = ["ew", "ns", "ne", "es", "sw", "nw", "nesw", "none"];
  if (family === "terrain") {
    const water = {
      "worn-heartland": "damp-hollow",
      "spring-terraces": "mineral-spring-water",
      "dry-scrub": "waterless-dry-wash",
      "ash-waste": "waterless-sealed-runoff",
      "neutral-temperate": "small-field-pond-water",
    };
    const shore = {
      "worn-heartland": "reclaimed-hollow-edge",
      "spring-terraces": "truthful-spring-shore",
      "dry-scrub": "cracked-wash-edge",
      "ash-waste": "containment-trench-edge",
      "neutral-temperate": "damp-pond-verge",
    };
    const soil = {
      "worn-heartland": "trampled-soil",
      "spring-terraces": "wet-stone-soil",
      "dry-scrub": "cracked-sandstone-soil",
      "ash-waste": "plum-ash-slag-soil",
      "neutral-temperate": "meadow-soil",
    };
    return [
      ...REGIONAL_R4_VARIANT_RECIPES[kit].ground.map(({ id }) => id),
      ...topologyMasks.map((mask) => `${kit}/path/connected-route/${mask}`),
      ...topologyMasks.map((mask) => `${kit}/water/${water[kit]}/${mask}`),
      ...topologyMasks.map((mask) => `${kit}/shore/${shore[kit]}/${mask}`),
      ...["none", "ew", "ns", "nesw"].map((_mask, index) => `${kit}/soil/${soil[kit]}/${index}`),
    ];
  }
  if (family === "scenery") {
    return SCENERY_STYLE_ORDER.flatMap((style) => SCENERY_KIND_ORDER[kit]
      .map((kind) => `${kit}/${kind}/${style}`));
  }
  if (family === "landmarks") return REGIONAL_R4_VARIANT_RECIPES[kit].landmarks.map(({ id }) => id);
  return [
    "standing-a-base", "standing-b-base", "warm-overlay", "durable-hoarding-overlay",
    "persistent-ruin-base",
  ];
}

function hexRgba(value, alpha = 255) {
  assert.match(value, /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i);
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) : alpha,
  ];
}

function repositoryAssetUrl(path) {
  return new URL(`../../${path}`, import.meta.url);
}

async function decodePinnedRgba(path, expectedSha256, { ensureAlpha = true } = {}) {
  const bytes = await readFile(repositoryAssetUrl(path));
  assert.equal(rawSha256(bytes), expectedSha256, `${path} file bytes drifted`);
  let pipeline = sharp(bytes, { failOn: "error" });
  if (ensureAlpha) pipeline = pipeline.ensureAlpha();
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function nearestKitColor(red, green, blue, authority, kit, options = {}) {
  const palette = options.paletteOverride ?? authority.palettes.kits[kit];
  const entries = Object.entries(palette).sort(([left], [right]) => left.localeCompare(right));
  if (options.outlineIsNearestPaletteCandidate === true) {
    entries.push(["outline", authority.palettes.outline.source]);
    entries.sort(([left], [right]) => left.localeCompare(right));
  }
  let best = null;
  for (const [token, hex] of entries) {
    const rgba = hexRgba(hex);
    const distance = (rgba[0] - red) ** 2 + (rgba[1] - green) ** 2 + (rgba[2] - blue) ** 2;
    if (best === null || distance < best.distance) best = { token, rgba, distance };
  }
  return best.rgba;
}

function normalizeGuideRgba(decoded, authority, kit, options = {}) {
  const expected = authority.normalization;
  const phaseX = options.phaseX ?? 0;
  const phaseY = options.phaseY ?? 0;
  const stride = options.stride ?? decoded.channels;
  if (decoded.channels !== expected.decode.requiredChannels) {
    throw new Error(`R5_RASTER_DECODE_CHANNELS:${decoded.channels}`);
  }
  if (stride !== decoded.channels) throw new Error(`R5_RASTER_CHANNEL_STRIDE:${stride}`);
  assert.deepEqual({ width: decoded.width, height: decoded.height }, expected.sourceSize);
  const { width, height } = expected.normalizedSize;
  const data = Buffer.alloc(width * height * 4);
  const outline = hexRgba(authority.palettes.outline.source);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sourceX = Math.min(decoded.width - 1, x * 2 + phaseX);
    const sourceY = Math.min(decoded.height - 1, y * 2 + phaseY);
    const source = (sourceY * decoded.width + sourceX) * stride;
    const red = decoded.data[source];
    const green = decoded.data[source + 1];
    const blue = decoded.data[source + 2];
    const target = (y * width + x) * 4;
    if (red > 210 && blue > 170 && green < 100) continue;
    const rgba = red === outline[0] && green === outline[1] && blue === outline[2]
      && options.mapExactOutline !== true
      ? outline : nearestKitColor(red, green, blue, authority, kit, options);
    data[target] = rgba[0];
    data[target + 1] = rgba[1];
    data[target + 2] = rgba[2];
    data[target + 3] = 255;
  }
  return { data, width, height };
}

function cropNormalizedGuide(image, record, authority, options = {}) {
  const [left, top, width, height] = record.normalizedRect;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const start = ((top + y) * image.width + left) * 4;
    image.data.copy(data, y * width * 4, start, start + width * 4);
  }
  const snapshot = options.mutableOutlineSnapshot === true ? data : Buffer.from(data);
  const outline = hexRgba(authority.palettes.outline.repair.fill);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const target = (y * width + x) * 4;
    if (snapshot[target + 3] !== 0) continue;
    const hasOpaqueNeighbour = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
      .some(([nx, ny]) => nx >= 0 && ny >= 0 && nx < width && ny < height
        && snapshot[(ny * width + nx) * 4 + 3] !== 0);
    if (!hasOpaqueNeighbour) continue;
    data[target] = outline[0];
    data[target + 1] = outline[1];
    data[target + 2] = outline[2];
    data[target + 3] = 255;
  }
  return { data, width, height };
}

function decodeLiteralPatch(patch, authority) {
  const data = Buffer.alloc(patch.width * patch.height * 4);
  for (let y = 0; y < patch.height; y += 1) {
    assert.equal(patch.rows[y].length, patch.width);
    for (let x = 0; x < patch.width; x += 1) {
      const index = patch.rows[y][x];
      const token = patch.palette[index];
      if (token === "transparent") continue;
      const rgba = token === "outline" ? hexRgba(authority.palettes.outline.source)
        : hexRgba(authority.palettes.kits[patch.ownerKit][token]);
      data.set(rgba, (y * patch.width + x) * 4);
    }
  }
  return { data, width: patch.width, height: patch.height };
}

function alphaPixelCount(image) {
  let count = 0;
  for (let offset = 3; offset < image.data.length; offset += 4) count += image.data[offset] !== 0 ? 1 : 0;
  return count;
}

function placeCompleteRgba(destination, source, x, y, owner, ownerIndex) {
  let visibleSourceAlphaPixels = 0;
  for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
    const destinationY = y + sourceY;
    if (destinationY < 0 || destinationY >= destination.height) continue;
    for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
      const destinationX = x + sourceX;
      if (destinationX < 0 || destinationX >= destination.width) continue;
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      if (source.data[sourceOffset + 3] === 0) continue;
      visibleSourceAlphaPixels += 1;
      const destinationPixel = destinationY * destination.width + destinationX;
      const destinationOffset = destinationPixel * 4;
      source.data.copy(destination.data, destinationOffset, sourceOffset, sourceOffset + 4);
      owner[destinationPixel] = ownerIndex;
    }
  }
  return visibleSourceAlphaPixels;
}

async function reconstructAshLandmarkAtlas(authority, options = {}) {
  const source = authority.authoringSources.regionKits;
  const decoded = await decodePinnedRgba(source.path, source.sha256, {
    ensureAlpha: options.ensureAlpha !== false,
  });
  const normalized = normalizeGuideRgba(decoded, authority, "ash-waste", options);
  const usageById = new Map(allUsageRecords(authority.crops).map((record) => [record.id, record]));
  const patchById = new Map(authority.literalPatches.patches.map((patch) => [patch.id, patch]));
  const plan = authority.atlasAuthoringPlans["ash-waste"][2];
  const geometry = plan.geometry;
  const cells = [];
  const sourceLedger = [];
  const patchLedger = [];
  const orderedCells = options.reverseCellOrder === true
    ? [...plan.semanticCells].reverse() : plan.semanticCells;
  for (const [cell, , originalLayers] of orderedCells) {
    const layers = options.reverseDrawOrder === true ? [...originalLayers].reverse() : originalLayers;
    const image = { data: Buffer.alloc(geometry.cellWidth * geometry.cellHeight * 4),
      width: geometry.cellWidth, height: geometry.cellHeight };
    const owner = new Int16Array(image.width * image.height).fill(-1);
    const ledgerRows = [];
    for (const [ownerIndex, layer] of layers.entries()) {
      const [layerId, , sourceKind, sourceId, role, x, y] = layer;
      let decodedLayer;
      let sourceRecord;
      if (sourceKind === "crop") {
        sourceRecord = usageById.get(sourceId);
        assert.ok(sourceRecord, `unknown crop ${sourceId}`);
        const paletteOverride = Array.isArray(sourceRecord.paletteTokens)
          ? Object.fromEntries(sourceRecord.paletteTokens.map((token) => [
            token, authority.palettes.kits[sourceRecord.kit][token],
          ])) : null;
        const normalizedCropSource = paletteOverride
          ? normalizeGuideRgba(decoded, authority, "ash-waste", { ...options, paletteOverride })
          : normalized;
        decodedLayer = cropNormalizedGuide(normalizedCropSource, sourceRecord, authority, options);
      } else {
        sourceRecord = patchById.get(sourceId);
        assert.ok(sourceRecord, `unknown patch ${sourceId}`);
        decodedLayer = decodeLiteralPatch(sourceRecord, authority);
      }
      const visibleSourceAlphaPixels = placeCompleteRgba(image, decodedLayer, x, y, owner, ownerIndex);
      ledgerRows.push({ layer, decodedLayer, sourceRecord, role, visibleSourceAlphaPixels, ownerIndex });
    }
    const finalCounts = new Map();
    for (const value of owner) if (value >= 0) finalCounts.set(value, (finalCounts.get(value) ?? 0) + 1);
    for (const row of ledgerRows) {
      const [layerId, , sourceKind, sourceId, role, x, y] = row.layer;
      const clipped = x < 0 || y < 0 || x + row.decodedLayer.width > image.width
        || y + row.decodedLayer.height > image.height ? "clipped" : "fully-in-bounds";
      if (sourceKind === "crop") sourceLedger.push({
        cell, layerId, sourceId, sourceWidth: row.decodedLayer.width,
        sourceHeight: row.decodedLayer.height, x, y, clipped,
        visibleSourceAlphaPixels: row.visibleSourceAlphaPixels,
        finalVisiblePixels: finalCounts.get(row.ownerIndex) ?? 0,
      });
      else patchLedger.push({
        cell, layerId, patchId: sourceId, role, width: row.decodedLayer.width,
        height: row.decodedLayer.height, x, y, clipped,
        sourceOpaquePixels: alphaPixelCount(row.decodedLayer),
        finalVisiblePixels: finalCounts.get(row.ownerIndex) ?? 0,
      });
    }
    cells.push({
      cell,
      image,
      rgbaSha256: rawSha256(image.data),
      metrics: analyzeLandmarkMaterialDepth(image),
      validationErrors: validateLandmarkMaterialDepth(image, `ash-landmark-${cell}`),
    });
  }
  cells.sort((left, right) => left.cell - right.cell);
  sourceLedger.sort((left, right) => left.cell - right.cell
    || left.layerId.localeCompare(right.layerId));
  patchLedger.sort((left, right) => left.cell - right.cell
    || left.layerId.localeCompare(right.layerId));
  const columns = geometry.width / geometry.cellWidth;
  const atlas = Buffer.alloc(geometry.width * geometry.height * 4);
  for (const { cell, image } of cells) {
    const cellX = cell % columns * geometry.cellWidth;
    const cellY = Math.floor(cell / columns) * geometry.cellHeight;
    for (let y = 0; y < geometry.cellHeight; y += 1) {
      const sourceStart = y * geometry.cellWidth * 4;
      const targetStart = ((cellY + y) * geometry.width + cellX) * 4;
      image.data.copy(atlas, targetStart, sourceStart, sourceStart + geometry.cellWidth * 4);
    }
  }
  return { sourceLedger, patchLedger, cells, atlas, atlasRgbaSha256: rawSha256(atlas) };
}

function extractRawRgba(image, rect) {
  const data = Buffer.alloc(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    const sourceStart = ((rect.y + y) * image.width + rect.x) * 4;
    image.data.copy(data, y * rect.width * 4, sourceStart, sourceStart + rect.width * 4);
  }
  return { data, width: rect.width, height: rect.height };
}

function copyOpaqueRgba(source, destination, x, y, options = {}) {
  for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const alpha = source.data[sourceOffset + 3];
      if (alpha === 0) continue;
      if (alpha !== 255) throw new Error(`R5_HOME_FRACTIONAL_ALPHA:${alpha}`);
      const targetX = x + sourceX;
      const targetY = y + sourceY;
      if (targetX < 0 || targetY < 0 || targetX >= destination.width || targetY >= destination.height) continue;
      const targetOffset = (targetY * destination.width + targetX) * 4;
      if (options.blending === true) {
        throw new Error("R5_HOME_BLENDING_FORBIDDEN");
      }
      source.data.copy(destination.data, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
}

function compositeOpaqueRgba(base, layers) {
  const output = { data: Buffer.from(base.data), width: base.width, height: base.height };
  for (const layer of layers) copyOpaqueRgba(layer, output, 0, 0);
  return output;
}

function successorOverlayConnectivityErrors(input) {
  const errors = new Set();
  const warm = analyzeOverlayVisibility(input.warmOverlay);
  const hoard = analyzeOverlayVisibility(input.hoardOverlay);
  if (warm.componentCount !== 1) errors.add("R5_WARM_RAW_COMPONENTS");
  if (hoard.componentCount !== 1) errors.add("R5_HOARD_RAW_COMPONENTS");
  const composites = analyzeLifecycleOverlayComposites(input);
  if (composites.hoard.some(({ componentCount }) => componentCount !== 1)) {
    errors.add("R5_HOARD_CHANGED_COMPONENTS");
  }
  return [...errors];
}

function syntheticOverlayConnectivityInput({ disconnectedRawHoard = false,
  occludeHoardBridge = false } = {}) {
  const image = (opaque = false) => {
    const data = Buffer.alloc(192 * 160 * 4);
    if (opaque) for (let offset = 0; offset < data.length; offset += 4) {
      data.set([30, 40, 50, 255], offset);
    }
    return { data, width: 192, height: 160 };
  };
  const setPixel = (target, x, y, rgba) => target.data.set(rgba, (y * target.width + x) * 4);
  const terrain = image(true);
  const baseA = image();
  const baseB = image();
  const homeActor = image();
  const warmOverlay = image();
  const hoardOverlay = image();
  setPixel(warmOverlay, 30, 30, [210, 130, 60, 255]);
  for (const x of [10, 11, 12]) setPixel(hoardOverlay, x, 20, [120, 90, 70, 255]);
  if (disconnectedRawHoard) setPixel(hoardOverlay, 80, 80, [120, 90, 70, 255]);
  if (occludeHoardBridge) setPixel(homeActor, 11, 20, [20, 20, 20, 255]);
  const warmComposites = [baseA, baseB].map((base) => (
    compositeOpaqueRgba(terrain, [base, warmOverlay, homeActor])
  ));
  const hoardComposites = [baseA, baseB].map((base) => (
    compositeOpaqueRgba(terrain, [base, hoardOverlay, homeActor])
  ));
  return { terrain, baseLayers: [baseA, baseB], homeActor, warmOverlay, hoardOverlay,
    warmComposites, hoardComposites };
}

async function reconstructHomeActorYards(authority, options = {}) {
  const proofBank = authority.mechanicsBindings.visualProofBindings.homeActorProofs;
  const guideSource = authority.authoringSources.homeRuin;
  const guide = await decodePinnedRgba(guideSource.path, guideSource.sha256);
  const homeCropById = new Map(authority.crops.homeMaterialFragments.map((crop) => [crop.id, crop]));
  const patchById = new Map(authority.literalPatches.patches.map((patch) => [patch.id, patch]));
  const results = [];
  for (const proof of proofBank.kitProofs) {
    const normalized = normalizeGuideRgba(guide, authority, proof.kitId, options);
    const component = await decodePinnedRgba(proof.componentAtlasPath, proof.componentAtlasPngSha256);
    assert.deepEqual({ width: component.width, height: component.height }, proof.componentAtlasGeometry);
    const outputGeometry = proofBank.construction.output;
    const actor = { data: Buffer.alloc(outputGeometry.width * outputGeometry.height * 4),
      width: outputGeometry.width, height: outputGeometry.height };
    const componentGeometry = proofBank.construction.componentGeometry;
    for (const frame of proofBank.construction.frameSequence) {
      const frameImage = extractRawRgba(component, {
        x: frame.index % componentGeometry.columns * componentGeometry.cellWidth,
        y: Math.floor(frame.index / componentGeometry.columns) * componentGeometry.cellHeight,
        width: componentGeometry.cellWidth,
        height: componentGeometry.cellHeight,
      });
      copyOpaqueRgba(frameImage, actor, proofBank.construction.origin.x,
        proofBank.construction.origin.y, options);
    }
    const terrainAtlas = await decodePinnedRgba(proof.terrainAtlasPath, proof.terrainAtlasPngSha256);
    assert.deepEqual({ width: terrainAtlas.width, height: terrainAtlas.height }, { width: 256, height: 256 });
    const preview = extractRawRgba(terrainAtlas, proof.terrainPreviewRect);
    const yardPlan = authority.atlasAuthoringPlans[proof.kitId]
      .find(({ atlasId }) => atlasId === `${proof.kitId}-home-yards`);
    assert.ok(yardPlan);
    const yards = [];
    for (const [cell, , layers] of yardPlan.semanticCells) {
      const yard = { data: Buffer.alloc(192 * 160 * 4), width: 192, height: 160 };
      for (const [, , sourceKind, sourceId, , x, y] of layers) {
        let sourceImage;
        if (sourceKind === "crop") {
          const crop = homeCropById.get(sourceId);
          assert.ok(crop, `${proof.kitId}: unknown home crop ${sourceId}`);
          const inheritedAshHomeTokens = crop.owner === "home-ruin" && crop.kit === "ash-waste"
            && !Object.hasOwn(crop, "paletteTokens")
            ? Object.keys(authority.palettes.kits[crop.kit]).filter((token) => (
              token !== "warning-ochre" && token !== "hazard-lime"
            ))
            : null;
          const paletteTokens = Array.isArray(crop.paletteTokens)
            ? crop.paletteTokens : inheritedAshHomeTokens;
          const paletteOverride = Array.isArray(paletteTokens)
            ? Object.fromEntries(paletteTokens.map((token) => [
              token, authority.palettes.kits[crop.kit][token],
            ])) : null;
          const normalizedCropSource = paletteOverride
            ? normalizeGuideRgba(guide, authority, proof.kitId, { ...options, paletteOverride })
            : normalized;
          sourceImage = cropNormalizedGuide(normalizedCropSource, crop, authority, options);
        } else {
          const patch = patchById.get(sourceId);
          assert.ok(patch, `${proof.kitId}: unknown yard patch ${sourceId}`);
          sourceImage = decodeLiteralPatch(patch, authority);
        }
        copyOpaqueRgba(sourceImage, yard, x, y, options);
      }
      yards[cell] = yard;
    }
    const composites = {
      baselineA: compositeOpaqueRgba(preview, [yards[0], actor]),
      baselineB: compositeOpaqueRgba(preview, [yards[1], actor]),
      warmA: compositeOpaqueRgba(preview, [yards[0], yards[2], actor]),
      warmB: compositeOpaqueRgba(preview, [yards[1], yards[2], actor]),
      hoardA: compositeOpaqueRgba(preview, [yards[0], yards[3], actor]),
      hoardB: compositeOpaqueRgba(preview, [yards[1], yards[3], actor]),
    };
    results.push({ proof, actor, preview, yards, composites });
  }
  return results;
}

function successorAuthorityErrors(authority) {
  const errors = new Set();
  const expected = LITERAL_AUTHORITY;
  const same = (left, right) => canonical(left) === canonical(right);
  if (!same(authority.normalization.decode, expected.normalization.decode)) errors.add("R5_DECODE_CONTRACT");
  if (authority.normalization.scope !== "whole-sheet-once") errors.add("R5_NORMALIZATION_SCOPE");
  if (!same(authority.normalization.sampling, expected.normalization.sampling)) {
    errors.add("R5_NORMALIZATION_SAMPLING");
  }
  if (!same(authority.palettes.kits["ash-waste"], expected.palettes.kits["ash-waste"])) {
    errors.add("R5_ASH_PALETTE");
  }
  if (!same(authority.normalization.paletteMapping, expected.normalization.paletteMapping)) {
    errors.add("R5_OUTLINE_MAPPING");
  }
  if (!same(authority.palettes.outline.repair, expected.palettes.outline.repair)) {
    errors.add("R5_OUTLINE_REPAIR");
  }

  const clusterProofs = authority.mechanicsBindings.visualProofBindings.clusterProofs;
  const expectedClusterProofs = expected.mechanicsBindings.visualProofBindings.clusterProofs;
  if (!same(clusterProofs.sourcePrescription, expectedClusterProofs.sourcePrescription)
      || clusterProofs.sourcePrescriptionSha256 !== sha256(clusterProofs.sourcePrescription)
      || clusterProofs.sourcePrescriptionSha256 !== expectedClusterProofs.sourcePrescriptionSha256) {
    errors.add("R5_CLUSTER_SOURCE_PRESCRIPTION");
  }
  if (clusterProofs.records.length !== 40 || !same(clusterProofs.records.map(({ kitId, clusterId }) => (
    [kitId, clusterId]
  )), expectedClusterProofs.records.map(({ kitId, clusterId }) => [kitId, clusterId]))) {
    errors.add("R5_CLUSTER_TABLE_ORDER");
  }
  for (const record of clusterProofs.records) {
    const targetTiles = record.routeTarget?.kind === "shore"
      ? REGIONAL_R4_SCENE_PLANS[record.kitId]?.shoreTiles
      : REGIONAL_R4_SCENE_PLANS[record.kitId]?.routeTiles;
    const serviceTarget = record.routeTarget?.kind === "ash-service-chain"
      && same(record.routeTarget, { kind: "ash-service-chain", tileX: 10, tileY: 7, terrainCell: 11 });
    const r4Target = Array.isArray(targetTiles) && targetTiles.some(({ x, y }) => (
      x === record.routeTarget?.tileX && y === record.routeTarget?.tileY
    )) && Number.isInteger(record.routeTarget?.terrainCell);
    if (!serviceTarget && !r4Target) errors.add("R5_CLUSTER_R4_TARGET");
    const { canonicalSha256, ...recordAuthority } = record;
    if (typeof canonicalSha256 !== "string" || sha256(recordAuthority) !== canonicalSha256) {
      errors.add("R5_CLUSTER_RECORD_HASH");
    }
  }
  if (clusterProofs.tableSha256 !== sha256(clusterProofs.records)
      || clusterProofs.tableSha256 !== expectedClusterProofs.tableSha256) {
    errors.add("R5_CLUSTER_TABLE_AUTHORITY");
  }
  const { canonicalSha256: clusterHash, ...clusterAuthority } = clusterProofs;
  if (clusterHash !== CLUSTER_PROOFS_DIGEST || sha256(clusterAuthority) !== clusterHash) {
    errors.add("R5_CLUSTER_COLLECTION_HASH");
  }

  for (const kit of KITS) {
    const scene = authority.keyScenes[kit];
    const scenery = authority.atlasAuthoringPlans[kit][1];
    for (const support of scene.supportLayers) {
      const proof = clusterProofs.records.find(({ kitId, clusterId }) => (
        kitId === kit && clusterId === support.clusterId
      ));
      const proofSupport = [proof?.supportA, proof?.supportB]
        .find(({ keySceneLayerId } = {}) => keySceneLayerId === support.id);
      if (support.presentationOnly !== true) errors.add("R5_SUPPORT_PRESENTATION_ONLY");
      if (support.routeTarget === null || !same(support.routeTarget, proof?.routeTarget)) {
        errors.add("R5_SUPPORT_TARGET");
      }
      if (!proofSupport || support.cell !== proofSupport.cell || support.x !== proofSupport.x
        || support.y !== proofSupport.y) errors.add("R5_SUPPORT_POSITION");
      const selectedCell = semanticCell(scenery, support.cell);
      if (!selectedCell || support.sceneryKind !== selectedCell[1].split("/")[1]) {
        errors.add("R5_SUPPORT_SEMANTIC_KIND");
      }
    }
  }

  const homeProofs = authority.mechanicsBindings.visualProofBindings.homeActorProofs;
  const expectedConstruction = expected.mechanicsBindings.visualProofBindings.homeActorProofs.construction;
  if (!same(homeProofs.construction.origin, expectedConstruction.origin)) errors.add("R5_HOME_ORIGIN");
  if (!same(homeProofs.construction.output, expectedConstruction.output)) errors.add("R5_HOME_OUTPUT");
  if (!same(homeProofs.construction.state, expectedConstruction.state)) errors.add("R5_HOME_STATE");
  if (!same(homeProofs.construction.frameSequence, expectedConstruction.frameSequence)) {
    errors.add("R5_HOME_FRAME_SEQUENCE");
  }
  if (!same(homeProofs.construction.copyMode, expectedConstruction.copyMode)) {
    errors.add("R5_HOME_COPY_MODE");
  }
  const neutralYardCounts = authority.atlasAuthoringPlans["neutral-temperate"][3].semanticCells
    .map(([, , layers]) => layers.length);
  if (!same(neutralYardCounts, [3, 3, 1, 3, 4])) errors.add("R5_NEUTRAL_YARD_COUNTS");
  const { canonicalSha256: homeHash, ...homeAuthority } = homeProofs;
  if (homeHash !== HOME_ACTOR_PROOFS_DIGEST || sha256(homeAuthority) !== homeHash) {
    errors.add("R5_HOME_PROOF_HASH");
  }

  const proof = authority.mechanicsBindings.visualProofBindings.ashLandmarkAtlasProof;
  const plan = authority.atlasAuthoringPlans["ash-waste"][2];
  if (proof.sourceLedger.length !== 0 || proof.patchLedger.length !== 8
      || proof.patchLedger.some(({ sourceOpaquePixels }) => sourceOpaquePixels <= 0)) {
    errors.add("R5_ASH_SOURCE_INTERSECTION");
  }
  if (proof.patchLedger.some(({ finalVisiblePixels }) => finalVisiblePixels <= 0)) {
    errors.add("R5_ASH_FINAL_OWNERSHIP");
  }
  const plannedPatchIds = plan.semanticCells.map(([, , layers]) => layers[0]?.[3]);
  if (new Set(proof.patchLedger.map(({ patchId }) => patchId)).size !== 8
      || !same([...new Set(proof.patchLedger.map(({ patchId }) => patchId))].sort(), [...plannedPatchIds].sort())) {
    errors.add("R5_ASH_PATCH_DIVERSITY");
  }
  const patchById = new Map(authority.literalPatches.patches.map((patch) => [patch.id, patch]));
  for (const [cell, , layers] of plan.semanticCells) {
    if (!same(layers.map(([, ordinal, sourceKind]) => [ordinal, sourceKind]), [[0, "literal-patch"]])) {
      errors.add("R5_ASH_DRAW_ORDER");
    }
    for (const [, , sourceKind, sourceId, , x, y] of layers) {
      if (sourceKind !== "literal-patch") continue;
      const patch = patchById.get(sourceId);
      if (!patch || x < 0 || y < 0 || x + patch.width > 128 || y + patch.height > 128) {
        errors.add("R5_ASH_PATCH_BOUNDS");
      }
    }
  }
  if (proof.cells.some(({ validationErrors }) => validationErrors.length !== 0)) {
    errors.add("R5_ASH_LANDMARK_ERRORS");
  }
  const { canonicalSha256: proofHash, ...proofAuthority } = proof;
  if (proofHash !== ASH_LANDMARK_PROOF_DIGEST || sha256(proofAuthority) !== proofHash) {
    errors.add("R5_ASH_PROOF_HASH");
  }
  if (plan.canonicalSha256 !== LITERAL_CELL_PLAN_DIGESTS.landmarks.kits["ash-waste"]
    || sha256(literalPlanAuthority(plan)) !== plan.canonicalSha256) errors.add("R5_ASH_PLAN_HASH");
  return [...errors];
}

function assertSuccessorHostile(code, mutate) {
  const candidate = structuredClone(LITERAL_AUTHORITY);
  mutate(candidate);
  const errors = successorAuthorityErrors(candidate);
  assert.equal(errors[0], code, `${code} must precede transitive errors: ${errors.join(", ")}`);
}

test("independent pinned-byte reconstruction closes the literal ash industrial atlas", async () => {
  const proof = LITERAL_AUTHORITY.mechanicsBindings.visualProofBindings.ashLandmarkAtlasProof;
  const plan = LITERAL_AUTHORITY.atlasAuthoringPlans["ash-waste"][2];
  assert.equal(sha256(proof.sourceLedger), ASH_SOURCE_LEDGER_DIGEST);
  assert.equal(sha256(proof.patchLedger), ASH_PATCH_LEDGER_DIGEST);
  assert.equal(sha256(proof.cells), ASH_CELLS_DIGEST);
  assert.equal(sha256(plan.semanticCells.map(([cell, , layers]) => [cell, layers])), ASH_SCHEDULE_DIGEST);
  assert.deepEqual(plan.semanticCells.map(([, , layers]) => (
    layers.map(([, , sourceKind]) => sourceKind)
  )), Array.from({ length: 8 }, () => ["literal-patch"]));

  const actual = await reconstructAshLandmarkAtlas(LITERAL_AUTHORITY);
  assert.deepEqual(actual.sourceLedger, proof.sourceLedger);
  assert.deepEqual(actual.patchLedger, proof.patchLedger);
  assert.deepEqual(actual.cells.map(({ image: _image, ...cell }) => cell), proof.cells);
  assert.deepEqual(actual.cells.map(({ rgbaSha256 }) => rgbaSha256), ASH_CELL_RGBA_SHA256);
  assert.equal(actual.atlasRgbaSha256, ASH_ATLAS_RGBA_SHA256);
  assert.equal(proof.atlasRgbaSha256, ASH_ATLAS_RGBA_SHA256);
  assert.deepEqual(actual.sourceLedger, [], "literal industrial cells consume no guide-crop ledger rows");
  assert.equal(actual.patchLedger.every(({ sourceOpaquePixels, finalVisiblePixels }) => (
    sourceOpaquePixels > 0 && finalVisiblePixels > 0
  )), true, "all eight literal industrial cells must contribute final visible pixels");
  assert.equal(new Set(actual.patchLedger.map(({ patchId }) => patchId)).size, 8);
  assert.equal(actual.cells.every(({ validationErrors }) => validationErrors.length === 0), true);
  const { canonicalSha256, ...proofAuthority } = proof;
  assert.equal(sha256(proofAuthority), canonicalSha256);
});

test("independent HomeActor, yard, and composite reconstruction closes every pinned raster", async () => {
  const results = await reconstructHomeActorYards(LITERAL_AUTHORITY);
  const summary = [];
  const yardKeys = ["standingA", "standingB", "warm", "hoard", "ruin"];
  for (const { proof, actor, preview, yards, composites } of results) {
    const yardHashes = Object.fromEntries(yardKeys.map((key, index) => [key, rawSha256(yards[index].data)]));
    const compositeHashes = Object.fromEntries(Object.entries(composites)
      .map(([key, image]) => [key, rawSha256(image.data)]));
    assert.equal(rawSha256(actor.data), proof.homeActorRgbaSha256, `${proof.kitId}: HomeActor`);
    assert.equal(rawSha256(preview.data), proof.terrainPreviewRgbaSha256, `${proof.kitId}: terrain preview`);
    assert.deepEqual(yardHashes, proof.yardCellRgbaSha256, `${proof.kitId}: yard cells`);
    assert.deepEqual(compositeHashes, proof.compositeRgbaSha256, `${proof.kitId}: composites`);
    if (proof.kitId === "spring-terraces") {
      assert.ok(analyzeYardCell(yards[0]).alphaCoverage >= 0.7,
        "accepted Spring wet-stone yard must remain a broad inhabited surface");
    } else {
      assert.deepEqual(validateYardCell(yards[0], `${proof.kitId}/standing-a`), []);
      assert.deepEqual(validateYardCell(yards[1], `${proof.kitId}/standing-b`), []);
      assert.deepEqual(validateYardCell(yards[4], `${proof.kitId}/ruin`), []);
    }
    if (proof.kitId === "spring-terraces") {
      assert.deepEqual([yards[0], yards[1], yards[4]].map((yard) => (
        analyzeYardCell(yard).doorClearanceCoverage
      )), [0, 0, 0], "accepted Spring yard states must preserve the exact doorway clearance");
    } else {
      assert.deepEqual(validateYardLifecycle({ baseA: yards[0], baseB: yards[1], ruin: yards[4] }), []);
    }
    const rawWarmMetrics = analyzeOverlayVisibility(yards[2]);
    const rawHoardMetrics = analyzeOverlayVisibility(yards[3]);
    assert.deepEqual(validateOverlayVisibility(yards[2], `${proof.kitId}/warm`), []);
    assert.deepEqual(validateOverlayVisibility(yards[3], `${proof.kitId}/hoard`), []);
    assert.equal(rawWarmMetrics.componentCount, 1, `${proof.kitId}: raw warm must be connected`);
    assert.equal(rawHoardMetrics.componentCount, 1, `${proof.kitId}: raw hoard must be connected`);
    const lifecycleInput = {
      terrain: preview,
      baseLayers: [yards[0], yards[1]],
      homeActor: actor,
      warmOverlay: yards[2],
      hoardOverlay: yards[3],
      warmComposites: [composites.warmA, composites.warmB],
      hoardComposites: [composites.hoardA, composites.hoardB],
    };
    if (proof.kitId === "spring-terraces") {
      assert.ok(analyzeLifecycleOverlayComposites(lifecycleInput).warm
        .every(({ visibleAlphaShare }) => visibleAlphaShare >= 0.65),
      "accepted Spring warmth must remain materially visible across both broad wet-yard bases");
    } else assert.deepEqual(validateLifecycleOverlayMetrics(lifecycleInput), []);
    assert.equal(analyzeYardCell(yards[0]).doorClearanceCoverage, 0);
    assert.equal(analyzeYardLifecycle({ baseA: yards[0], baseB: yards[1], ruin: yards[4] })
      .states.length, 3);
    assert.ok(rawWarmMetrics.opaquePixels > 0);
    const overlayMetrics = analyzeLifecycleOverlayComposites(lifecycleInput);
    assert.deepEqual(overlayMetrics.flattenErrors, []);
    assert.deepEqual({
      warm: overlayMetrics.warm.map(({ componentCount }) => componentCount),
      hoard: overlayMetrics.hoard.map(({ componentCount }) => componentCount),
    }, OVERLAY_CHANGED_COMPONENT_COUNTS[proof.kitId], `${proof.kitId}: changed-mask components`);
    assert.deepEqual(overlayMetrics.hoard.map(({ componentCount }) => componentCount), [1, 1],
      `${proof.kitId}: hoard changed masks are a single connected architectural mass`);
    if (proof.kitId !== "spring-terraces") {
      assert.deepEqual(successorOverlayConnectivityErrors(lifecycleInput), []);
    }
    summary.push({ kitId: proof.kitId, actor: rawSha256(actor.data), preview: rawSha256(preview.data),
      yards: yardHashes, composites: compositeHashes });
  }
  assert.equal(sha256(summary), HOME_ACTOR_RASTER_SUMMARY_DIGEST);
  assert.deepEqual(LITERAL_AUTHORITY.atlasAuthoringPlans["spring-terraces"][3].semanticCells[1][2]
    .find(([, , , sourceId]) => sourceId === "r5-home/spring-terraces/boundary-post-pair")
    .slice(5, 7), [8, 52]);
  assert.deepEqual(LITERAL_AUTHORITY.atlasAuthoringPlans["neutral-temperate"][3].semanticCells
    .map(([, , layers]) => layers.length), [3, 3, 1, 3, 4]);
});

test("decode, normalization, palette, and outline hostiles fail before raster closure", async () => {
  assert.deepEqual(successorAuthorityErrors(LITERAL_AUTHORITY), []);
  assertSuccessorHostile("R5_DECODE_CONTRACT", (candidate) => {
    candidate.normalization.decode.ensureAlpha = false;
  });
  assertSuccessorHostile("R5_DECODE_CONTRACT", (candidate) => {
    candidate.normalization.decode.channelStride = 3;
  });
  assertSuccessorHostile("R5_NORMALIZATION_SCOPE", (candidate) => {
    candidate.normalization.scope = "per-crop";
  });
  assertSuccessorHostile("R5_NORMALIZATION_SAMPLING", (candidate) => {
    candidate.normalization.sampling.phase = "odd-odd";
  });
  assertSuccessorHostile("R5_ASH_PALETTE", (candidate) => {
    candidate.palettes.kits["ash-waste"] = {
      "plum-ash": "#514a5b", charcoal: "#202128", "coral-fissure": "#d05f5d",
      "oxidized-metal": "#716879", "containment-concrete": "#8c8492", slag: "#34313f",
      "vent-warm": "#ed8b69",
    };
  });
  assertSuccessorHostile("R5_OUTLINE_MAPPING", (candidate) => {
    candidate.normalization.paletteMapping.outlineIsNearestPaletteCandidate = true;
  });
  assertSuccessorHostile("R5_OUTLINE_REPAIR", (candidate) => {
    candidate.palettes.outline.repair.sourceSnapshot = "mutable-current-pass";
    candidate.palettes.outline.repair.iterativeGrowth = true;
  });

  await assert.rejects(reconstructAshLandmarkAtlas(LITERAL_AUTHORITY, { ensureAlpha: false }),
    /R5_RASTER_DECODE_CHANNELS/);
  await assert.rejects(reconstructAshLandmarkAtlas(LITERAL_AUTHORITY, { stride: 3 }),
    /R5_RASTER_CHANNEL_STRIDE/);
  const wrongPhase = await reconstructAshLandmarkAtlas(LITERAL_AUTHORITY, { phaseX: 1, phaseY: 1 });
  assert.equal(wrongPhase.atlasRgbaSha256, ASH_ATLAS_RGBA_SHA256,
    "the all-literal ash atlas is independent of guide sampling after authority validation");
  const oldPalette = await reconstructAshLandmarkAtlas(LITERAL_AUTHORITY, { paletteOverride: {
    "plum-ash": "#514a5b", charcoal: "#202128", "coral-fissure": "#d05f5d",
    "oxidized-metal": "#716879", "containment-concrete": "#8c8492", slag: "#34313f",
    "vent-warm": "#ed8b69",
  } });
  assert.equal(oldPalette.atlasRgbaSha256, ASH_ATLAS_RGBA_SHA256,
    "the all-literal ash atlas is independent of guide palette overrides after authority validation");
  const outlineCandidate = await reconstructAshLandmarkAtlas(LITERAL_AUTHORITY, {
    outlineIsNearestPaletteCandidate: true, mapExactOutline: true,
  });
  assert.equal(outlineCandidate.atlasRgbaSha256, ASH_ATLAS_RGBA_SHA256,
    "the all-literal ash atlas is independent of guide outline mapping after authority validation");
  const cascadingOutline = await reconstructAshLandmarkAtlas(LITERAL_AUTHORITY, {
    mutableOutlineSnapshot: true,
  });
  assert.equal(cascadingOutline.atlasRgbaSha256, ASH_ATLAS_RGBA_SHA256,
    "the all-literal ash atlas is independent of guide outline snapshots after authority validation");
});

test("actual-alpha source prescription exposes semantic inputs and rejects self-attestation", () => {
  const clusterProofs = LITERAL_AUTHORITY.mechanicsBindings.visualProofBindings.clusterProofs;
  assert.deepEqual(clusterProofs.sourcePrescription, {
    schema: "regional-r5-actual-alpha-remediation/v1",
    routeSourceRules: {
      route: {
        sourceScope: "selected-terrain-cell-at-target-tile",
        terrainLayerRole: "route-or-patch",
        genericGround: "forbidden",
      },
      shore: {
        sourceScope: "selected-terrain-cell-at-target-tile",
        terrainLayerRole: "boundary-material",
        genericGround: "forbidden",
      },
    },
    ashServiceSources: [
      {
        sourceKind: "terrain-role", atlasId: "ash-waste-terrain", terrainCell: 11,
        tileX: 10, tileY: 7, role: "route-or-patch",
      },
      {
        sourceKind: "macro", layerId: "r5-scene/ash-waste/macro/03",
        sourceId: "r5-regional/ash-waste/service-strip", x: 288, y: 152,
        role: "service-route",
      },
      {
        sourceKind: "macro", layerId: "r5-scene/ash-waste/macro/05",
        sourceId: "r5-regional/ash-waste/service-junction", x: 304, y: 196,
        role: "service-route",
      },
      {
        sourceKind: "literal-patch", layerId: "r5-scene/ash-waste/patch/8",
        sourceId: "ash:service-conduit", x: 300, y: 216, role: "literal-service-slab",
      },
    ],
    ashServiceAlphaContract: {
      componentCount: 1,
      opaquePixels: 3475,
      bounds: [292, 158, 371, 255],
    },
    supportMoves: [
      {
        kitId: "spring-terraces", clusterId: "spring-boardwalk-crossing", support: "A",
        keySceneLayerId: "spring:support:post-a", from: { x: 60, y: 231 }, to: { x: 60, y: 232 },
      },
      {
        kitId: "ash-waste", clusterId: "ash-crater-north", support: "A",
        keySceneLayerId: "r5-scene/ash-waste/support-authored/1/a",
        from: { x: 299, y: 228 }, to: { x: 296, y: 231 },
      },
      {
        kitId: "ash-waste", clusterId: "ash-slag-north", support: "A",
        keySceneLayerId: "r5-scene/ash-waste/support-authored/4/a",
        from: { x: 472, y: 252 }, to: { x: 472, y: 253 },
      },
      {
        kitId: "ash-waste", clusterId: "ash-debris-east", support: "A",
        keySceneLayerId: "r5-scene/ash-waste/support-authored/6/a",
        from: { x: 620, y: 362 }, to: { x: 606, y: 362 },
      },
      {
        kitId: "ash-waste", clusterId: "ash-slag-crossing", support: "A",
        keySceneLayerId: "ash:support:slag-a",
        from: { x: 411, y: 228 }, to: { x: 470, y: 228 },
      },
      {
        kitId: "ash-waste", clusterId: "ash-slag-crossing", support: "B",
        keySceneLayerId: "ash:support:rebar-a",
        from: { x: 442, y: 201 }, to: { x: 454, y: 198 },
      },
      {
        kitId: "ash-waste", clusterId: "ash-shelter-debris", support: "A",
        keySceneLayerId: "ash:support:filter-a",
        from: { x: 632, y: 380 }, to: { x: 643, y: 376 },
      },
      {
        kitId: "ash-waste", clusterId: "ash-shelter-debris", support: "B",
        keySceneLayerId: "ash:support:conduit-a",
        from: { x: 603, y: 353 }, to: { x: 616, y: 361 },
      },
      {
        kitId: "neutral-temperate", clusterId: "neutral-grove-home", support: "B",
        keySceneLayerId: "neutral:support:herb-a", from: { x: 365, y: 255 }, to: { x: 364, y: 255 },
      },
      {
        kitId: "neutral-temperate", clusterId: "neutral-wall-gate", support: "A",
        keySceneLayerId: "neutral:support:stone-a", from: { x: 203, y: 267 }, to: { x: 202, y: 267 },
      },
      {
        kitId: "neutral-temperate", clusterId: "neutral-lane-verge", support: "B",
        keySceneLayerId: "neutral:support:verge-a", from: { x: 224, y: 224 }, to: { x: 225, y: 225 },
      },
    ],
    landmarkMoves: [
      {
        kitId: "ash-waste", cell: 3, layerOrdinal: 0,
        layerId: "r5-layer/ash-waste/landmarks/003/00",
        sourceId: "r5-regional/ash-waste/fracture-macro-band",
        from: { x: -40, y: -34 }, to: { x: -20, y: 2 },
      },
      {
        kitId: "ash-waste", cell: 3, layerOrdinal: 5,
        layerId: "r5-layer/ash-waste/landmarks/003/05",
        sourceId: "r5-safe/ash-waste/slag-rock/1",
        from: { x: -29, y: 109 }, to: { x: -29, y: 97 },
      },
    ],
  });
  assert.equal(clusterProofs.sourcePrescriptionSha256, sha256(clusterProofs.sourcePrescription));
  assert.equal(clusterProofs.tableSha256, sha256(clusterProofs.records));

  assertSuccessorHostile("R5_CLUSTER_SOURCE_PRESCRIPTION", (candidate) => {
    const proofs = candidate.mechanicsBindings.visualProofBindings.clusterProofs;
    proofs.sourcePrescription.routeSourceRules.route.terrainLayerRole = "generic-ground";
    proofs.sourcePrescriptionSha256 = sha256(proofs.sourcePrescription);
  });
  assertSuccessorHostile("R5_CLUSTER_SOURCE_PRESCRIPTION", (candidate) => {
    const proofs = candidate.mechanicsBindings.visualProofBindings.clusterProofs;
    proofs.sourcePrescription.ashServiceSources[0].role = "generic-ground";
    proofs.sourcePrescriptionSha256 = sha256(proofs.sourcePrescription);
  });
});

test("cluster and support hostiles fail with dedicated successor diagnostics", () => {
  assertSuccessorHostile("R5_CLUSTER_TABLE_ORDER", (candidate) => {
    candidate.mechanicsBindings.visualProofBindings.clusterProofs.records.pop();
  });
  assertSuccessorHostile("R5_CLUSTER_TABLE_ORDER", (candidate) => {
    const records = candidate.mechanicsBindings.visualProofBindings.clusterProofs.records;
    [records[0], records[1]] = [records[1], records[0]];
  });
  assertSuccessorHostile("R5_CLUSTER_RECORD_HASH", (candidate) => {
    candidate.mechanicsBindings.visualProofBindings.clusterProofs.records[0]
      .metrics.minimumOmitOneVisibleShare += 0.01;
  });
  assertSuccessorHostile("R5_CLUSTER_RECORD_HASH", (candidate) => {
    delete candidate.mechanicsBindings.visualProofBindings.clusterProofs.records[0].canonicalSha256;
  });
  assertSuccessorHostile("R5_CLUSTER_TABLE_AUTHORITY", (candidate) => {
    const proofs = candidate.mechanicsBindings.visualProofBindings.clusterProofs;
    const record = proofs.records[0];
    record.metrics.minimumOmitOneVisibleShare += 0.01;
    const { canonicalSha256: _recordHash, ...recordAuthority } = record;
    record.canonicalSha256 = sha256(recordAuthority);
    proofs.tableSha256 = sha256(proofs.records);
    const { canonicalSha256: _collectionHash, ...collectionAuthority } = proofs;
    proofs.canonicalSha256 = sha256(collectionAuthority);
  });
  assertSuccessorHostile("R5_CLUSTER_R4_TARGET", (candidate) => {
    const target = candidate.mechanicsBindings.visualProofBindings.clusterProofs.records[0].routeTarget;
    target.tileX = 0;
    target.tileY = 0;
  });
  assertSuccessorHostile("R5_SUPPORT_PRESENTATION_ONLY", (candidate) => {
    delete candidate.keyScenes["worn-heartland"].supportLayers[0].presentationOnly;
  });
  assertSuccessorHostile("R5_SUPPORT_TARGET", (candidate) => {
    candidate.keyScenes["spring-terraces"].supportLayers[0].routeTarget = null;
  });
  assertSuccessorHostile("R5_SUPPORT_SEMANTIC_KIND", (candidate) => {
    candidate.keyScenes["worn-heartland"].supportLayers[2].sceneryKind = "old-oak";
  });
  assertSuccessorHostile("R5_SUPPORT_POSITION", (candidate) => {
    const support = candidate.keyScenes["dry-scrub"].supportLayers[0];
    support.x += 1;
  });
  assertSuccessorHostile("R5_SUPPORT_TARGET", (candidate) => {
    const support = candidate.keyScenes["ash-waste"].supportLayers
      .find(({ clusterId }) => clusterId === "ash-pylon-north");
    support.routeTarget.terrainCell = null;
  });
});

test("HomeActor schema, binary-copy, and yard-count hostiles fail closed", () => {
  assertSuccessorHostile("R5_HOME_ORIGIN", (candidate) => {
    candidate.mechanicsBindings.visualProofBindings.homeActorProofs.construction.origin = { x: 32, y: 0 };
  });
  assertSuccessorHostile("R5_HOME_OUTPUT", (candidate) => {
    candidate.mechanicsBindings.visualProofBindings.homeActorProofs.construction.output.width = 128;
    candidate.mechanicsBindings.visualProofBindings.homeActorProofs.construction.output.height = 128;
  });
  assertSuccessorHostile("R5_HOME_STATE", (candidate) => {
    candidate.mechanicsBindings.visualProofBindings.homeActorProofs.construction.state = "lit";
  });
  assertSuccessorHostile("R5_HOME_FRAME_SEQUENCE", (candidate) => {
    const frames = candidate.mechanicsBindings.visualProofBindings.homeActorProofs.construction.frameSequence;
    [0, 1, 2, 6, 9, 17, 20].forEach((index, position) => { frames[position].index = index; });
    frames.pop();
  });
  assertSuccessorHostile("R5_HOME_COPY_MODE", (candidate) => {
    candidate.mechanicsBindings.visualProofBindings.homeActorProofs.construction.copyMode.resampling = true;
  });
  assertSuccessorHostile("R5_HOME_COPY_MODE", (candidate) => {
    candidate.mechanicsBindings.visualProofBindings.homeActorProofs.construction.copyMode.blending = true;
  });
  assertSuccessorHostile("R5_NEUTRAL_YARD_COUNTS", (candidate) => {
    const cells = candidate.atlasAuthoringPlans["neutral-temperate"][3].semanticCells;
    cells[2][2].push(cells[1][2].pop());
  });
  const fractional = { data: Buffer.from([1, 2, 3, 128]), width: 1, height: 1 };
  const destination = { data: Buffer.alloc(4), width: 1, height: 1 };
  assert.throws(() => copyOpaqueRgba(fractional, destination, 0, 0), /R5_HOME_FRACTIONAL_ALPHA/);
  const opaque = { data: Buffer.from([1, 2, 3, 255]), width: 1, height: 1 };
  assert.throws(() => copyOpaqueRgba(opaque, destination, 0, 0, { blending: true }),
    /R5_HOME_BLENDING_FORBIDDEN/);
});

test("disconnected raw and composite hoards fail dedicated connectivity gates", () => {
  const accepted = syntheticOverlayConnectivityInput();
  assert.deepEqual(successorOverlayConnectivityErrors(accepted), []);

  const disconnectedRaw = successorOverlayConnectivityErrors(
    syntheticOverlayConnectivityInput({ disconnectedRawHoard: true }),
  );
  assert.equal(disconnectedRaw[0], "R5_HOARD_RAW_COMPONENTS",
    `raw connectivity must fail before changed-mask diagnostics: ${disconnectedRaw.join(", ")}`);

  const disconnectedChanged = syntheticOverlayConnectivityInput({ occludeHoardBridge: true });
  assert.equal(analyzeOverlayVisibility(disconnectedChanged.hoardOverlay).componentCount, 1,
    "hostile raw hoard remains connected before composition");
  assert.deepEqual(successorOverlayConnectivityErrors(disconnectedChanged),
    ["R5_HOARD_CHANGED_COMPONENTS"]);
});

test("ash literal ledger, ownership, schedule, and raster hostiles fail closed", () => {
  assertSuccessorHostile("R5_ASH_SOURCE_INTERSECTION", (candidate) => {
    candidate.mechanicsBindings.visualProofBindings.ashLandmarkAtlasProof.sourceLedger.push({ hostile: true });
  });
  assertSuccessorHostile("R5_ASH_SOURCE_INTERSECTION", (candidate) => {
    candidate.mechanicsBindings.visualProofBindings.ashLandmarkAtlasProof.patchLedger[0]
      .sourceOpaquePixels = 0;
  });
  assertSuccessorHostile("R5_ASH_FINAL_OWNERSHIP", (candidate) => {
    candidate.mechanicsBindings.visualProofBindings.ashLandmarkAtlasProof.patchLedger[0]
      .finalVisiblePixels = 0;
  });
  assertSuccessorHostile("R5_ASH_PATCH_BOUNDS", (candidate) => {
    candidate.atlasAuthoringPlans["ash-waste"][2].semanticCells[0][2][0][5] = 127;
  });
  assertSuccessorHostile("R5_ASH_PATCH_DIVERSITY", (candidate) => {
    const proof = candidate.mechanicsBindings.visualProofBindings.ashLandmarkAtlasProof;
    const replaced = proof.patchLedger[0].patchId;
    for (const row of proof.patchLedger) if (row.patchId === replaced) row.patchId = proof.patchLedger[1].patchId;
  });
  assertSuccessorHostile("R5_ASH_DRAW_ORDER", (candidate) => {
    candidate.atlasAuthoringPlans["ash-waste"][2].semanticCells[0][2][0][1] = 1;
  });
  assertSuccessorHostile("R5_ASH_LANDMARK_ERRORS", (candidate) => {
    candidate.mechanicsBindings.visualProofBindings.ashLandmarkAtlasProof.cells[0]
      .validationErrors.push("hostile");
  });
});

test("superseded stop strings, counts, and candidate hashes are absent from literal authority", () => {
  for (const stale of [
    "ash-slag-crossing/containment-crossing", "material-cache", "material-stockpile",
    "afb7d59e", "075fc1c1",
  ]) assert.equal(LITERAL_AUTHORITY_SOURCE.includes(stale), false, `${stale} must remain superseded`);
  assert.equal(LITERAL_AUTHORITY_SOURCE.includes('"layerCount": 2038'), false);
  assert.equal(LITERAL_AUTHORITY_SOURCE.includes('"layerCount":2038'), false);
});

test("checked-in literal authority exposes every atlas layer and key-scene preimage", () => {
  assert.equal(rawSha256(LITERAL_AUTHORITY_SOURCE), LITERAL_AUTHORITY_SHA256);
  assert.deepEqual(Object.keys(LITERAL_AUTHORITY).sort(),
    [
      "schema", "authoringKits", "authoringSources", "normalization", "palettes", "crops",
      "literalPatches", "mechanicsBindings", "atlasAuthoringPlans", "keyScenes", "authoringSpec",
    ].sort());
  assert.equal(LITERAL_AUTHORITY.schema, "regional-r5-literal-authority/v3");
  assert.deepEqual(LITERAL_AUTHORITY.authoringSpec, {
    kits: LITERAL_AUTHORITY.authoringKits,
    sources: LITERAL_AUTHORITY.authoringSources,
    normalization: LITERAL_AUTHORITY.normalization,
    palettes: LITERAL_AUTHORITY.palettes,
    crops: LITERAL_AUTHORITY.crops,
    literalPatches: LITERAL_AUTHORITY.literalPatches,
    mechanicsBindings: LITERAL_AUTHORITY.mechanicsBindings,
    atlasAuthoringPlans: LITERAL_AUTHORITY.atlasAuthoringPlans,
    keyScenes: LITERAL_AUTHORITY.keyScenes,
    sourceReusePolicy: LITERAL_AUTHORITY.authoringSpec.sourceReusePolicy,
    digests: LITERAL_AUTHORITY.authoringSpec.digests,
  }, "aggregate authoringSpec must duplicate every literal preimage exactly");
  assert.deepEqual(Object.keys(LITERAL_AUTHORITY.atlasAuthoringPlans), KITS);
  assert.deepEqual(Object.keys(LITERAL_AUTHORITY.keyScenes), KITS);
  let planCount = 0;
  let cellCount = 0;
  let layerCount = 0;
  const layerIds = new Set();
  for (const kit of KITS) {
    const plans = LITERAL_AUTHORITY.atlasAuthoringPlans[kit];
    assert.equal(plans.length, 4);
    for (const plan of plans) {
      planCount += 1;
      cellCount += plan.semanticCells.length;
      for (const [cellIndex, semanticId, layers] of plan.semanticCells) {
        assert.ok(Number.isInteger(cellIndex));
        assert.equal(typeof semanticId, "string");
        assert.ok(layers.length >= 1);
        for (const layer of layers) {
          assert.equal(layer.length, 9);
          assert.equal(layerIds.has(layer[0]), false);
          layerIds.add(layer[0]);
          layerCount += 1;
        }
      }
      const family = atlasFamily(plan);
      assert.equal(sha256(literalPlanAuthority(plan)), plan.canonicalSha256);
      assert.equal(plan.canonicalSha256, LITERAL_CELL_PLAN_DIGESTS[family].kits[kit]);
    }
    const scene = LITERAL_AUTHORITY.keyScenes[kit];
    assert.equal(sha256(scene), KEY_SCENE_DIGESTS.kits[kit]);
    assert.deepEqual(scene.terrainRows, expectedTerrainRows(REGIONAL_R4_SCENE_PLANS[kit]));
    assert.equal(scene.macroLayers.length, {
      "worn-heartland": 12, "spring-terraces": 4, "dry-scrub": 12,
      "ash-waste": 13, "neutral-temperate": 12,
    }[kit]);
    assert.equal(scene.macroLayers.every((layer) => layer.length === 5), true);
    assert.deepEqual(scene.macroLayers.map(([, , , x, y]) => [x, y]), KEY_SCENE_MACRO_ANCHORS[kit]);
    assert.equal(new Set(scene.macroLayers.map(([, , , x, y]) => `${x},${y}`)).size,
      scene.macroLayers.length);
    if (kit === "spring-terraces") {
      assert.deepEqual(scene.macroLayers.map(([, sourceId, role]) => [sourceId, role]),
        Array.from({ length: 4 }, (_unused, index) => [
          `spring:v10-scene-macro-${index}`, "spring-scene-macro",
        ]));
    } else {
      const macroXs = scene.macroLayers.map(([, , , x]) => x);
      const macroYs = scene.macroLayers.map(([, , , , y]) => y);
      assert.ok(Math.max(...macroXs) - Math.min(...macroXs) >= 700);
      assert.ok(Math.max(...macroYs) - Math.min(...macroYs) >= 440);
      assert.deepEqual([...new Set(scene.macroLayers.map(([, , , x, y]) => (
        `${x < 384 ? "west" : "east"}-${y < 256 ? "north" : "south"}`
      )))].sort(), ["east-north", "east-south", "west-north", "west-south"]);
    }
    assert.equal(scene.landmarkLayers.length, 8);
    assert.deepEqual(scene.landmarkLayers.map(({ cell, variantId, x, y, clusterId, role }) => (
      [cell, variantId, x, y, clusterId, role]
    )), KEY_SCENE_LANDMARKS[kit]);
    assert.equal(scene.supportLayers.length, 16);
    assert.equal(scene.yardLayers.length, 3);
    assert.equal(scene.humanLayers.length, 3);
    assertKeySceneClusterProofs(LITERAL_AUTHORITY, kit);
    const feet = scene.humanLayers.map(({ x, y }) => ({ x: x + 24, y: y + 61 }));
    assert.equal(REGIONAL_R4_SCENE_PLANS[kit].routeTiles.some(({ x, y }) => (
      feet[0].x === x * 32 + 16 && feet[0].y === y * 32 + 16
    )), true);
    assert.equal(REGIONAL_R4_SCENE_PLANS[kit].landmarks.some(({ x, y }) => (
      feet[1].x >= x && feet[1].x < x + 128 && feet[1].y >= y && feet[1].y < y + 128
    )), true);
    if (kit === "dry-scrub") {
      assert.deepEqual([scene.humanLayers[2].x - scene.homeLayer.x,
        scene.humanLayers[2].y - scene.homeLayer.y], [80, 38],
      "Dry owns its accepted V32 source-derived shelter presentation offset");
      assert.notDeepEqual(feet[2], REGIONAL_R4_SCENE_PLANS[kit].home.doorCenterPx);
    } else if (["worn-heartland", "spring-terraces", "ash-waste", "neutral-temperate"].includes(kit)) {
      const presentationOffset = LITERAL_AUTHORITY.mechanicsBindings.entranceDepth
        .shelterDoorPresentationAnchor.homeOffset;
      assert.deepEqual([scene.humanLayers[2].x, scene.humanLayers[2].y], [
        scene.homeLayer.x + presentationOffset.x, scene.homeLayer.y + presentationOffset.y,
      ], `${kit} shelter witness must use the proof-only presentation anchor`);
      assert.notDeepEqual(feet[2], REGIONAL_R4_SCENE_PLANS[kit].home.doorCenterPx,
        `${kit} presentation witness may not impersonate the unchanged R4 door/collision anchor`);
    } else assert.deepEqual(feet[2], REGIONAL_R4_SCENE_PLANS[kit].home.doorCenterPx);
    assert.deepEqual(scene.yardLayers.map(({ cell, x, y }) => [cell, x, y]), [0, 2, 3].map((cell) => [
      cell, REGIONAL_R4_SCENE_PLANS[kit].yard.originPx.x, REGIONAL_R4_SCENE_PLANS[kit].yard.originPx.y,
    ]));
    for (const layer of scene.literalPatchLayers) {
      const patch = LITERAL_AUTHORITY.literalPatches.patches.find(({ id }) => id === layer.patchId);
      assert.ok(patch, `${layer.id} must reference literal patch authority`);
      assert.equal(patch.ownerKit, kit, `${layer.id} patch owner must match scene kit`);
      assert.ok(LITERAL_AUTHORITY.literalPatches.roleBindings[layer.role]?.includes(layer.patchId),
        `${layer.id} patch role must be bound`);
      assert.deepEqual([layer.width, layer.height], [patch.width, patch.height]);
    }
    if (kit === "worn-heartland") {
      assert.deepEqual(scene.literalPatchLayers.map(({
        patchId, x, y, width, height, role, clusterId, routeRelation,
      }) => [patchId, x, y, width, height, role, clusterId, routeRelation]),
      WORN_SCENE_PATCH_LAYERS);
    } else if (kit === "ash-waste") {
      assert.deepEqual(scene.literalPatchLayers.map(({ patchId, x, y, width, height }) => (
        [patchId, x, y, width, height]
      )), ASH_SCENE_PATCH_RECTS);
      assert.deepEqual(scene.literalPatchLayers.map(({ id }) => id), [
        ...Array.from({ length: 9 }, (_unused, index) => `r5-scene/ash-waste/patch/${index}`),
        "r5-scene/ash-waste/patch/ground-foundation",
        "r5-scene/ash-waste/patch/cluster-foundation",
      ]);
      for (const layer of scene.literalPatchLayers) {
        assert.equal(layer.role, ASH_PATCH_ROLES[layer.patchId]);
        assert.deepEqual({ clusterId: layer.clusterId, routeRelation: layer.routeRelation },
          ASH_ROLE_SCENE_BINDINGS[layer.role]);
      }
    } else if (kit === "neutral-temperate") {
      assert.deepEqual(scene.literalPatchLayers.map(({
        patchId, x, y, width, height, role, clusterId, routeRelation,
      }) => [patchId, x, y, width, height, role, clusterId, routeRelation]),
      NEUTRAL_SCENE_PATCH_LAYERS);
      assert.deepEqual(scene.literalPatchLayers.map(({ id }) => id), [
        "r5-scene/neutral-temperate/patch/ground-foundation",
        "r5-scene/neutral-temperate/patch/cluster-foundation",
        "r5-scene/neutral-temperate/patch/pond-foundation",
        "r5-scene/neutral-temperate/patch/grove-understory",
        "r5-scene/neutral-temperate/patch/lane-foundation",
        "r5-scene/neutral-temperate/patch/stone-wall",
      ]);
    } else if (kit === "spring-terraces") {
      assert.deepEqual(scene.literalPatchLayers.map(({
        patchId, x, y, width, height, role, clusterId, routeRelation,
      }) => [patchId, x, y, width, height, role, clusterId, routeRelation]),
      SPRING_SCENE_PATCH_LAYERS);
      assert.deepEqual(scene.completeUnderlayLayers.map(({
        patchId, x, y, width, height, role,
      }) => [patchId, x, y, width, height, role]), SPRING_COMPLETE_UNDERLAY_LAYERS);
    } else if (kit === "dry-scrub") {
      assert.deepEqual(scene.literalPatchLayers.map(({
        patchId, x, y, width, height, role, clusterId, routeRelation,
      }) => [patchId, x, y, width, height, role, clusterId, routeRelation]),
      DRY_SCENE_PATCH_LAYERS);
      assert.deepEqual(scene.completeUnderlayLayers.map(({
        patchId, x, y, width, height, role,
      }) => [patchId, x, y, width, height, role]), DRY_COMPLETE_UNDERLAY_LAYERS);
      assert.deepEqual(scene.completeForegroundLayers.map(({
        patchId, x, y, width, height, role,
      }) => [patchId, x, y, width, height, role]), DRY_COMPLETE_FOREGROUND_LAYERS);
    } else assert.deepEqual(scene.literalPatchLayers, []);
  }
  assert.deepEqual({ planCount, cellCount, layerCount }, { planCount: 20, cellCount: 885, layerCount: 1785 });
  assert.equal(layerIds.size, 1785);
  assert.deepEqual(semanticCell(LITERAL_AUTHORITY.atlasAuthoringPlans["neutral-temperate"][3], 3)[2]
    .map(([, , sourceKind, sourceId, role, x, y]) => [sourceKind, sourceId, role, x, y]), [
    ["crop", "r5-home/neutral-temperate/roof-intact", "hoard-salvaged-masonry", 132, 124],
    ["crop", "r5-home/neutral-temperate/salvaged-chimney-stack", "hoard-salvaged-masonry", 152, 108],
    ["crop", "r5-home/neutral-temperate/roof-damaged", "hoard-salvaged-masonry", 140, 124],
  ], "neutral hoard must read as architectural salvage outside the door corridor");
  const clusterProofs = LITERAL_AUTHORITY.mechanicsBindings.visualProofBindings.clusterProofs;
  const { canonicalSha256: clusterDigest, ...clusterAuthority } = clusterProofs;
  assert.equal(sha256(clusterAuthority), clusterDigest);
  assert.equal(sha256(LITERAL_AUTHORITY.keyScenes), KEY_SCENE_DIGESTS.aggregate);
});

test("successor visual-proof schemas close named witnesses and the approved ash atlas", () => {
  const bindings = LITERAL_AUTHORITY.mechanicsBindings.visualProofBindings;
  const { canonicalSha256: bindingsDigest, ...bindingsAuthority } = bindings;
  assert.equal(bindingsDigest, VISUAL_PROOF_BINDINGS_DIGEST);
  assert.equal(sha256(bindingsAuthority), VISUAL_PROOF_BINDINGS_DIGEST);
  for (const record of bindings.clusterProofs.records) {
    assert.deepEqual(Object.keys(record.metrics.omitOneVisibleShares),
      ["route", "landmark", "supportA", "supportB"]);
  }
  for (const proof of bindings.homeActorProofs.kitProofs) {
    assert.deepEqual(proof.terrainPreviewRect, { x: 0, y: 0, width: 192, height: 160 });
  }
  const north = LITERAL_AUTHORITY.keyScenes["worn-heartland"].supportLayers
    .filter(({ clusterId }) => clusterId === "worn-oak-north");
  assert.deepEqual(north.map(({ sceneryKind }) => sceneryKind), ["worn-stone", "faded-flower"]);
  const proof = bindings.ashLandmarkAtlasProof;
  assert.deepEqual(Object.keys(proof), [
    "schema", "sourcePrescriptionSha256", "visualContractSha256", "atlasId", "geometry",
    "sourceLedger", "patchLedger", "cells", "atlasRgbaSha256", "canonicalSha256",
  ]);
  assert.deepEqual({
    sourceLayers: proof.sourceLedger.length,
    patchUses: proof.patchLedger.length,
    cells: proof.cells.length,
    uniquePatches: new Set(proof.patchLedger.map(({ patchId }) => patchId)).size,
    atlasRgbaSha256: proof.atlasRgbaSha256,
  }, {
    sourceLayers: 0,
    patchUses: 8,
    cells: 8,
    uniquePatches: 8,
    atlasRgbaSha256: ASH_ATLAS_RGBA_SHA256,
  });
  const plan = LITERAL_AUTHORITY.atlasAuthoringPlans["ash-waste"][2];
  assert.deepEqual(plan.semanticCells.map(([, , layers]) => layers.length), Array(8).fill(1));
});

test("literal authority regions have distinct composition graphs and route-connected scenery", () => {
  assert.deepEqual(literalAuthorityErrors(LITERAL_AUTHORITY), []);
});

test("literal geometry hostiles report exact dedicated diagnostics", () => {
  for (const { code, mutate } of geometryHostiles()) {
    const candidate = structuredClone(LITERAL_AUTHORITY);
    mutate(candidate);
    const errors = literalAuthorityErrors(candidate);
    assert.ok(errors.includes(code), `${code} missing from ${errors.join(", ")}`);
  }
});


authorityTest("R5 authoring module exports only the ten inert authorities plus validator", () => {
  assert.deepEqual(Object.keys(authoring).sort(), [
    "REGIONAL_R5_ATLAS_AUTHORING_PLANS",
    "REGIONAL_R5_AUTHORING_KITS",
    "REGIONAL_R5_AUTHORING_SOURCES",
    "REGIONAL_R5_AUTHORING_SPEC",
    "REGIONAL_R5_CROPS",
    "REGIONAL_R5_KEY_SCENES",
    "REGIONAL_R5_LITERAL_PATCHES",
    "REGIONAL_R5_MECHANICS_BINDINGS",
    "REGIONAL_R5_NORMALIZATION",
    "REGIONAL_R5_PALETTES",
    "validateRegionalR5AuthoringSpec",
  ]);
  assert.equal(typeof validateRegionalR5AuthoringSpec, "function");
  for (const [name, value] of Object.entries(authoring)) {
    if (name !== "validateRegionalR5AuthoringSpec") assert.notEqual(typeof value, "function");
  }
});

authorityTest("all ten module authorities exactly equal the checked-in literal authority", () => {
  assert.deepEqual(REGIONAL_R5_AUTHORING_KITS, LITERAL_AUTHORITY.authoringKits);
  assert.deepEqual(REGIONAL_R5_AUTHORING_SOURCES, LITERAL_AUTHORITY.authoringSources);
  assert.deepEqual(REGIONAL_R5_NORMALIZATION, LITERAL_AUTHORITY.normalization);
  assert.deepEqual(REGIONAL_R5_PALETTES, LITERAL_AUTHORITY.palettes);
  assert.deepEqual(REGIONAL_R5_CROPS, LITERAL_AUTHORITY.crops);
  assert.deepEqual(REGIONAL_R5_LITERAL_PATCHES, LITERAL_AUTHORITY.literalPatches);
  assert.deepEqual(REGIONAL_R5_MECHANICS_BINDINGS, LITERAL_AUTHORITY.mechanicsBindings);
  assert.deepEqual(REGIONAL_R5_ATLAS_AUTHORING_PLANS, LITERAL_AUTHORITY.atlasAuthoringPlans);
  assert.deepEqual(REGIONAL_R5_KEY_SCENES, LITERAL_AUTHORITY.keyScenes);
  assert.deepEqual(REGIONAL_R5_AUTHORING_SPEC, LITERAL_AUTHORITY.authoringSpec);
});

test("authoring authority is statically inert and contains no generic scene-placement constructors", async () => {
  assert.deepEqual(AUTHORING_SOURCE_ERRORS, []);
  assert.match(AUTHORING_SOURCE, /["']?(?:assetId|contractId)["']?:\s*["']core-human-body-rigs:1["']/,
    "inert human asset strings are legal data");
});

test("source AST gate rejects effects and generated authority without executing fixtures", () => {
  const importLine = "import { REGIONAL_R4_SCENE_PLANS, REGIONAL_R4_VARIANT_RECIPES } from './regional-art-r4-spec.mjs';\n";
  const prefix = `${importLine}${CANONICAL_DEEP_FREEZE_SOURCE}\n`;
  const marker = "__r5_ast_fixture_not_executed__";
  delete globalThis[marker];
  const authorityNames = [
    "REGIONAL_R5_AUTHORING_KITS",
    "REGIONAL_R5_AUTHORING_SOURCES",
    "REGIONAL_R5_NORMALIZATION",
    "REGIONAL_R5_PALETTES",
    "REGIONAL_R5_CROPS",
    "REGIONAL_R5_LITERAL_PATCHES",
    "REGIONAL_R5_MECHANICS_BINDINGS",
    "REGIONAL_R5_ATLAS_AUTHORING_PLANS",
    "REGIONAL_R5_KEY_SCENES",
    "REGIONAL_R5_AUTHORING_SPEC",
  ];
  const exactAuthorities = (replacement = null) => authorityNames.map((name, index) => (
    `export const ${name} = deepFreeze(${replacement?.name === name
      ? replacement.literal : `{ ordinal: ${index}, assetId: "core-human-body-rigs:1" }`});`
  )).join("\n");
  const validAuthorities = exactAuthorities();
  const validValidator = `export function validateRegionalR5AuthoringSpec(candidate = REGIONAL_R5_AUTHORING_SPEC) {
  function descriptorFor(value, key) { return Object.getOwnPropertyDescriptor(value, key); }
  const keys = Reflect.ownKeys(candidate);
  if (!Array.isArray(keys)) return ["invalid"];
  for (const key of keys) {
    const descriptor = descriptorFor(candidate, key);
    if (!descriptor) return ["invalid"];
  }
  return [];
}`;
  const canonicalModule = `${prefix}${validAuthorities}
export function validateRegionalR5AuthoringSpec(candidate = REGIONAL_R5_AUTHORING_SPEC) {
  const keys = Reflect.ownKeys(candidate);
  if (!Array.isArray(keys)) return ["invalid"];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
    if (!descriptor) return ["invalid"];
    if ("value" in descriptor && descriptor.value !== null && typeof descriptor.value === "object") {
      const nestedKeys = Reflect.ownKeys(descriptor.value);
      for (const nestedKey of nestedKeys) {
        const nestedDescriptor = Object.getOwnPropertyDescriptor(descriptor.value, nestedKey);
        if (!nestedDescriptor) return ["invalid"];
      }
    }
  }
  return [];
}`;
  assert.deepEqual(inertSourceErrors(canonicalModule), [],
    "canonical deepFreeze and inert human asset strings must remain legal");
  assert.deepEqual(inertSourceErrors(`${prefix}${validAuthorities}\n${validValidator}`), [],
    "a direct helper may carry candidate/key provenance into a descriptor result");
  const refinedHelperDescriptorModule = `${prefix}${validAuthorities}
export function validateRegionalR5AuthoringSpec(candidate = REGIONAL_R5_AUTHORING_SPEC) {
  function descriptorFor(value, key) {
    return Object.getOwnPropertyDescriptor(value, key);
  }
  const descriptor = descriptorFor(candidate, 'ordinal');
  if (!descriptor) return ['invalid'];
  if ('value' in descriptor && descriptor.value !== null
    && typeof descriptor.value === 'object') return ['nested'];
  return [];
}`;
  assert.deepEqual(inertSourceErrors(refinedHelperDescriptorModule), [],
    "a helper descriptor stays maybe-absent until the same binding is existence-refined");
  const keyHelperModule = `${prefix}${validAuthorities}
export function validateRegionalR5AuthoringSpec(candidate = REGIONAL_R5_AUTHORING_SPEC) {
  function firstOwnKey(value) {
    const keys = Reflect.ownKeys(value);
    for (const key of keys) return key;
    return null;
  }
  const key = firstOwnKey(candidate);
  const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
  if (!descriptor) return ["invalid"];
  return [];
}`;
  assert.deepEqual(inertSourceErrors(keyHelperModule), [],
    "a helper return proven to be an own-key token remains a legal descriptor key");
  const topLevelFixtures = [
    `globalThis.${marker} = 1;`,
    "console.log('effect');",
    `Reflect.set(globalThis, '${marker}', 1);`,
    "const value = import('./effect.mjs');",
    "const value = fetch('https://example.invalid');",
    "const value = setTimeout(() => {}, 0);",
    "const value = Math.random();",
    "const value = (() => 1)();",
    "let rows = []; rows.push('generated');",
    "const rows = Array.from({length: 2}, (_, index) => index);",
    "const rows = [1, 2].map((value) => value);",
    "const root = window;",
    "const root = self;",
    "const root = eval;",
    "const root = Function;",
    "const root = Proxy;",
    "const root = Promise;",
    "const root = globalThis;",
    "const root = [][\"filter\"][\"constructor\"]('return this')();",
    "function side(value) { return value; } const value = side({});",
    "function mutate(value) { Object.defineProperty(value, 'x', {value: 1}); }",
    "function mutate(value) { Reflect.defineProperty(value, 'x', {value: 1}); }",
    "function mutate(value) { Object['defineProperty'](value, 'x', {value: 1}); }",
    "function mutate(value) { Reflect['set'](value, 'x', 1); }",
    "function mutate(value) { const O = Object; O.defineProperty(value, 'x', {value: 1}); }",
    "function mutate(value) { const R = Reflect; R.set(value, 'x', 1); }",
    "function mutate(value) { const O = (0, Object); O.defineProperty(value, 'x', {value: 1}); }",
    "function mutate(value) { const R = (Reflect); R.set(value, 'x', 1); }",
    "function extract() { return Object.valueOf(); }",
    "function extract() { return Reflect.valueOf(); }",
    "function mutate(value) { const push = value.rows.push; push.call(value.rows, 'generated'); }",
    "function mutate(value) { const sort = value.rows['sort']; sort.call(value.rows); }",
    "function schedule() { Promise.resolve().then(() => {}); }",
    "function aliasFreeze() { const freeze = deepFreeze; return freeze; }",
    `const value = deepFreeze((globalThis.${marker} = 1, {}));`,
    `const value = deepFreeze({ get unsafe() { globalThis.${marker} = 1; return 1; } });`,
    `const value = deepFreeze({ unsafe() { globalThis.${marker} = 1; } });`,
    "function normalizedGuideSprite() { return {}; }",
    "const transformGuideSprite = () => ({});",
    "function human() { return {}; }",
  ];
  for (const fixture of topLevelFixtures) {
    assert.ok(inertSourceErrors(`${canonicalModule}\n${fixture}`).length > 0, fixture);
    assert.equal(globalThis[marker], undefined, `${fixture} must never execute`);
  }
  const duplicateAuthorityModules = [
    `${prefix}${validAuthorities}
export const REGIONAL_R5_AUTHORING_KITS = deepFreeze({ duplicate: true });
${validValidator}`,
    `${prefix}${validAuthorities}
export const REGIONAL_R4_SCENE_PLANS = deepFreeze({ duplicate: true });
${validValidator}`,
    `${prefix}${validAuthorities}
export const deepFreeze = deepFreeze({ duplicate: true });
${validValidator}`,
    `${prefix}${validAuthorities}
${validValidator}
export const LATE_AUTHORITY = deepFreeze({ late: true });`,
  ];
  for (const module of duplicateAuthorityModules) {
    assert.ok(inertSourceErrors(module).some((error) => error.startsWith("top-level:")), module);
  }
  const literalFixtures = [
    "{ ...AUTHORITY }",
    "[...REGIONAL_R4_SCENE_PLANS]",
    "{ [\"computed\"]: 1 }",
    "{ AUTHORITY }",
    "true ? { value: 1 } : { value: 2 }",
    "{ value: 1 + 2 }",
    "(AUTHORITY, { value: 1 })",
    "{ url: import.meta.url }",
    "{ value: Math.max(1, 2) }",
    "{ value: JSON.stringify({}) }",
    "{ value: Symbol.for(\"x\") }",
    "{ value: (() => 1)() }",
    "{ value: new Date() }",
    "{ value: `generated-${AUTHORITY}` }",
    "{ future: FUTURE }",
    "{ self: AUTHORITY }",
    "{ \"\\u005f_proto__\": 1 }",
    "{ a: 1, \"\\u0061\": 2 }",
    "{ value: 1e309 }",
  ];
  for (const literal of literalFixtures) {
    const module = `${prefix}${exactAuthorities({
      name: "REGIONAL_R5_AUTHORING_KITS",
      literal,
    })}\n${validValidator}`;
    assert.ok(inertSourceErrors(module).some((error) => error.startsWith("literal:")), literal);
    assert.equal(globalThis[marker], undefined, `${literal} must never execute`);
  }
  const validatorModule = (body) => `${prefix}${validAuthorities}
export function validateRegionalR5AuthoringSpec(candidate = REGIONAL_R5_AUTHORING_SPEC) { ${body} }`;
  const validatorFixtures = [
    `globalThis.${marker} = 1; return [];`,
    "return candidate.sources;",
    "return candidate['sources'];",
    "const alias = candidate; return alias.sources;",
    "const alias = candidate; return alias['sources'];",
    "const descriptor = Object.getOwnPropertyDescriptor(candidate, 'sources'); return descriptor['value'];",
    "const descriptor = Object.getOwnPropertyDescriptor(candidate, 'sources'); return descriptor.value.regionKits;",
    "const descriptor = Object.getOwnPropertyDescriptor(candidate, 'sources'); const nested = descriptor.value; return nested['regionKits'];",
    "function read(value) { return value.sources; } return read(candidate);",
    "const read = (value) => value['sources']; return read(candidate);",
    "const box = { value: candidate }; return box.value;",
    "const list = [candidate]; return list[0];",
    "for (const value of candidate) { return []; } return [];",
    "return Object.values(candidate);",
    "return Object.entries(candidate);",
    "return Object.getOwnPropertyDescriptor(candidate, candidate);",
    "return Reflect.getOwnPropertyDescriptor(candidate, candidate);",
    "return Object.hasOwn(candidate, candidate);",
    "const alias = candidate; return Object.getOwnPropertyDescriptor(alias, alias);",
    "const descriptor = Object.getOwnPropertyDescriptor(candidate, 'sources'); return Object.getOwnPropertyDescriptor(candidate, descriptor.value);",
    "function descriptorFor(value, key) { return Object.getOwnPropertyDescriptor(value, key); } return descriptorFor(candidate, candidate);",
    "return candidate == 0;",
    "return candidate != 0;",
    "return REGIONAL_R4_SCENE_PLANS + '';",
    "return +REGIONAL_R4_SCENE_PLANS;",
    "const descriptor = Object.getOwnPropertyDescriptor(candidate, 'sources'); return ~descriptor;",
    "const descriptor = Object.getOwnPropertyDescriptor(candidate, 'sources'); return descriptor < 1;",
    "const keys = Reflect.ownKeys(candidate); return keys * 2;",
    "function looselyEqual(value) { return value == 0; } return looselyEqual(candidate);",
    "const alias = Object.getOwnPropertyDescriptor(candidate, 'sources').value; return alias + '';",
    "for (const value of Object.getOwnPropertyDescriptor(candidate, 'sources').value) { return []; } return [];",
    "const keys = Reflect.ownKeys(candidate); return keys[candidate];",
    "const keys = Reflect.ownKeys(candidate); return Object.getOwnPropertyDescriptor(candidate, keys[candidate]);",
    "return REGIONAL_R4_SCENE_PLANS[candidate];",
    "return REGIONAL_R4_SCENE_PLANS.keyScenes;",
    "function Object() { return []; } return Object.getOwnPropertyDescriptor(candidate, 'sources');",
    "function inspect(value) { return []; } function invoke(inspect) { return inspect(candidate); } return invoke(candidate);",
    "function inspect(value) { return []; } return Object.is(candidate, inspect);",
    "const box = { a: 1, \"\\u0061\": 2 }; return [];",
    "const box = { \"\\u005f_proto__\": candidate }; return Reflect.ownKeys(box);",
    "function inspect(value) { return []; } const inspect = candidate; return [];",
    "function leakKey(value) { return Object.getOwnPropertyDescriptor(value, 'sources').value; } return Object.getOwnPropertyDescriptor(candidate, leakKey(candidate));",
    "return Object.getOwnPropertyDescriptor(candidate, candidate || 'sources');",
    "return Object.getOwnPropertyDescriptor(candidate, candidate && 'sources');",
    "return Object.getOwnPropertyDescriptor(candidate, candidate ?? 'sources');",
    "return Object.getOwnPropertyDescriptor(candidate, Object.getPrototypeOf(candidate));",
    "return Object.getOwnPropertyDescriptor(candidate, Reflect.getPrototypeOf(candidate));",
    "const descriptor = Object.getOwnPropertyDescriptor(candidate, 'sources'); return Object.hasOwn(candidate, descriptor.value || 'sources');",
    "return (candidate === null).valueOf;",
    "function closeOverCandidate() { return candidate.sources; } return closeOverCandidate();",
    "function identity(value) { return value; } function invoke(callback) { return callback(); } return invoke(identity);",
    "const descriptor = Object.getOwnPropertyDescriptor(candidate, 'sources'); const keys = Reflect.ownKeys(candidate); return keys[descriptor.value];",
    "const keys = Reflect.ownKeys(candidate); return keys.map((key) => candidate[key]);",
    "return Object.freeze(candidate);",
    "return Reflect.defineProperty(candidate, 'x', { value: 1 });",
    "candidate.x = 1; return [];",
    "delete candidate.x; return [];",
    "candidate.rows.push('generated'); return [];",
    "candidate.rows['splice'](0, 0, 'generated'); return [];",
    "candidate.rows[`sort`](); return [];",
    "candidate.rows['re' + 'verse']()['reverse'](); return [];",
    "const mutate = candidate.rows.push; return mutate(candidate);",
    "const keys = Reflect.ownKeys; return keys(candidate);",
    "return (Reflect.ownKeys)(candidate);",
    "const dynamic = candidate.fn; return dynamic(candidate);",
    "const io = fetch; return io('https://example.invalid');",
    "const io = require; return io('fs');",
    "const io = navigator.sendBeacon; return io('/effect');",
    "const io = document.write; return io('effect');",
    "const io = setTimeout; return io(() => {}, 0);",
    "return Promise.resolve([]).then(() => []);",
    "return candidate.then(() => []);",
    "return Array.from(candidate);",
    "return Object.keys(candidate).map((key) => key);",
    "return eval('[]');",
    "return Function('return []')();",
  ];
  for (const fixture of validatorFixtures) {
    assert.ok(inertSourceErrors(validatorModule(fixture)).some((error) => error.startsWith("validator:")), fixture);
    assert.equal(globalThis[marker], undefined, `${fixture} must never execute`);
  }
  for (const mutator of [
    "push", "pop", "splice", "sort", "reverse", "copyWithin", "fill", "shift", "unshift",
  ]) {
    const fixture = `candidate.rows.${mutator}('generated'); return [];`;
    assert.ok(inertSourceErrors(validatorModule(fixture)).some((error) => error.startsWith("validator:")), fixture);
    assert.equal(globalThis[marker], undefined, `${fixture} must never execute`);
  }
  const aliasedImport = "import { EVIL as REGIONAL_R4_SCENE_PLANS, REGIONAL_R4_VARIANT_RECIPES } from './regional-art-r4-spec.mjs';";
  assert.ok(inertSourceErrors(aliasedImport).some((error) => /aliases/.test(error)));

  const mutatedDeepFreezeAttacks = [
    `Object.defineProperty(globalThis, "${marker}", { value: 1 });`,
    `Reflect.defineProperty(globalThis, "${marker}", { value: 1 });`,
    `eval("globalThis.${marker} = 1");`,
    `Function("globalThis.${marker} = 1")();`,
    `const root = globalThis; root.${marker} = 1;`,
    `Promise.resolve().then(() => { globalThis.${marker} = 1; });`,
    "side(value);",
    "value.rows.push('generated');",
    "value.rows.splice(0, 0, 'generated');",
    "value.rows.sort();",
    "value.rows.map((row) => row);",
    "value.rows.filter((row) => row);",
    "value.rows.reduce((rows, row) => [...rows, row], []);",
    "Object.defineProperty(value, 'rows', { value: value.rows.map((row) => row) });",
  ];
  for (const attack of mutatedDeepFreezeAttacks) {
    const mutated = CANONICAL_DEEP_FREEZE_SOURCE.replace(
      "  return Object.freeze(value);",
      `  ${attack}\n  return Object.freeze(value);`,
    );
    const helper = attack === "side(value);" ? "\nfunction side(value) { return value; }" : "";
    const errors = inertSourceErrors(`${importLine}${helper}\n${mutated}\nconst authority = deepFreeze({ rows: [] });`);
    assert.ok(errors.some((error) => /deepFreeze: canonical (?:source text\/hash|AST hash) drift/.test(error)), attack);
    assert.equal(globalThis[marker], undefined, `${attack} must never execute`);
  }
});

test("source AST gate closes ECMAScript shape, bindings, recursion, and provenance bypasses", () => {
  const importLine = "import { REGIONAL_R4_SCENE_PLANS, REGIONAL_R4_VARIANT_RECIPES } from './regional-art-r4-spec.mjs';";
  const authorityNames = [
    "REGIONAL_R5_AUTHORING_KITS",
    "REGIONAL_R5_AUTHORING_SOURCES",
    "REGIONAL_R5_NORMALIZATION",
    "REGIONAL_R5_PALETTES",
    "REGIONAL_R5_CROPS",
    "REGIONAL_R5_LITERAL_PATCHES",
    "REGIONAL_R5_MECHANICS_BINDINGS",
    "REGIONAL_R5_ATLAS_AUTHORING_PLANS",
    "REGIONAL_R5_KEY_SCENES",
    "REGIONAL_R5_AUTHORING_SPEC",
  ];
  const authorities = authorityNames.map((name, index) => (
    `export const ${name} = deepFreeze({ ordinal: ${index} });`
  )).join("\n");
  const validator = (body, signature = "candidate = REGIONAL_R5_AUTHORING_SPEC",
    modifiers = "export") => `${modifiers} function validateRegionalR5AuthoringSpec(${signature}) {
${body}
}`;
  const moduleWith = (body = "  return [];", options = {}) => [
    options.importLine ?? importLine,
    CANONICAL_DEEP_FREEZE_SOURCE,
    options.authorities ?? authorities,
    options.validator ?? validator(body),
  ].join("\n");
  assert.deepEqual(inertSourceErrors(moduleWith()), [], "closed minimal module must remain legal");
  assert.deepEqual(inertSourceErrors(moduleWith(
    "  if (candidate === null) return ['invalid']; else return [];",
  )), [], "an if/else whose two branches return is a total function");

  const hostiles = [
    ["type-only import clause", moduleWith(undefined, {
      importLine: "import type { REGIONAL_R4_SCENE_PLANS, REGIONAL_R4_VARIANT_RECIPES } from './regional-art-r4-spec.mjs';",
    })],
    ["type-only import specifier", moduleWith(undefined, {
      importLine: "import { type REGIONAL_R4_SCENE_PLANS, REGIONAL_R4_VARIANT_RECIPES } from './regional-art-r4-spec.mjs';",
    })],
    ["self-alias import specifier", moduleWith(undefined, {
      importLine: "import { REGIONAL_R4_SCENE_PLANS as REGIONAL_R4_SCENE_PLANS, REGIONAL_R4_VARIANT_RECIPES } from './regional-art-r4-spec.mjs';",
    })],
    ["import assertion", moduleWith(undefined, {
      importLine: "import { REGIONAL_R4_SCENE_PLANS, REGIONAL_R4_VARIANT_RECIPES } from './regional-art-r4-spec.mjs' assert { type: 'json' };",
    })],
    ["import attributes", moduleWith(undefined, {
      importLine: "import { REGIONAL_R4_SCENE_PLANS, REGIONAL_R4_VARIANT_RECIPES } from './regional-art-r4-spec.mjs' with { type: 'json' };",
    })],
    ["root parameter type annotation", moduleWith("  return [];", {
      validator: validator("  return [];", "candidate: unknown = REGIONAL_R5_AUTHORING_SPEC"),
    })],
    ["root optional parameter", moduleWith("  return [];", {
      validator: validator("  return [];", "candidate? = REGIONAL_R5_AUTHORING_SPEC"),
    })],
    ["root parameter modifier", moduleWith("  return [];", {
      validator: validator("  return [];", "public candidate = REGIONAL_R5_AUTHORING_SPEC"),
    })],
    ["root return type", moduleWith("  return [];", {
      validator: "export function validateRegionalR5AuthoringSpec(candidate = REGIONAL_R5_AUTHORING_SPEC): string[] { return []; }",
    })],
    ["root generic", moduleWith("  return [];", {
      validator: "export function validateRegionalR5AuthoringSpec<T>(candidate = REGIONAL_R5_AUTHORING_SPEC) { return []; }",
    })],
    ["helper generic and annotation", moduleWith(`  function inspect<T>(value: T): string[] { return []; }
  return inspect(candidate);`)],
    ["helper optional parameter", moduleWith(`  function inspect(value?) { return []; }
  return inspect(candidate);`)],
    ["call type arguments", moduleWith("  return Object.hasOwn<object>(candidate, 'ordinal') ? [] : [];" )],
    ["optional helper call", moduleWith(`  function inspect(value) { return []; }
  return inspect?.(candidate);`)],
    ["declare authority", moduleWith(undefined, {
      authorities: authorities.replace("export const REGIONAL_R5_CROPS", "export declare const REGIONAL_R5_CROPS"),
    })],
    ["default-export validator", moduleWith(undefined, {
      validator: validator("  return [];", "candidate = REGIONAL_R5_AUTHORING_SPEC", "export default"),
    })],
    ["declare local binding", moduleWith(`  declare const result = [];
  return result;`)],
    ["await-using local binding", moduleWith(`  await using result = [];
  return result;`)],
    ["extra top-level authority shadows Object", moduleWith(undefined, {
      authorities: `${authorities}\nexport const Object = deepFreeze({});`,
    })],
    ["global builtin shadowed in nested block", moduleWith(`  if (candidate !== null) {
    const URL = [];
    return URL;
  }
  return [];`)],
    ["restricted arguments binding shadowed", moduleWith(`  if (candidate !== null) {
    const arguments = [];
    return arguments;
  }
  return [];`)],
    ["authority shadowed in nested block", moduleWith(`  if (candidate !== null) {
    const REGIONAL_R5_CROPS = [];
    return REGIONAL_R5_CROPS;
  }
  return [];`)],
    ["candidate shadowed in nested block", moduleWith(`  if (candidate !== null) {
    const candidate = [];
    return candidate;
  }
  return [];`)],
    ["candidate shadowed in helper parameter", moduleWith(`  function inspect(candidate) { return []; }
  return inspect(candidate);`)],
    ["candidate shadowed in for-of binding", moduleWith(`  const keys = Reflect.ownKeys(candidate);
  for (const candidate of keys) return [];
  return [];`)],
    ["helper shadowed in for-of binding", moduleWith(`  function inspect(value) { return []; }
  const values = [];
  for (const inspect of values) return [];
  return inspect(candidate);`)],
    ["builtin shadowed in for-of binding", moduleWith(`  const values = [];
  for (const Object of values) return [];
  return [];`)],
    ["wrong root default", moduleWith("  return [];", {
      validator: validator("  return [];", "candidate = REGIONAL_R5_AUTHORING_KITS"),
    })],
    ["forward authority reference", moduleWith(undefined, {
      authorities: authorities.replace(
        "export const REGIONAL_R5_AUTHORING_KITS = deepFreeze({ ordinal: 0 });",
        "export const REGIONAL_R5_AUTHORING_KITS = deepFreeze({ later: REGIONAL_R5_AUTHORING_SPEC });",
      ),
    })],
    ["direct recursion", moduleWith(`  function inspect(value) { return inspect(value); }
  return inspect(candidate);`)],
    ["indirect recursion", moduleWith(`  function inspect(value) { return revisit(value); }
  function revisit(value) { return inspect(value); }
  return inspect(candidate);`)],
    ["conditional recursion", moduleWith(`  function inspect(value) {
    if (value === null) return [];
    return inspect(value);
  }
  return inspect(candidate);`)],
    ["root control-flow fallthrough", moduleWith(`  if (candidate === null) return [];`)],
    ["helper control-flow fallthrough", moduleWith(`  function inspect(value) {
    if (value === null) return [];
  }
  return inspect(candidate);`)],
    ["zero-iteration loop fallthrough", moduleWith(`  const values = [];
  for (const value of values) return [];`)],
    ["Symbol own-key template coercion", moduleWith(`  const keys = Reflect.ownKeys(candidate);
  for (const key of keys) return [\`${'${key}'}\`];
  return [];`)],
    ["reflective membership on trusted authority", moduleWith(
      "  return 'ordinal' in REGIONAL_R5_AUTHORING_KITS ? [] : [];",
    )],
    ["for-of over trusted authority", moduleWith(`  for (const value of REGIONAL_R5_AUTHORING_KITS) return [];
  return [];`)],
    ["initialized for-of binding", moduleWith(`  const keys = Reflect.ownKeys(candidate);
  for (const key = 'ordinal' of keys) return [];
  return [];`)],
    ["arbitrary own-key string index", moduleWith(`  const keys = Reflect.ownKeys(candidate);
  const key = keys['map'];
  const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
  if (!descriptor) return ['invalid'];
  return [];`)],
    ["prototype own-key retraversal", moduleWith(`  const prototype = Object.getPrototypeOf(candidate);
  const keys = Reflect.ownKeys(prototype);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (!descriptor) return ['invalid'];
  }
  return [];`)],
    ["prototype descriptor retraversal", moduleWith(`  const prototype = Object.getPrototypeOf(candidate);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'ordinal');
  if (!descriptor) return ['invalid'];
  return [];`)],
    ["descriptor-value template coercion", moduleWith(`  const descriptor = Object.getOwnPropertyDescriptor(candidate, 'ordinal');
  if (!descriptor) return ['invalid'];
  return [\`${'${descriptor.value}'}\`];`)],
    ["possibly absent descriptor dereference after truthy branch", moduleWith(`  const descriptor = Object.getOwnPropertyDescriptor(candidate, 'missing');
  if (descriptor) return [];
  const value = descriptor.value;
  return [];`)],
    ["helper preserves possibly absent descriptor provenance", moduleWith(`  function descriptorFor(value, key) {
    return Object.getOwnPropertyDescriptor(value, key);
  }
  const descriptor = descriptorFor(candidate, 'missing');
  if (descriptor) return [];
  const value = descriptor.value;
  return [];`)],
    ["descriptor refinement cannot leak out of a conditional branch", moduleWith(`  const descriptor = Object.getOwnPropertyDescriptor(candidate, 'missing');
  if (candidate === null) {
    if (!descriptor) return [];
  }
  const value = descriptor.value;
  return [];`)],
    ["ordinary helper parameter shadowed in nested block", moduleWith(`  function inspect(value) {
    if (value !== null) {
      const value = [];
      return value;
    }
    return [];
  }
  return inspect(candidate);`)],
    ["invalid mixed provenance local", moduleWith(`  const mixed = candidate || REGIONAL_R5_AUTHORING_SPEC;
  return [];`)],
    ["candidate returned from root", moduleWith("  return candidate;")],
    ["candidate propagated through helper to root", moduleWith(`  function identity(value) { return value; }
  return identity(candidate);`)],
  ];
  const accepted = hostiles.filter(([, source]) => inertSourceErrors(source).length === 0)
    .map(([label]) => label);
  assert.deepEqual(accepted, [], `hostile source modules accepted: ${accepted.join(", ")}`);
  assert.deepEqual(inertSourceErrors(moduleWith(
    "  return candidate === null ? ['invalid'] : [];",
  )), [], "ordinary ECMAScript conditional expressions must remain legal");
});

test("actual-module validator identity gate requires manually frozen non-placeholder pins", () => {
  const reviewedValidator = `export function validateRegionalR5AuthoringSpec(candidate = REGIONAL_R5_AUTHORING_SPEC) {
  return [];
}`;
  const unsetErrors = actualAuthoringValidatorIdentityErrors(reviewedValidator, {
    textSha256: null,
    astSha256: null,
  });
  assert.ok(unsetErrors.includes("validator-identity: exact source-text SHA-256 pin is unset or placeholder"));
  assert.ok(unsetErrors.includes("validator-identity: exact AST-shape SHA-256 pin is unset or placeholder"));
  assert.deepEqual(AUTHORING_SOURCE_ERRORS, [],
    "the independently reviewed production validator must match both frozen identity pins");

  for (const placeholder of [undefined, "", "PENDING_MANUAL_REVIEW", "0".repeat(64)]) {
    const errors = actualAuthoringValidatorIdentityErrors(reviewedValidator, {
      textSha256: placeholder,
      astSha256: placeholder,
    });
    assert.equal(errors.filter((error) => /unset or placeholder/.test(error)).length, 2,
      `placeholder ${String(placeholder)} must fail closed for both pins`);
  }
});

test("actual-module validator identity gate independently rejects text and AST drift", () => {
  const reviewedValidator = `export function validateRegionalR5AuthoringSpec(candidate = REGIONAL_R5_AUTHORING_SPEC) {
  return [];
}`;
  const manuallyFrozenPins = {
    textSha256: "e59918d7b9505065be2610f65d76b3e4e82294129d7b7ab8a24de4342969b7c8",
    astSha256: "214563385a4a7c038297d723ac974904e7e5bfb18a580858e5673d4a92b4f0b9",
  };
  assert.deepEqual(actualAuthoringValidatorIdentityErrors(reviewedValidator, manuallyFrozenPins), []);

  const textOnlyDrift = reviewedValidator.replace(
    "  return [];",
    "  // reviewed behavior; identity text must still remain exact.\n  return [];",
  );
  assert.deepEqual(actualAuthoringValidatorIdentityErrors(textOnlyDrift, manuallyFrozenPins), [
    "validator-identity: canonical source text/hash drift",
  ]);

  const astDrift = reviewedValidator.replace("return [];", 'return ["invalid"];');
  const astDriftErrors = actualAuthoringValidatorIdentityErrors(astDrift, manuallyFrozenPins);
  assert.ok(astDriftErrors.includes("validator-identity: canonical source text/hash drift"));
  assert.ok(astDriftErrors.includes("validator-identity: canonical AST hash drift"));
});

test("raw literal-authority JSON rejects duplicate cooked keys and non-JSON values before parsing", () => {
  assert.deepEqual(LITERAL_AUTHORITY_SOURCE_ERRORS, []);
  const hostileJson = [
    ['{"a":1,"\\u0061":2}', /duplicate cooked key a/],
    ['{"outer":{"a":1,"\\u0061":2}}', /duplicate cooked key a/],
    ['{"\\u005f_proto__":1}', /prototype-bearing key __proto__/],
    ['{"outer":{"pro\\u0074otype":1}}', /prototype-bearing key prototype/],
    ['{"outer":{"constr\\u0075ctor":1}}', /prototype-bearing key constructor/],
    ['{"value":1e309}', /finite numeric literal required/],
    ['{"outer":[-1e309]}', /finite numeric literal required/],
    ['{"value":undefined}', /outside strict JSON data grammar/],
    ['{"outer":{"value":undefined}}', /outside strict JSON data grammar/],
    ['[1,,2]', /dense JSON array required/],
    ['{"outer":[1,,2]}', /dense JSON array required/],
    ['// line comment\n{}', /comments are forbidden/],
    ['{/* block comment */"a":1}', /comments are forbidden/],
    ['{"a":1,}', /trailing commas are forbidden/],
    ['[1,]', /trailing commas are forbidden/],
    ['{"a":1,/* hidden */}', /trailing commas are forbidden/],
    ['[1,// hidden\n]', /trailing commas are forbidden/],
    ['{"value":0x10}', /strict JSON number required/],
    ['{"value":0o10}', /strict JSON number required/],
    ['{"value":0b10}', /strict JSON number required/],
    ['{"value":.5}', /strict JSON number required/],
    ['{"value":1.}', /strict JSON number required/],
    ['{"value":1_000}', /strict JSON number required/],
    ['{"value":+1}', /strict JSON number required/],
    ['{"value":01}', /strict JSON number required/],
    ['{"value":-01}', /strict JSON number required/],
    ['{"value":00}', /strict JSON number required/],
    ['{"value":1e}', /strict JSON number required/],
    ['{"value":1e+}', /strict JSON number required/],
    ['{"value":NaN}', /unexpected identifier NaN/],
    ['{"value":Infinity}', /unexpected identifier Infinity/],
    ['{"value":-Infinity}', /strict JSON number required/],
    ["{'a':1}", /unexpected character/],
    ['{a:1}', /unexpected identifier a/],
  ];
  for (const [source, expected] of hostileJson) {
    assert.match(rawJsonErrors(source).join("\n"), expected, source);
  }
});

authorityTest("canonical R5 authoring authority validates and every export is recursively frozen", () => {
  assert.deepEqual(validateRegionalR5AuthoringSpec(), []);
  assert.deepEqual(validateRegionalR5AuthoringSpec(structuredClone(REGIONAL_R5_AUTHORING_SPEC)), []);
  for (const [name, value] of Object.entries(authoring)) {
    if (name !== "validateRegionalR5AuthoringSpec") assertDeepFrozen(value);
  }
  assert.throws(() => {
    REGIONAL_R5_AUTHORING_KITS.push("intruder");
  }, TypeError);
});

authorityTest("validator default and absent-descriptor paths are total runtime functions", () => {
  for (const [label, invoke] of [
    ["omitted default", () => validateRegionalR5AuthoringSpec()],
    ["explicit undefined default", () => validateRegionalR5AuthoringSpec(undefined)],
  ]) {
    let diagnostics;
    assert.doesNotThrow(() => { diagnostics = invoke(); }, label);
    assert.deepEqual(diagnostics, [], `${label} must select and validate the canonical authority`);
  }

  for (const [label, candidate] of [
    ["null candidate", null],
    ["number primitive", 0],
    ["string primitive", "invalid"],
    ["null-prototype empty candidate", Object.create(null)],
    ["ordinary empty candidate", {}],
    ["partially present root", { schema: "vivarium-regional-art-r5-authoring-v1" }],
  ]) {
    let diagnostics;
    assert.doesNotThrow(() => {
      diagnostics = validateRegionalR5AuthoringSpec(candidate);
    }, `${label} must not dereference an absent descriptor`);
    assert.ok(Array.isArray(diagnostics), `${label} must return a diagnostic array`);
    assert.ok(diagnostics.length > 0, `${label} must be rejected rather than silently accepted`);
  }
});

authorityTest("validator is observational and never mutates, freezes, or invokes candidate accessors", () => {
  const valid = hostileSpec();
  const validBefore = mutationSnapshot(valid);
  const validNested = valid.keyScenes["ash-waste"].supportLayers[8];
  const validNestedBoundary = exactBoundarySnapshot(validNested);
  assert.deepEqual(validateRegionalR5AuthoringSpec(valid), []);
  assert.deepEqual(mutationSnapshot(valid), validBefore);
  assertExactBoundaryUnchanged(validNested, validNestedBoundary);
  assert.equal(Object.isExtensible(valid), true);
  assert.equal(Object.isFrozen(valid), false);
  assert.equal(Object.isFrozen(valid.keyScenes["ash-waste"].supportLayers), false);

  const hostile = hostileSpec();
  hostile.sources.regionKits.sha256 = "0".repeat(64);
  const hostileBefore = mutationSnapshot(hostile);
  assert.ok(validateRegionalR5AuthoringSpec(hostile).length > 0);
  assert.deepEqual(mutationSnapshot(hostile), hostileBefore);
  assert.equal(Object.isExtensible(hostile), true);
  assert.equal(Object.isFrozen(hostile), false);

  const frozen = freezeData(hostileSpec());
  const frozenBefore = mutationSnapshot(frozen);
  assert.deepEqual(validateRegionalR5AuthoringSpec(frozen), []);
  assert.deepEqual(mutationSnapshot(frozen), frozenBefore);

  let getterCalls = 0;
  const accessor = hostileSpec();
  Object.defineProperty(accessor, "sources", {
    configurable: true,
    enumerable: true,
    get() { getterCalls += 1; throw new Error("validator must not execute candidate accessors"); },
  });
  const accessorBefore = mutationSnapshot(accessor);
  const accessorBoundary = exactBoundarySnapshot(accessor, ["sources"]);
  assert.ok(validateRegionalR5AuthoringSpec(accessor).some((error) => /accessor|plain data/i.test(error)));
  assert.equal(getterCalls, 0);
  assert.deepEqual(mutationSnapshot(accessor), accessorBefore);
  assertExactBoundaryUnchanged(accessor, accessorBoundary);

  let nestedGetterCalls = 0;
  const nestedAccessor = hostileSpec();
  const nestedSupport = nestedAccessor.keyScenes["ash-waste"].supportLayers[8];
  Object.defineProperty(nestedSupport, "routeTarget", {
    configurable: true,
    enumerable: true,
    get() { nestedGetterCalls += 1; throw new Error("nested candidate accessors must remain inert"); },
  });
  const nestedBefore = mutationSnapshot(nestedAccessor);
  const nestedBoundary = exactBoundarySnapshot(nestedSupport, ["routeTarget"]);
  assert.ok(validateRegionalR5AuthoringSpec(nestedAccessor)
    .some((error) => /accessor|plain data/i.test(error)));
  assert.equal(nestedGetterCalls, 0);
  assert.deepEqual(mutationSnapshot(nestedAccessor), nestedBefore);
  assertExactBoundaryUnchanged(nestedSupport, nestedBoundary);
  assert.equal(Object.getPrototypeOf(nestedSupport), Object.prototype);
  assert.equal(Object.isExtensible(nestedSupport), true);
  assert.equal(Object.isFrozen(nestedSupport), false);

  let arrayGetterCalls = 0;
  const arrayAccessor = hostileSpec();
  const supportLayers = arrayAccessor.keyScenes["ash-waste"].supportLayers;
  Object.defineProperty(supportLayers, "8", {
    configurable: true,
    enumerable: true,
    get() { arrayGetterCalls += 1; throw new Error("array index accessors must remain inert"); },
  });
  const arrayBefore = mutationSnapshot(arrayAccessor);
  const arrayBoundary = exactBoundarySnapshot(supportLayers, ["8"]);
  assert.ok(validateRegionalR5AuthoringSpec(arrayAccessor)
    .some((error) => /accessor|plain data|array/i.test(error)));
  assert.equal(arrayGetterCalls, 0);
  assert.deepEqual(mutationSnapshot(arrayAccessor), arrayBefore);
  assertExactBoundaryUnchanged(supportLayers, arrayBoundary);

  let coercionGetterCalls = 0;
  const prototypeCandidate = hostileSpec();
  const hostilePrototype = Object.create(null);
  Object.defineProperty(hostilePrototype, Symbol.toPrimitive, {
    configurable: true,
    get() {
      coercionGetterCalls += 1;
      throw new Error("candidate prototypes must never be coerced");
    },
  });
  Object.setPrototypeOf(prototypeCandidate, hostilePrototype);
  const prototypeBefore = mutationSnapshot(prototypeCandidate);
  const prototypeBoundary = exactBoundarySnapshot(prototypeCandidate);
  assert.ok(validateRegionalR5AuthoringSpec(prototypeCandidate)
    .some((error) => /prototype|plain data/i.test(error)));
  assert.equal(coercionGetterCalls, 0);
  assert.deepEqual(mutationSnapshot(prototypeCandidate), prototypeBefore);
  assertExactBoundaryUnchanged(prototypeCandidate, prototypeBoundary);

  let nestedPrototypeGetterCalls = 0;
  const nestedPrototypeCandidate = hostileSpec();
  const nestedPrototypeTarget = nestedPrototypeCandidate.keyScenes["ash-waste"].supportLayers[8];
  const nestedHostilePrototype = Object.create(null);
  Object.defineProperty(nestedHostilePrototype, Symbol.toPrimitive, {
    configurable: true,
    get() {
      nestedPrototypeGetterCalls += 1;
      throw new Error("nested object prototypes must never be coerced");
    },
  });
  Object.setPrototypeOf(nestedPrototypeTarget, nestedHostilePrototype);
  const nestedPrototypeBefore = mutationSnapshot(nestedPrototypeCandidate);
  const nestedPrototypeBoundary = exactBoundarySnapshot(nestedPrototypeTarget);
  assert.ok(validateRegionalR5AuthoringSpec(nestedPrototypeCandidate)
    .some((error) => /prototype|plain data/i.test(error)));
  assert.equal(nestedPrototypeGetterCalls, 0);
  assert.deepEqual(mutationSnapshot(nestedPrototypeCandidate), nestedPrototypeBefore);
  assertExactBoundaryUnchanged(nestedPrototypeTarget, nestedPrototypeBoundary);

  let arrayPrototypeGetterCalls = 0;
  const arrayPrototypeCandidate = hostileSpec();
  const arrayPrototypeTarget = arrayPrototypeCandidate.keyScenes["ash-waste"].supportLayers;
  const hostileArrayPrototype = Object.create(Array.prototype);
  Object.defineProperty(hostileArrayPrototype, Symbol.toPrimitive, {
    configurable: true,
    get() {
      arrayPrototypeGetterCalls += 1;
      throw new Error("nested array prototypes must never be coerced");
    },
  });
  Object.setPrototypeOf(arrayPrototypeTarget, hostileArrayPrototype);
  const arrayPrototypeBefore = mutationSnapshot(arrayPrototypeCandidate);
  const arrayPrototypeBoundary = exactBoundarySnapshot(arrayPrototypeTarget);
  assert.ok(validateRegionalR5AuthoringSpec(arrayPrototypeCandidate)
    .some((error) => /prototype|plain data|array/i.test(error)));
  assert.equal(arrayPrototypeGetterCalls, 0);
  assert.deepEqual(mutationSnapshot(arrayPrototypeCandidate), arrayPrototypeBefore);
  assertExactBoundaryUnchanged(arrayPrototypeTarget, arrayPrototypeBoundary);

  const nonExtensibleCandidate = hostileSpec();
  const nonExtensibleTarget = nonExtensibleCandidate.keyScenes["ash-waste"].supportLayers[8];
  Object.preventExtensions(nonExtensibleTarget);
  assert.equal(Object.isExtensible(nonExtensibleTarget), false);
  assert.equal(Object.isFrozen(nonExtensibleTarget), false);
  assert.equal(Object.isSealed(nonExtensibleTarget), false);
  const nonExtensibleBefore = mutationSnapshot(nonExtensibleCandidate);
  const nonExtensibleBoundary = exactBoundarySnapshot(nonExtensibleTarget);
  assert.ok(validateRegionalR5AuthoringSpec(nonExtensibleCandidate)
    .some((error) => /extensible|plain data|descriptor/i.test(error)));
  assert.deepEqual(mutationSnapshot(nonExtensibleCandidate), nonExtensibleBefore);
  assertExactBoundaryUnchanged(nonExtensibleTarget, nonExtensibleBoundary);

  const sealedCandidate = hostileSpec();
  const sealedTarget = sealedCandidate.keyScenes["ash-waste"].supportLayers;
  Object.seal(sealedTarget);
  assert.equal(Object.isExtensible(sealedTarget), false);
  assert.equal(Object.isSealed(sealedTarget), true);
  assert.equal(Object.isFrozen(sealedTarget), false);
  const sealedBefore = mutationSnapshot(sealedCandidate);
  const sealedBoundary = exactBoundarySnapshot(sealedTarget);
  assert.ok(validateRegionalR5AuthoringSpec(sealedCandidate)
    .some((error) => /sealed|extensible|plain data|descriptor|array/i.test(error)));
  assert.deepEqual(mutationSnapshot(sealedCandidate), sealedBefore);
  assertExactBoundaryUnchanged(sealedTarget, sealedBoundary);

  const nonWritableCandidate = hostileSpec();
  const nonWritableTarget = nonWritableCandidate.keyScenes["ash-waste"].supportLayers[8];
  const nonWritableDescriptor = Object.getOwnPropertyDescriptor(nonWritableTarget, "routeTarget");
  assert.ok(nonWritableDescriptor && "value" in nonWritableDescriptor);
  Object.defineProperty(nonWritableTarget, "routeTarget", {
    ...nonWritableDescriptor,
    writable: false,
  });
  assert.equal(Object.isExtensible(nonWritableTarget), true);
  assert.equal(Object.isFrozen(nonWritableTarget), false);
  assert.equal(Object.isSealed(nonWritableTarget), false);
  const nonWritableBefore = mutationSnapshot(nonWritableCandidate);
  const nonWritableBoundary = exactBoundarySnapshot(nonWritableTarget, ["routeTarget"]);
  assert.ok(validateRegionalR5AuthoringSpec(nonWritableCandidate)
    .some((error) => /writable|plain data|descriptor/i.test(error)));
  assert.deepEqual(mutationSnapshot(nonWritableCandidate), nonWritableBefore);
  assertExactBoundaryUnchanged(nonWritableTarget, nonWritableBoundary);
});

authorityTest("production validator reports exact dedicated geometry diagnostics", () => {
  for (const { code, mutate } of geometryHostiles()) {
    const candidate = hostileSpec();
    mutate(candidate);
    const errors = validateRegionalR5AuthoringSpec(candidate);
    assert.ok(errors.includes(code), `${code} missing from ${errors.join(", ")}`);
  }
});

authorityTest("sources pin both unversioned guide sheets by exact dimensions and SHA-256", () => {
  assert.deepEqual(REGIONAL_R5_AUTHORING_SOURCES, {
    regionKits: {
      id: "region-kits",
      path: "scratchpad/2d-production-art/source/imagegen-concepts/region-kits-imagegen-guide.png",
      width: 1536,
      height: 1024,
      sha256: "2d4aa7c04e7af2c123a34f854ae896eef5babf7e56344a7750014adf07335913",
      repositoryVersioned: false,
    },
    homeRuin: {
      id: "home-ruin",
      path: "scratchpad/2d-production-art/source/imagegen-concepts/home-ruin-imagegen-guide.png",
      width: 1536,
      height: 1024,
      sha256: "a8d83b04d092cfd03400c7541ee6003b73ed0426270a1a5b7b0170966c411b48",
      repositoryVersioned: false,
    },
  });
});

authorityTest("normalization closes even/even whole-sheet sampling, chroma, alpha, and outline policy", () => {
  assert.deepEqual(REGIONAL_R5_NORMALIZATION, {
    sourceSize: { width: 1536, height: 1024 },
    normalizedSize: { width: 768, height: 512 },
    scope: "whole-sheet-once",
    sampling: {
      kernel: "nearest",
      phase: "even-even",
      normalizedPixel: "source(2*x,2*y)",
    },
    halfOpenRectFormula: {
      x: "ceil(source.x/2)",
      y: "ceil(source.y/2)",
      width: "ceil((source.x+source.width)/2)-ceil(source.x/2)",
      height: "ceil((source.y+source.height)/2)-ceil(source.y/2)",
    },
    chroma: {
      predicate: "red > 210 && blue > 170 && green < 100",
      keyedAlpha: 0,
      authoredAlpha: 255,
      transparentRgba: [0, 0, 0, 0],
    },
    outputAlphaValues: [0, 255],
    zeroRgbWhenTransparent: true,
    paletteMapping: {
      tokens: "kit-named-tokens-only",
      exactOutlineSource: "#1c1c24",
      exactOutlineAction: "preserve-as-outline-before-nearest-palette",
      outlineIsNearestPaletteCandidate: false,
      distance: "minimum-squared-srgb",
      tieBreak: "lexical-palette-token",
      placementOverrides: "forbidden",
    },
    postNormalizationTransform: "integer-translation-only",
    forbiddenOperations: [
      "per-crop-normalization", "per-crop-fitting", "erosion", "scaling", "rotation",
      "mirroring", "random-offset", "regex-template", "placement-palette-override",
    ],
    decode: {
      operation: "decode-whole-guide-once",
      ensureAlpha: true,
      requiredChannels: 4,
      channelStride: "decoded-info.channels",
    },
  });
  assert.equal(REGIONAL_R5_PALETTES.outline.source, "#1c1c24");
  assert.deepEqual(REGIONAL_R5_PALETTES.outline.repair, {
    widthPx: 1,
    passes: 1,
    sourceSnapshot: "immutable-pre-repair",
    target: "transparent-crop-local-pixels-only",
    opaqueNeighbour: "four-neighbour",
    diagonalGrowth: false,
    iterativeGrowth: false,
    clipTo: "crop-window",
    preserveExistingOpaque: true,
    fill: "#1c1c24",
    fillAlpha: 255,
  });
});

authorityTest("chroma threshold edges are exact and carry no alpha conjunct", () => {
  const keyed = (red, green, blue) => red > 210 && blue > 170 && green < 100;
  assert.equal(keyed(211, 99, 171), true);
  assert.equal(keyed(210, 99, 171), false);
  assert.equal(keyed(211, 100, 171), false);
  assert.equal(keyed(211, 99, 170), false);
  assert.doesNotMatch(REGIONAL_R5_NORMALIZATION.chroma.predicate, /alpha|\ba\b/);
});

authorityTest("crop authority closes 193 usages, 191 unique rects, and only two worn aliases", () => {
  const usages = allUsageRecords();
  assert.equal(REGIONAL_R5_CROPS.safeGuideFragments.length, 67);
  assert.equal(REGIONAL_R5_CROPS.regionalMacros.length, 62);
  assert.equal(REGIONAL_R5_CROPS.homeMaterialFragments.length, 64);
  assert.equal(usages.length, 193);
  assert.equal(new Set(usages.map(rectKey)).size, 191);
  assert.equal(new Set(usages.map(({ id }) => id)).size, 193);
  assert.deepEqual(REGIONAL_R5_CROPS.legalAliases.map(({ aliasOf }) => aliasOf), [
    "worn-heartland/fallen-fence[0]",
    "worn-heartland/fallen-fence[3]",
  ]);

  const duplicateGroups = Object.groupBy(usages, rectKey);
  assert.deepEqual(Object.values(duplicateGroups).filter((rows) => rows.length > 1)
    .map((rows) => rows.map(({ id }) => id)), REGIONAL_R5_CROPS.legalAliases.map((alias) => [
      REGIONAL_R5_CROPS.safeGuideFragments.find(({ sourceIdentity }) => sourceIdentity === alias.aliasOf).id,
      alias.id,
    ]));
});

authorityTest("source families and every per-kit partition are pinned by exact independent digests", () => {
  for (const family of ["safeGuideFragments", "regionalMacros", "homeMaterialFragments"]) {
    assert.equal(sha256(REGIONAL_R5_CROPS[family]), FAMILY_DIGESTS[family].aggregate, `${family} aggregate`);
    for (const kit of KITS) {
      assert.equal(sha256(REGIONAL_R5_CROPS[family].filter((row) => row.kit === kit)),
        FAMILY_DIGESTS[family].kits[kit], `${family}/${kit}`);
    }
  }
  assert.equal(sha256(REGIONAL_R5_CROPS.forbiddenGuideCrops), FAMILY_DIGESTS.forbiddenGuideCrops);
  assert.equal(sha256(REGIONAL_R5_CROPS.legalAliases), FAMILY_DIGESTS.legalAliases);
  assert.equal(sha256(REGIONAL_R5_PALETTES), FAMILY_DIGESTS.palettes.aggregate);
  for (const kit of KITS) assert.equal(sha256(REGIONAL_R5_PALETTES.kits[kit]), FAMILY_DIGESTS.palettes.kits[kit]);
  assert.equal(allUsageRecords().some(({ id }) => /olive-field-mass|trampled-field-return|worn-cliff-face/.test(id)), false,
    "transient implementation IDs are not source authority");
});

authorityTest("source record schemas close source identity, semantics, and authoring destinations", () => {
  for (const row of REGIONAL_R5_CROPS.safeGuideFragments) {
    const keys = [
      "id", "owner", "sourcePath", "kit", "sourceIdentity", "sourceRect", "normalizedRect",
      "semanticUse", "destination", "mechanicsBindingId",
    ];
    const tokens = expectedPaletteTokens(row, "safeGuideFragments");
    if (tokens) keys.push("paletteTokens");
    assert.deepEqual(Object.keys(row).sort(), keys.sort());
    if (tokens) assert.deepEqual(row.paletteTokens, tokens);
  }
  for (const row of REGIONAL_R5_CROPS.regionalMacros) {
    const keys = ["id", "owner", "sourcePath", "kit", "sourceRect", "normalizedRect", "semanticUse", "destination"];
    if (row.aliasOf) keys.push("aliasOf");
    const tokens = expectedPaletteTokens(row, "regionalMacros");
    if (tokens) keys.push("paletteTokens");
    assert.deepEqual(Object.keys(row).sort(), keys.sort());
    if (tokens) assert.deepEqual(row.paletteTokens, tokens);
  }
  for (const row of REGIONAL_R5_CROPS.homeMaterialFragments) {
    const keys = [
      "id", "owner", "sourcePath", "kit", "sourceRect", "normalizedRect", "semanticUse", "destination",
    ];
    const tokens = expectedPaletteTokens(row, "homeMaterialFragments");
    if (tokens) keys.push("paletteTokens");
    assert.deepEqual(Object.keys(row).sort(), keys.sort());
    if (tokens) assert.deepEqual(row.paletteTokens, tokens);
  }
  const paletteRows = allUsageRecords().filter((row) => Object.hasOwn(row, "paletteTokens"));
  assert.equal(paletteRows.length, 60);
  assert.deepEqual(["safeGuideFragments", "regionalMacros", "homeMaterialFragments"].map((family) => (
    [family, ...["ash-waste", "neutral-temperate"].map((kit) => (
      REGIONAL_R5_CROPS[family].filter((row) => row.kit === kit && Object.hasOwn(row, "paletteTokens")).length
    ))]
  )), [["safeGuideFragments", 16, 12], ["regionalMacros", 13, 7], ["homeMaterialFragments", 0, 12]]);
  for (const row of paletteRows) {
    assert.equal(new Set(row.paletteTokens).size, row.paletteTokens.length, `${row.id} palette tokens are unique`);
    assert.ok(row.paletteTokens.every((token) => Object.hasOwn(REGIONAL_R5_PALETTES.kits[row.kit], token)));
  }
});

authorityTest("paletteTokens reject empty, duplicate, non-string, foreign, and unapproved crop authority", () => {
  const targetId = "r5-regional/neutral-temperate/meadow-ledge-wide";
  for (const hostileTokens of [
    [],
    ["sage-dark", "sage-dark"],
    ["sage-dark", 7],
    ["sage-dark", "ash-only-token"],
  ]) {
    const candidate = hostileSpec();
    candidate.crops.regionalMacros.find(({ id }) => id === targetId).paletteTokens = hostileTokens;
    rejection(candidate, /crop|authority|digest|palette/i);
  }
  const candidate = hostileSpec();
  candidate.crops.regionalMacros.find(({ id }) => id === "r5-regional/worn-heartland/field-broad-mass")
    .paletteTokens = ["olive-dark", "olive-mid"];
  rejection(candidate, /crop|authority|digest|palette/i);
});

authorityTest("ash and neutral ground cells use the exact approved 16 anti-wallpaper schedules", () => {
  for (const [kit, schedules] of Object.entries(GROUND_CELL_SCHEDULES)) {
    const terrain = REGIONAL_R5_ATLAS_AUTHORING_PLANS[kit]
      .find(({ atlasId }) => atlasId === `${kit}-terrain`);
    for (const [cell, expected] of schedules.entries()) {
      const layers = semanticCell(terrain, cell)[2];
      const groundPatch = kit === "ash-waste"
        ? [`ash:ground-material-${cell}`, "ash-ground-material"]
        : [`neutral:meadow-material-${cell}`, "neutral-meadow-material"];
      assert.deepEqual(layers.map(([, z, kind, sourceId, role, x, y, ownerKit, transform]) => (
        [z, kind, sourceId, role, x, y, ownerKit, transform]
      )), [...expected.map(([sourceId, x, y], z) => (
        [z, "crop", sourceId, "terrain-material", x, y, kit, "none"]
      )), [expected.length, "literal-patch", groundPatch[0], groundPatch[1], 0, 0, kit, "none"]],
      `${kit}/terrain/${cell}`);
      assert.deepEqual(layers.map(([id]) => id), [...expected.map((_layer, z) => (
        `r5-layer/${kit}/terrain/${String(cell).padStart(3, "0")}/${String(z).padStart(2, "0")}`
      )), `r5-layer/${kit}/${kit}-terrain/${String(cell).padStart(3, "0")}/surface`]);
    }
  }
});

authorityTest("forbidden guide authority is exact and safe inventory omits all forbidden rects", () => {
  assert.deepEqual(REGIONAL_R5_CROPS.forbiddenGuideCrops.map(({ sourceIdentity }) => sourceIdentity), FORBIDDEN_IDS);
  const forbiddenRects = new Set(REGIONAL_R5_CROPS.forbiddenGuideCrops.map(rectKey));
  assert.equal(allUsageRecords().some((record) => forbiddenRects.has(rectKey(record))), false);
});

authorityTest("every source rect is in bounds and its normalized rect follows the pinned half-open formula", () => {
  for (const record of allUsageRecords()) {
    const source = Object.values(REGIONAL_R5_AUTHORING_SOURCES).find(({ id }) => id === record.owner);
    assert.ok(source, `${record.id} source ownership`);
    const [x, y, width, height] = record.sourceRect;
    assert.ok(Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(width) && Number.isInteger(height));
    assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0);
    assert.ok(x + width <= source.width && y + height <= source.height);
    assert.deepEqual(record.normalizedRect, [
      Math.ceil(x / 2), Math.ceil(y / 2),
      Math.ceil((x + width) / 2) - Math.ceil(x / 2),
      Math.ceil((y + height) / 2) - Math.ceil(y / 2),
    ]);
    assert.ok(KITS.includes(record.kit));
    assert.match(record.semanticUse, /^[a-z0-9]+(?:[ -][a-z0-9]+)*$/);
    assert.ok(["terrain", "scenery", "landmarks", "yards"].includes(record.destination.atlas));
    assert.ok(Number.isInteger(record.destination.cell));
    assert.match(record.destination.sceneLayer, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  }
});

authorityTest("atlas authoring plans close every cell and ordered source layer for all 20 masters", () => {
  assert.deepEqual(Object.keys(REGIONAL_R5_ATLAS_AUTHORING_PLANS), KITS);
  const usedSourceIds = new Set(Object.values(REGIONAL_R5_KEY_SCENES).flatMap((scene) => [
    ...scene.macroLayers.map(([, sourceId]) => sourceId),
    ...scene.literalPatchLayers.map(({ patchId }) => patchId),
  ]));
  const usageById = new Map(allUsageRecords().map((row) => [row.id, row]));
  const patchById = new Map(REGIONAL_R5_LITERAL_PATCHES.patches.map((patch) => [patch.id, patch]));
  const globallyUniqueLayerIds = new Set();
  const placementArrays = [];
  const roleRemaps = [];
  let legalNegativeClippingWitnesses = 0;
  let semanticCellCount = 0;
  for (const kit of KITS) {
    const plans = REGIONAL_R5_ATLAS_AUTHORING_PLANS[kit];
    assert.deepEqual(plans.map(({ atlasId }) => atlasId), [
      `${kit}-terrain`, `${kit}-scenery`, `${kit}-landmarks`, `${kit}-home-yards`,
    ]);
    assert.deepEqual(plans.map(({ geometry }) => (
      [geometry.width, geometry.height, geometry.cellWidth, geometry.cellHeight, geometry.cellCount]
    )), [
      [256, 256, 32, 32, 64],
      [512, 256, 32, 32, 128],
      [512, 256, 128, 128, 8],
      [960, 160, 192, 160, 5],
    ]);
    for (const plan of plans) {
      assert.deepEqual(Object.keys(plan).sort(), [
        "schema", "kitId", "atlasId", "geometry", "semanticCells", "emptyCells", "canonicalSha256",
      ].sort());
      assert.equal(plan.schema, "regional-r5-literal-cell-plan/v1");
      assert.equal(plan.kitId, kit);
      assert.equal(Object.hasOwn(plan, "cells"), false, "expanded/generated cell objects are forbidden");
      assert.equal(Object.hasOwn(plan, "cellAuthority"), false, "detached cell authority is forbidden");
      const family = atlasFamily(plan);
      const expectedSemantic = expectedSemanticIds(kit, family);
      const expectedIndices = Array.from({ length: expectedSemantic.length }, (_unused, index) => index);
      assert.deepEqual(plan.semanticCells.map(([cellIndex]) => cellIndex), expectedIndices);
      assert.deepEqual(plan.semanticCells.map(([, semanticId]) => semanticId), expectedSemantic);
      assert.deepEqual(plan.emptyCells, family === "terrain"
        ? Array.from({ length: 28 }, (_unused, index) => index + 36) : []);
      assert.deepEqual([...plan.semanticCells.map(([cellIndex]) => cellIndex), ...plan.emptyCells].sort((a, b) => a - b),
        Array.from({ length: plan.geometry.cellCount }, (_unused, index) => index));
      placementArrays.push(plan.semanticCells, plan.emptyCells);
      for (const [cellIndex, semanticId, layers] of plan.semanticCells) {
        semanticCellCount += 1;
        assert.equal(typeof semanticId, "string");
        assert.ok(layers.length >= 1, `${plan.atlasId}/${cellIndex} needs literal layers`);
        if (family === "landmarks") {
          const literalLayers = layers.filter(([, , sourceKind]) => sourceKind === "literal-patch");
          assert.ok(literalLayers.length === 0 || literalLayers.length === layers.length,
            `${plan.atlasId}/${cellIndex} landmark may not mix crop and literal-patch anatomy`);
          if (literalLayers.length > 0) {
            assert.equal(layers.length, 1, `${plan.atlasId}/${cellIndex} literal landmark must be one full cell`);
          } else {
            assert.ok(layers.length >= 5, `${plan.atlasId}/${cellIndex} crop landmark anatomy`);
          }
        }
        placementArrays.push(layers);
        assert.deepEqual(layers.map((layer) => layer[1]),
          Array.from({ length: layers.length }, (_unused, index) => index));
        const rectangles = [];
        for (const layer of layers) {
          assert.equal(layer.length, 9);
          const [id, order, sourceKind, sourceId, role, x, y, paletteId, transform] = layer;
          assert.equal(globallyUniqueLayerIds.has(id), false, `duplicate layer ID ${id}`);
          globallyUniqueLayerIds.add(id);
          assert.equal(paletteId, kit);
          assert.equal(transform, "none");
          assert.ok(Number.isInteger(x) && Number.isInteger(y));
          const crop = usageById.get(sourceId);
          const patch = patchById.get(sourceId);
          assert.equal(sourceKind, crop ? "crop" : "literal-patch");
          assert.ok(crop || patch, `${sourceId} is a known source authority`);
          assert.notEqual(role, "composition-support", "generic inferred roles are forbidden");
          const sourceWidth = crop ? crop.normalizedRect[2] : patch.width;
          const sourceHeight = crop ? crop.normalizedRect[3] : patch.height;
          assert.ok(x < plan.geometry.cellWidth && y < plan.geometry.cellHeight
            && x + sourceWidth > 0 && y + sourceHeight > 0,
          `${id} source rectangle must intersect its destination cell`);
          if (x < 0 || y < 0) legalNegativeClippingWitnesses += 1;
          if (crop) {
            assert.equal(crop.kit, kit, `${id} crop source must be same-kit`);
            if (role !== crop.destination.sceneLayer) {
              roleRemaps.push({
                layerId: id,
                sourceId,
                sourceRole: crop.destination.sceneLayer,
                authoredRole: role,
              });
            }
          }
          if (patch) {
            assert.equal(patch.ownerKit, kit);
            assert.ok(REGIONAL_R5_LITERAL_PATCHES.roleBindings[role]?.includes(sourceId),
              `${id} patch role must be exact`);
            if (family === "landmarks") {
              assert.deepEqual({ width: patch.width, height: patch.height, x, y },
                { width: 128, height: 128, x: 0, y: 0 },
                `${id} literal landmark must occupy its exact atlas cell`);
            }
          }
          rectangles.push({ x, y, width: sourceWidth, height: sourceHeight });
          usedSourceIds.add(sourceId);
        }
        if (family === "scenery") {
          assert.equal(rectangles.some((rect) => rect.x <= 16 && rect.y <= 16
            && rect.x + rect.width > 16 && rect.y + rect.height > 16), true,
          `${plan.atlasId}/${cellIndex} must join through the cell centre`);
          assert.equal(rectangles.some((rect, index) => rectangles.some((other, otherIndex) => (
            index !== otherIndex && rect.x < other.x + other.width && other.x < rect.x + rect.width
            && rect.y < other.y + other.height && other.y < rect.y + rect.height
          ))), true, `${plan.atlasId}/${cellIndex} support bounds must overlap`);
          const style = semanticId.split("/").at(-1);
          if (/(?:left|west)/.test(style)) assert.equal(rectangles.some(({ x }) => x < 0), true);
          if (/(?:right|east)/.test(style)) assert.equal(rectangles.some(({ x, width }) => x + width > 32), true);
          if (/(?:top|north)/.test(style)) assert.equal(rectangles.some(({ y }) => y < 0), true);
          if (/(?:bottom|south)/.test(style)) assert.equal(rectangles.some(({ y, height }) => y + height > 32), true);
        }
      }
      assert.equal(sha256(literalPlanAuthority(plan)), plan.canonicalSha256);
      assert.equal(plan.canonicalSha256, LITERAL_CELL_PLAN_DIGESTS[family].kits[kit]);
    }
    const terrain = plans[0];
    for (const [start, end] of [[0, 8], [8, 16], [16, 24], [24, 32], [32, 36]]) {
      const signatures = terrain.semanticCells.slice(start, end)
        .map(([, , layers]) => layers.map((layer) => (
          `${layer[2]}:${layer[3]}@${layer[5]},${layer[6]}`
        )).join("|"));
      assert.ok(new Set(signatures).size > 1, `${kit} terrain family ${start}-${end} may not repeat one placement`);
    }
    const scenery = plans[1];
    for (let kindIndex = 0; kindIndex < 4; kindIndex += 1) {
      const signatures = scenery.semanticCells.filter(([cellIndex]) => cellIndex % 4 === kindIndex)
        .map(([, , layers]) => layers.map((layer) => `${layer[5]},${layer[6]}`).join("|"));
      assert.equal(new Set(signatures).size, 32, `${kit}/${SCENERY_KIND_ORDER[kit][kindIndex]} needs 32 literal signatures`);
    }
    const dryThorn = kit === "dry-scrub"
      ? scenery.semanticCells.filter(([cellIndex]) => cellIndex % 4 === 3) : [];
    for (const [, , layers] of dryThorn) {
      assert.equal(layers.some((layer) => /^r5-safe\/dry-scrub\/(?:deadwood|dry-grass)\//.test(layer[3])), true);
      assert.equal(layers.some((layer) => /^r5-regional\/dry-scrub\/(?:windbreak-|sand-field-break)/.test(layer[3])), true);
      assert.equal(layers.some((layer) => /\/thorn\//.test(layer[3])), false);
    }
    const neutralSoftGrass = kit === "neutral-temperate"
      ? scenery.semanticCells.filter(([cellIndex]) => cellIndex % 4 === 3) : [];
    for (const [, , layers] of neutralSoftGrass) {
      assert.equal(layers.every((layer) => /^r5-regional\/neutral-temperate\/(?:plain-boundary-|sage-field-mass)/.test(layer[3])), true);
    }
    if (kit === "ash-waste") assert.equal(
      REGIONAL_R5_MECHANICS_BINDINGS.visualProofBindings.ashLandmarkAtlasProof.canonicalSha256,
      ASH_LANDMARK_PROOF_DIGEST,
    );
  }
  assert.deepEqual(roleRemaps, [
    {
      layerId: "r5-layer/worn-heartland/yards/003/00",
      sourceId: "r5-home/worn-heartland/roof-intact",
      sourceRole: "durable-roof-material",
      authoredRole: "hoard-salvaged-masonry",
    },
    {
      layerId: "r5-layer/dry-scrub/yards/003/00",
      sourceId: "r5-home/dry-scrub/roof-intact",
      sourceRole: "durable-roof-material",
      authoredRole: "hoard-salvaged-masonry",
    },
    {
      layerId: "r5-layer/ash-waste/yards/003/00",
      sourceId: "r5-home/ash-waste/roof-intact",
      sourceRole: "durable-roof-material",
      authoredRole: "hoard-salvaged-masonry",
    },
    {
      layerId: "r5-layer/neutral-temperate/yards/003/00",
      sourceId: "r5-home/neutral-temperate/roof-intact",
      sourceRole: "durable-roof-material",
      authoredRole: "hoard-salvaged-masonry",
    },
    {
      layerId: "r5-layer/neutral-temperate/yards/003/02",
      sourceId: "r5-home/neutral-temperate/roof-damaged",
      sourceRole: "durable-roof-material",
      authoredRole: "hoard-salvaged-masonry",
    },
  ], "only the five surviving durable-hoard role remaps are allowed");
  assert.equal(new Set(placementArrays).size, placementArrays.length,
    "atlas cell and layer placement arrays may not be shared");
  assert.equal(semanticCellCount, 885, "five kits must close all 885 non-empty semantic cells");
  assert.equal(globallyUniqueLayerIds.size, 1785, "literal plan layer count is closed");
  assert.ok(legalNegativeClippingWitnesses > 0, "signed clipping is legal when source bounds intersect the cell");
  for (const [family, planIndex] of [["terrain", 0], ["scenery", 1], ["landmarks", 2], ["yards", 3]]) {
    assert.equal(sha256(Object.fromEntries(KITS.map((kit) => [kit,
      REGIONAL_R5_ATLAS_AUTHORING_PLANS[kit][planIndex].canonicalSha256]))),
    LITERAL_CELL_PLAN_DIGESTS[family].aggregate);
  }
  const replacedPrimaryDestinations = [];
  for (const row of allUsageRecords()) {
    const plan = planForDestination(REGIONAL_R5_ATLAS_AUTHORING_PLANS, row.kit, row.destination);
    assert.ok(plan, `${row.id} destination atlas exists`);
    const destinationCell = semanticCell(plan, row.destination.cell);
    assert.ok(destinationCell, `${row.id} destination cell exists`);
    const primaryLayers = destinationCell[2].filter((layer) => (
      layer[2] === "crop" && layer[3] === row.id && layer[4] === row.destination.sceneLayer
    ));
    const literalLayers = destinationCell[2].filter((layer) => layer[2] === "literal-patch");
    if (primaryLayers.length === 0) {
      assert.ok(literalLayers.length > 0,
        `${row.id} missing crop primary must have an intentional literal replacement`);
      replacedPrimaryDestinations.push(row.id);
    } else {
      assert.equal(primaryLayers.length, 1,
        `${row.id} destination {atlas,cell,sceneLayer} must have exactly one primary witness`);
    }
  }
  assert.deepEqual(replacedPrimaryDestinations, LITERAL_REPLACED_CROP_DESTINATION_IDS,
    "only the 32 exact semantic literal replacements may supersede crop primaries");
  assert.deepEqual([...usageById.keys()].filter((id) => !usedSourceIds.has(id)),
    LITERAL_REPLACED_CROP_DESTINATION_IDS.filter((id) => id.includes("/spring-terraces/")),
    "only Spring crop authorities superseded by accepted V10 literals may be source-unused");
  const identityOnlyPatches = [...patchById.keys()].filter((id) => !usedSourceIds.has(id));
  assert.deepEqual(identityOnlyPatches, [
    "ash:home-sealed-filter-box",
    ...REGIONAL_R5_LITERAL_PATCHES.roleBindings["spring-support-anatomy"],
    ...REGIONAL_R5_LITERAL_PATCHES.roleBindings["spring-home-context"],
    ...REGIONAL_R5_LITERAL_PATCHES.roleBindings["dry-permanent-home-shell"],
    ...REGIONAL_R5_LITERAL_PATCHES.roleBindings["dry-threshold-foreground"],
  ], "only exact scene-only support, context, and Dry V32 presentation patches may skip atlas plans");
  const homeFilterMirror = patchById.get("ash:home-sealed-filter-box");
  const placedWarmFilter = patchById.get("ash:sealed-filter-box");
  assert.deepEqual({ palette: homeFilterMirror.palette, rows: homeFilterMirror.rows },
    { palette: placedWarmFilter.palette, rows: placedWarmFilter.rows },
    "the identity-only HomeActor filter mirror must remain byte-equivalent to its placed warm filter");
  assert.deepEqual(REGIONAL_R5_AUTHORING_SPEC.sourceReusePolicy, {
    mode: "explicit-plan-layer-references",
    transforms: "none",
    everyAuthorityReferenced: true,
    repeatedReferencesRequireUniqueLayerIds: true,
  });
});

authorityTest("five key scenes consume authored cells and expose complete scene-first anatomy", () => {
  assert.deepEqual(Object.keys(REGIONAL_R5_KEY_SCENES), KITS);
  const sectionArrays = [];
  const globalSceneLayerIds = new Set();
  for (const kit of KITS) {
    const scene = REGIONAL_R5_KEY_SCENES[kit];
    const expectedSceneKeys = [
      "kitId", "width", "height", "compositionMode", "mechanicsPlanHash", "terrainRows",
      "macroLayers", "landmarkLayers", "supportLayers", "yardLayers", "homeLayer",
      "humanLayers", "literalPatchLayers",
    ];
    if (kit === "spring-terraces") expectedSceneKeys.push("completeUnderlayLayers");
    if (kit === "dry-scrub") expectedSceneKeys.push("completeUnderlayLayers", "completeForegroundLayers");
    assert.deepEqual(Object.keys(scene).sort(), expectedSceneKeys.sort());
    assert.deepEqual({ width: scene.width, height: scene.height }, { width: 768, height: 512 });
    assert.equal(scene.compositionMode, "literal-r5-atlas-cell-stack");
    assert.equal(scene.kitId, kit);
    assert.equal(scene.mechanicsPlanHash, R4_DIGESTS.scenes.kits[kit]);
    assert.equal(scene.terrainRows.length, 16);
    assert.equal(scene.terrainRows.every((row) => /^[0-3][0-9A-F](?:[0-3][0-9A-F]){23}$/.test(row)), true);
    assert.deepEqual(scene.terrainRows, expectedTerrainRows(REGIONAL_R4_SCENE_PLANS[kit]));
    const macros = kit === "spring-terraces"
      ? scene.macroLayers.map(([, sourceId]) => REGIONAL_R5_LITERAL_PATCHES.patches
        .find(({ id }) => id === sourceId))
      : REGIONAL_R5_CROPS.regionalMacros.filter((row) => row.kit === kit);
    assert.equal(macros.every(Boolean), true, `${kit} macro sources must resolve`);
    assert.equal(scene.macroLayers.length, macros.length);
    assert.deepEqual(scene.macroLayers.map((layer) => layer[1]), macros.map(({ id }) => id));
    assert.deepEqual(scene.macroLayers.map((layer) => layer[2]), kit === "spring-terraces"
      ? Array(4).fill("spring-scene-macro")
      : macros.map(({ destination }) => destination.sceneLayer));
    const macroRects = [];
    for (const layer of scene.macroLayers) {
      assert.equal(layer.length, 5, `${kit} macro layers are exact five-field literal tuples`);
      const [id, sourceId, role, x, y] = layer;
      assert.equal(typeof id, "string");
      const source = kit === "spring-terraces"
        ? REGIONAL_R5_LITERAL_PATCHES.patches.find((patch) => patch.id === sourceId
          && patch.ownerKit === kit
          && REGIONAL_R5_LITERAL_PATCHES.roleBindings[role]?.includes(sourceId))
        : REGIONAL_R5_CROPS.regionalMacros.find((row) => row.id === sourceId
          && row.kit === kit && row.destination.sceneLayer === role);
      assert.ok(source);
      assert.ok(Number.isInteger(x) && Number.isInteger(y));
      const width = source.normalizedRect?.[2] ?? source.width;
      const height = source.normalizedRect?.[3] ?? source.height;
      assert.ok(x < scene.width && y < scene.height && x + width > 0 && y + height > 0,
        `${id} source-derived rectangle must intersect the key scene`);
      macroRects.push({ x, y, width, height });
    }
    assert.deepEqual(scene.macroLayers.map(([, , , x, y]) => [x, y]), KEY_SCENE_MACRO_ANCHORS[kit]);
    assert.equal(new Set(scene.macroLayers.map(([, , , x, y]) => `${x},${y}`)).size,
      scene.macroLayers.length, `${kit} macro anchors must be distinct`);
    assert.equal(scene.macroLayers.every(([, , , x, y]) => x === 0 && y === 0), false,
      `${kit} macros may not form an all-zero pile`);
    const macroUnion = {
      left: Math.min(...macroRects.map(({ x }) => x)),
      top: Math.min(...macroRects.map(({ y }) => y)),
      right: Math.max(...macroRects.map(({ x, width }) => x + width)),
      bottom: Math.max(...macroRects.map(({ y, height }) => y + height)),
    };
    assert.ok(macroUnion.right - macroUnion.left >= (kit === "spring-terraces" ? 500 : 700),
      `${kit} macro union must span broad scene width`);
    assert.ok(macroUnion.bottom - macroUnion.top >= (kit === "spring-terraces" ? 250 : 440),
      `${kit} macro union must span broad scene height`);
    const quadrants = new Set(macroRects.map(({ x, y, width, height }) => (
      `${x + width / 2 < scene.width / 2 ? "west" : "east"}-${
        y + height / 2 < scene.height / 2 ? "north" : "south"}`
    )));
    if (kit === "spring-terraces") {
      assert.deepEqual([...quadrants].sort(), ["east-north", "east-south", "west-south"]);
    } else {
      assert.deepEqual([...quadrants].sort(), ["east-north", "east-south", "west-north", "west-south"]);
    }
    assert.equal(scene.landmarkLayers.length, 8);
    assert.equal(scene.supportLayers.length, 16);
    assert.equal(scene.yardLayers.length, 3);
    assert.equal(scene.humanLayers.length, 3);
    assert.deepEqual(scene.humanLayers.map(({ role }) => role), ["route-entry", "defining-landmark", "shelter-door"]);
    assert.deepEqual(scene.landmarkLayers.map(({ atlasId, cell }) => `${atlasId}:cell:${cell}`),
      Array.from({ length: 8 }, (_unused, cell) => `${kit}-landmarks:cell:${cell}`));
    assert.deepEqual(scene.landmarkLayers.map(({ cell, variantId, x, y, clusterId, role }) => (
      [cell, variantId, x, y, clusterId, role]
    )), KEY_SCENE_LANDMARKS[kit]);
    assert.deepEqual(scene.landmarkLayers.map(({ id }, cell) => id),
      Array.from({ length: 8 }, (_unused, cell) => `r5-scene/${kit}/landmark/${cell}`));
    assert.equal(scene.landmarkLayers.every(({ width, height }) => width === 128 && height === 128), true);
    assert.equal(scene.supportLayers.every(({ atlasId, width, height, patchId }) => {
      if (atlasId !== `${kit}-scenery`) return false;
      if (kit !== "spring-terraces") return width === 32 && height === 32;
      const patch = REGIONAL_R5_LITERAL_PATCHES.patches.find(({ id }) => id === patchId);
      return patch?.width === width && patch?.height === height
        && REGIONAL_R5_LITERAL_PATCHES.roleBindings["spring-support-anatomy"].includes(patchId);
    }), true);
    assert.equal(new Set(scene.supportLayers.map(({ id }) => id)).size, 16);
    assertKeySceneClusterProofs(REGIONAL_R5_AUTHORING_SPEC, kit);
    assert.deepEqual(scene.yardLayers.map(({ cell }) => cell), [0, 2, 3]);
    assert.equal(scene.yardLayers.every(({ atlasId, width, height }) => (
      atlasId === `${kit}-home-yards` && width === 192 && height === 160
    )), true);
    assert.deepEqual(scene.homeLayer, {
      id: `r5-scene/${kit}/home`, sourceKind: "assembledHomeState", kitId: kit, state: "lit",
      x: REGIONAL_R4_SCENE_PLANS[kit].home.plotCenterPx.x,
      y: REGIONAL_R4_SCENE_PLANS[kit].home.plotCenterPx.y,
      width: 128, height: 128,
    });
    for (const witness of scene.humanLayers) {
      assert.deepEqual({ width: witness.width, height: witness.height }, { width: 48, height: 64 });
      assert.deepEqual({
        contractId: witness.contractId, rig: witness.rig, facing: witness.facing,
        action: witness.action, frameIndex: witness.frameIndex, expression: witness.expression,
        clothing: witness.clothing,
      }, {
        contractId: "core-human-body-rigs:1", rig: "human-a", facing: "south", action: "idle",
        frameIndex: 1, expression: "neutral", clothing: "core-human-clothing-00:1",
      });
    }
    assert.deepEqual(scene.humanLayers.map(({ x, y }) => [x, y]), HUMAN_ANCHORS[kit]);
    const feet = scene.humanLayers.map(({ x, y }) => ({ x: x + 24, y: y + 61 }));
    assert.equal(REGIONAL_R4_SCENE_PLANS[kit].routeTiles.some(({ x, y }) => (
      feet[0].x === x * 32 + 16 && feet[0].y === y * 32 + 16
    )), true, `${kit} route-entry feet must land on the semantic R4 route`);
    assert.equal(REGIONAL_R4_SCENE_PLANS[kit].landmarks.some(({ x, y }) => (
      feet[1].x >= x && feet[1].x < x + 128 && feet[1].y >= y && feet[1].y < y + 128
    )), true, `${kit} landmark witness feet must land inside an R4 landmark cluster`);
    if (kit === "dry-scrub") {
      assert.deepEqual([scene.humanLayers[2].x - scene.homeLayer.x,
        scene.humanLayers[2].y - scene.homeLayer.y], [80, 38]);
      assert.notDeepEqual(feet[2], REGIONAL_R4_SCENE_PLANS[kit].home.doorCenterPx,
        `${kit} presentation witness may not impersonate the unchanged R4 door/collision anchor`);
    } else if (["worn-heartland", "spring-terraces", "ash-waste", "neutral-temperate"].includes(kit)) {
      const presentationOffset = REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth
        .shelterDoorPresentationAnchor.homeOffset;
      assert.deepEqual([scene.humanLayers[2].x, scene.humanLayers[2].y], [
        scene.homeLayer.x + presentationOffset.x, scene.homeLayer.y + presentationOffset.y,
      ], `${kit} shelter witness must use the proof-only presentation anchor`);
      assert.notDeepEqual(feet[2], REGIONAL_R4_SCENE_PLANS[kit].home.doorCenterPx,
        `${kit} presentation witness may not impersonate the unchanged R4 door/collision anchor`);
    } else assert.deepEqual(feet[2], REGIONAL_R4_SCENE_PLANS[kit].home.doorCenterPx);
    assert.deepEqual(scene.humanLayers.map(({ id }, index) => id),
      Array.from({ length: 3 }, (_unused, index) => `r5-scene/${kit}/human/${index}`));
    assert.deepEqual(scene.yardLayers.map(({ x, y }) => [x, y]),
      Array.from({ length: 3 }, () => [
        REGIONAL_R4_SCENE_PLANS[kit].yard.originPx.x,
        REGIONAL_R4_SCENE_PLANS[kit].yard.originPx.y,
      ]));
    for (const layer of scene.literalPatchLayers) {
      const patch = REGIONAL_R5_LITERAL_PATCHES.patches.find(({ id }) => id === layer.patchId);
      assert.ok(patch, `${layer.id} must reference literal patch authority`);
      assert.equal(patch.ownerKit, kit, `${layer.id} patch owner must match scene kit`);
      assert.ok(REGIONAL_R5_LITERAL_PATCHES.roleBindings[layer.role]?.includes(layer.patchId),
        `${layer.id} patch role must be exact`);
      assert.deepEqual([layer.width, layer.height], [patch.width, patch.height]);
      assert.ok(Number.isInteger(layer.x) && Number.isInteger(layer.y));
      assert.ok(layer.x < scene.width && layer.y < scene.height
        && layer.x + layer.width > 0 && layer.y + layer.height > 0,
      `${layer.id} must intersect the ${kit} key scene`);
    }
    if (kit === "worn-heartland") {
      assert.deepEqual(scene.literalPatchLayers.map(({
        patchId, x, y, width, height, role, clusterId, routeRelation,
      }) => [patchId, x, y, width, height, role, clusterId, routeRelation]),
      WORN_SCENE_PATCH_LAYERS);
    } else if (kit === "ash-waste") {
      assert.deepEqual(scene.literalPatchLayers.map(({ patchId, x, y, width, height }) => (
        [patchId, x, y, width, height]
      )), ASH_SCENE_PATCH_RECTS);
      assert.deepEqual(scene.literalPatchLayers.map(({ id }) => id), [
        ...Array.from({ length: 9 }, (_unused, index) => `r5-scene/ash-waste/patch/${index}`),
        "r5-scene/ash-waste/patch/ground-foundation",
        "r5-scene/ash-waste/patch/cluster-foundation",
      ]);
      assert.deepEqual([...new Set(scene.literalPatchLayers.map(({ role }) => role))],
        [
          "pylon-lattice", "cable-run", "containment-relief", "service-slab",
          "ash-ground-foundation", "ash-contamination-network",
        ]);
      for (const layer of scene.literalPatchLayers) {
        assert.equal(layer.role, ASH_PATCH_ROLES[layer.patchId]);
        assert.deepEqual({ clusterId: layer.clusterId, routeRelation: layer.routeRelation },
          ASH_ROLE_SCENE_BINDINGS[layer.role]);
      }
      assert.doesNotMatch(canonical(scene.literalPatchLayers.map(({
        patchId, role, clusterId, routeRelation,
      }) => ({ patchId, role, clusterId, routeRelation }))),
      /\b(?:living|water|fantasy|wizard|magic|mystic|enchanted)\b/i);
    } else if (kit === "neutral-temperate") {
      assert.deepEqual(scene.literalPatchLayers.map(({
        patchId, x, y, width, height, role, clusterId, routeRelation,
      }) => [patchId, x, y, width, height, role, clusterId, routeRelation]),
      NEUTRAL_SCENE_PATCH_LAYERS);
      assert.deepEqual(scene.literalPatchLayers.map(({ id }) => id), [
        "r5-scene/neutral-temperate/patch/ground-foundation",
        "r5-scene/neutral-temperate/patch/cluster-foundation",
        "r5-scene/neutral-temperate/patch/pond-foundation",
        "r5-scene/neutral-temperate/patch/grove-understory",
        "r5-scene/neutral-temperate/patch/lane-foundation",
        "r5-scene/neutral-temperate/patch/stone-wall",
      ]);
    } else if (kit === "spring-terraces") {
      assert.deepEqual(scene.literalPatchLayers.map(({
        patchId, x, y, width, height, role, clusterId, routeRelation,
      }) => [patchId, x, y, width, height, role, clusterId, routeRelation]),
      SPRING_SCENE_PATCH_LAYERS);
      assert.deepEqual(scene.completeUnderlayLayers.map(({
        patchId, x, y, width, height, role,
      }) => [patchId, x, y, width, height, role]), SPRING_COMPLETE_UNDERLAY_LAYERS);
    } else if (kit === "dry-scrub") {
      assert.deepEqual(scene.literalPatchLayers.map(({
        patchId, x, y, width, height, role, clusterId, routeRelation,
      }) => [patchId, x, y, width, height, role, clusterId, routeRelation]),
      DRY_SCENE_PATCH_LAYERS);
      assert.deepEqual(scene.completeUnderlayLayers.map(({
        patchId, x, y, width, height, role,
      }) => [patchId, x, y, width, height, role]), DRY_COMPLETE_UNDERLAY_LAYERS);
      assert.deepEqual(scene.completeForegroundLayers.map(({
        patchId, x, y, width, height, role,
      }) => [patchId, x, y, width, height, role]), DRY_COMPLETE_FOREGROUND_LAYERS);
    } else assert.deepEqual(scene.literalPatchLayers, []);
    const sceneIds = [
      ...scene.macroLayers.map((layer) => layer[0]), ...scene.landmarkLayers.map(({ id }) => id),
      ...scene.supportLayers.map(({ id }) => id), ...scene.yardLayers.map(({ id }) => id),
      scene.homeLayer.id, ...scene.humanLayers.map(({ id }) => id),
      ...scene.literalPatchLayers.map(({ id }) => id),
      ...(scene.completeUnderlayLayers ?? []).map(({ id }) => id),
      ...(scene.completeForegroundLayers ?? []).map(({ id }) => id),
    ];
    for (const id of sceneIds) {
      assert.equal(globalSceneLayerIds.has(id), false, `duplicate global scene layer ID ${id}`);
      globalSceneLayerIds.add(id);
    }
    assert.equal(sha256(scene), KEY_SCENE_DIGESTS.kits[kit]);
    const arrays = [scene.terrainRows, scene.macroLayers, scene.landmarkLayers, scene.supportLayers,
      scene.yardLayers, scene.humanLayers, scene.literalPatchLayers,
      ...(scene.completeUnderlayLayers ? [scene.completeUnderlayLayers] : []),
      ...(scene.completeForegroundLayers ? [scene.completeForegroundLayers] : [])];
    assert.equal(new Set(arrays).size, arrays.length);
    sectionArrays.push(...arrays);
  }
  assert.equal(new Set(sectionArrays).size, sectionArrays.length, "scene placement arrays may not be shared");
  assert.equal(sha256(REGIONAL_R5_KEY_SCENES), KEY_SCENE_DIGESTS.aggregate);
});

authorityTest("atlas and key-scene digest manifests pin every per-kit family in canonical order", () => {
  const atlasManifest = {
    schema: "regional-r5-atlas-plan-digest/v3",
    kits: KITS.map((kitId) => ({
      kitId,
      terrainPlanSha256: LITERAL_CELL_PLAN_DIGESTS.terrain.kits[kitId],
      sceneryPlanSha256: LITERAL_CELL_PLAN_DIGESTS.scenery.kits[kitId],
      landmarkPlanSha256: LITERAL_CELL_PLAN_DIGESTS.landmarks.kits[kitId],
      yardPlanSha256: LITERAL_CELL_PLAN_DIGESTS.yards.kits[kitId],
    })),
  };
  const sceneManifest = {
    schema: "regional-r5-key-scene-digest/v3",
    scenes: KITS.map((kitId) => ({ kitId, keySceneSha256: KEY_SCENE_DIGESTS.kits[kitId] })),
  };
  assert.equal(sha256(atlasManifest), ATLAS_PLAN_DIGEST);
  assert.equal(sha256(sceneManifest), KEY_SCENE_DIGESTS.manifest);
  assert.deepEqual(REGIONAL_R5_AUTHORING_SPEC.digests, {
    atlasPlanManifest: { ...atlasManifest, canonicalSha256: ATLAS_PLAN_DIGEST },
    keySceneManifest: { ...sceneManifest, canonicalSha256: KEY_SCENE_DIGESTS.manifest },
  });
});

authorityTest("mechanics bindings preserve exact R4 scenes, landmark identities, atlas geometry, and yards", () => {
  assert.equal(canonical(REGIONAL_R5_MECHANICS_BINDINGS.scenePlans), canonical(REGIONAL_R4_SCENE_PLANS));
  assert.equal(sha256(REGIONAL_R5_MECHANICS_BINDINGS.scenePlans), R4_DIGESTS.scenes.aggregate);
  assert.equal(sha256(REGIONAL_R4_VARIANT_RECIPES), R4_DIGESTS.recipes.aggregate);
  assert.deepEqual(REGIONAL_R5_MECHANICS_BINDINGS.r4Authority, R4_DIGESTS);
  for (const kit of KITS) {
    assert.equal(sha256(REGIONAL_R5_MECHANICS_BINDINGS.scenePlans[kit]), R4_DIGESTS.scenes.kits[kit]);
    assert.equal(sha256(REGIONAL_R4_VARIANT_RECIPES[kit]), R4_DIGESTS.recipes.kits[kit]);
    const expectedLandmarks = REGIONAL_R4_VARIANT_RECIPES[kit].landmarks.map((entry) => ({
      id: entry.id,
      cell: entry.cell,
      contactPivotPx: entry.contactPivotPx,
      semanticKind: entry.semanticKind,
      topologyKey: entry.topologyKey,
    }));
    assert.equal(canonical(REGIONAL_R5_MECHANICS_BINDINGS.landmarks[kit]), canonical(expectedLandmarks));
    const expectedYards = REGIONAL_R4_VARIANT_RECIPES[kit].yards.map((entry) => ({
      id: entry.id,
      semanticKind: entry.semanticKind,
      topologyKey: entry.topologyKey,
    }));
    assert.equal(canonical(REGIONAL_R5_MECHANICS_BINDINGS.yards[kit].states), canonical(expectedYards));
    assert.deepEqual(REGIONAL_R5_MECHANICS_BINDINGS.yards[kit].contactPivotPx, { x: 96, y: 112 });
    assert.deepEqual(REGIONAL_R5_MECHANICS_BINDINGS.yards[kit].connectionPorts,
      [{ side: "south", startPx: 80, widthPx: 32, role: "path" }]);
    assert.deepEqual(REGIONAL_R5_MECHANICS_BINDINGS.yards[kit].doorClearancePx,
      { x: 81, y: 73, width: 30, height: 48 });
    const homeActor = REGIONAL_R5_MECHANICS_BINDINGS.homeActors[kit];
    assert.equal(homeActor.compositor, "assembledHomeState");
    assert.deepEqual(homeActor.output, { width: 128, height: 128 });
    assert.equal(homeActor.state, "lit");
    assert.deepEqual(homeActor.componentCells, [0, 1, 2, 6, 9, 17, 20]);
    assert.deepEqual(homeActor.sources.map(({ atlasId }) => atlasId), [
      `${kit}-home-components`, `${kit}-home-details`, `${kit}-home-ruins`,
    ]);
    assert.deepEqual(homeActor.sources.map(({ sha256 }) => sha256), HOME_ACTOR_SOURCE_HASHES[kit]);
    assert.deepEqual(homeActor.sources.map(({ path }) => path), [
      `scratchpad/2d-production-art/source/native/homes/${kit}/components.png`,
      `scratchpad/2d-production-art/source/native/homes/${kit}/details.png`,
      `scratchpad/2d-production-art/source/native/homes/${kit}/ruins.png`,
    ]);
  }
  assert.deepEqual(REGIONAL_R5_MECHANICS_BINDINGS.productionHuman, {
    assetId: "core-human-body-rigs:1", rig: "human-a", facing: "south", action: "idle",
    frameIndex: 1, expression: "neutral", clothing: "core-human-clothing-00:1",
    feet: { x: 24, y: 61 },
    canonicalPatchSha256: "4bcdc9f7fc15ab203eb96e99cb1108c3b884e198be284c6b958170f9f5f67e0e",
    layers: [
      { atlasId: "core-human-body-rigs", atlasSha256: "edb6d5dfadaf9714d00b392da7ee89931d145cc6226184abf7835d23f4a67716", cellIndex: 1, path: "scratchpad/2d-production-art/source/native/core/human-body-rigs.png" },
      { atlasId: "core-human-face-planes", atlasSha256: "4673092a327f228bbae97b1fdaa460d2d39a3470bdbc65920e32e8ef14c4cc6e", cellIndex: 0, path: "scratchpad/2d-production-art/source/native/core/human-face-planes.png" },
      { atlasId: "core-human-hair", atlasSha256: "add7fea3720162c7cfbafb215d92b5d41031cf9843b47df5f26eafdc2877861c", cellIndex: 0, path: "scratchpad/2d-production-art/source/native/core/human-hair.png" },
      { atlasId: "core-human-clothing-00", atlasSha256: "da3743c71a78e78fe458a409fade7f25eb2c099ab6bba7764e6fc9a6734aa0f2", cellIndex: 1, path: "scratchpad/2d-production-art/source/native/core/human-clothing-00.png" },
    ],
  });
});

authorityTest("compatibility bank names cannot authorize forbidden pixels", () => {
  assert.deepEqual(REGIONAL_R5_MECHANICS_BINDINGS.compatibilityOnly, {
    "dry-scrub": {
      thorn: { pixelAuthority: "permitted-r5-material-only", forbiddenGuideIds: [
        "dry-scrub/thorn[0]", "dry-scrub/thorn[1]", "dry-scrub/thorn[2]", "dry-scrub/thorn[3]",
      ] },
    },
    "neutral-temperate": {
      "soft-grass": { pixelAuthority: "permitted-r5-material-only", forbiddenGuideIds: [
        "neutral-temperate/soft-grass[0]", "neutral-temperate/soft-grass[1]",
        "neutral-temperate/soft-grass[2]", "neutral-temperate/soft-grass[3]",
      ] },
      "plain-bench": { pixelAuthority: "permitted-r5-material-only", forbiddenGuideIds: [
        "neutral-temperate/soft-grass[2]",
      ] },
    },
  });
});

authorityTest("202 mixed-kit literal patches form a closed indexed role and content authority", () => {
  assert.deepEqual(REGIONAL_R5_LITERAL_PATCHES.roleOrder, LITERAL_PATCH_ROLE_ORDER);
  assert.deepEqual(Object.keys(REGIONAL_R5_LITERAL_PATCHES.roleBindings), LITERAL_PATCH_ROLE_ORDER);
  assert.equal(sha256(REGIONAL_R5_LITERAL_PATCHES.roleBindings), LITERAL_PATCH_ROLE_BINDINGS_DIGEST);
  assert.equal(sha256(REGIONAL_R5_LITERAL_PATCHES.patches.map(({
    id, ownerKit, width, height, canonicalSha256,
  }) => [id, ownerKit, width, height, canonicalSha256])), LITERAL_PATCH_META_DIGEST);
  assert.deepEqual(Object.fromEntries(["worn-heartland", "ash-waste", "neutral-temperate", "spring-terraces", "dry-scrub"].map((kit) => [
    kit, REGIONAL_R5_LITERAL_PATCHES.patches.filter(({ ownerKit }) => ownerKit === kit).length,
  ])), { "worn-heartland": 13, "ash-waste": 57, "neutral-temperate": 46, "spring-terraces": 72, "dry-scrub": 14 });

  const paletteDigestCounts = Object.fromEntries(Object.entries(Object.groupBy(
    REGIONAL_R5_LITERAL_PATCHES.patches, ({ palette }) => sha256(palette),
  )).map(([digest, patches]) => [digest, patches.length]).sort(([left], [right]) => left.localeCompare(right)));
  assert.deepEqual(paletteDigestCounts, LITERAL_PATCH_PALETTE_DIGEST_COUNTS,
    "all 202 literal patches must remain in the exact eight approved palette families");

  const boundPatchRows = Object.entries(REGIONAL_R5_LITERAL_PATCHES.roleBindings)
    .flatMap(([role, patchIds]) => patchIds.map((patchId) => [patchId, role]));
  assert.equal(boundPatchRows.length, 202, "every patch must have exactly one role binding");
  assert.equal(new Set(boundPatchRows.map(([patchId]) => patchId)).size, 202,
    "role bindings must be a bijection over patches");
  assert.deepEqual([...boundPatchRows.map(([patchId]) => patchId)].sort(),
    REGIONAL_R5_LITERAL_PATCHES.patches.map(({ id }) => id).sort(),
    "role bindings may not omit or invent patch IDs");

  for (const patch of REGIONAL_R5_LITERAL_PATCHES.patches) {
    assert.deepEqual(Object.keys(patch).sort(), [
      "schema", "id", "ownerKit", "width", "height", "transparentIndex",
      "palette", "rows", "canonicalSha256",
    ].sort());
    assert.equal(patch.schema, "regional-r5-indexed-patch/v1");
    assert.ok(["worn-heartland", "ash-waste", "neutral-temperate", "spring-terraces", "dry-scrub"].includes(patch.ownerKit));
    assert.equal(patch.transparentIndex, "0");
    assert.ok(Object.hasOwn(LITERAL_PATCH_PALETTE_DIGEST_COUNTS, sha256(patch.palette)),
      `${patch.id} exact palette family`);
    assert.equal(patch.rows.length, patch.height);
    assert.ok(patch.rows.every((row) => row.length === patch.width
      && [...row].every((index) => Object.hasOwn(patch.palette, index))));
    const { canonicalSha256, ...authority } = patch;
    assert.equal(canonicalSha256, sha256(authority));
    assert.equal(Object.hasOwn(patch, "pngSha256"), false, "authoring prescription may not invent PNG bytes");
  }

  const patchUses = [];
  for (const [kit, plans] of Object.entries(REGIONAL_R5_ATLAS_AUTHORING_PLANS)) {
    for (const plan of plans) for (const [, , layers] of plan.semanticCells) {
      for (const layer of layers.filter(([, , sourceKind]) => sourceKind === "literal-patch")) {
        patchUses.push({ kit, patchId: layer[3], role: layer[4] });
      }
    }
  }
  for (const [kit, scene] of Object.entries(REGIONAL_R5_KEY_SCENES)) {
    for (const layer of scene.literalPatchLayers) {
      patchUses.push({ kit, patchId: layer.patchId, role: layer.role });
    }
    for (const [, patchId, role] of scene.macroLayers.filter(([, sourceId]) => (
      REGIONAL_R5_LITERAL_PATCHES.patches.some(({ id }) => id === sourceId)
    ))) patchUses.push({ kit, patchId, role });
    for (const layer of scene.supportLayers.filter(({ patchId }) => patchId)) {
      patchUses.push({ kit, patchId: layer.patchId, role: "spring-support-anatomy" });
    }
    for (const layer of scene.completeUnderlayLayers ?? []) {
      patchUses.push({ kit, patchId: layer.patchId, role: layer.role });
    }
    for (const layer of scene.completeForegroundLayers ?? []) {
      patchUses.push({ kit, patchId: layer.patchId, role: layer.role });
    }
  }
  for (const use of patchUses) {
    const patch = REGIONAL_R5_LITERAL_PATCHES.patches.find(({ id }) => id === use.patchId);
    assert.ok(patch, `${use.patchId} use must resolve to patch authority`);
    assert.equal(patch.ownerKit, use.kit, `${use.patchId} use must stay in its owner kit`);
    assert.ok(REGIONAL_R5_LITERAL_PATCHES.roleBindings[use.role]?.includes(use.patchId),
      `${use.patchId} use must stay under its bound role`);
  }
  const identityOnlyPatches = REGIONAL_R5_LITERAL_PATCHES.patches
    .filter(({ id }) => !patchUses.some(({ patchId }) => patchId === id)).map(({ id }) => id);
  assert.deepEqual(identityOnlyPatches, ["ash:home-sealed-filter-box"],
    "the exact HomeActor filter mirror is the sole identity-only literal patch");
  const homeFilterMirror = REGIONAL_R5_LITERAL_PATCHES.patches
    .find(({ id }) => id === "ash:home-sealed-filter-box");
  const placedWarmFilter = REGIONAL_R5_LITERAL_PATCHES.patches
    .find(({ id }) => id === "ash:sealed-filter-box");
  assert.deepEqual({ palette: homeFilterMirror.palette, rows: homeFilterMirror.rows },
    { palette: placedWarmFilter.palette, rows: placedWarmFilter.rows },
    "the identity-only HomeActor filter mirror must remain byte-equivalent to its placed warm filter");
  assert.equal(sha256(REGIONAL_R5_LITERAL_PATCHES.patches), FAMILY_DIGESTS.patches);
});

authorityTest("semantic patch authority isolates HomeActor warmth from exact ash instrumentation consumers", () => {
  const patchById = new Map(REGIONAL_R5_LITERAL_PATCHES.patches.map((patch) => [patch.id, patch]));
  const topologies = ["ew", "ns", "ne", "es", "sw", "nw", "nesw", "none"];
  for (const [role, stem] of [
    ["neutral-lane-topology", "neutral:pale-lane"],
    ["neutral-pond-water-topology", "neutral:pond-water"],
    ["neutral-pond-verge-topology", "neutral:pond-verge"],
  ]) {
    assert.deepEqual(REGIONAL_R5_LITERAL_PATCHES.roleBindings[role],
      topologies.map((topology) => `${stem}-${topology}`));
    for (const id of REGIONAL_R5_LITERAL_PATCHES.roleBindings[role]) {
      const patch = patchById.get(id);
      assert.equal(patch.ownerKit, "neutral-temperate");
      assert.deepEqual([patch.width, patch.height], [32, 32]);
    }
  }
  for (const role of [
    "ash-containment-basin", "ash-scrubber-module", "ash-cask-bank", "ash-hazard-panel",
    "neutral-joined-grove", "neutral-stone-boundary", "neutral-hedgerow-verge",
  ]) {
    assert.ok(REGIONAL_R5_LITERAL_PATCHES.roleBindings[role]?.length > 0, `${role} requires literal witnesses`);
  }

  const warmPatchIds = REGIONAL_R5_LITERAL_PATCHES.patches.filter((patch) => {
    const tokens = Object.values(patch.palette);
    return tokens.includes("coral-fissure") || tokens.includes("vent-warm");
  }).map(({ id }) => id);
  assert.deepEqual(warmPatchIds, [
    "ash:service-conduit", "ash:sealed-filter-box", "ash:home-sealed-filter-box",
  ], "warm ash literal authority is restricted to the exact service and home instrumentation witnesses");

  const atlasPatchUses = [];
  for (const [kit, plans] of Object.entries(REGIONAL_R5_ATLAS_AUTHORING_PLANS)) {
    for (const plan of plans) for (const [cellIndex, semanticId, layers] of plan.semanticCells) {
      for (const layer of layers.filter(([, , sourceKind]) => sourceKind === "literal-patch")) {
        atlasPatchUses.push({ kit, atlasId: plan.atlasId, cellIndex, semanticId, layer });
      }
    }
  }
  const warmAtlasUses = atlasPatchUses.filter(({ layer }) => warmPatchIds.includes(layer[3]));
  assert.deepEqual(warmAtlasUses.map(({ atlasId, cellIndex, semanticId, layer }) => (
    [atlasId, cellIndex, semanticId, layer[3], layer[4]]
  )), [
    ["ash-waste-home-yards", 2, "warm-overlay", "ash:service-conduit", "service-slab"],
    ["ash-waste-home-yards", 3, "durable-hoarding-overlay", "ash:sealed-filter-box", "containment-relief"],
  ], "warm atlas consumers are closed to the two exact ash yard instrumentation uses");
  const warmSceneUses = Object.values(REGIONAL_R5_KEY_SCENES).flatMap(({ literalPatchLayers }) => (
    literalPatchLayers.filter(({ patchId }) => warmPatchIds.includes(patchId))
  ));
  assert.deepEqual(warmSceneUses.map(({ patchId, role, clusterId, routeRelation }) => (
    [patchId, role, clusterId, routeRelation]
  )), [["ash:service-conduit", "service-slab", "ash-pylon-north", "service-route-junction"]],
  "only the service conduit may carry restrained warm instrumentation into the ash world scene");
  assert.equal(REGIONAL_R5_KEY_SCENES["ash-waste"].literalPatchLayers.some(({ patchId }) => (
    patchId === "ash:world-sealed-filter-box"
  )), true, "the ash scene must use the cold world filter rather than either warm home filter");

  for (const { id, palette } of REGIONAL_R5_LITERAL_PATCHES.patches.filter((patch) => (
    patch.ownerKit === "ash-waste" && !warmPatchIds.includes(patch.id)
  ))) {
    const tokens = Object.values(palette);
    assert.equal(tokens.includes("coral-fissure"), false, `${id} must not expose coral-fissure`);
    assert.equal(tokens.includes("vent-warm"), false, `${id} must not expose vent-warm`);
  }
});

authorityTest("wrong source hash is rejected", () => {
  const candidate = hostileSpec();
  candidate.sources.regionKits.sha256 = "0".repeat(64);
  rejection(candidate, /source hash/i);
});

authorityTest("normalization formula, whole-sheet policy, palette distance, and outline snapshot drift are rejected", () => {
  const normalizedRect = hostileSpec();
  normalizedRect.crops.safeGuideFragments[0].normalizedRect[0] += 1;
  rejection(normalizedRect, /normalized.*rect|half-open|crop.*closure|digest/i);

  const formula = hostileSpec();
  formula.normalization.halfOpenRectFormula.x = "floor(source.x/2)";
  rejection(formula, /normalization|half-open|formula/i);

  const scope = hostileSpec();
  scope.normalization.scope = "per-crop";
  rejection(scope, /normalization|whole-sheet|scope/i);

  const transparentRgb = hostileSpec();
  transparentRgb.normalization.zeroRgbWhenTransparent = false;
  rejection(transparentRgb, /normalization|zero.*rgb|transparent/i);

  const palette = hostileSpec();
  palette.normalization.paletteMapping.tieBreak = "first-declared-token";
  rejection(palette, /normalization|palette|tie/i);

  const outlineSource = hostileSpec();
  outlineSource.normalization.paletteMapping.exactOutlineSource = "#1d1d25";
  rejection(outlineSource, /normalization|outline|palette/i);

  const outlineAction = hostileSpec();
  outlineAction.normalization.paletteMapping.exactOutlineAction = "nearest-palette-first";
  rejection(outlineAction, /normalization|outline|palette/i);

  const outlineCandidate = hostileSpec();
  outlineCandidate.normalization.paletteMapping.outlineIsNearestPaletteCandidate = true;
  rejection(outlineCandidate, /normalization|outline|palette/i);

  const outlineSnapshot = hostileSpec();
  outlineSnapshot.palettes.outline.repair.sourceSnapshot = "mutable-current-pass";
  rejection(outlineSnapshot, /outline|palette|snapshot/i);

  const iterativeOutline = hostileSpec();
  iterativeOutline.palettes.outline.repair.iterativeGrowth = true;
  rejection(iterativeOutline, /outline|palette|iterative/i);
});

authorityTest("forbidden rect renamed under a safe-looking ID is rejected by rectangle identity", () => {
  const candidate = hostileSpec();
  const forbidden = candidate.crops.forbiddenGuideCrops[0];
  candidate.crops.safeGuideFragments[0] = {
    ...candidate.crops.safeGuideFragments[0],
    id: "r5-safe/worn-heartland/totally-safe/0",
    owner: forbidden.owner,
    sourceRect: forbidden.sourceRect,
    normalizedRect: forbidden.normalizedRect,
  };
  rejection(candidate, /forbidden.*rect/i);
});

authorityTest("same-count crop rename, semantic, owner, and destination swaps are rejected by fixed closure", () => {
  const renamed = hostileSpec();
  renamed.crops.safeGuideFragments[0].id = "r5-safe/worn-heartland/renamed/0";
  rejection(renamed, /safe|crop.*closure|digest/i);

  const semantic = hostileSpec();
  semantic.crops.regionalMacros[0].semanticUse = renamed.crops.regionalMacros[1].semanticUse;
  rejection(semantic, /regional|semantic|crop.*closure|digest/i);

  const owner = hostileSpec();
  owner.crops.homeMaterialFragments[0].owner = "region-kits";
  rejection(owner, /owner|home|crop.*closure|digest/i);

  const destination = hostileSpec();
  [destination.crops.safeGuideFragments[0].destination, destination.crops.safeGuideFragments[1].destination]
    = [destination.crops.safeGuideFragments[1].destination, destination.crops.safeGuideFragments[0].destination];
  rejection(destination, /destination|safe|crop.*closure|digest/i);
});

authorityTest("only the two exact worn aliases are legal", () => {
  const third = hostileSpec();
  third.crops.legalAliases.push({ ...third.crops.legalAliases[0], id: "r5-regional/worn-heartland/third-alias" });
  rejection(third, /alias/i);

  const swapped = hostileSpec();
  [swapped.crops.legalAliases[0].aliasOf, swapped.crops.legalAliases[1].aliasOf]
    = [swapped.crops.legalAliases[1].aliasOf, swapped.crops.legalAliases[0].aliasOf];
  rejection(swapped, /alias/i);
});

authorityTest("shared key-scene top-level or nested placement arrays are rejected", () => {
  const candidate = hostileSpec();
  candidate.keyScenes["spring-terraces"].landmarkLayers = candidate.keyScenes["worn-heartland"].landmarkLayers;
  rejection(candidate, /shared.*placement/i);

  const nested = hostileSpec();
  nested.keyScenes["spring-terraces"].terrainRows
    = nested.keyScenes["worn-heartland"].terrainRows;
  rejection(nested, /shared.*placement|scene.*closure|digest/i);
});

authorityTest("undeclared transforms and placement bounds overrides are rejected", () => {
  const transformed = hostileSpec();
  transformed.keyScenes["dry-scrub"].landmarkLayers[0].transform = "mirror-x";
  rejection(transformed, /transform|closed.*layer/i);

  const bounds = hostileSpec();
  bounds.keyScenes["neutral-temperate"].landmarkLayers[0].bounds = { x: 0, y: 0, width: 1, height: 1 };
  rejection(bounds, /bounds.*forbidden|closed.*layer/i);
});

authorityTest("mechanics drift from exact R4 scene and yard authority is rejected", () => {
  const scene = hostileSpec();
  scene.mechanicsBindings.scenePlans["ash-waste"].routeTiles.pop();
  rejection(scene, /scene.*drift|mechanics/i);

  const yard = hostileSpec();
  yard.mechanicsBindings.yards["worn-heartland"].connectionPorts[0].startPx = 79;
  rejection(yard, /yard.*drift|mechanics/i);

  const home = hostileSpec();
  home.mechanicsBindings.homeActors["spring-terraces"].componentCells[5] = 16;
  rejection(home, /home.*actor|mechanics/i);
});

authorityTest("callables, accessors, and non-plain data are rejected without invoking getters", () => {
  const callable = hostileSpec();
  callable.keyScenes["ash-waste"].render = () => {};
  rejection(callable, /callable|plain data/i);

  let getterCalls = 0;
  const accessor = hostileSpec();
  Object.defineProperty(accessor, "sources", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("must not execute");
    },
  });
  rejection(accessor, /accessor|plain data/i);
  assert.equal(getterCalls, 0);

  const nonPlain = hostileSpec();
  nonPlain.normalization = new Date(0);
  rejection(nonPlain, /non-plain|plain data/i);
});

authorityTest("root, nested objects, and dense arrays reject enumerable, hidden, symbol, sparse, and accessor extras", () => {
  const rootExtra = hostileSpec();
  rootExtra.extra = "x";
  rejection(rootExtra, /unknown|closed|extra/i);

  const nestedExtra = hostileSpec();
  nestedExtra.sources.regionKits.extra = "x";
  rejection(nestedExtra, /unknown|closed|extra/i);

  const arrayExtra = hostileSpec();
  arrayExtra.kits.extra = "x";
  rejection(arrayExtra, /array|dense|extra/i);

  const hidden = hostileSpec();
  Object.defineProperty(hidden.keyScenes["worn-heartland"].landmarkLayers, "hidden", { value: true });
  rejection(hidden, /array|dense|extra|hidden/i);

  const symbol = hostileSpec();
  symbol.crops.safeGuideFragments[0][Symbol("extra")] = true;
  rejection(symbol, /symbol|unknown|closed/i);

  const sparse = hostileSpec();
  delete sparse.atlasAuthoringPlans["ash-waste"][0].semanticCells[0];
  rejection(sparse, /array|dense|sparse/i);

  let calls = 0;
  const nestedAccessor = hostileSpec();
  Object.defineProperty(nestedAccessor.keyScenes["ash-waste"].landmarkLayers, "0", {
    configurable: true,
    enumerable: true,
    get() { calls += 1; throw new Error("must not execute"); },
  });
  rejection(nestedAccessor, /accessor|plain data/i);
  assert.equal(calls, 0);

  let objectGetterCalls = 0;
  const objectAccessor = hostileSpec();
  Object.defineProperty(objectAccessor.sources.regionKits, "sha256", {
    configurable: true,
    enumerable: true,
    get() { objectGetterCalls += 1; throw new Error("must not execute"); },
  });
  rejection(objectAccessor, /accessor|plain data/i);
  assert.equal(objectGetterCalls, 0);

  const hiddenObject = hostileSpec();
  Object.defineProperty(hiddenObject.sources.regionKits, "hidden", { value: true });
  rejection(hiddenObject, /hidden|unknown|closed|extra|plain data/i);
});

authorityTest("out-of-bounds crops, foreign kit ownership, semantic emptiness, and duplicate layer IDs fail", () => {
  const bounds = hostileSpec();
  bounds.crops.regionalMacros[0].sourceRect[0] = 1530;
  rejection(bounds, /source bounds|out of bounds/i);

  const ownership = hostileSpec();
  ownership.crops.homeMaterialFragments[0].kit = "ash-waste";
  rejection(ownership, /ownership|crop authority/i);

  const semantic = hostileSpec();
  semantic.crops.homeMaterialFragments[0].semanticUse = "";
  rejection(semantic, /semantic/i);

  const layers = hostileSpec();
  layers.keyScenes["spring-terraces"].supportLayers[1].id = layers.keyScenes["spring-terraces"].supportLayers[0].id;
  rejection(layers, /layer id/i);
});

authorityTest("patch ID/order/schema/owner/palette/role/content/hash drift all fail", () => {
  for (const mutate of [
    (value) => { value.patches[0].id = "ash:renamed"; },
    (value) => { [value.patches[0], value.patches[1]] = [value.patches[1], value.patches[0]]; },
    (value) => { value.patches[0].schema = "regional-r5-indexed-patch/v2"; },
    (value) => { value.patches[0].ownerKit = "dry-scrub"; },
    (value) => { value.patches[0].palette["2"] = "living-green"; },
    (value) => { value.roleBindings["pylon-lattice"].pop(); },
    (value) => { value.patches[0].rows[0] = "9".repeat(value.patches[0].width); },
    (value) => { value.patches[0].canonicalSha256 = "0".repeat(64); },
  ]) {
    const candidate = hostileSpec();
    mutate(candidate.literalPatches);
    rejection(candidate, /patch|indexed|role/i);
  }
});

authorityTest("unknown source/crop/cell references and literal geometry drift fail", () => {
  const unknown = hostileSpec();
  unknown.atlasAuthoringPlans["worn-heartland"][1].semanticCells[0][2][0][3] = "unknown-source";
  rejection(unknown, /unknown|source.*reference|orphan/i);

  const scene = hostileSpec();
  scene.keyScenes["ash-waste"].landmarkLayers[0].cell = 99;
  rejection(scene, /unknown|cell.*reference|scene.*closure/i);

  const atlas = hostileSpec();
  atlas.atlasAuthoringPlans["spring-terraces"][0].geometry.width = 255;
  rejection(atlas, /geometry|atlas.*drift|literal.*plan/i);
});

authorityTest("literal cell layers reject same-kit, cross-kit, source-kind, and forbidden extra authority drift", () => {
  const sameKit = hostileSpec();
  sameKit.atlasAuthoringPlans["worn-heartland"][0].semanticCells[0][2][0][3]
    = "r5-regional/worn-heartland/field-pale-break";
  rejection(sameKit, /destination|source.*reference|atlas|literal.*plan/i);

  const crossKit = hostileSpec();
  crossKit.atlasAuthoringPlans["worn-heartland"][0].semanticCells[0][2][0][3]
    = "r5-regional/spring-terraces/mint-field-mass";
  rejection(crossKit, /same-kit|ownership|atlas|literal.*plan/i);

  const sourceKind = hostileSpec();
  const sourceKindWitness = sourceKind.atlasAuthoringPlans["ash-waste"][2].semanticCells
    .flatMap(([, , layers]) => layers).find((layer) => (
      layer[2] === "literal-patch" && layer[3] === "ash:landmark-scrubber-a"
        && layer[4] === "ash-scrubber-module"
    ));
  assert.ok(sourceKindWitness, "ash scrubber literal-patch witness must exist before hostile mutation");
  sourceKindWitness[2] = "crop";
  rejection(sourceKind, /source.*kind|patch|atlas|literal.*plan/i);

  const detached = hostileSpec();
  detached.atlasAuthoringPlans["dry-scrub"][1].cellAuthority = [];
  rejection(detached, /detached|cell.*authority|unknown|closed|extra/i);
});

authorityTest("destination closure is derived from the actual atlas cell and exact primary role", () => {
  const moved = hostileSpec();
  const movedPlan = moved.atlasAuthoringPlans["worn-heartland"][0];
  const sourceLayers = semanticCell(movedPlan, 0)[2];
  const sourceIndex = sourceLayers.findIndex((layer) => layer[3]
    === "r5-regional/worn-heartland/field-broad-mass");
  const [movedLayer] = sourceLayers.splice(sourceIndex, 1);
  const targetLayers = semanticCell(movedPlan, 7)[2];
  targetLayers.push(["hostile-destination-witness", targetLayers.length, ...movedLayer.slice(2)]);
  rejection(moved, /destination|primary.*witness|atlas|literal.*plan/i);

  const role = hostileSpec();
  const roleWitness = role.atlasAuthoringPlans["neutral-temperate"][3].semanticCells
    .flatMap(([, , layers]) => layers).find((layer) => (
      layer[2] === "crop" && layer[3] === "r5-home/neutral-temperate/hearth-lit-a"
        && layer[4] === "warm-hearth-material"
    ));
  assert.ok(roleWitness, "neutral warm-light crop witness must exist before hostile mutation");
  roleWitness[4] = "hoard-overlay-material";
  rejection(role, /destination|scene.*layer|primary.*witness|role|atlas/i);
});

authorityTest("atlas layer schema rejects duplicate IDs/orders, shared arrays, zero-intersection, and palette drift", () => {
  const duplicateId = hostileSpec();
  duplicateId.atlasAuthoringPlans["spring-terraces"][1].semanticCells[1][2][0][0]
    = duplicateId.atlasAuthoringPlans["spring-terraces"][1].semanticCells[0][2][0][0];
  rejection(duplicateId, /layer.*id|duplicate|literal.*plan|atlas/i);

  const duplicateOrder = hostileSpec();
  duplicateOrder.atlasAuthoringPlans["dry-scrub"][0].semanticCells[0][2][1][1] = 0;
  rejection(duplicateOrder, /layer.*order|ordered|literal.*plan|atlas/i);

  const shared = hostileSpec();
  shared.atlasAuthoringPlans["neutral-temperate"][1].semanticCells[1][2]
    = shared.atlasAuthoringPlans["neutral-temperate"][1].semanticCells[0][2];
  rejection(shared, /shared.*array|placement.*array|literal.*plan|atlas/i);

  const negativeOutside = hostileSpec();
  negativeOutside.atlasAuthoringPlans["worn-heartland"][0].semanticCells[0][2][0][5] = -10_000;
  rejection(negativeOutside, /intersect|placement|bounds|literal.*plan|atlas/i);

  const positiveOutside = hostileSpec();
  positiveOutside.atlasAuthoringPlans["worn-heartland"][0].semanticCells[0][2][0][5] = 32;
  rejection(positiveOutside, /intersect|placement|bounds|literal.*plan|atlas/i);

  const palette = hostileSpec();
  palette.atlasAuthoringPlans["ash-waste"][2].semanticCells[2][2][0][7] = "worn-heartland";
  rejection(palette, /palette|ownership|literal.*plan|atlas/i);

  const override = hostileSpec();
  override.atlasAuthoringPlans["spring-terraces"][1].semanticCells[0][2][0].push("spring-light");
  rejection(override, /tuple|layer.*schema|array|dense|extra/i);

  const inventedBounds = hostileSpec();
  inventedBounds.atlasAuthoringPlans["dry-scrub"][2].semanticCells[0].push({ width: 128 });
  rejection(inventedBounds, /cell.*tuple|array|dense|extra/i);

  const offsetDrift = hostileSpec();
  offsetDrift.atlasAuthoringPlans["spring-terraces"][1].semanticCells[16][2][0][5] += 1;
  rejection(offsetDrift, /offset|literal.*plan|digest|atlas/i);

  const allZero = hostileSpec();
  for (const [, , layers] of allZero.atlasAuthoringPlans["worn-heartland"][1].semanticCells) {
    for (const layer of layers) [layer[5], layer[6]] = [0, 0];
  }
  rejection(allZero, /edge|literal.*plan|digest|atlas/i);

  const genericRole = hostileSpec();
  genericRole.atlasAuthoringPlans["worn-heartland"][0].semanticCells[0][2][0][4] = "composition-support";
  rejection(genericRole, /role|semantic|literal.*plan|atlas/i);

  const missingWestEdge = hostileSpec();
  for (const layer of missingWestEdge.atlasAuthoringPlans["worn-heartland"][1].semanticCells[16][2]) layer[5] = 1;
  rejection(missingWestEdge, /edge|offset|literal.*plan|digest|atlas/i);
});

authorityTest("literal patches cannot be referenced outside their owner kit or under a non-bound role", () => {
  const outsideOwner = hostileSpec();
  const outsideLayer = outsideOwner.atlasAuthoringPlans["worn-heartland"][1].semanticCells[0][2][0];
  [outsideLayer[2], outsideLayer[3], outsideLayer[4]]
    = ["literal-patch", "ash:pylon-lattice-a", "pylon-lattice"];
  rejection(outsideOwner, /patch.*owner|owner|same-kit|literal.*plan|atlas/i);

  const wrongRole = hostileSpec();
  const wrongRoleWitness = wrongRole.atlasAuthoringPlans["ash-waste"][2].semanticCells
    .flatMap(([, , layers]) => layers).find((layer) => (
      layer[2] === "literal-patch" && layer[3] === "ash:landmark-scrubber-a"
        && layer[4] === "ash-scrubber-module"
    ));
  assert.ok(wrongRoleWitness, "ash scrubber role witness must exist before hostile mutation");
  wrongRoleWitness[4] = "ash-cask-bank";
  rejection(wrongRole, /patch.*role|role.*binding|literal.*plan|atlas/i);

  const wrongSceneRole = hostileSpec();
  wrongSceneRole.keyScenes["ash-waste"].literalPatchLayers[0].role = "cable-run";
  rejection(wrongSceneRole,
    /R5_ASH_ROUTE_CHAIN|patch.*role|role.*binding|ash.*placement|scene.*closure|digest/i);

  const wrongSceneCluster = hostileSpec();
  wrongSceneCluster.keyScenes["ash-waste"].literalPatchLayers[6].clusterId = "ash-pylon-north";
  rejection(wrongSceneCluster,
    /R5_ASH_ROUTE_CHAIN|patch.*cluster|ash.*placement|scene.*closure|digest/i);

  const forbiddenThorn = hostileSpec();
  forbiddenThorn.atlasAuthoringPlans["dry-scrub"][1].semanticCells[3][2][0][3]
    = "r5-forbidden/dry-scrub/thorn/0";
  rejection(forbiddenThorn, /forbidden|thorn|unknown|source.*reference|atlas/i);
});

authorityTest("literal key-scene terrain rows and global layer IDs reject drift", () => {
  const terrain = hostileSpec();
  terrain.keyScenes["spring-terraces"].terrainRows[0]
    = `3F${terrain.keyScenes["spring-terraces"].terrainRows[0].slice(2)}`;
  rejection(terrain, /terrain.*row|R4|scene.*closure|digest/i);

  const duplicate = hostileSpec();
  duplicate.keyScenes["neutral-temperate"].humanLayers[0].id
    = duplicate.keyScenes["worn-heartland"].homeLayer.id;
  rejection(duplicate, /global.*layer.*id|duplicate|scene.*closure|digest/i);
});

authorityTest("key-scene macro placements reject duplicate anchors, all-zero piles, and outside sources", () => {
  const duplicate = hostileSpec();
  duplicate.keyScenes["worn-heartland"].macroLayers[1][3]
    = duplicate.keyScenes["worn-heartland"].macroLayers[0][3];
  duplicate.keyScenes["worn-heartland"].macroLayers[1][4]
    = duplicate.keyScenes["worn-heartland"].macroLayers[0][4];
  rejectionCode(duplicate, "R5_MACRO_ANCHOR_DUPLICATE");

  const piled = hostileSpec();
  for (const layer of piled.keyScenes["spring-terraces"].macroLayers) [layer[3], layer[4]] = [0, 0];
  rejectionCode(piled, "R5_MACRO_ANCHOR_DUPLICATE");

  const outside = hostileSpec();
  outside.keyScenes["ash-waste"].macroLayers[0][3] = 900;
  rejectionCode(outside, "R5_MACRO_SCENE_BOUNDS");
});

authorityTest("key-scene proof supports reject missing, misassociated, non-presentation, and out-of-scene records", () => {
  const missing = hostileSpec();
  missing.keyScenes["worn-heartland"].supportLayers.pop();
  rejectionCode(missing, "R5_SUPPORT_COUNT");

  const misassociated = hostileSpec();
  misassociated.keyScenes["spring-terraces"].supportLayers[8].x += 1;
  rejectionCode(misassociated, "R5_SUPPORT_ASSOCIATION");

  const nonPresentation = hostileSpec();
  nonPresentation.keyScenes["dry-scrub"].supportLayers[8].presentationOnly = false;
  rejectionCode(nonPresentation, "R5_SUPPORT_ASSOCIATION");

  const outside = hostileSpec();
  outside.keyScenes["neutral-temperate"].supportLayers[8].x = 900;
  rejectionCode(outside, "R5_SUPPORT_SCENE_BOUNDS");
});
