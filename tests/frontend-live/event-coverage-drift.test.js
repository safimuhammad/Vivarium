const assert = require('node:assert/strict');
const acorn = require('acorn');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const { LIVE_RUN_EVENT_TYPES, MECHANICS_TOOL_NAMES } = require('./live-mechanics-helpers');

const repoRoot = path.resolve(__dirname, '..', '..');
const presentationCoverageTitle = 'covers every world-reference event type with observer-facing copy';

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function sliceBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end marker ${endMarker}`);
  return text.slice(start, end);
}

function extractPythonQuotedSet(source, startMarker, endMarker) {
  const body = sliceBetween(source, startMarker, endMarker);
  const values = [...body.matchAll(/^\s+"([a-z_]+)"(?:\s*:\s*[a-z_]+)?,?$/gm)].map((match) => match[1]);
  assert.ok(values.length > 0, `missing quoted Python set entries after ${startMarker}`);
  assert.equal(new Set(values).size, values.length, `duplicate Python set entries after ${startMarker}`);
  return values.sort();
}

function extractFirstColumnEventRows(markdown) {
  return uniqueSorted([...markdown.matchAll(/^\| `([^`]+)`\s*\|/gm)]
    .map((match) => match[1]));
}

function extractWorldReferenceEventTypes(markdown) {
  return extractFirstColumnEventRows(
    sliceBetween(markdown, '### Lifecycle', '**Chained events'),
  );
}

function extractCoverageMatrixEventTypes(markdown) {
  return extractFirstColumnEventRows(
    sliceBetween(markdown, '## Matrix', '## Current Proof Surfaces'),
  );
}

function extractCoverageMatrixRows(markdown) {
  const matrix = sliceBetween(markdown, '## Matrix', '## Current Proof Surfaces');
  return [...matrix.matchAll(/^\| `([^`]+)`\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|$/gm)]
    .map((match) => ({
      type: match[1],
      presentation: match[2].trim(),
      beat: match[3].trim(),
      renderer: match[4].trim(),
      appQa: match[5].trim(),
      deterministicLive: match[6].trim(),
    }));
}

function extractCoverageMatrixBeatParticipantTypes(markdown) {
  return uniqueSorted(extractCoverageMatrixRows(markdown)
    .filter((row) => row.beat !== 'pass-through')
    .map((row) => row.type));
}

function extractCoverageMatrixRendererTypesByPrefix(markdown, prefix) {
  return uniqueSorted(extractCoverageMatrixRows(markdown)
    .filter((row) => row.renderer.startsWith(prefix))
    .map((row) => row.type));
}

function parseJavaScriptSource(source) {
  return acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'script',
  });
}

function formatTypeScriptDiagnostic(sourceFile, diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  if (diagnostic.start === undefined) {
    return `${sourceFile.fileName}: ${message}`;
  }
  const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
  return `${sourceFile.fileName}:${position.line + 1}:${position.character + 1}: ${message}`;
}

function parseTypeScriptSource(source, fileName = 'source.ts') {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  assert.deepEqual(
    sourceFile.parseDiagnostics.map((diagnostic) => (
      formatTypeScriptDiagnostic(sourceFile, diagnostic)
    )),
    [],
  );
  return sourceFile;
}

function findTopLevelConstInitializer(ast, constName) {
  const matches = [];
  for (const statement of ast.body) {
    if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') {
      continue;
    }
    for (const declaration of statement.declarations) {
      if (declaration.id.type === 'Identifier' && declaration.id.name === constName) {
        matches.push(declaration.init);
      }
    }
  }
  assert.equal(matches.length, 1, `expected one top-level const ${constName}`);
  assert.ok(matches[0], `missing initializer for top-level const ${constName}`);
  return matches[0];
}

function unwrapStringArrayInitializer(initializer, constName) {
  if (initializer.type === 'ArrayExpression') {
    return initializer;
  }
  if (
    initializer.type === 'CallExpression'
    && initializer.arguments.length === 1
    && initializer.callee.type === 'MemberExpression'
    && initializer.callee.computed === false
    && initializer.callee.object.type === 'Identifier'
    && initializer.callee.object.name === 'Object'
    && initializer.callee.property.type === 'Identifier'
    && initializer.callee.property.name === 'freeze'
    && initializer.arguments[0].type === 'ArrayExpression'
  ) {
    return initializer.arguments[0];
  }
  if (
    initializer.type === 'CallExpression'
    && initializer.arguments.length === 0
    && initializer.callee.type === 'MemberExpression'
    && initializer.callee.computed === false
    && initializer.callee.property.type === 'Identifier'
    && initializer.callee.property.name === 'sort'
    && initializer.callee.object.type === 'ArrayExpression'
  ) {
    return initializer.callee.object;
  }
  assert.fail(`expected ${constName} to initialize from a string array`);
}

function extractLiteralStringArray(arrayNode, context) {
  return arrayNode.elements.map((element, index) => {
    assert.ok(element, `missing ${context}[${index}]`);
    assert.equal(element.type, 'Literal', `expected ${context}[${index}] to be a literal`);
    assert.equal(typeof element.value, 'string', `expected ${context}[${index}] to be a string`);
    return element.value;
  });
}

function extractStringArrayConst(ast, constName) {
  return extractLiteralStringArray(
    unwrapStringArrayInitializer(findTopLevelConstInitializer(ast, constName), constName),
    constName,
  );
}

function findJavaScriptFunction(ast, functionName) {
  const matches = ast.body.filter((statement) => (
    statement.type === 'FunctionDeclaration'
    && statement.id
    && statement.id.name === functionName
  ));
  assert.equal(matches.length, 1, `expected one JavaScript function ${functionName}`);
  return matches[0];
}

function visitJavaScriptNode(node, visitor) {
  if (!node || typeof node !== 'object') {
    return;
  }
  visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      value.forEach((child) => visitJavaScriptNode(child, visitor));
    } else {
      visitJavaScriptNode(value, visitor);
    }
  }
}

function extractForOfStringArray(functionNode, loopVariableName, context) {
  const matches = [];
  visitJavaScriptNode(functionNode.body, (node) => {
    if (
      node.type === 'ForOfStatement'
      && node.left.type === 'VariableDeclaration'
      && node.left.declarations.length === 1
      && node.left.declarations[0].id.type === 'Identifier'
      && node.left.declarations[0].id.name === loopVariableName
      && node.right.type === 'ArrayExpression'
    ) {
      matches.push(node.right);
    }
  });
  assert.equal(matches.length, 1, `expected one ${context} for-of string array`);
  return extractLiteralStringArray(matches[0], context);
}

function extractRendererAppRawSummaryFields(ast) {
  return uniqueSorted(extractForOfStringArray(
    findJavaScriptFunction(ast, 'expectSummaryHasNoRawFields'),
    'rawField',
    'expectSummaryHasNoRawFields',
  ));
}

function extractRendererSummaryMutationBoundaryInvariants(ast, functionName) {
  const functionNode = findJavaScriptFunction(ast, functionName);
  const properties = [];
  const suffixes = [];
  visitJavaScriptNode(functionNode.body, (node) => {
    if (
      node.type === 'MemberExpression'
      && node.computed === false
      && node.object.type === 'Identifier'
      && node.object.name === 'summary'
      && node.property.type === 'Identifier'
      && (
        node.property.name.endsWith('Mutated')
        || node.property.name.endsWith('Created')
      )
    ) {
      properties.push(node.property.name);
    }
    if (
      node.type === 'CallExpression'
      && node.callee.type === 'MemberExpression'
      && node.callee.computed === false
      && node.callee.property.type === 'Identifier'
      && node.callee.property.name === 'endsWith'
      && node.arguments.length === 1
      && node.arguments[0].type === 'Literal'
      && typeof node.arguments[0].value === 'string'
    ) {
      suffixes.push(node.arguments[0].value);
    }
  });
  return {
    properties: uniqueSorted(properties),
    suffixes: uniqueSorted(suffixes),
  };
}

function summaryKindTestValue(node) {
  if (
    node.type !== 'BinaryExpression'
    || (node.operator !== '===' && node.operator !== '==')
  ) {
    return null;
  }
  const left = node.left;
  const right = node.right;
  if (
    left.type === 'MemberExpression'
    && left.computed === false
    && left.object.type === 'Identifier'
    && left.object.name === 'summary'
    && left.property.type === 'Identifier'
    && left.property.name === 'kind'
    && right.type === 'Literal'
    && typeof right.value === 'string'
  ) {
    return right.value;
  }
  if (
    right.type === 'MemberExpression'
    && right.computed === false
    && right.object.type === 'Identifier'
    && right.object.name === 'summary'
    && right.property.type === 'Identifier'
    && right.property.name === 'kind'
    && left.type === 'Literal'
    && typeof left.value === 'string'
  ) {
    return left.value;
  }
  return null;
}

function normalizedEffectCarrierProperty(propertyName) {
  return propertyName === 'hasBubble' ? 'bubble' : propertyName;
}

function extractExpectBubbleRequirement(node) {
  if (
    node.type !== 'CallExpression'
    || node.callee.type !== 'MemberExpression'
    || node.callee.computed !== false
    || node.callee.property.type !== 'Identifier'
    || (node.callee.property.name !== 'toBeTruthy' && node.callee.property.name !== 'toBeFalsy')
    || node.callee.object.type !== 'CallExpression'
    || node.callee.object.callee.type !== 'Identifier'
    || node.callee.object.callee.name !== 'expect'
    || node.callee.object.arguments.length !== 1
  ) {
    return null;
  }
  const expectedNode = node.callee.object.arguments[0];
  if (
    expectedNode.type !== 'MemberExpression'
    || expectedNode.computed !== false
    || expectedNode.object.type !== 'Identifier'
    || expectedNode.object.name !== 'effect'
    || expectedNode.property.type !== 'Identifier'
    || normalizedEffectCarrierProperty(expectedNode.property.name) !== 'bubble'
  ) {
    return null;
  }
  return node.callee.property.name === 'toBeTruthy';
}

function extractBinaryBubbleRequirement(node) {
  if (
    node.type !== 'BinaryExpression'
    || node.operator !== '!=='
  ) {
    return null;
  }
  for (const [member, literal] of [
    [node.left, node.right],
    [node.right, node.left],
  ]) {
    if (
      member.type === 'MemberExpression'
      && member.computed === false
      && member.object.type === 'Identifier'
      && member.object.name === 'effect'
      && member.property.type === 'Identifier'
      && normalizedEffectCarrierProperty(member.property.name) === 'bubble'
      && literal.type === 'Literal'
      && typeof literal.value === 'boolean'
    ) {
      return literal.value;
    }
  }
  return null;
}

function extractRendererGenericCarrierInvariants(ast, functionName) {
  const functionNode = findJavaScriptFunction(ast, functionName);
  const invariants = {};
  visitJavaScriptNode(functionNode.body, (node) => {
    if (node.type !== 'IfStatement') {
      return;
    }
    const kind = summaryKindTestValue(node.test);
    if (!kind || !kind.startsWith('generic-event-')) {
      return;
    }
    const summaryProperties = [];
    const effectProperties = [];
    const bubbleRequirements = [];
    visitJavaScriptNode(node.consequent, (candidate) => {
      if (
        candidate.type === 'MemberExpression'
        && candidate.computed === false
        && candidate.object.type === 'Identifier'
        && candidate.property.type === 'Identifier'
      ) {
        if (candidate.object.name === 'summary') {
          summaryProperties.push(candidate.property.name);
        }
        if (candidate.object.name === 'effect') {
          effectProperties.push(normalizedEffectCarrierProperty(candidate.property.name));
        }
      }
      const expectBubbleRequirement = extractExpectBubbleRequirement(candidate);
      if (expectBubbleRequirement !== null) {
        bubbleRequirements.push(expectBubbleRequirement);
      }
      const binaryBubbleRequirement = extractBinaryBubbleRequirement(candidate);
      if (binaryBubbleRequirement !== null) {
        bubbleRequirements.push(binaryBubbleRequirement);
      }
    });
    assert.equal(
      new Set(bubbleRequirements).size,
      1,
      `expected one bubble carrier requirement for ${functionName} ${kind}`,
    );
    invariants[kind] = {
      summaryProperties: uniqueSorted(summaryProperties.filter((property) => property !== 'kind')),
      effectProperties: uniqueSorted(effectProperties),
      bubbleRequired: bubbleRequirements[0],
    };
  });
  return Object.fromEntries(Object.entries(invariants).sort(([left], [right]) => left.localeCompare(right)));
}

function isSummaryProperty(node, propertyName) {
  return (
    node.type === 'MemberExpression'
    && node.computed === false
    && node.object.type === 'Identifier'
    && node.object.name === 'summary'
    && node.property.type === 'Identifier'
    && node.property.name === propertyName
  );
}

function extractMotionModeCatalogPredicate(node) {
  if (
    node.type !== 'CallExpression'
    || node.arguments.length !== 1
    || !isSummaryProperty(node.arguments[0], 'kind')
    || node.callee.type !== 'MemberExpression'
    || node.callee.computed !== false
    || node.callee.object.type !== 'Identifier'
    || node.callee.property.type !== 'Identifier'
    || (node.callee.property.name !== 'has' && node.callee.property.name !== 'includes')
  ) {
    return null;
  }
  return {
    catalogName: node.callee.object.name,
    catalogMethod: node.callee.property.name,
    summaryKindProperty: 'kind',
  };
}

function extractExpectMotionModeEquality(node) {
  if (
    node.type !== 'CallExpression'
    || node.arguments.length !== 1
    || node.arguments[0].type !== 'Identifier'
    || node.callee.type !== 'MemberExpression'
    || node.callee.computed !== false
    || node.callee.property.type !== 'Identifier'
    || node.callee.property.name !== 'toBe'
    || node.callee.object.type !== 'CallExpression'
    || node.callee.object.callee.type !== 'Identifier'
    || node.callee.object.callee.name !== 'expect'
    || node.callee.object.arguments.length !== 1
    || !isSummaryProperty(node.callee.object.arguments[0], 'motionMode')
  ) {
    return null;
  }
  return {
    assertion: 'expect-toBe',
    summaryMotionModeProperty: 'motionMode',
    modeIdentifier: node.arguments[0].name,
  };
}

function extractBinaryMotionModeMismatch(node) {
  if (
    node.type !== 'BinaryExpression'
    || node.operator !== '!=='
  ) {
    return null;
  }
  for (const [summaryNode, modeNode] of [
    [node.left, node.right],
    [node.right, node.left],
  ]) {
    if (
      isSummaryProperty(summaryNode, 'motionMode')
      && modeNode.type === 'Identifier'
    ) {
      return {
        assertion: 'failure-on-inequality',
        summaryMotionModeProperty: 'motionMode',
        modeIdentifier: modeNode.name,
      };
    }
  }
  return null;
}

function extractRendererMotionModeInvariant(ast, functionName) {
  const functionNode = findJavaScriptFunction(ast, functionName);
  const invariants = [];
  visitJavaScriptNode(functionNode.body, (node) => {
    if (node.type !== 'IfStatement') {
      return;
    }
    const predicates = [];
    const equalities = [];
    visitJavaScriptNode(node.test, (candidate) => {
      const predicate = extractMotionModeCatalogPredicate(candidate);
      if (predicate !== null) {
        predicates.push(predicate);
      }
      const mismatch = extractBinaryMotionModeMismatch(candidate);
      if (mismatch !== null) {
        equalities.push(mismatch);
      }
    });
    if (predicates.length === 0) {
      return;
    }
    visitJavaScriptNode(node.consequent, (candidate) => {
      const expected = extractExpectMotionModeEquality(candidate);
      if (expected !== null) {
        equalities.push(expected);
      }
      const mismatch = extractBinaryMotionModeMismatch(candidate);
      if (mismatch !== null) {
        equalities.push(mismatch);
      }
    });
    assert.equal(predicates.length, 1, `expected one motion-mode catalog predicate in ${functionName}`);
    assert.equal(equalities.length, 1, `expected one motion-mode equality invariant in ${functionName}`);
    invariants.push({
      ...predicates[0],
      ...equalities[0],
    });
  });
  assert.equal(invariants.length, 1, `expected one motion-mode invariant in ${functionName}`);
  return invariants[0];
}

function extractObjectArrayConst(ast, constName) {
  const arrayNode = unwrapStringArrayInitializer(
    findTopLevelConstInitializer(ast, constName),
    constName,
  );
  return arrayNode.elements.map((element, index) => {
    assert.ok(element, `missing ${constName}[${index}]`);
    assert.equal(element.type, 'ObjectExpression', `expected ${constName}[${index}] to be an object`);
    return element;
  });
}

function propertyName(property) {
  if (property.key.type === 'Identifier') {
    return property.key.name;
  }
  if (property.key.type === 'Literal') {
    return property.key.value;
  }
  return null;
}

function findObjectPropertyValue(objectNode, property, context) {
  assert.equal(objectNode.type, 'ObjectExpression', `expected ${context} to be an object`);
  const matches = objectNode.properties.filter((candidate) => (
    candidate.type === 'Property'
    && candidate.computed === false
    && propertyName(candidate) === property
  ));
  assert.equal(matches.length, 1, `expected one ${context}.${property} property`);
  return matches[0].value;
}

function extractObjectStringProperty(objectNode, property, context) {
  const value = findObjectPropertyValue(objectNode, property, context);
  assert.equal(value.type, 'Literal', `expected ${context}.${property} to be a literal`);
  assert.equal(typeof value.value, 'string', `expected ${context}.${property} to be a string`);
  return value.value;
}

function extractLowFrequencyAppFixtureEventTypes(ast) {
  const lowFrequencyEnvelope = findTopLevelConstInitializer(ast, 'lowFrequencyEnvelope');
  const events = findObjectPropertyValue(lowFrequencyEnvelope, 'events', 'lowFrequencyEnvelope');
  assert.equal(events.type, 'ArrayExpression', 'expected lowFrequencyEnvelope.events to be an array');
  assert.ok(events.elements.length > 0, 'missing low-frequency eventEntry fixture types');
  return events.elements.map((element, index) => {
    assert.ok(element, `missing lowFrequencyEnvelope.events[${index}]`);
    assert.equal(
      element.type,
      'CallExpression',
      `expected lowFrequencyEnvelope.events[${index}] to be eventEntry(...)`,
    );
    assert.equal(
      element.callee.type,
      'Identifier',
      `expected lowFrequencyEnvelope.events[${index}] direct call callee`,
    );
    assert.equal(
      element.callee.name,
      'eventEntry',
      `expected lowFrequencyEnvelope.events[${index}] to call eventEntry`,
    );
    const eventType = element.arguments[1];
    assert.ok(eventType, `missing lowFrequencyEnvelope.events[${index}] event type argument`);
    assert.equal(
      eventType.type,
      'Literal',
      `expected lowFrequencyEnvelope.events[${index}] event type to be literal`,
    );
    assert.equal(
      typeof eventType.value,
      'string',
      `expected lowFrequencyEnvelope.events[${index}] event type to be a string`,
    );
    return eventType.value;
  });
}

function extractAppSemanticFixtureEventTypes(ast) {
  return uniqueSorted([
    ...extractStringArrayConst(ast, 'burstVisualEventTypes'),
    ...extractStringArrayConst(ast, 'burstGroupedAwayEventTypes'),
    ...extractLowFrequencyAppFixtureEventTypes(ast),
  ]);
}

function extractAppWorldReferenceEventTypes(ast) {
  return uniqueSorted(extractStringArrayConst(ast, 'worldReferenceEventTypes'));
}

function typeScriptPropertyName(propertyNameNode) {
  if (
    ts.isIdentifier(propertyNameNode)
    || ts.isStringLiteral(propertyNameNode)
    || ts.isNumericLiteral(propertyNameNode)
  ) {
    return propertyNameNode.text;
  }
  return null;
}

function isTypeScriptStringLiteral(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function unwrapTypeScriptExpression(expression) {
  let current = expression;
  while (
    ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function findTopLevelTypeScriptConstInitializer(sourceFile, constName) {
  const matches = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    const isConstDeclarationList = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === constName) {
        assert.ok(isConstDeclarationList, `expected top-level ${constName} to be const`);
        matches.push(declaration.initializer);
      }
    }
  }
  assert.equal(matches.length, 1, `expected one top-level TypeScript const ${constName}`);
  assert.ok(matches[0], `missing initializer for top-level TypeScript const ${constName}`);
  return matches[0];
}

function extractTypeScriptStringArrayConst(sourceFile, constName) {
  const initializer = unwrapTypeScriptExpression(
    findTopLevelTypeScriptConstInitializer(sourceFile, constName),
  );
  assert.ok(ts.isArrayLiteralExpression(initializer), `expected ${constName} to be an array`);
  return initializer.elements.map((element, index) => {
    assert.ok(
      isTypeScriptStringLiteral(element),
      `expected ${constName}[${index}] to be a string literal`,
    );
    return element.text;
  });
}

function extractTypeScriptObjectConstKeys(sourceFile, constName) {
  const initializer = unwrapTypeScriptExpression(
    findTopLevelTypeScriptConstInitializer(sourceFile, constName),
  );
  assert.ok(ts.isObjectLiteralExpression(initializer), `expected ${constName} to be an object`);
  assert.ok(initializer.properties.length > 0, `missing ${constName} object properties`);
  return initializer.properties.map((property, index) => {
    assert.ok(
      ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property),
      `expected ${constName} property ${index} to be a direct assignment or method`,
    );
    const key = typeScriptPropertyName(property.name);
    assert.equal(typeof key, 'string', `expected ${constName} property ${index} to have a literal key`);
    return key;
  });
}

function unwrapTypeScriptObjectFreeze(expression, context) {
  const initializer = unwrapTypeScriptExpression(expression);
  if (ts.isObjectLiteralExpression(initializer)) {
    return initializer;
  }
  if (
    ts.isCallExpression(initializer)
    && ts.isPropertyAccessExpression(initializer.expression)
    && ts.isIdentifier(initializer.expression.expression)
    && initializer.expression.expression.text === 'Object'
    && initializer.expression.name.text === 'freeze'
    && initializer.arguments.length === 1
  ) {
    const argument = unwrapTypeScriptExpression(initializer.arguments[0]);
    assert.ok(ts.isObjectLiteralExpression(argument), `expected ${context} Object.freeze argument to be an object`);
    return argument;
  }
  assert.fail(`expected ${context} to be an object or Object.freeze(object)`);
}

function unwrapTypeScriptArrayFreeze(expression, context) {
  const initializer = unwrapTypeScriptExpression(expression);
  if (ts.isArrayLiteralExpression(initializer)) {
    return initializer;
  }
  if (
    ts.isCallExpression(initializer)
    && ts.isPropertyAccessExpression(initializer.expression)
    && ts.isIdentifier(initializer.expression.expression)
    && initializer.expression.expression.text === 'Object'
    && initializer.expression.name.text === 'freeze'
    && initializer.arguments.length === 1
  ) {
    const argument = unwrapTypeScriptExpression(initializer.arguments[0]);
    assert.ok(ts.isArrayLiteralExpression(argument), `expected ${context} Object.freeze argument to be an array`);
    return argument;
  }
  assert.fail(`expected ${context} to be an array or Object.freeze(array)`);
}

function extractTypeScriptObjectStringArrayEntries(sourceFile, constName) {
  const object = unwrapTypeScriptObjectFreeze(
    findTopLevelTypeScriptConstInitializer(sourceFile, constName),
    constName,
  );
  return Object.fromEntries(object.properties.map((property, index) => {
    assert.ok(ts.isPropertyAssignment(property), `expected ${constName} property ${index} to be an assignment`);
    const key = typeScriptPropertyName(property.name);
    assert.equal(typeof key, 'string', `expected ${constName} property ${index} to have a literal key`);
    const array = unwrapTypeScriptArrayFreeze(property.initializer, `${constName}.${key}`);
    return [key, array.elements.map((element, elementIndex) => {
      assert.ok(
        isTypeScriptStringLiteral(element),
        `expected ${constName}.${key}[${elementIndex}] to be a string literal`,
      );
      return element.text;
    })];
  }));
}

function extractTypeScriptInterfacePropertyKeys(sourceFile, interfaceName) {
  const matches = sourceFile.statements.filter((statement) => (
    ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName
  ));
  assert.equal(matches.length, 1, `expected one TypeScript interface ${interfaceName}`);
  assert.ok(matches[0].members.length > 0, `missing ${interfaceName} members`);
  return matches[0].members.map((member, index) => {
    assert.ok(
      ts.isPropertySignature(member) || ts.isMethodSignature(member),
      `expected ${interfaceName} member ${index} to be a property or method signature`,
    );
    const key = typeScriptPropertyName(member.name);
    assert.equal(typeof key, 'string', `expected ${interfaceName} member ${index} to have a literal key`);
    return key;
  });
}

function findTypeScriptFunction(sourceFile, functionName) {
  const matches = [];
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement)
      && statement.name
      && statement.name.text === functionName
    ) {
      matches.push(statement);
    }
  }
  assert.equal(matches.length, 1, `expected one function ${functionName}`);
  assert.ok(matches[0].body, `missing function body for ${functionName}`);
  return matches[0];
}

function isEventTypeAccess(node) {
  return (
    ts.isPropertyAccessExpression(node)
    && node.name.text === 'type'
    && (
      (
        ts.isIdentifier(node.expression)
        && node.expression.text === 'event'
      )
      || (
        ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'event'
      )
    )
  );
}

function isIdentifierNamed(node, name) {
  return ts.isIdentifier(node) && node.text === name;
}

function extractSwitchCaseStringLabelsForExpression(functionNode, expressionMatches, context) {
  const labels = [];
  function visit(node) {
    if (ts.isSwitchStatement(node) && expressionMatches(node.expression)) {
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause)) {
          assert.ok(
            isTypeScriptStringLiteral(clause.expression),
            `expected ${context} switch case to be a string literal`,
          );
          labels.push(clause.expression.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(functionNode);
  assert.ok(labels.length > 0, `missing ${context} event-type switch labels`);
  return uniqueSorted(labels);
}

function extractSwitchCaseStringLabels(functionNode, context) {
  return extractSwitchCaseStringLabelsForExpression(functionNode, isEventTypeAccess, context);
}

function extractIdentifierSwitchCaseStringLabels(functionNode, identifierName, context) {
  return extractSwitchCaseStringLabelsForExpression(
    functionNode,
    (expression) => isIdentifierNamed(expression, identifierName),
    context,
  );
}

function collectEventTypeComparisonStrings(functionNode) {
  const types = [];
  function visit(node) {
    if (
      ts.isBinaryExpression(node)
      && (
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
        || node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken
      )
    ) {
      if (isEventTypeAccess(node.left) && isTypeScriptStringLiteral(node.right)) {
        types.push(node.right.text);
      }
      if (isEventTypeAccess(node.right) && isTypeScriptStringLiteral(node.left)) {
        types.push(node.left.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(functionNode);
  return types;
}

function collectIdentifierComparisonStrings(functionNode, identifierName) {
  const types = [];
  function visit(node) {
    if (
      ts.isBinaryExpression(node)
      && (
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
        || node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken
      )
    ) {
      if (isIdentifierNamed(node.left, identifierName) && isTypeScriptStringLiteral(node.right)) {
        types.push(node.right.text);
      }
      if (isIdentifierNamed(node.right, identifierName) && isTypeScriptStringLiteral(node.left)) {
        types.push(node.left.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(functionNode);
  return types;
}

function findTypeScriptFunctionLike(sourceFile, functionName) {
  const matches = [];
  function visit(node) {
    if (
      (
        ts.isFunctionDeclaration(node)
        || ts.isMethodDeclaration(node)
      )
      && node.name
      && (
        (
          ts.isIdentifier(node.name)
          && node.name.text === functionName
        )
        || (
          ts.isStringLiteral(node.name)
          && node.name.text === functionName
        )
      )
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.equal(matches.length, 1, `expected one function or method ${functionName}`);
  assert.ok(matches[0].body, `missing function body for ${functionName}`);
  return matches[0];
}

function nodeContainsPropertyAssignment(node, propertyName) {
  let found = false;
  function visit(candidate) {
    if (found) {
      return;
    }
    if (
      ts.isPropertyAssignment(candidate)
      && typeScriptPropertyName(candidate.name) === propertyName
    ) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  }
  visit(node);
  return found;
}

function extractEventTypeSwitchLabelsWithProperty(functionNode, propertyName, context) {
  const labels = [];
  function visit(node) {
    if (ts.isSwitchStatement(node) && isEventTypeAccess(node.expression)) {
      for (const clause of node.caseBlock.clauses) {
        if (!ts.isCaseClause(clause)) {
          continue;
        }
        assert.ok(
          isTypeScriptStringLiteral(clause.expression),
          `expected ${context} switch case to be a string literal`,
        );
        if (clause.statements.some((statement) => nodeContainsPropertyAssignment(statement, propertyName))) {
          labels.push(clause.expression.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(functionNode);
  assert.ok(labels.length > 0, `missing ${context} switch labels with ${propertyName}`);
  return uniqueSorted(labels);
}

function collectStringLiteralValuesFromExpression(expression) {
  if (isTypeScriptStringLiteral(expression)) {
    return [expression.text];
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...collectStringLiteralValuesFromExpression(expression.whenTrue),
      ...collectStringLiteralValuesFromExpression(expression.whenFalse),
    ];
  }
  return [];
}

function collectStringLiteralPropertyAssignments(functionNode, propertyName) {
  const values = [];
  function visit(node) {
    if (
      ts.isPropertyAssignment(node)
      && typeScriptPropertyName(node.name) === propertyName
    ) {
      values.push(...collectStringLiteralValuesFromExpression(node.initializer));
    }
    ts.forEachChild(node, visit);
  }
  visit(functionNode);
  return values;
}

function collectFirstStringLiteralCallArguments(sourceFile, methodName) {
  const values = [];
  function visit(node) {
    if (
      ts.isCallExpression(node)
      && node.arguments.length > 0
      && isTypeScriptStringLiteral(node.arguments[0])
      && (
        (
          ts.isIdentifier(node.expression)
          && node.expression.text === methodName
        )
        || (
          ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === methodName
        )
      )
    ) {
      values.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return values;
}

function collectReturnStringLiterals(functionNode) {
  const values = [];
  function visit(node) {
    if (ts.isReturnStatement(node) && node.expression && isTypeScriptStringLiteral(node.expression)) {
      values.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(functionNode);
  return values;
}

function extractBeatDirectorGroupableTypes(sourceFile) {
  return uniqueSorted(
    extractTypeScriptStringArrayConst(sourceFile, 'BEAT_DIRECTOR_GROUPABLE_EVENT_TYPES'),
  );
}

function extractBeatDirectorDeclaredParticipantTypes(sourceFile) {
  return uniqueSorted(
    extractTypeScriptStringArrayConst(sourceFile, 'BEAT_DIRECTOR_PARTICIPANT_EVENT_TYPES'),
  );
}

function extractBeatDirectorSwitchTypes(sourceFile) {
  return extractSwitchCaseStringLabels(
    findTypeScriptFunction(sourceFile, 'groupedVisualBeat'),
    'groupedVisualBeat',
  );
}

function extractBeatDirectorParticipantTypes(sourceFile) {
  const participantTypes = [
    ...extractBeatDirectorSwitchTypes(sourceFile),
    ...extractBeatDirectorGroupableTypes(sourceFile),
  ];
  for (const functionName of [
    'groupedVisualBeat',
    'findRecoveryPartner',
    'findAgentHoardingPartner',
  ]) {
    participantTypes.push(
      ...collectEventTypeComparisonStrings(findTypeScriptFunction(sourceFile, functionName)),
    );
  }
  return uniqueSorted(participantTypes);
}

function extractRendererVisualSpecDeclaredTypes(sourceFile) {
  return uniqueSorted(
    extractTypeScriptStringArrayConst(sourceFile, 'RENDERER_VISUAL_SPEC_EVENT_TYPES'),
  );
}

function extractRendererSpecialGrammarTypes(sourceFile) {
  return uniqueSorted(
    extractTypeScriptStringArrayConst(sourceFile, 'RENDERER_SPECIAL_GRAMMAR_EVENT_TYPES'),
  );
}

function extractRendererBubbleGrammarTypes(sourceFile) {
  return uniqueSorted(
    extractTypeScriptStringArrayConst(sourceFile, 'RENDERER_BUBBLE_GRAMMAR_EVENT_TYPES'),
  );
}

function extractRendererPassiveGrammarTypes(sourceFile) {
  return uniqueSorted(
    extractTypeScriptStringArrayConst(sourceFile, 'RENDERER_PASSIVE_GRAMMAR_EVENT_TYPES'),
  );
}

function extractRendererSpecialEffectTypes(sourceFile) {
  return uniqueSorted(
    extractTypeScriptStringArrayConst(sourceFile, 'RENDERER_SPECIAL_EFFECT_EVENT_TYPES'),
  );
}

function extractRendererLifeTransitionTypes(sourceFile) {
  return uniqueSorted(
    extractTypeScriptStringArrayConst(sourceFile, 'RENDERER_LIFE_TRANSITION_EVENT_TYPES'),
  );
}

function extractRendererBespokeBubbleSummaryTypes(sourceFile) {
  return uniqueSorted(
    extractTypeScriptStringArrayConst(sourceFile, 'RENDERER_BESPOKE_BUBBLE_SUMMARY_EVENT_TYPES'),
  );
}

function extractRendererDebugSummaryKinds(sourceFile) {
  return uniqueSorted(
    extractTypeScriptStringArrayConst(sourceFile, 'RENDERER_DEBUG_SUMMARY_KINDS'),
  );
}

function extractRendererMotionModeSummaryKinds(sourceFile) {
  return uniqueSorted(
    extractTypeScriptStringArrayConst(sourceFile, 'RENDERER_MOTION_MODE_SUMMARY_KINDS'),
  );
}

function extractRendererVisualSpecSwitchTypes(sourceFile) {
  return extractSwitchCaseStringLabels(
    findTypeScriptFunctionLike(sourceFile, 'visualSpecFor'),
    'visualSpecFor',
  );
}

function extractRendererSpecialEffectSwitchTypes(sourceFile) {
  return extractIdentifierSwitchCaseStringLabels(
    findTypeScriptFunctionLike(sourceFile, 'addSpecialEventEffects'),
    'eventType',
    'addSpecialEventEffects',
  );
}

function extractRendererVisualSpecLifeTransitionTypes(sourceFile) {
  return extractEventTypeSwitchLabelsWithProperty(
    findTypeScriptFunctionLike(sourceFile, 'visualSpecFor'),
    'lifeTransitionKind',
    'visualSpecFor',
  );
}

function extractRendererBubbleSummaryImplementationTypes(sourceFile) {
  return uniqueSorted(collectIdentifierComparisonStrings(
    findTypeScriptFunctionLike(sourceFile, 'bubbleEventDebugSummary'),
    'eventType',
  ));
}

function extractRendererProductionSummaryKinds(sourceFile) {
  const summaryKinds = [];
  for (const functionName of [
    'bubbleEventDebugSummary',
    'genericBubbleDebugSummary',
    'genericPulseDebugSummary',
    'genericArcDebugSummary',
    'simulationStartedDebugSummary',
    'hearthEmberDebugSummary',
    'combatBubbleDebugSummary',
    'thoughtWispDebugSummary',
    'agentHoardingDebugSummary',
    'combatImpactDebugSummary',
    'effectDebugSummary',
  ]) {
    summaryKinds.push(
      ...collectStringLiteralPropertyAssignments(
        findTypeScriptFunctionLike(sourceFile, functionName),
        'kind',
      ),
    );
  }
  summaryKinds.push(
    ...collectFirstStringLiteralCallArguments(sourceFile, 'homeBreachDebugSummary'),
    ...collectReturnStringLiterals(findTypeScriptFunctionLike(sourceFile, 'homeLifecycleDebugKind')),
  );
  return uniqueSorted(summaryKinds);
}

function extractLiveRendererRequiredTailSummaries(ast) {
  return extractObjectArrayConst(ast, 'LIVE_RENDERER_REQUIRED_TAIL_SUMMARIES')
    .map((objectNode, index) => ({
      eventType: extractObjectStringProperty(
        objectNode,
        'eventType',
        `LIVE_RENDERER_REQUIRED_TAIL_SUMMARIES[${index}]`,
      ),
      kind: extractObjectStringProperty(
        objectNode,
        'kind',
        `LIVE_RENDERER_REQUIRED_TAIL_SUMMARIES[${index}]`,
      ),
    }));
}

function findVitestItCallback(sourceFile, title) {
  const matches = [];
  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'it'
      && node.arguments.length >= 2
      && isTypeScriptStringLiteral(node.arguments[0])
      && node.arguments[0].text === title
    ) {
      matches.push(node.arguments[1]);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.equal(matches.length, 1, `expected one Vitest it(...) block titled ${title}`);
  const callback = matches[0];
  assert.ok(
    ts.isArrowFunction(callback) || ts.isFunctionExpression(callback),
    `expected ${title} to use a function callback`,
  );
  assert.ok(ts.isBlock(callback.body), `expected ${title} callback body to be a block`);
  return callback;
}

function findCallbackConstArray(callback, constName, context) {
  const matches = [];
  for (const statement of callback.body.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    const isConstDeclarationList = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === constName) {
        assert.ok(isConstDeclarationList, `expected ${constName} in ${context} to be const`);
        matches.push(declaration.initializer);
      }
    }
  }
  assert.equal(matches.length, 1, `expected one ${constName} declaration in ${context}`);
  assert.ok(matches[0], `missing initializer for ${constName} in ${context}`);
  assert.ok(ts.isArrayLiteralExpression(matches[0]), `expected ${constName} in ${context} to be an array`);
  return matches[0];
}

function extractTypeScriptObjectStringProperty(objectNode, property, context) {
  assert.ok(ts.isObjectLiteralExpression(objectNode), `expected ${context} to be an object literal`);
  const matches = objectNode.properties.filter((candidate) => (
    ts.isPropertyAssignment(candidate)
    && typeScriptPropertyName(candidate.name) === property
  ));
  assert.equal(matches.length, 1, `expected one ${context}.${property} property`);
  const initializer = matches[0].initializer;
  assert.ok(isTypeScriptStringLiteral(initializer), `expected ${context}.${property} to be a string literal`);
  return initializer.text;
}

function extractPresentationCoverageEventTypes(source) {
  const sourceFile = parseTypeScriptSource(source, 'eventPresentation.test.ts');
  const callback = findVitestItCallback(sourceFile, presentationCoverageTitle);
  const cases = findCallbackConstArray(callback, 'cases', presentationCoverageTitle);
  assert.ok(cases.elements.length > 0, 'missing presentation coverage cases');
  return uniqueSorted(cases.elements.map((element, index) => (
    extractTypeScriptObjectStringProperty(element, 'type', `presentation cases[${index}]`)
  )));
}

test('event coverage matrix stays aligned with world-reference event catalog', () => {
  const worldTypes = extractWorldReferenceEventTypes(readRepoFile('docs/world-reference.md'));
  const coverageTypes = extractCoverageMatrixEventTypes(readRepoFile('docs/frontend/EVENT_COVERAGE.md'));

  assert.equal(worldTypes.length, 28);
  assert.equal(coverageTypes.length, 28);
  assert.deepEqual(coverageTypes, worldTypes);
});

test('event coverage matrix stays aligned with deterministic live event set', () => {
  const coverageTypes = extractCoverageMatrixEventTypes(readRepoFile('docs/frontend/EVENT_COVERAGE.md'));

  assert.deepEqual(coverageTypes, uniqueSorted(LIVE_RUN_EVENT_TYPES));
});

test('event coverage matrix stays aligned with app semantic fixture catalog', () => {
  const coverageTypes = extractCoverageMatrixEventTypes(readRepoFile('docs/frontend/EVENT_COVERAGE.md'));
  const appSpecAst = parseJavaScriptSource(readRepoFile('tests/frontend-app/world-renderer.spec.js'));
  const appFixtureTypes = extractAppSemanticFixtureEventTypes(appSpecAst);
  const appWorldReferenceTypes = extractAppWorldReferenceEventTypes(appSpecAst);

  assert.equal(appFixtureTypes.length, 28);
  assert.equal(appWorldReferenceTypes.length, 28);
  assert.deepEqual(appFixtureTypes, appWorldReferenceTypes);
  assert.deepEqual(coverageTypes, appFixtureTypes);
});

test('event coverage matrix stays aligned with event presentation coverage catalog', () => {
  const coverageTypes = extractCoverageMatrixEventTypes(readRepoFile('docs/frontend/EVENT_COVERAGE.md'));
  const presentationTypes = extractPresentationCoverageEventTypes(
    readRepoFile('frontend/src/app/eventPresentation.test.ts'),
  );

  assert.equal(presentationTypes.length, 28);
  assert.deepEqual(coverageTypes, presentationTypes);
});

test('event coverage matrix stays aligned with event visual catalog coverage', () => {
  const coverageTypes = extractCoverageMatrixEventTypes(readRepoFile('docs/frontend/EVENT_COVERAGE.md'));
  const visualCatalogSource = parseTypeScriptSource(
    readRepoFile('frontend/src/events/eventVisualCatalog.ts'),
    'eventVisualCatalog.ts',
  );
  const visualCatalogTestSource = parseTypeScriptSource(
    readRepoFile('frontend/src/events/eventVisualCatalog.test.ts'),
    'eventVisualCatalog.test.ts',
  );
  const visualEventTypes = uniqueSorted(
    extractTypeScriptStringArrayConst(visualCatalogSource, 'EVENT_VISUAL_EVENT_TYPES'),
  );
  const visualCatalogKeys = uniqueSorted(
    extractTypeScriptObjectConstKeys(visualCatalogSource, 'EVENT_VISUAL_CATALOG'),
  );
  const visualTestReferenceTypes = uniqueSorted(
    extractTypeScriptStringArrayConst(visualCatalogTestSource, 'WORLD_REFERENCE_EVENT_TYPES'),
  );
  const visualBehaviorKeys = uniqueSorted(
    extractTypeScriptObjectConstKeys(visualCatalogTestSource, 'LAYER_74_VISUAL_BEHAVIOR'),
  );

  assert.equal(visualEventTypes.length, 28);
  assert.equal(visualCatalogKeys.length, 28);
  assert.equal(visualTestReferenceTypes.length, 28);
  assert.equal(visualBehaviorKeys.length, 28);
  assert.deepEqual(visualCatalogKeys, visualEventTypes);
  assert.deepEqual(visualTestReferenceTypes, visualEventTypes);
  assert.deepEqual(visualBehaviorKeys, visualEventTypes);
  assert.deepEqual(coverageTypes, visualEventTypes);
});

test('Task 3 payload projector and presentation registries stay set-equal at 28 events', () => {
  const worldTypes = extractWorldReferenceEventTypes(readRepoFile('docs/world-reference.md'));
  const visualSource = parseTypeScriptSource(
    readRepoFile('frontend/src/events/eventVisualCatalog.ts'),
    'eventVisualCatalog.ts',
  );
  const payloadSource = parseTypeScriptSource(
    readRepoFile('frontend/src/presentation/eventPayloads.ts'),
    'eventPayloads.ts',
  );
  const projectorSource = parseTypeScriptSource(
    readRepoFile('frontend/src/presentation/PresentedEventProjector.ts'),
    'PresentedEventProjector.ts',
  );
  const presentationTypes = extractPresentationCoverageEventTypes(
    readRepoFile('frontend/src/app/eventPresentation.test.ts'),
  );
  const catalogs = {
    visualTypes: uniqueSorted(extractTypeScriptStringArrayConst(visualSource, 'EVENT_VISUAL_EVENT_TYPES')),
    visualCatalog: uniqueSorted(extractTypeScriptObjectConstKeys(visualSource, 'EVENT_VISUAL_CATALOG')),
    payloadUnion: uniqueSorted(extractTypeScriptInterfacePropertyKeys(payloadSource, 'PresentedPayloadByType')),
    payloadParsers: uniqueSorted(extractTypeScriptObjectConstKeys(payloadSource, 'PRESENTED_EVENT_PAYLOAD_PARSERS')),
    projectors: uniqueSorted(extractTypeScriptObjectConstKeys(projectorSource, 'PRESENTED_EVENT_PROJECTORS')),
    presentation: presentationTypes,
  };

  assert.equal(worldTypes.length, 28);
  for (const [name, eventTypes] of Object.entries(catalogs)) {
    assert.equal(eventTypes.length, 28, `${name} must contain exactly 28 event types`);
    assert.deepEqual(eventTypes, worldTypes, `${name} drifted from the world-reference catalog`);
  }
});

test('Task 9 choreography family partition and declaration contract stay canonical', () => {
  const worldTypes = extractWorldReferenceEventTypes(readRepoFile('docs/world-reference.md'));
  const registrySource = parseTypeScriptSource(
    readRepoFile('frontend/src/presentation/choreography/registry.ts'),
    'choreography/registry.ts',
  );
  const contractSource = parseTypeScriptSource(
    readRepoFile('frontend/src/presentation/choreography/contracts.ts'),
    'choreography/contracts.ts',
  );
  const families = extractTypeScriptObjectStringArrayEntries(
    registrySource,
    'CHOREOGRAPHY_FAMILY_EVENT_TYPES',
  );
  const expectedCounts = {
    lifecycle: 5,
    movement: 2,
    communication: 2,
    resource: 3,
    bond: 4,
    combat: 1,
    home: 6,
    contest: 4,
    system: 1,
  };

  assert.deepEqual(Object.keys(families), Object.keys(expectedCounts));
  for (const [family, expectedCount] of Object.entries(expectedCounts)) {
    assert.equal(families[family].length, expectedCount, `${family} choreography family count drifted`);
  }
  const flattened = Object.values(families).flat();
  assert.equal(new Set(flattened).size, flattened.length, 'choreography families must be disjoint');
  assert.deepEqual(uniqueSorted(flattened), worldTypes);
  assert.deepEqual(
    uniqueSorted(extractTypeScriptInterfacePropertyKeys(contractSource, 'ChoreographyDefinition')),
    uniqueSorted([
      'eventType',
      'participants',
      'requiredAnchors',
      'contactMarker',
      'consequenceMarker',
      'safeCancelMarkers',
      'duration',
      'missingParticipant',
      'resolve',
    ]),
  );
});

test('Task 9 frozen Chronicles honestly cover the full 28-event vocabulary', () => {
  const worldTypes = extractWorldReferenceEventTypes(readRepoFile('docs/world-reference.md'));
  const dataDir = path.join(repoRoot, 'tests/frontend-app/fixtures/chronicles/data');
  const fixtureTypes = new Set();
  for (const fileName of fs.readdirSync(dataDir).filter((name) => /^C\d\d-.*\.json$/.test(name))) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, fileName), 'utf8'));
    for (const entry of manifest.entries) fixtureTypes.add(entry.event.type);
  }
  assert.equal(fixtureTypes.size, 28);
  assert.deepEqual(
    worldTypes.filter((eventType) => !fixtureTypes.has(eventType)),
    [],
  );
});

test('Task 12 generated Chronicle catalog stays exactly ordered and identity-equal at C00-C19', () => {
  const dataDir = path.join(repoRoot, 'tests/frontend-app/fixtures/chronicles/data');
  const catalog = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8'));
  const expectedIds = Array.from({ length: 20 }, (_unused, index) => `C${String(index).padStart(2, '0')}`);
  assert.deepEqual(Object.keys(catalog).sort(), ['chronicles', 'schema']);
  assert.equal(catalog.schema, 1);
  assert.equal(catalog.chronicles.length, 20);
  assert.deepEqual(catalog.chronicles.map(({ id }) => id), expectedIds);

  const generatedFiles = fs.readdirSync(dataDir)
    .filter((name) => /^C\d\d-.*\.json$/.test(name))
    .sort();
  assert.deepEqual(generatedFiles, catalog.chronicles.map(({ file }) => file).sort());

  const coveredTypes = new Set();
  for (const [index, entry] of catalog.chronicles.entries()) {
    assert.deepEqual(Object.keys(entry).sort(), [
      'expectedFinalCursor', 'file', 'id', 'runId', 'seed', 'slug', 'version',
    ]);
    assert.equal(entry.id, expectedIds[index]);
    assert.equal(entry.file, `${entry.id}-${entry.slug}.json`);
    assert.equal(entry.version, 1);
    assert.equal(entry.seed, 30_000 + index);
    assert.equal(entry.runId, `mock-${entry.id.toLowerCase()}-v1`);
    const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, entry.file), 'utf8'));
    for (const field of ['id', 'slug', 'version', 'seed', 'runId', 'expectedFinalCursor']) {
      assert.equal(manifest[field], entry[field], `${entry.id} ${field} drifted from catalog`);
    }
    assert.equal(manifest.initialSnapshot.run_id, entry.runId);
    assert.equal(manifest.initialSnapshot.event_cursor, 0);
    assert.equal(manifest.entries.length, entry.expectedFinalCursor);
    assert.deepEqual(
      manifest.entries.map(({ cursor }) => cursor),
      Array.from({ length: entry.expectedFinalCursor }, (_unused, cursor) => cursor + 1),
    );
    for (const envelope of manifest.entries) coveredTypes.add(envelope.event.type);
    const eventTypeCounts = new Map();
    for (const { event } of manifest.entries) {
      eventTypeCounts.set(event.type, (eventTypeCounts.get(event.type) ?? 0) + 1);
    }
    const occurrenceQualifiedTypes = new Set(manifest.expectedMarkers.flatMap((marker) => {
      const match = /^event:([^@]+)@cursor:\d+$/.exec(marker);
      return match?.[1] === undefined ? [] : [match[1]];
    }));
    const requiredMarkers = uniqueSorted(manifest.entries.map(({ cursor, event }) => (
      eventTypeCounts.get(event.type) === 1 || !occurrenceQualifiedTypes.has(event.type)
        ? `event:${event.type}`
        : `event:${event.type}@cursor:${cursor}`
    )));
    requiredMarkers.push('checkpoint:final');
    assert.deepEqual(manifest.expectedMarkers, requiredMarkers, `${entry.id} marker catalog drifted`);
  }

  const sourceFile = parseTypeScriptSource(
    readRepoFile('frontend/src/presentation/fixtures/chronicleCatalog.ts'),
    'chronicleCatalog.ts',
  );
  assert.deepEqual(extractTypeScriptStringArrayConst(sourceFile, 'CHRONICLE_IDS'), expectedIds);
  const worldTypes = extractWorldReferenceEventTypes(readRepoFile('docs/world-reference.md'));
  assert.equal(coveredTypes.size, 28);
  assert.deepEqual(
    worldTypes.filter((eventType) => !coveredTypes.has(eventType)),
    [],
  );
});

test('Task 12 Chronicle producer tool catalog stays equal to the exact 17 builtins', () => {
  const canonical = extractPythonQuotedSet(
    readRepoFile('tests/fixtures/chronicles/catalog.py'),
    'CANONICAL_TOOL_NAMES = frozenset(',
    '\n\nCANONICAL_EVENT_TYPES',
  );
  const builtins = extractPythonQuotedSet(
    readRepoFile('tools/builtin/__init__.py'),
    'BUILTIN_TOOLS: dict[str, ToolFn] = {',
    '\n}',
  );
  assert.equal(canonical.length, 17);
  assert.deepEqual(canonical, builtins);
  assert.deepEqual(
    uniqueSorted(MECHANICS_TOOL_NAMES).filter((tool) => !canonical.includes(tool)),
    [],
  );
});

test('RED: Task 9 real choreography registry closes over all 28 canonical event types', () => {
  const worldTypes = extractWorldReferenceEventTypes(readRepoFile('docs/world-reference.md'));
  const registrySource = parseTypeScriptSource(
    readRepoFile('frontend/src/presentation/choreography/registry.ts'),
    'choreography/registry.ts',
  );
  const registeredTypes = uniqueSorted(
    extractTypeScriptStringArrayConst(registrySource, 'CHOREOGRAPHY_REGISTERED_EVENT_TYPES'),
  );
  assert.equal(registeredTypes.length, 28);
  assert.deepEqual(registeredTypes, worldTypes);
});

test('event coverage matrix stays aligned with beat director grouping coverage', () => {
  const beatParticipantTypes = extractCoverageMatrixBeatParticipantTypes(
    readRepoFile('docs/frontend/EVENT_COVERAGE.md'),
  );
  const beatDirectorSource = parseTypeScriptSource(
    readRepoFile('frontend/src/events/beatDirector.ts'),
    'beatDirector.ts',
  );
  const switchTypes = extractBeatDirectorSwitchTypes(beatDirectorSource);
  const groupableTypes = extractBeatDirectorGroupableTypes(beatDirectorSource);
  const declaredParticipantTypes = extractBeatDirectorDeclaredParticipantTypes(beatDirectorSource);
  const implementationTypes = extractBeatDirectorParticipantTypes(beatDirectorSource);

  assert.equal(beatParticipantTypes.length, 13);
  assert.equal(groupableTypes.length, 10);
  assert.equal(declaredParticipantTypes.length, 13);
  assert.deepEqual(groupableTypes, switchTypes);
  assert.deepEqual(declaredParticipantTypes, implementationTypes);
  assert.deepEqual(beatParticipantTypes, declaredParticipantTypes);
});

test('event coverage matrix stays aligned with renderer grammar coverage', () => {
  const coverageMarkdown = readRepoFile('docs/frontend/EVENT_COVERAGE.md');
  const coverageTypes = extractCoverageMatrixEventTypes(coverageMarkdown);
  const rendererSpecialRows = extractCoverageMatrixRendererTypesByPrefix(coverageMarkdown, 'special');
  const rendererBubbleRows = extractCoverageMatrixRendererTypesByPrefix(coverageMarkdown, 'bubble');
  const rendererPassiveRows = extractCoverageMatrixRendererTypesByPrefix(coverageMarkdown, 'passive');
  const rendererSource = parseTypeScriptSource(
    readRepoFile('frontend/src/renderer/WorldRenderer.ts'),
    'WorldRenderer.ts',
  );
  const appSpecAst = parseJavaScriptSource(readRepoFile('tests/frontend-app/world-renderer.spec.js'));
  const declaredVisualTypes = extractRendererVisualSpecDeclaredTypes(rendererSource);
  const visualSpecSwitchTypes = extractRendererVisualSpecSwitchTypes(rendererSource);
  const specialGrammarTypes = extractRendererSpecialGrammarTypes(rendererSource);
  const bubbleGrammarTypes = extractRendererBubbleGrammarTypes(rendererSource);
  const passiveGrammarTypes = extractRendererPassiveGrammarTypes(rendererSource);
  const specialEffectTypes = extractRendererSpecialEffectTypes(rendererSource);
  const specialEffectSwitchTypes = extractRendererSpecialEffectSwitchTypes(rendererSource);
  const lifeTransitionTypes = extractRendererLifeTransitionTypes(rendererSource);
  const visualSpecLifeTransitionTypes = extractRendererVisualSpecLifeTransitionTypes(rendererSource);
  const bespokeBubbleSummaryTypes = extractRendererBespokeBubbleSummaryTypes(rendererSource);
  const bubbleSummaryImplementationTypes = extractRendererBubbleSummaryImplementationTypes(rendererSource);
  const debugSummaryKinds = extractRendererDebugSummaryKinds(rendererSource);
  const productionSummaryKinds = extractRendererProductionSummaryKinds(rendererSource);
  const appSummaryKinds = uniqueSorted(extractStringArrayConst(appSpecAst, 'rendererSummaryKindCatalog'));
  const motionModeSummaryKinds = extractRendererMotionModeSummaryKinds(rendererSource);
  const appMotionModeSummaryKinds = uniqueSorted(extractStringArrayConst(
    appSpecAst,
    'rendererMotionModeSummaryKinds',
  ));
  const specialEffectRows = uniqueSorted(
    specialEffectTypes.filter((type) => !bubbleGrammarTypes.includes(type)),
  );

  assert.equal(declaredVisualTypes.length, 28);
  assert.equal(specialGrammarTypes.length, 21);
  assert.equal(bubbleGrammarTypes.length, 6);
  assert.equal(passiveGrammarTypes.length, 1);
  assert.equal(specialEffectTypes.length, 20);
  assert.equal(lifeTransitionTypes.length, 3);
  assert.equal(bespokeBubbleSummaryTypes.length, 8);
  assert.equal(debugSummaryKinds.length, 29);
  assert.deepEqual(coverageTypes, declaredVisualTypes);
  assert.deepEqual(declaredVisualTypes, visualSpecSwitchTypes);
  assert.deepEqual(rendererSpecialRows, specialGrammarTypes);
  assert.deepEqual(rendererBubbleRows, bubbleGrammarTypes);
  assert.deepEqual(rendererPassiveRows, passiveGrammarTypes);
  assert.deepEqual(specialEffectTypes, specialEffectSwitchTypes);
  assert.deepEqual(lifeTransitionTypes, visualSpecLifeTransitionTypes);
  assert.deepEqual(
    specialGrammarTypes,
    uniqueSorted([...specialEffectRows, ...lifeTransitionTypes]),
  );
  assert.deepEqual(bespokeBubbleSummaryTypes, bubbleSummaryImplementationTypes);
  assert.deepEqual(debugSummaryKinds, productionSummaryKinds);
  assert.deepEqual(debugSummaryKinds, appSummaryKinds);
  assert.deepEqual(motionModeSummaryKinds, appMotionModeSummaryKinds);
  assert.deepEqual(
    uniqueSorted([...specialGrammarTypes, ...bubbleGrammarTypes, ...passiveGrammarTypes]),
    coverageTypes,
  );
  assert.deepEqual(
    motionModeSummaryKinds.filter((kind) => !debugSummaryKinds.includes(kind)),
    [],
  );
});

test('live renderer summary diagnostics stay aligned with renderer summary catalogs', () => {
  const rendererSource = parseTypeScriptSource(
    readRepoFile('frontend/src/renderer/WorldRenderer.ts'),
    'WorldRenderer.ts',
  );
  const diagnosticsAst = parseJavaScriptSource(
    readRepoFile('tests/frontend-live/live-renderer-summary-diagnostics.js'),
  );
  const rendererSummaryKinds = extractRendererDebugSummaryKinds(rendererSource);
  const liveSummaryKinds = uniqueSorted(
    extractStringArrayConst(diagnosticsAst, 'LIVE_RENDERER_SUMMARY_KIND_POOL'),
  );
  const rendererMotionModeKinds = extractRendererMotionModeSummaryKinds(rendererSource);
  const liveMotionModeKinds = uniqueSorted(
    extractStringArrayConst(diagnosticsAst, 'LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS'),
  );

  assert.equal(liveSummaryKinds.length, 29);
  assert.equal(liveMotionModeKinds.length, 25);
  assert.deepEqual(liveSummaryKinds, rendererSummaryKinds);
  assert.deepEqual(liveMotionModeKinds, rendererMotionModeKinds);
});

test('live renderer required tail summaries stay aligned with renderer grammar', () => {
  const coverageTypes = extractCoverageMatrixEventTypes(readRepoFile('docs/frontend/EVENT_COVERAGE.md'));
  const rendererSource = parseTypeScriptSource(
    readRepoFile('frontend/src/renderer/WorldRenderer.ts'),
    'WorldRenderer.ts',
  );
  const diagnosticsAst = parseJavaScriptSource(
    readRepoFile('tests/frontend-live/live-renderer-summary-diagnostics.js'),
  );
  const visualTypes = extractRendererVisualSpecDeclaredTypes(rendererSource);
  const summaryKinds = extractRendererDebugSummaryKinds(rendererSource);
  const lifeTransitionTypes = extractRendererLifeTransitionTypes(rendererSource);
  const bespokeBubbleSummaryTypes = extractRendererBespokeBubbleSummaryTypes(rendererSource);
  const genericBubbleTypes = visualTypes.filter((type) => (
    !bespokeBubbleSummaryTypes.includes(type)
  ));
  const requiredTailSummaries = extractLiveRendererRequiredTailSummaries(diagnosticsAst);
  const requiredPairKeys = requiredTailSummaries.map(({ eventType, kind }) => `${eventType}/${kind}`);

  assert.deepEqual(visualTypes, coverageTypes);
  assert.ok(requiredPairKeys.includes('agent_died/generic-event-bubble'));
  assert.ok(requiredPairKeys.includes('agent_died/life-transition'));
  assert.equal(new Set(requiredPairKeys).size, requiredPairKeys.length);
  assert.deepEqual(
    requiredTailSummaries.filter(({ eventType }) => !visualTypes.includes(eventType)),
    [],
  );
  assert.deepEqual(
    requiredTailSummaries.filter(({ kind }) => !summaryKinds.includes(kind)),
    [],
  );
  assert.deepEqual(
    requiredTailSummaries
      .filter(({ kind }) => kind === 'life-transition')
      .filter(({ eventType }) => !lifeTransitionTypes.includes(eventType)),
    [],
  );
  assert.ok(lifeTransitionTypes.includes('agent_died'));
  assert.deepEqual(
    requiredTailSummaries
      .filter(({ kind }) => kind === 'generic-event-bubble')
      .filter(({ eventType }) => !genericBubbleTypes.includes(eventType)),
    [],
  );
  assert.ok(genericBubbleTypes.includes('agent_died'));
  assert.deepEqual(
    requiredTailSummaries.filter(({ kind }) => (
      kind !== 'generic-event-bubble' &&
      kind !== 'life-transition'
    )),
    [],
  );
});

test('renderer raw summary field diagnostics stay aligned across app and live guards', () => {
  const appSpecAst = parseJavaScriptSource(readRepoFile('tests/frontend-app/world-renderer.spec.js'));
  const diagnosticsAst = parseJavaScriptSource(
    readRepoFile('tests/frontend-live/live-renderer-summary-diagnostics.js'),
  );
  const appRawFields = extractRendererAppRawSummaryFields(appSpecAst);
  const liveRawFields = uniqueSorted(
    extractStringArrayConst(diagnosticsAst, 'LIVE_RENDERER_RAW_SUMMARY_FIELDS'),
  );

  assert.equal(appRawFields.length, 10);
  assert.deepEqual(liveRawFields, appRawFields);
});

test('renderer tuple summary diagnostics stay aligned across app and live guards', () => {
  const appSpecAst = parseJavaScriptSource(readRepoFile('tests/frontend-app/world-renderer.spec.js'));
  const diagnosticsAst = parseJavaScriptSource(
    readRepoFile('tests/frontend-live/live-renderer-summary-diagnostics.js'),
  );
  const appTupleFields = uniqueSorted(extractStringArrayConst(appSpecAst, 'summaryTupleFields'));
  const liveTupleFields = uniqueSorted(
    extractStringArrayConst(diagnosticsAst, 'LIVE_RENDERER_SUMMARY_TUPLE_FIELDS'),
  );
  const appTupleArrayFields = uniqueSorted(
    extractStringArrayConst(appSpecAst, 'summaryTupleArrayFields'),
  );
  const liveTupleArrayFields = uniqueSorted(
    extractStringArrayConst(diagnosticsAst, 'LIVE_RENDERER_SUMMARY_TUPLE_ARRAY_FIELDS'),
  );

  assert.equal(appTupleFields.length, 11);
  assert.equal(appTupleArrayFields.length, 4);
  assert.deepEqual(liveTupleFields, appTupleFields);
  assert.deepEqual(liveTupleArrayFields, appTupleArrayFields);
});

test('renderer mutation-boundary diagnostics stay aligned across app and live guards', () => {
  const appSpecAst = parseJavaScriptSource(readRepoFile('tests/frontend-app/world-renderer.spec.js'));
  const diagnosticsAst = parseJavaScriptSource(
    readRepoFile('tests/frontend-live/live-renderer-summary-diagnostics.js'),
  );
  const appInvariants = extractRendererSummaryMutationBoundaryInvariants(
    appSpecAst,
    'expectRendererSummaryCatalogIntegrity',
  );
  const liveInvariants = extractRendererSummaryMutationBoundaryInvariants(
    diagnosticsAst,
    'validateMechanicsRendererSummaryDiagnostics',
  );

  assert.deepEqual(appInvariants, {
    properties: ['inspectorMutated', 'selectionMutated'],
    suffixes: ['Created', 'Mutated'],
  });
  assert.deepEqual(liveInvariants, appInvariants);
});

test('renderer generic carrier diagnostics stay aligned across app and live guards', () => {
  const appSpecAst = parseJavaScriptSource(readRepoFile('tests/frontend-app/world-renderer.spec.js'));
  const diagnosticsAst = parseJavaScriptSource(
    readRepoFile('tests/frontend-live/live-renderer-summary-diagnostics.js'),
  );
  const appInvariants = extractRendererGenericCarrierInvariants(
    appSpecAst,
    'expectRendererSummaryCatalogIntegrity',
  );
  const liveInvariants = extractRendererGenericCarrierInvariants(
    diagnosticsAst,
    'validateMechanicsRendererSummaryDiagnostics',
  );

  assert.deepEqual(appInvariants, {
    'generic-event-arc': {
      summaryProperties: ['arcEventType', 'eventGroup'],
      effectProperties: ['bubble', 'eventType', 'group'],
      bubbleRequired: false,
    },
    'generic-event-bubble': {
      summaryProperties: ['bubbleEventType', 'eventGroup'],
      effectProperties: ['bubble', 'eventType', 'group'],
      bubbleRequired: true,
    },
    'generic-event-pulse': {
      summaryProperties: ['eventGroup', 'pulseEventType'],
      effectProperties: ['bubble', 'eventType', 'group'],
      bubbleRequired: false,
    },
  });
  assert.deepEqual(liveInvariants, appInvariants);
});

test('renderer motion-mode diagnostics stay aligned across app and live guards', () => {
  const appSpecAst = parseJavaScriptSource(readRepoFile('tests/frontend-app/world-renderer.spec.js'));
  const diagnosticsAst = parseJavaScriptSource(
    readRepoFile('tests/frontend-live/live-renderer-summary-diagnostics.js'),
  );
  const appMotionModeKinds = uniqueSorted(extractStringArrayConst(
    appSpecAst,
    'rendererMotionModeSummaryKinds',
  ));
  const liveMotionModeKinds = uniqueSorted(
    extractStringArrayConst(diagnosticsAst, 'LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS'),
  );
  const appInvariant = extractRendererMotionModeInvariant(
    appSpecAst,
    'expectRendererSummaryCatalogIntegrity',
  );
  const liveInvariant = extractRendererMotionModeInvariant(
    diagnosticsAst,
    'validateMechanicsRendererSummaryDiagnostics',
  );

  assert.equal(appMotionModeKinds.length, 25);
  assert.deepEqual(liveMotionModeKinds, appMotionModeKinds);
  assert.deepEqual(appInvariant, {
    catalogName: 'summaryMotionModeKinds',
    catalogMethod: 'has',
    summaryKindProperty: 'kind',
    assertion: 'expect-toBe',
    summaryMotionModeProperty: 'motionMode',
    modeIdentifier: 'motionMode',
  });
  assert.deepEqual(liveInvariant, {
    catalogName: 'LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS',
    catalogMethod: 'includes',
    summaryKindProperty: 'kind',
    assertion: 'failure-on-inequality',
    summaryMotionModeProperty: 'motionMode',
    modeIdentifier: 'motionMode',
  });
  assert.deepEqual(
    {
      summaryKindProperty: appInvariant.summaryKindProperty,
      summaryMotionModeProperty: appInvariant.summaryMotionModeProperty,
      modeIdentifier: appInvariant.modeIdentifier,
    },
    {
      summaryKindProperty: liveInvariant.summaryKindProperty,
      summaryMotionModeProperty: liveInvariant.summaryMotionModeProperty,
      modeIdentifier: liveInvariant.modeIdentifier,
    },
  );
});

test('world-reference event parser ignores payload-key backticks and cross references', () => {
  const markdown = `
### Lifecycle
| type | payload |
| --- | --- |
| \`agent_born\` | \`child_id\`, \`parent_ids\` |
| *(\`agent_died\`)* | see lifecycle |
| \`speak\` | \`message\`, \`target\` |
**Chained events
`;

  assert.deepEqual(extractWorldReferenceEventTypes(markdown), [
    'agent_born',
    'speak',
  ]);
});

test('beat coverage parser reads beat column and event-type implementation checks only', () => {
  const markdown = `
## Matrix
| Event type | Presentation | Beat | Renderer | App QA | Deterministic live |
| --- | --- | --- | --- | --- | --- |
| \`agent_entered_region\` | yes | movement winner | bubble | yes | yes |
| \`agent_left_region\` | yes | grouped into entered | bubble | yes | yes |
| \`speak\` | yes | pass-through | bubble | yes | yes |
## Current Proof Surfaces
`;
  const source = `
export const BEAT_DIRECTOR_GROUPABLE_EVENT_TYPES = [
  "agent_left_region",
] as const;

export const BEAT_DIRECTOR_PARTICIPANT_EVENT_TYPES = [
  "agent_left_region",
  "agent_entered_region",
] as const;

function groupedVisualBeat(entry, candidates, groupingWindowMs) {
  switch (entry.event.type) {
    case "agent_left_region": {
      const arrival = candidates.find((candidate) => (
        candidate.event.type === "agent_entered_region" &&
        eventPayloadString(candidate, "agent_id") === eventPayloadString(entry, "agent_id")
      ));
      return arrival ? { visual: arrival, skip: [entry] } : null;
    }
    default:
      return null;
  }
}

function findRecoveryPartner(entry, candidates, groupingWindowMs) {
  return undefined;
}

function findAgentHoardingPartner(entry, candidates, groupingWindowMs) {
  return undefined;
}
`;
  const sourceFile = parseTypeScriptSource(source, 'beatDirector.test-snippet.ts');

  assert.deepEqual(extractCoverageMatrixBeatParticipantTypes(markdown), [
    'agent_entered_region',
    'agent_left_region',
  ]);
  assert.deepEqual(extractBeatDirectorGroupableTypes(sourceFile), [
    'agent_left_region',
  ]);
  assert.deepEqual(extractBeatDirectorDeclaredParticipantTypes(sourceFile), [
    'agent_entered_region',
    'agent_left_region',
  ]);
  assert.deepEqual(extractBeatDirectorParticipantTypes(sourceFile), [
    'agent_entered_region',
    'agent_left_region',
  ]);
});

test('renderer coverage parser reads renderer categories and grammar catalogs only', () => {
  const markdown = `
## Matrix
| Event type | Presentation | Beat | Renderer | App QA | Deterministic live |
| --- | --- | --- | --- | --- | --- |
| \`agent_died\` | yes | pass-through | special life transition | yes | yes |
| \`simulation_started\` | yes | pass-through | passive startup bubble/system pulse | yes | yes |
| \`speak\` | yes | pass-through | bubble speech plus targeted leader-line diagnostics | yes | yes |
## Current Proof Surfaces
`;
  const source = `
export const RENDERER_VISUAL_SPEC_EVENT_TYPES = [
  "agent_died",
  "simulation_started",
  "speak",
] as const;

export const RENDERER_SPECIAL_GRAMMAR_EVENT_TYPES = [
  "agent_died",
] as const;

export const RENDERER_BUBBLE_GRAMMAR_EVENT_TYPES = [
  "speak",
] as const;

export const RENDERER_PASSIVE_GRAMMAR_EVENT_TYPES = [
  "simulation_started",
] as const;

export const RENDERER_SPECIAL_EFFECT_EVENT_TYPES = [
  "speak",
] as const;

export const RENDERER_LIFE_TRANSITION_EVENT_TYPES = [
  "agent_died",
] as const;

export const RENDERER_BESPOKE_BUBBLE_SUMMARY_EVENT_TYPES = [
  "speak",
] as const;

export const RENDERER_DEBUG_SUMMARY_KINDS = [
  "generic-event-bubble",
  "home-membership-join",
  "home-theft-raid",
  "speech-bubble",
] as const;

export const RENDERER_MOTION_MODE_SUMMARY_KINDS = [
  "generic-event-bubble",
  "speech-bubble",
] as const;

function visualSpecFor(entry) {
  const event = entry.event;
  const payload = { ignored: "agent_id" };
  switch (event.type) {
    case "agent_died":
      return { lifeTransitionKind: "died", label: "copy ignored" };
    case "simulation_started":
      return { label: "world wakes" };
    case "speak":
      return { label: "speaks" };
    default:
      return { label: event.type };
  }
}

class WorldRenderer {
  addSpecialEventEffects(eventType) {
    switch (eventType) {
      case "speak":
        break;
      default:
        break;
    }
  }

  bubbleEventDebugSummary(eventType) {
    if (eventType === "speak") {
      return { kind: "speech-bubble" };
    }
    return this.genericBubbleDebugSummary(eventType);
  }

  genericBubbleDebugSummary(eventType) {
    return { kind: "generic-event-bubble", bubbleEventType: eventType };
  }

  genericPulseDebugSummary(eventType) {
    return {};
  }

  genericArcDebugSummary(eventType) {
    return {};
  }

  simulationStartedDebugSummary(primary) {
    return {};
  }

  hearthEmberDebugSummary() {
    return {};
  }

  combatBubbleDebugSummary() {
    return {};
  }

  thoughtWispDebugSummary() {
    return {};
  }

  agentHoardingDebugSummary() {
    return {};
  }

  combatImpactDebugSummary() {
    return {};
  }

  effectDebugSummary(effect) {
    return {
      kind: effect.homeRaid ? "home-theft-raid" : "generic-event-bubble",
    };
  }
}

function homeLifecycleDebugKind(kind) {
  switch (kind) {
    case "join":
      return "home-membership-join";
  }
}
`;
  const sourceFile = parseTypeScriptSource(source, 'WorldRenderer.test-snippet.ts');

  assert.deepEqual(extractCoverageMatrixRendererTypesByPrefix(markdown, 'special'), [
    'agent_died',
  ]);
  assert.deepEqual(extractCoverageMatrixRendererTypesByPrefix(markdown, 'bubble'), [
    'speak',
  ]);
  assert.deepEqual(extractCoverageMatrixRendererTypesByPrefix(markdown, 'passive'), [
    'simulation_started',
  ]);
  assert.deepEqual(extractRendererVisualSpecDeclaredTypes(sourceFile), [
    'agent_died',
    'simulation_started',
    'speak',
  ]);
  assert.deepEqual(extractRendererVisualSpecSwitchTypes(sourceFile), [
    'agent_died',
    'simulation_started',
    'speak',
  ]);
  assert.deepEqual(extractRendererSpecialEffectSwitchTypes(sourceFile), [
    'speak',
  ]);
  assert.deepEqual(extractRendererVisualSpecLifeTransitionTypes(sourceFile), [
    'agent_died',
  ]);
  assert.deepEqual(extractRendererBubbleSummaryImplementationTypes(sourceFile), [
    'speak',
  ]);
  assert.deepEqual(extractRendererProductionSummaryKinds(sourceFile), [
    'generic-event-bubble',
    'home-membership-join',
    'home-theft-raid',
    'speech-bubble',
  ]);
});

test('javascript string-array parser reads frozen catalogs only', () => {
  const source = `
const LIVE_RENDERER_SUMMARY_KIND_POOL = Object.freeze([
  'generic-event-bubble',
  'speech-bubble',
]);

const ignored = Object.freeze([
  'home-build',
]);

const rendererSummaryKindCatalog = [
  'private-thought',
].sort();

const rendererMotionModeSummaryKinds = [
  'generic-event-bubble',
].sort();

const summaryMotionModeKinds = new Set(rendererMotionModeSummaryKinds);

const summaryTupleFields = [
  'anchorWorld',
];

const summaryTupleArrayFields = [
  'parentWorlds',
];

const LIVE_RENDERER_REQUIRED_TAIL_SUMMARIES = Object.freeze([
  { eventType: 'agent_died', kind: 'life-transition' },
]);

const LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS = Object.freeze([
  'generic-event-bubble',
]);

function expectSummaryHasNoRawFields(summary) {
  for (const rawField of ['message', 'text']) {
    if (summary[rawField]) {
      throw new Error(rawField);
    }
  }
}

function expectRendererSummaryCatalogIntegrity(effects, expectedKinds, motionMode = 'full') {
  expect(summary.inspectorMutated).toBe(false);
  expect(summary.selectionMutated).toBe(false);
  if (summaryMotionModeKinds.has(summary.kind)) {
    expect(summary.motionMode).toBe(motionMode);
  }
  for (const [field, value] of Object.entries(summary)) {
    if (field.endsWith('Mutated') || field.endsWith('Created')) {
      expect(value).toBe(false);
    }
  }
}

function validateMechanicsRendererSummaryDiagnostics(diagnostics) {
  const motionMode = diagnostics?.motionMode?.mode;
  if (
    LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS.includes(summary.kind) &&
    summary.motionMode !== motionMode
  ) {
    failures.push('motion mode');
  }
  if (summary.kind === 'generic-event-bubble') {
    if (summary.bubbleEventType !== effect.eventType) failures.push('type');
    if (summary.eventGroup !== effect.group) failures.push('group');
    if (effect.hasBubble !== true) failures.push('bubble');
  }
}
`;
  const ast = parseJavaScriptSource(source);

  assert.deepEqual(extractStringArrayConst(ast, 'LIVE_RENDERER_SUMMARY_KIND_POOL'), [
    'generic-event-bubble',
    'speech-bubble',
  ]);
  assert.deepEqual(extractStringArrayConst(ast, 'rendererSummaryKindCatalog'), [
    'private-thought',
  ]);
  assert.deepEqual(extractStringArrayConst(ast, 'rendererMotionModeSummaryKinds'), [
    'generic-event-bubble',
  ]);
  assert.deepEqual(extractStringArrayConst(ast, 'LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS'), [
    'generic-event-bubble',
  ]);
  assert.deepEqual(extractLiveRendererRequiredTailSummaries(ast), [
    { eventType: 'agent_died', kind: 'life-transition' },
  ]);
  assert.deepEqual(extractRendererAppRawSummaryFields(ast), [
    'message',
    'text',
  ]);
  assert.deepEqual(extractStringArrayConst(ast, 'summaryTupleFields'), [
    'anchorWorld',
  ]);
  assert.deepEqual(extractStringArrayConst(ast, 'summaryTupleArrayFields'), [
    'parentWorlds',
  ]);
  assert.deepEqual(
    extractRendererSummaryMutationBoundaryInvariants(ast, 'expectRendererSummaryCatalogIntegrity'),
    {
      properties: ['inspectorMutated', 'selectionMutated'],
      suffixes: ['Created', 'Mutated'],
    },
  );
  assert.deepEqual(
    extractRendererGenericCarrierInvariants(ast, 'validateMechanicsRendererSummaryDiagnostics'),
    {
      'generic-event-bubble': {
        summaryProperties: ['bubbleEventType', 'eventGroup'],
        effectProperties: ['bubble', 'eventType', 'group'],
        bubbleRequired: true,
      },
    },
  );
  assert.deepEqual(
    extractRendererMotionModeInvariant(ast, 'expectRendererSummaryCatalogIntegrity'),
    {
      catalogName: 'summaryMotionModeKinds',
      catalogMethod: 'has',
      summaryKindProperty: 'kind',
      assertion: 'expect-toBe',
      summaryMotionModeProperty: 'motionMode',
      modeIdentifier: 'motionMode',
    },
  );
  assert.deepEqual(
    extractRendererMotionModeInvariant(ast, 'validateMechanicsRendererSummaryDiagnostics'),
    {
      catalogName: 'LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS',
      catalogMethod: 'includes',
      summaryKindProperty: 'kind',
      assertion: 'failure-on-inequality',
      summaryMotionModeProperty: 'motionMode',
      modeIdentifier: 'motionMode',
    },
  );

  const looseMotionModeAst = parseJavaScriptSource(`
function validateMechanicsRendererSummaryDiagnostics(diagnostics) {
  const motionMode = diagnostics?.motionMode?.mode;
  if (
    LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS.includes(summary.kind) &&
    summary.motionMode != motionMode
  ) {
    failures.push('motion mode');
  }
}
`);
  assert.throws(
    () => extractRendererMotionModeInvariant(
      looseMotionModeAst,
      'validateMechanicsRendererSummaryDiagnostics',
    ),
    /expected one motion-mode equality invariant/,
  );
});

test('event visual catalog parser reads exported arrays and catalog keys only', () => {
  const source = `
export const EVENT_VISUAL_EVENT_TYPES = [
  "agent_born",
  "home_built",
] as const;

const unrelated = {
  speak: { label: "ignored" },
};

export const EVENT_VISUAL_CATALOG = {
  agent_born: { iconKey: "birth", medallionLabel: "Birth" },
  home_built: { iconKey: "home", medallionLabel: "Home" },
} as const satisfies Record<string, { iconKey: string; medallionLabel: string }>;

const WORLD_REFERENCE_EVENT_TYPES = [
  "agent_born",
  "home_built",
] as const;

const LAYER_74_VISUAL_BEHAVIOR = {
  agent_born: { priority: "featured" },
  home_built: { priority: "featured" },
} as const;
`;
  const sourceFile = parseTypeScriptSource(source, 'eventVisualCatalog.test-snippet.ts');

  assert.deepEqual(uniqueSorted(extractTypeScriptStringArrayConst(sourceFile, 'EVENT_VISUAL_EVENT_TYPES')), [
    'agent_born',
    'home_built',
  ]);
  assert.deepEqual(uniqueSorted(extractTypeScriptObjectConstKeys(sourceFile, 'EVENT_VISUAL_CATALOG')), [
    'agent_born',
    'home_built',
  ]);
  assert.deepEqual(uniqueSorted(extractTypeScriptStringArrayConst(sourceFile, 'WORLD_REFERENCE_EVENT_TYPES')), [
    'agent_born',
    'home_built',
  ]);
  assert.deepEqual(uniqueSorted(extractTypeScriptObjectConstKeys(sourceFile, 'LAYER_74_VISUAL_BEHAVIOR')), [
    'agent_born',
    'home_built',
  ]);
});

test('event presentation coverage parser reads only the exact Vitest case list', () => {
  const source = `
import { it } from "vitest";

it("returns compact sanitized detail for high-value world bubbles", () => {
  const cases: Array<{ type: string }> = [
    { type: "speak" },
  ];
});

it("covers every world-reference event type with observer-facing copy", () => {
  const cases: Array<{
    type: string;
    payload: Record<string, unknown>;
    label: string;
  }> = [
    {
      type: "agent_born",
      payload: { message: "ignore nested payload prose", related: ["speak"] },
      label: "born",
    },
    {
      type: "home_built",
      payload: {},
      label: "home raised",
    },
  ];
});
`;

  assert.deepEqual(extractPresentationCoverageEventTypes(source), [
    'agent_born',
    'home_built',
  ]);
});

test('app semantic fixture parser reads only anchored fixture declarations', () => {
  const source = `
const burstVisualEventTypes = [
  'speak',
];
const burstGroupedAwayEventTypes = [
  'home_breached',
];
eventEntry(1, 'outside_low_frequency', 'world', {}, {});
const lowFrequencyEnvelope = {
  events: [
    eventEntry(2, 'simulation_started', 'world', { label: 'ignored' }, {}),
  ],
};
const lowFrequencyVisualEventTypes = lowFrequencyEnvelope.events.map(({ event }) => event.type);
const worldReferenceEventTypes = [
  'home_breached',
  'simulation_started',
  'speak',
].sort();
`;
  const ast = parseJavaScriptSource(source);

  assert.deepEqual(extractAppSemanticFixtureEventTypes(ast), [
    'home_breached',
    'simulation_started',
    'speak',
  ]);
  assert.deepEqual(extractAppWorldReferenceEventTypes(ast), [
    'home_breached',
    'simulation_started',
    'speak',
  ]);
});
