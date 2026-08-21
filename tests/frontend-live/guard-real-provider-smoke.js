#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const repoRoot = path.resolve(__dirname, '../..');

const files = {
  realProviderSpec: 'tests/frontend-live/live-real-provider.spec.js',
  deterministicLiveSpec: 'tests/frontend-live/live-real-api.spec.js',
  deterministicBuiltSpec: 'tests/frontend-live/live-built-real-api.spec.js',
  commonHelpers: 'tests/frontend-live/live-common-helpers.js',
  rendererSummaryDiagnostics: 'tests/frontend-live/live-renderer-summary-diagnostics.js',
  realLiveConfig: 'playwright.frontend-real-live.config.js',
  deterministicLiveConfig: 'playwright.frontend-live.config.js',
  deterministicBuiltConfig: 'playwright.frontend-live-built.config.js',
};

const mechanicsApiPath = '/api/test/mechanics/run';
const mechanicsHelperModules = [
  './live-mechanics-helpers',
  './live-smoke-helpers',
  './live-renderer-summary-diagnostics',
];
const commonHelperModule = './live-common-helpers';
const mechanicsHelperImportPatterns = mechanicsHelperModules.map(moduleReferencePattern);
const runConstantsHelper = 'expectRunConstants';
const rawRunMetadataBannedCopyBuilder = 'buildRawRunMetadataBannedCopy';
const rawRunMetadataCopyHelper = 'expectNoRawRunMetadataCopy';
const liveEventPresentationHelper = 'expectLiveEventPresentation';
const liveRendererFreshnessHelper = 'expectLiveRendererFreshness';
const liveRetainedSurfacePresentationHelper = 'expectLiveRetainedSurfacePresentation';
const liveEventCursorCorrelationHelper = 'formatLiveEventCursorCorrelationFailure';
const eventCursorDomAttribute = 'data-event-cursor';
const playwrightRouteHandlerMethods = new Set([
  'abort',
  'continue',
  'fallback',
  'fetch',
  'fulfill',
]);
const rawRunMetadataRuntimeHelpers = [
  runConstantsHelper,
  rawRunMetadataBannedCopyBuilder,
  rawRunMetadataCopyHelper,
];
const rawRunMetadataBannedCopyVariable = 'rawRunMetadataBannedCopy';
const runEnvelopeVariable = 'runEnvelope';
const eventsEnvelopeVariable = 'eventsEnvelope';
const presentationStateVariable = 'presentationState';
const apiEventCursorsVariable = 'apiEventCursors';
const apiEventCursorSetVariable = 'apiEventCursorSet';
const presentedChronicleCursorsVariable = 'presentedChronicleCursors';
const mutatingCollectionMethods = new Set([
  'add',
  'clear',
  'copyWithin',
  'delete',
  'fill',
  'pop',
  'push',
  'reverse',
  'set',
  'shift',
  'sort',
  'splice',
  'unshift',
]);
const commonHelperDestructureImportPattern = new RegExp(
  `const\\s*\\{[^}]*\\}\\s*=\\s*require\\s*\\(\\s*['"\`]` +
    `${escapeRegExp(commonHelperModule)}(?:\\.js)?['"\`]\\s*\\)`,
  'g',
);
const mechanicsRouteFragmentPattern = /\/api\/test\/mechanics\/run|\/mechanics\/run|\bmechanics\b/i;
const rendererSummaryReferencePattern = /\bLIVE_RENDERER_[A-Z0-9_]+\b/;
const rendererSummaryDiagnosticReferences = [
  'LIVE_RENDERER_SUMMARY_KIND_POOL',
  'LIVE_RENDERER_REQUIRED_TAIL_SUMMARIES',
  'LIVE_RENDERER_RAW_SUMMARY_FIELDS',
  'LIVE_RENDERER_SUMMARY_TUPLE_FIELDS',
  'LIVE_RENDERER_SUMMARY_TUPLE_ARRAY_FIELDS',
  'LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS',
];
const bannedMechanicsReferences = [
  'triggerMechanicsBurst',
  'expectMechanicsWorldAftermath',
  'expectMechanicsReplayArtifacts',
  'expectMechanicsBurstVisible',
  'expectMechanicsRendererSummaryDiagnostics',
  'expectThievedJoeHomeAftermath',
  'expectMechanicsTheftReplayProof',
  'validateMechanicsRendererSummaryDiagnostics',
  'MECHANICS_EVENT_TYPES',
  'MECHANICS_EVENT_MIN_COUNTS',
  'LIVE_RUN_EVENT_TYPES',
  ...rendererSummaryDiagnosticReferences,
  'MECHANICS_TOOL_NAMES',
  'STRUCTURAL_MECHANICS_REASONS',
  'STRUCTURAL_MECHANICS_REASON_MIN_COUNTS',
  'MECHANICS_CHRONICLE_ROWS',
  'API_PATHS',
  'live-mechanics-helpers',
  'live-smoke-helpers',
  'live-renderer-summary-diagnostics',
];
const bannedCommonHelperReferences = [
  mechanicsApiPath,
  'triggerMechanicsBurst',
  'expectMechanicsWorldAftermath',
  'expectMechanicsReplayArtifacts',
  'expectMechanicsBurstVisible',
  'expectMechanicsRendererSummaryDiagnostics',
  'expectThievedJoeHomeAftermath',
  'expectMechanicsTheftReplayProof',
  'validateMechanicsRendererSummaryDiagnostics',
  'MECHANICS_EVENT_TYPES',
  'MECHANICS_EVENT_MIN_COUNTS',
  'LIVE_RUN_EVENT_TYPES',
  ...rendererSummaryDiagnosticReferences,
  'MECHANICS_TOOL_NAMES',
  'STRUCTURAL_MECHANICS_REASONS',
  'STRUCTURAL_MECHANICS_REASON_MIN_COUNTS',
  'MECHANICS_CHRONICLE_ROWS',
  'API_PATHS',
  'live-mechanics-helpers',
  'live-smoke-helpers',
  'live-renderer-summary-diagnostics',
];

const deterministicConfigs = [
  {
    path: files.deterministicLiveConfig,
    expectedSpec: 'live-real-api.spec.js',
    expectedTestMatchPattern: /testMatch\s*:\s*\/live-real-api\\\.spec\\\.js\//,
  },
  {
    path: files.deterministicBuiltConfig,
    expectedSpec: 'live-built-real-api.spec.js',
    expectedTestMatchPattern: /testMatch\s*:\s*\/live-built-real-api\\\.spec\\\.js\//,
  },
];

const deterministicLiveSpecs = [
  {
    path: files.deterministicLiveSpec,
    description: 'deterministic dev live smoke',
    title: 'production app observes the real deterministic live API and SSE stream',
  },
  {
    path: files.deterministicBuiltSpec,
    description: 'deterministic built live smoke',
    title: 'built frontend observes the real deterministic live API and SSE stream',
  },
];
const externalRealProviderSpec = {
  path: files.realProviderSpec,
  description: 'external real-provider smoke',
  title: 'external real-provider frontend observes a live sim without deterministic harnesses',
};

function readRepoFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  try {
    return fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    throw new Error(`could not be read (${error.message})`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function moduleReferencePattern(modulePath) {
  const modulePattern = `${escapeRegExp(modulePath)}(?:\\.js)?`;
  const quote = "['\"`]";
  return new RegExp(
    `require\\s*\\(\\s*${quote}${modulePattern}${quote}\\s*\\)|` +
      `from\\s+${quote}${modulePattern}${quote}|` +
      `import\\s*\\(\\s*${quote}${modulePattern}${quote}\\s*\\)`,
  );
}

function stripComments(source) {
  return stripJavaScriptTrivia(source, { strings: false });
}

function stripCommentsAndStrings(source) {
  return stripJavaScriptTrivia(source, { strings: true });
}

function stripJavaScriptTrivia(source, options) {
  let output = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      output += '  ';
      index += 2;
      while (index < source.length && source[index] !== '\n') {
        output += ' ';
        index += 1;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      output += '  ';
      index += 2;
      while (index < source.length) {
        if (source[index] === '*' && source[index + 1] === '/') {
          output += '  ';
          index += 2;
          break;
        }
        output += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }

    if (options.strings && (char === '"' || char === "'" || char === '`')) {
      const quote = char;
      output += ' ';
      index += 1;
      while (index < source.length) {
        const current = source[index];
        if (current === '\\') {
          output += '  ';
          index += 2;
          continue;
        }
        output += current === '\n' ? '\n' : ' ';
        index += 1;
        if (current === quote) {
          break;
        }
      }
      continue;
    }

    output += char;
    index += 1;
  }
  return output;
}

function hasDirectFunctionCall(source, functionName) {
  const sanitized = stripCommentsAndStrings(source);
  const identifierPattern = /[A-Za-z_$][\w$]*/g;
  let match;
  let previousToken = null;

  while ((match = identifierPattern.exec(sanitized)) !== null) {
    const token = match[0];
    const tokenStart = match.index;
    const tokenEnd = tokenStart + token.length;
    const nextIndex = nextNonWhitespaceIndex(sanitized, tokenEnd);
    const previousIndex = previousNonWhitespaceIndex(sanitized, tokenStart - 1);
    const previousChar = previousIndex >= 0 ? sanitized[previousIndex] : '';
    const isCall = nextIndex >= 0 && sanitized[nextIndex] === '(';
    const closingParenIndex = isCall ? findClosingParenIndex(sanitized, nextIndex) : -1;
    const afterParenIndex = closingParenIndex >= 0
      ? nextNonWhitespaceIndex(sanitized, closingParenIndex + 1)
      : -1;
    const isMemberAccess = previousChar === '.';
    const isDeclaration = previousToken === 'function';
    const isMethodDefinition = afterParenIndex >= 0 && sanitized[afterParenIndex] === '{';

    if (token === functionName && isCall && !isMemberAccess && !isDeclaration && !isMethodDefinition) {
      return true;
    }

    previousToken = token;
  }

  return false;
}

function findClosingParenIndex(source, openParenIndex) {
  let depth = 0;
  for (let index = openParenIndex; index < source.length; index += 1) {
    if (source[index] === '(') {
      depth += 1;
    } else if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function nextNonWhitespaceIndex(source, start) {
  for (let index = start; index < source.length; index += 1) {
    if (!/\s/.test(source[index])) {
      return index;
    }
  }
  return -1;
}

function previousNonWhitespaceIndex(source, start) {
  for (let index = start; index >= 0; index -= 1) {
    if (!/\s/.test(source[index])) {
      return index;
    }
  }
  return -1;
}

function defaultReadFile(relativePath) {
  return readRepoFile(relativePath);
}

function runGuard(options = {}) {
  const readFile = options.readFile || defaultReadFile;
  const failures = [];

  const readSource = (relativePath) => {
    try {
      return readFile(relativePath);
    } catch (error) {
      failures.push(`${relativePath}: ${error.message}`);
      return '';
    }
  };

  assertRendererSummaryDiagnosticReferencesAligned(readSource, failures);
  assertNoMechanicsDriftInExternalSpec(readSource, failures);
  assertCommonHelpersStayGeneric(readSource, failures);
  assertDeterministicSpecsPreserveRawRunMetadataChecks(readSource, failures);
  assertExternalConfigTargetsExternalSpec(readSource, failures);
  assertDeterministicConfigsExcludeExternalSpec(readSource, failures);
  return failures;
}

function assertRendererSummaryDiagnosticReferencesAligned(readSource, failures) {
  const source = readSource(files.rendererSummaryDiagnostics);
  const ast = parseJavaScriptSource(source, failures, files.rendererSummaryDiagnostics);
  const exportedReferences = uniqueSorted(extractCommonJsExportNames(ast)
    .filter((name) => name.startsWith('LIVE_RENDERER_')));
  const guardReferences = uniqueSorted(rendererSummaryDiagnosticReferences);

  if (exportedReferences.length !== guardReferences.length) {
    failures.push(
      `${files.rendererSummaryDiagnostics}: exported deterministic renderer summary ` +
        `diagnostics must match rendererSummaryDiagnosticReferences. ` +
        `exports=[${exportedReferences.join(', ')}] guard=[${guardReferences.join(', ')}].`,
    );
    return;
  }

  for (const [index, exportedReference] of exportedReferences.entries()) {
    if (exportedReference !== guardReferences[index]) {
      failures.push(
        `${files.rendererSummaryDiagnostics}: exported deterministic renderer summary ` +
          `diagnostics must match rendererSummaryDiagnosticReferences. ` +
          `exports=[${exportedReferences.join(', ')}] guard=[${guardReferences.join(', ')}].`,
      );
      return;
    }
  }
}

function assertNoMechanicsDriftInExternalSpec(readSource, failures) {
  const source = readSource(files.realProviderSpec);
  const sourceWithoutComments = stripComments(source);
  const ast = parseJavaScriptSource(source, failures, files.realProviderSpec);
  const testCallback = extractTestCallbackFromAst(
    source,
    ast,
    externalRealProviderSpec.description,
    externalRealProviderSpec.title,
    failures,
    files.realProviderSpec,
  );
  const testBody = testCallback.bodySource;
  const topLevelStatements = testCallback.topLevelStatements;

  if (mechanicsHelperImportPatterns.some((pattern) => pattern.test(sourceWithoutComments))) {
    failures.push(
      `${files.realProviderSpec}: must not import deterministic mechanics helpers. ` +
        `Use live-common-helpers.js for generic external smoke helpers.`,
    );
  }

  if (!hasStaticModuleImport(ast, commonHelperModule)) {
    failures.push(
      `${files.realProviderSpec}: must import generic helpers from live-common-helpers.js.`,
    );
  }

  if (!hasNamedModuleImport(ast, commonHelperModule, rawRunMetadataCopyHelper)) {
    failures.push(
      `${files.realProviderSpec}: must import ${rawRunMetadataCopyHelper} from ` +
        'live-common-helpers.js.',
    );
  }

  if (!hasNamedModuleImport(ast, commonHelperModule, liveEventPresentationHelper)) {
    failures.push(
      `${files.realProviderSpec}: must import ${liveEventPresentationHelper} from ` +
        'live-common-helpers.js.',
    );
  }

  if (!hasNamedModuleImport(ast, commonHelperModule, liveRendererFreshnessHelper)) {
    failures.push(
      `${files.realProviderSpec}: must import ${liveRendererFreshnessHelper} from ` +
        'live-common-helpers.js.',
    );
  }

  if (!hasNamedModuleImport(ast, commonHelperModule, liveRetainedSurfacePresentationHelper)) {
    failures.push(
      `${files.realProviderSpec}: must import ${liveRetainedSurfacePresentationHelper} from ` +
        'live-common-helpers.js.',
    );
  }

  if (!hasNamedModuleImport(ast, commonHelperModule, liveEventCursorCorrelationHelper)) {
    failures.push(
      `${files.realProviderSpec}: must import ${liveEventCursorCorrelationHelper} from ` +
        'live-common-helpers.js.',
    );
  }

  if (!topLevelStatements.some((statement) => isTopLevelHelperCallStatement(statement, rawRunMetadataCopyHelper))) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must call ` +
        `${rawRunMetadataCopyHelper} to keep raw run metadata out of observer copy.`,
    );
  }

  if (!topLevelStatements.some((statement) => isTopLevelHelperCallStatement(statement, liveEventPresentationHelper))) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must call ` +
        `${liveEventPresentationHelper} to prove real live event presentation.`,
    );
  }

  if (!topLevelStatements.some(isLiveEventPresentationStateDeclarationStatement)) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must assign ` +
        `${presentationStateVariable} from await ${liveEventPresentationHelper}(page).`,
    );
  }

  if (!topLevelStatements.some(isLiveRendererFreshnessCallStatement)) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must call ` +
        `${liveRendererFreshnessHelper}(page, ${presentationStateVariable}) after ` +
        `${presentationStateVariable} is captured.`,
    );
  }

  if (!topLevelStatements.some(isLiveRetainedSurfacePresentationCallStatement)) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must call ` +
        `${liveRetainedSurfacePresentationHelper}(page) to prove retained live surfaces.`,
    );
  }

  if (!topLevelStatements.some(isLiveEventCursorCorrelationAssertionStatement)) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must pass ` +
        `${liveEventCursorCorrelationHelper} to the live event cursor correlation assertion.`,
    );
  }

  if (!topLevelStatements.some(isEventsEnvelopeFetchStatement)) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must fetch ` +
        `${eventsEnvelopeVariable} from /api/events?cursor=0 inside the smoke callback ` +
        'and return await response.json() as the body.',
    );
  }

  if (!topLevelStatements.some(isApiEventCursorsDeclarationStatement)) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must derive ` +
        `${apiEventCursorsVariable} from ${eventsEnvelopeVariable}.body.events.`,
    );
  }

  if (!topLevelStatements.some(isApiEventCursorSetDeclarationStatement)) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must build ` +
        `${apiEventCursorSetVariable} with new Set(${apiEventCursorsVariable}).`,
    );
  }

  if (!topLevelStatements.some(isPresentedChronicleCursorsDeclarationStatement)) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must derive ` +
        `${presentedChronicleCursorsVariable} from presentationState.chronicleRows.`,
    );
  }

  if (testBody && hasExternalEventCursorProvenanceMutation(testBody)) {
    failures.push(
      `${files.realProviderSpec}: must not reassign or mutate live event cursor ` +
        'correlation provenance.',
    );
  }

  assertNoFakeFrontendProvenance(ast, failures);

  if (testBody && hasExecutableControlTransfer(testBody)) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must not contain ` +
        'top-level return, throw, break, or continue in the smoke callback.',
    );
  }

  if (hasRawRunMetadataHelperShadow(source, rawRunMetadataCopyHelper)) {
    failures.push(
      `${files.realProviderSpec}: must not shadow ${rawRunMetadataCopyHelper}; ` +
        'call the imported live-common-helpers.js guard directly.',
    );
  }

  if (hasRawRunMetadataHelperShadow(source, liveEventPresentationHelper)) {
    failures.push(
      `${files.realProviderSpec}: must not shadow ${liveEventPresentationHelper}; ` +
        'call the imported live-common-helpers.js guard directly.',
    );
  }

  if (hasRawRunMetadataHelperShadow(source, liveRendererFreshnessHelper)) {
    failures.push(
      `${files.realProviderSpec}: must not shadow ${liveRendererFreshnessHelper}; ` +
        'call the imported live-common-helpers.js guard directly.',
    );
  }

  if (hasRawRunMetadataHelperShadow(source, liveRetainedSurfacePresentationHelper)) {
    failures.push(
      `${files.realProviderSpec}: must not shadow ${liveRetainedSurfacePresentationHelper}; ` +
        'call the imported live-common-helpers.js guard directly.',
    );
  }

  if (hasRawRunMetadataHelperShadow(source, liveEventCursorCorrelationHelper)) {
    failures.push(
      `${files.realProviderSpec}: must not shadow ${liveEventCursorCorrelationHelper}; ` +
        'call the imported live-common-helpers.js guard directly.',
    );
  }

  if (mechanicsRouteFragmentPattern.test(source)) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must not contain ` +
        'deterministic mechanics route or harness vocabulary. ' +
        'Use generic /api/test namespace checks when proving external isolation.',
    );
  }

  const rendererSummaryReference = source.match(rendererSummaryReferencePattern)?.[0];
  if (rendererSummaryReference) {
    failures.push(
      `${files.realProviderSpec}: must not reference deterministic renderer summary ` +
        `diagnostic "${rendererSummaryReference}".`,
    );
  }

  for (const reference of bannedMechanicsReferences) {
    if (new RegExp(`\\b${reference}\\b`).test(source)) {
      failures.push(
        `${files.realProviderSpec}: must not import or reference deterministic ` +
          `mechanics helper "${reference}".`,
      );
    }
  }
}

function assertNoFakeFrontendProvenance(ast, failures) {
  const routeRegistrations = findMemberCallReferences(ast, [
    { objectName: 'page', propertyNames: new Set(['route']) },
    { objectName: 'context', propertyNames: new Set(['route']) },
  ]);
  if (routeRegistrations.length > 0) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must not register ` +
        `Playwright route mocks (${routeRegistrations.join(', ')}).`,
    );
  }

  const routeHandlerCalls = findMemberCallReferences(ast, [
    { objectName: 'route', propertyNames: playwrightRouteHandlerMethods },
  ]);
  if (routeHandlerCalls.length > 0) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must not fake ` +
        `provider responses with route handler calls (${routeHandlerCalls.join(', ')}).`,
    );
  }

  const setContentCalls = findMemberCallReferences(ast, [
    { objectName: 'page', propertyNames: new Set(['setContent']) },
  ]);
  if (setContentCalls.length > 0) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must not replace ` +
        `the frontend document with ${setContentCalls.join(', ')}.`,
    );
  }

  if (hasDirectChronicleRowDomInjection(ast)) {
    failures.push(
      `${files.realProviderSpec}: external real-provider smoke must not inject ` +
        `chronicle/live rows directly with document.createElement or innerHTML plus ` +
        `${eventCursorDomAttribute}.`,
    );
  }
}

function findMemberCallReferences(ast, callSpecs) {
  const found = new Set();
  walkAst(ast, (node) => {
    const call = unwrapChainExpression(node);
    if (call?.type !== 'CallExpression') {
      return;
    }

    const callee = unwrapChainExpression(call.callee);
    for (const spec of callSpecs) {
      const propertyName = matchingMemberPropertyName(
        callee,
        spec.objectName,
        spec.propertyNames,
      );
      if (propertyName) {
        found.add(`${spec.objectName}.${propertyName}`);
      }
    }
  });
  return [...found].sort();
}

function hasDirectChronicleRowDomInjection(ast) {
  return (
    hasEventCursorDomMarker(ast) &&
    (hasDocumentCreateElementCall(ast) || hasInnerHtmlMutation(ast))
  );
}

function hasDocumentCreateElementCall(ast) {
  return findMemberCallReferences(ast, [
    { objectName: 'document', propertyNames: new Set(['createElement']) },
  ]).length > 0;
}

function hasInnerHtmlMutation(ast) {
  let found = false;
  walkAst(ast, (node) => {
    if (
      node?.type === 'AssignmentExpression' &&
      memberExpressionHasProperty(node.left, 'innerHTML')
    ) {
      found = true;
    }
  });
  return found;
}

function hasEventCursorDomMarker(ast) {
  let found = false;
  walkAst(ast, (node) => {
    if (
      stringLiteralValue(node)?.includes(eventCursorDomAttribute) ||
      isDatasetEventCursorMember(node)
    ) {
      found = true;
    }
  });
  return found;
}

function isDatasetEventCursorMember(node) {
  const member = unwrapChainExpression(node);
  return (
    member?.type === 'MemberExpression' &&
    getPropertyName(member.property) === 'eventCursor' &&
    memberExpressionHasProperty(member.object, 'dataset')
  );
}

function memberExpressionHasProperty(node, propertyName) {
  const member = unwrapChainExpression(node);
  return (
    member?.type === 'MemberExpression' &&
    getPropertyName(member.property) === propertyName
  );
}

function matchingMemberPropertyName(node, objectName, propertyNames) {
  const member = unwrapChainExpression(node);
  if (
    member?.type !== 'MemberExpression' ||
    !isIdentifier(unwrapChainExpression(member.object), objectName)
  ) {
    return '';
  }

  const propertyName = getPropertyName(member.property);
  return propertyNames.has(propertyName) ? propertyName : '';
}

function walkAst(node, visitor) {
  if (!node || typeof node !== 'object') {
    return;
  }

  visitor(node);

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        walkAst(item, visitor);
      }
    } else if (value && typeof value === 'object') {
      walkAst(value, visitor);
    }
  }
}

function assertDeterministicSpecsPreserveRawRunMetadataChecks(readSource, failures) {
  const copyCallCounts = [];

  for (const spec of deterministicLiveSpecs) {
    const source = readSource(spec.path);
    const sourceWithoutComments = stripComments(source);
    const ast = parseJavaScriptSource(source, failures, spec.path);
    const testCallback = extractTestCallbackFromAst(
      source,
      ast,
      spec.description,
      spec.title,
      failures,
      spec.path,
    );
    const testBody = testCallback.bodySource;
    const topLevelStatements = testCallback.topLevelStatements;

    for (const helperName of rawRunMetadataRuntimeHelpers) {
      if (!hasNamedModuleImport(ast, commonHelperModule, helperName)) {
        failures.push(
          `${spec.path}: must import ${helperName} from live-common-helpers.js.`,
        );
      }

      if (hasRawRunMetadataHelperShadow(source, helperName)) {
        failures.push(
          `${spec.path}: must not shadow ${helperName}; ` +
            'call the imported live-common-helpers.js guard directly.',
        );
      }
    }

    if (hasObjectFreezeBindingDrift(source)) {
      failures.push(
        `${spec.path}: must not shadow or reassign Object.freeze; ` +
          'raw metadata guard immutability must use the native binding.',
      );
    }

    if (hasDynamicMutationApi(source)) {
      failures.push(
        `${spec.path}: must not use dynamic mutation APIs such as Reflect, ` +
          'Object.assign, or Object.defineProperty in deterministic live smoke sources.',
      );
    }

    if (hasCommonHelperExportMutation(source)) {
      failures.push(
        `${spec.path}: must not mutate live-common-helpers.js exports; ` +
          'call the imported guard helpers directly.',
      );
    }

    if (testBody && !hasRequiredPlaywrightFixtures(testCallback.callbackNode)) {
      failures.push(
        `${spec.path}: ${spec.description} Playwright callback must receive ` +
          'unaliased page and request fixtures directly.',
      );
    }

    for (const fixtureName of ['page', 'request']) {
      if (testBody && hasRuntimeFixtureShadow(testBody, fixtureName)) {
        failures.push(
          `${spec.path}: must not shadow Playwright ${fixtureName}; ` +
            'use the fixture supplied to the smoke test callback.',
        );
      }
      if (testBody && hasVariableReassignment(testBody, fixtureName)) {
        failures.push(
          `${spec.path}: must not reassign Playwright ${fixtureName}; ` +
            'use the fixture supplied to the smoke test callback.',
        );
      }
      if (testBody && hasDestructuringReassignment(testBody, fixtureName)) {
        failures.push(
          `${spec.path}: must not reassign Playwright ${fixtureName} through destructuring; ` +
            'use the fixture supplied to the smoke test callback.',
        );
      }
    }

    if (testBody && hasExecutableControlTransfer(testBody)) {
      failures.push(
        `${spec.path}: ${spec.description} must not contain top-level return, ` +
          'throw, break, or continue in the smoke callback.',
      );
    }

    if (!testBody || !topLevelStatements.some(isRunEnvelopeFetchStatement)) {
      failures.push(
        `${spec.path}: ${spec.description} must fetch run metadata with ` +
          `const ${runEnvelopeVariable} = await ${runConstantsHelper}(request).`,
      );
    }

    if (!testBody || !topLevelStatements.some(isRawRunMetadataBannedCopyBuildStatement)) {
      failures.push(
        `${spec.path}: ${spec.description} must build ${rawRunMetadataBannedCopyVariable} ` +
          `with const ${rawRunMetadataBannedCopyVariable} = Object.freeze(` +
          `${rawRunMetadataBannedCopyBuilder}(${runEnvelopeVariable}.body)).`,
      );
    }

    for (const variableName of [runEnvelopeVariable, rawRunMetadataBannedCopyVariable]) {
      if (testBody && hasVariableAssignmentOrMutation(testBody, variableName)) {
        failures.push(
          `${spec.path}: must not reassign or mutate ${variableName}; ` +
            'raw metadata guard provenance must stay immutable.',
        );
      }
    }

    const copyCallCount = testBody
      ? topLevelStatements.filter(isRawRunMetadataObserverCopyCheckStatement).length
      : 0;
    copyCallCounts.push({ ...spec, count: copyCallCount });
    if (copyCallCount < 2) {
      failures.push(
        `${spec.path}: ${spec.description} must call ${rawRunMetadataCopyHelper}` +
          `(page, ${rawRunMetadataBannedCopyVariable}) at least twice.`,
      );
    }
  }

  const distinctCounts = new Set(copyCallCounts.map((entry) => entry.count));
  if (distinctCounts.size > 1) {
    const detail = copyCallCounts
      .map((entry) => `${entry.path}=${entry.count}`)
      .join(', ');
    failures.push(
      `deterministic live raw metadata guard call counts must match across dev/built specs: ${detail}.`,
    );
  }
}

function parseJavaScriptSource(source, failures, specPath) {
  for (const sourceType of ['script', 'module']) {
    try {
      return acorn.parse(source, {
        ecmaVersion: 'latest',
        sourceType,
      });
    } catch (error) {
      if (sourceType === 'module') {
        failures.push(`${specPath}: could not parse JavaScript source (${error.message}).`);
      }
    }
  }
  return null;
}

function extractTestCallbackFromAst(source, ast, description, title, failures, specPath) {
  if (!ast) {
    return emptyTestCallback();
  }

  const testStatements = ast.body.filter((statement) => (
    statement.type === 'ExpressionStatement' &&
    statement.expression?.type === 'CallExpression' &&
    statement.expression.callee?.type === 'Identifier' &&
    statement.expression.callee.name === 'test' &&
    isLiteralString(statement.expression.arguments[0], title)
  ));

  if (testStatements.length === 0) {
    failures.push(`${specPath}: could not find ${description} Playwright test callback.`);
    return emptyTestCallback();
  }

  if (testStatements.length > 1) {
    failures.push(`${specPath}: ${description} must contain exactly one Playwright test callback.`);
    return emptyTestCallback();
  }

  const testStatement = testStatements[0];
  const callbackNode = testStatement.expression.arguments.find((argument) => (
    argument.type === 'ArrowFunctionExpression' ||
    argument.type === 'FunctionExpression'
  ));

  if (!callbackNode) {
    failures.push(`${specPath}: could not parse ${description} Playwright test callback.`);
    return emptyTestCallback();
  }

  if (callbackNode.body.type !== 'BlockStatement') {
    failures.push(`${specPath}: ${description} Playwright test callback must use a block body.`);
    return emptyTestCallback();
  }

  return {
    bodySource: source.slice(callbackNode.body.start + 1, callbackNode.body.end - 1),
    callbackNode,
    topLevelStatements: callbackNode.body.body,
  };
}

function emptyTestCallback() {
  return {
    bodySource: '',
    callbackNode: null,
    topLevelStatements: [],
  };
}

function isRunEnvelopeFetchStatement(statement) {
  const declaration = singleConstDeclaration(statement, runEnvelopeVariable);
  if (!declaration || declaration.init?.type !== 'AwaitExpression') {
    return false;
  }

  const call = declaration.init.argument;
  return (
    call?.type === 'CallExpression' &&
    isIdentifier(call.callee, runConstantsHelper) &&
    call.arguments.length === 1 &&
    isIdentifier(call.arguments[0], 'request')
  );
}

function isRawRunMetadataBannedCopyBuildStatement(statement) {
  const declaration = singleConstDeclaration(statement, rawRunMetadataBannedCopyVariable);
  const freezeCall = declaration?.init;
  if (
    freezeCall?.type !== 'CallExpression' ||
    !isStaticMemberCall(freezeCall.callee, 'Object', 'freeze') ||
    freezeCall.arguments.length !== 1
  ) {
    return false;
  }

  const builderCall = freezeCall.arguments[0];
  return (
    builderCall.type === 'CallExpression' &&
    isIdentifier(builderCall.callee, rawRunMetadataBannedCopyBuilder) &&
    builderCall.arguments.length === 1 &&
    isStaticMemberExpression(builderCall.arguments[0], runEnvelopeVariable, 'body')
  );
}

function isRawRunMetadataObserverCopyCheckStatement(statement) {
  const expression = statement.type === 'ExpressionStatement' ? statement.expression : null;
  const call = expression?.type === 'AwaitExpression' ? expression.argument : null;
  return (
    call?.type === 'CallExpression' &&
    isIdentifier(call.callee, rawRunMetadataCopyHelper) &&
    call.arguments.length === 2 &&
    isIdentifier(call.arguments[0], 'page') &&
    isIdentifier(call.arguments[1], rawRunMetadataBannedCopyVariable)
  );
}

function isTopLevelHelperCallStatement(statement, helperName) {
  if (statement.type === 'ExpressionStatement') {
    return isAwaitedHelperCallExpression(statement.expression, helperName);
  }

  if (statement.type === 'VariableDeclaration') {
    return statement.declarations.some((declaration) => (
      isAwaitedHelperCallExpression(declaration.init, helperName)
    ));
  }

  return false;
}

function isAwaitedHelperCallExpression(expression, helperName) {
  if (expression?.type !== 'AwaitExpression') {
    return false;
  }
  const call = expression.argument;
  return call?.type === 'CallExpression' && isIdentifier(call.callee, helperName);
}

function isLiveEventPresentationStateDeclarationStatement(statement) {
  const declaration = singleConstDeclaration(statement, presentationStateVariable);
  const expression = declaration?.init;
  if (expression?.type !== 'AwaitExpression') {
    return false;
  }

  const call = expression.argument;
  return (
    call?.type === 'CallExpression' &&
    isIdentifier(call.callee, liveEventPresentationHelper) &&
    call.arguments.length >= 1 &&
    isIdentifier(call.arguments[0], 'page')
  );
}

function isLiveRendererFreshnessCallStatement(statement) {
  const expression = statement.type === 'ExpressionStatement' ? statement.expression : null;
  if (expression?.type !== 'AwaitExpression') {
    return false;
  }

  const call = expression.argument;
  return (
    call?.type === 'CallExpression' &&
    isIdentifier(call.callee, liveRendererFreshnessHelper) &&
    call.arguments.length >= 2 &&
    isIdentifier(call.arguments[0], 'page') &&
    isIdentifier(call.arguments[1], presentationStateVariable)
  );
}

function isLiveRetainedSurfacePresentationCallStatement(statement) {
  const expression = statement.type === 'ExpressionStatement' ? statement.expression : null;
  if (expression?.type !== 'AwaitExpression') {
    return false;
  }

  const call = expression.argument;
  return (
    call?.type === 'CallExpression' &&
    isIdentifier(call.callee, liveRetainedSurfacePresentationHelper) &&
    call.arguments.length >= 1 &&
    isIdentifier(call.arguments[0], 'page')
  );
}

function isLiveEventCursorCorrelationAssertionStatement(statement) {
  const expression = statement.type === 'ExpressionStatement' ? statement.expression : null;
  if (
    expression?.type !== 'CallExpression' ||
    expression.callee?.type !== 'MemberExpression' ||
    getPropertyName(expression.callee.property) !== 'toBe' ||
    expression.arguments.length !== 1 ||
    expression.arguments[0]?.value !== true
  ) {
    return false;
  }

  const expectCall = expression.callee.object;
  return (
    expectCall?.type === 'CallExpression' &&
    isIdentifier(expectCall.callee, 'expect') &&
    isPresentedCursorCorrelationExpression(expectCall.arguments[0]) &&
    isLiveEventCursorCorrelationFailureExpression(expectCall.arguments[1])
  );
}

function isPresentedCursorCorrelationExpression(expression) {
  if (
    expression?.type !== 'CallExpression' ||
    expression.callee?.type !== 'MemberExpression' ||
    getPropertyName(expression.callee.property) !== 'some' ||
    !isIdentifier(expression.callee.object, presentedChronicleCursorsVariable) ||
    expression.arguments.length !== 1
  ) {
    return false;
  }

  const callback = expression.arguments[0];
  if (
    callback?.type !== 'ArrowFunctionExpression' ||
    callback.params.length !== 1 ||
    callback.params[0]?.type !== 'Identifier'
  ) {
    return false;
  }

  const cursorName = callback.params[0].name;
  const body = callback.body;
  return (
    body?.type === 'CallExpression' &&
    body.callee?.type === 'MemberExpression' &&
    isIdentifier(body.callee.object, apiEventCursorSetVariable) &&
    getPropertyName(body.callee.property) === 'has' &&
    body.arguments.length === 1 &&
    isIdentifier(body.arguments[0], cursorName)
  );
}

function isLiveEventCursorCorrelationFailureExpression(expression) {
  return (
    expression?.type === 'CallExpression' &&
    isIdentifier(expression.callee, liveEventCursorCorrelationHelper) &&
    expression.arguments.length === 1 &&
    objectExpressionHasPropertyValue(expression.arguments[0], apiEventCursorsVariable, apiEventCursorsVariable) &&
    objectExpressionHasPropertyValue(
      expression.arguments[0],
      presentedChronicleCursorsVariable,
      presentedChronicleCursorsVariable,
    )
  );
}

function isEventsEnvelopeFetchStatement(statement) {
  const declaration = singleConstDeclaration(statement, eventsEnvelopeVariable);
  const pageEvaluateCall = declaration?.init?.type === 'AwaitExpression'
    ? declaration.init.argument
    : null;
  if (
    pageEvaluateCall?.type !== 'CallExpression' ||
    !isStaticMemberExpression(pageEvaluateCall.callee, 'page', 'evaluate') ||
    pageEvaluateCall.arguments.length === 0
  ) {
    return false;
  }

  const callback = pageEvaluateCall.arguments[0];
  return isEventsEnvelopeEvaluateCallback(callback);
}

function isEventsEnvelopeEvaluateCallback(callback) {
  if (
    (
      callback?.type !== 'ArrowFunctionExpression' &&
      callback?.type !== 'FunctionExpression'
    ) ||
    callback.body?.type !== 'BlockStatement'
  ) {
    return false;
  }

  return (
    !hasBindingIdentifier(callback, 'fetch') &&
    callback.body.body.some(isEventsResponseFetchDeclarationStatement) &&
    callback.body.body.some(isEventsEnvelopeReturnStatement)
  );
}

function isEventsResponseFetchDeclarationStatement(statement) {
  const declaration = singleConstDeclaration(statement, 'response');
  const fetchCall = declaration?.init?.type === 'AwaitExpression'
    ? declaration.init.argument
    : null;
  return (
    fetchCall?.type === 'CallExpression' &&
    isIdentifier(fetchCall.callee, 'fetch') &&
    fetchCall.arguments.length >= 1 &&
    isLiteralString(fetchCall.arguments[0], '/api/events?cursor=0')
  );
}

function isEventsEnvelopeReturnStatement(statement) {
  const envelope = statement.type === 'ReturnStatement' ? statement.argument : null;
  return (
    envelope?.type === 'ObjectExpression' &&
    objectExpressionHasStaticMemberProperty(envelope, 'ok', 'response', 'ok') &&
    objectExpressionHasStaticMemberProperty(envelope, 'status', 'response', 'status') &&
    objectExpressionHasAwaitedMethodCallProperty(envelope, 'body', 'response', 'json')
  );
}

function isApiEventCursorsDeclarationStatement(statement) {
  const declaration = singleConstDeclaration(statement, apiEventCursorsVariable);
  return isCursorMapFilterChain(declaration?.init, [
    eventsEnvelopeVariable,
    'body',
    'events',
  ]);
}

function isApiEventCursorSetDeclarationStatement(statement) {
  const declaration = singleConstDeclaration(statement, apiEventCursorSetVariable);
  const init = declaration?.init;
  return (
    init?.type === 'NewExpression' &&
    isIdentifier(init.callee, 'Set') &&
    init.arguments.length === 1 &&
    isIdentifier(init.arguments[0], apiEventCursorsVariable)
  );
}

function isPresentedChronicleCursorsDeclarationStatement(statement) {
  const declaration = singleConstDeclaration(statement, presentedChronicleCursorsVariable);
  return isCursorMapFilterChain(declaration?.init, [
    'presentationState',
    'chronicleRows',
  ]);
}

function isCursorMapFilterChain(expression, sourcePath) {
  if (
    expression?.type !== 'CallExpression' ||
    expression.callee?.type !== 'MemberExpression' ||
    getPropertyName(expression.callee.property) !== 'filter' ||
    expression.arguments.length !== 1 ||
    !isPositiveFiniteCursorFilterCallback(expression.arguments[0])
  ) {
    return false;
  }

  const mapCall = expression.callee.object;
  return (
    mapCall?.type === 'CallExpression' &&
    mapCall.callee?.type === 'MemberExpression' &&
    getPropertyName(mapCall.callee.property) === 'map' &&
    isStaticMemberPath(mapCall.callee.object, sourcePath) &&
    mapCall.arguments.length === 1 &&
    isCursorProjectionCallback(mapCall.arguments[0])
  );
}

function isCursorProjectionCallback(callback) {
  if (
    callback?.type !== 'ArrowFunctionExpression' ||
    callback.params.length !== 1 ||
    callback.params[0]?.type !== 'Identifier'
  ) {
    return false;
  }

  return isStaticMemberPath(callback.body, [
    callback.params[0].name,
    'cursor',
  ]);
}

function isPositiveFiniteCursorFilterCallback(callback) {
  if (
    callback?.type !== 'ArrowFunctionExpression' ||
    callback.params.length !== 1 ||
    callback.params[0]?.type !== 'Identifier'
  ) {
    return false;
  }

  const cursorName = callback.params[0].name;
  const body = callback.body;
  return (
    body?.type === 'LogicalExpression' &&
    body.operator === '&&' &&
    isNumberIsFiniteCall(body.left, cursorName) &&
    isPositiveComparison(body.right, cursorName)
  );
}

function isNumberIsFiniteCall(expression, argumentName) {
  return (
    expression?.type === 'CallExpression' &&
    isStaticMemberExpression(expression.callee, 'Number', 'isFinite') &&
    expression.arguments.length === 1 &&
    isIdentifier(expression.arguments[0], argumentName)
  );
}

function isPositiveComparison(expression, variableName) {
  return (
    expression?.type === 'BinaryExpression' &&
    expression.operator === '>' &&
    isIdentifier(expression.left, variableName) &&
    expression.right?.type === 'Literal' &&
    expression.right.value === 0
  );
}

function objectExpressionHasPropertyValue(node, propertyName, valueName) {
  return (
    node?.type === 'ObjectExpression' &&
    node.properties.some((property) => (
      property.type === 'Property' &&
      property.computed === false &&
      getPropertyName(property.key) === propertyName &&
      isIdentifier(property.value, valueName)
    ))
  );
}

function objectExpressionHasStaticMemberProperty(node, propertyName, objectName, memberName) {
  return (
    node?.type === 'ObjectExpression' &&
    node.properties.some((property) => (
      property.type === 'Property' &&
      property.computed === false &&
      getPropertyName(property.key) === propertyName &&
      isStaticMemberExpression(property.value, objectName, memberName)
    ))
  );
}

function objectExpressionHasAwaitedMethodCallProperty(node, propertyName, objectName, methodName) {
  return (
    node?.type === 'ObjectExpression' &&
    node.properties.some((property) => {
      const call = property.type === 'Property' &&
        property.computed === false &&
        getPropertyName(property.key) === propertyName &&
        property.value?.type === 'AwaitExpression'
        ? property.value.argument
        : null;
      return (
        call?.type === 'CallExpression' &&
        isStaticMemberExpression(call.callee, objectName, methodName) &&
        call.arguments.length === 0
      );
    })
  );
}

function hasBindingIdentifier(node, identifierName) {
  if (!node || typeof node !== 'object') {
    return false;
  }

  if (
    (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) &&
    node.params?.some((parameter) => bindingPatternHasIdentifier(parameter, identifierName))
  ) {
    return true;
  }

  if (
    (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ClassDeclaration'
    ) &&
    isIdentifier(node.id, identifierName)
  ) {
    return true;
  }

  if (node.type === 'VariableDeclarator' && bindingPatternHasIdentifier(node.id, identifierName)) {
    return true;
  }

  if (node.type === 'CatchClause' && bindingPatternHasIdentifier(node.param, identifierName)) {
    return true;
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      if (value.some((item) => hasBindingIdentifier(item, identifierName))) {
        return true;
      }
    } else if (hasBindingIdentifier(value, identifierName)) {
      return true;
    }
  }

  return false;
}

function bindingPatternHasIdentifier(pattern, identifierName) {
  if (!pattern || typeof pattern !== 'object') {
    return false;
  }

  if (isIdentifier(pattern, identifierName)) {
    return true;
  }

  if (pattern.type === 'RestElement') {
    return bindingPatternHasIdentifier(pattern.argument, identifierName);
  }

  if (pattern.type === 'AssignmentPattern') {
    return bindingPatternHasIdentifier(pattern.left, identifierName);
  }

  if (pattern.type === 'ArrayPattern') {
    return pattern.elements.some((element) => bindingPatternHasIdentifier(element, identifierName));
  }

  if (pattern.type === 'ObjectPattern') {
    return pattern.properties.some((property) => {
      if (property.type === 'RestElement') {
        return bindingPatternHasIdentifier(property.argument, identifierName);
      }
      return bindingPatternHasIdentifier(property.value, identifierName);
    });
  }

  return false;
}

function isStaticMemberPath(node, path) {
  if (path.length === 1) {
    return isIdentifier(node, path[0]);
  }

  return (
    node?.type === 'MemberExpression' &&
    node.computed === false &&
    getPropertyName(node.property) === path[path.length - 1] &&
    isStaticMemberPath(node.object, path.slice(0, -1))
  );
}

function singleConstDeclaration(statement, variableName) {
  if (
    statement.type !== 'VariableDeclaration' ||
    statement.kind !== 'const' ||
    statement.declarations.length !== 1
  ) {
    return null;
  }

  const declaration = statement.declarations[0];
  return isIdentifier(declaration.id, variableName) ? declaration : null;
}

function isIdentifier(node, name) {
  return node?.type === 'Identifier' && node.name === name;
}

function isLiteralString(node, value) {
  return node?.type === 'Literal' && node.value === value;
}

function hasStaticModuleImport(ast, modulePath) {
  return Boolean(ast?.body.some((statement) => (
    isImportDeclarationFrom(statement, modulePath) ||
    isConstRequireDeclarationFrom(statement, modulePath)
  )));
}

function hasNamedModuleImport(ast, modulePath, exportName) {
  return Boolean(ast?.body.some((statement) => (
    hasNamedImportDeclaration(statement, modulePath, exportName) ||
    hasNamedConstRequireDeclaration(statement, modulePath, exportName)
  )));
}

function isImportDeclarationFrom(statement, modulePath) {
  return (
    statement.type === 'ImportDeclaration' &&
    moduleReferenceMatches(statement.source?.value, modulePath)
  );
}

function hasNamedImportDeclaration(statement, modulePath, exportName) {
  return (
    isImportDeclarationFrom(statement, modulePath) &&
    statement.specifiers.some((specifier) => (
      specifier.type === 'ImportSpecifier' &&
      isIdentifier(specifier.imported, exportName) &&
      isIdentifier(specifier.local, exportName)
    ))
  );
}

function isConstRequireDeclarationFrom(statement, modulePath) {
  return (
    statement.type === 'VariableDeclaration' &&
    statement.kind === 'const' &&
    statement.declarations.some((declaration) => isRequireCallFrom(declaration.init, modulePath))
  );
}

function hasNamedConstRequireDeclaration(statement, modulePath, exportName) {
  return (
    statement.type === 'VariableDeclaration' &&
    statement.kind === 'const' &&
    statement.declarations.some((declaration) => (
      isRequireCallFrom(declaration.init, modulePath) &&
      objectPatternHasUnaliasedProperty(declaration.id, exportName)
    ))
  );
}

function isRequireCallFrom(node, modulePath) {
  return (
    node?.type === 'CallExpression' &&
    isIdentifier(node.callee, 'require') &&
    node.arguments.length === 1 &&
    moduleReferenceMatches(node.arguments[0]?.value, modulePath)
  );
}

function objectPatternHasUnaliasedProperty(node, propertyName) {
  return (
    node?.type === 'ObjectPattern' &&
    node.properties.some((property) => (
      property.type === 'Property' &&
      property.computed === false &&
      getPropertyName(property.key) === propertyName &&
      isIdentifier(property.value, propertyName)
    ))
  );
}

function moduleReferenceMatches(value, modulePath) {
  return value === modulePath || value === `${modulePath}.js`;
}

function hasCommonJsNamedExport(ast, exportName) {
  return Boolean(ast?.body.some((statement) => {
    const expression = statement.type === 'ExpressionStatement' ? statement.expression : null;
    if (expression?.type !== 'AssignmentExpression' || expression.operator !== '=') {
      return false;
    }

    if (isModuleExportsExpression(expression.left)) {
      return objectExpressionHasProperty(expression.right, exportName);
    }

    return isCommonJsNamedExportMember(expression.left, exportName);
  }));
}

function extractCommonJsExportNames(ast) {
  const names = [];
  walkAst(ast, (node) => {
    if (node?.type !== 'AssignmentExpression' || node.operator !== '=') {
      return;
    }
    if (isModuleExportsExpression(node.left) && node.right?.type === 'ObjectExpression') {
      for (const property of node.right.properties) {
        if (property.type === 'Property' && property.computed === false) {
          const name = getPropertyName(property.key);
          if (name) {
            names.push(name);
          }
        }
      }
      return;
    }
    if (
      node.left?.type === 'MemberExpression' &&
      (
        isIdentifier(node.left.object, 'exports') ||
        isModuleExportsExpression(node.left.object)
      )
    ) {
      const name = getPropertyName(node.left.property);
      if (name) {
        names.push(name);
      }
    }
  });
  return uniqueSorted(names);
}

function isModuleExportsExpression(node) {
  return (
    node?.type === 'MemberExpression' &&
    node.computed === false &&
    isIdentifier(node.object, 'module') &&
    isIdentifier(node.property, 'exports')
  );
}

function isCommonJsNamedExportMember(node, exportName) {
  return (
    node?.type === 'MemberExpression' &&
    node.computed === false &&
    getPropertyName(node.property) === exportName &&
    (
      isIdentifier(node.object, 'exports') ||
      isModuleExportsExpression(node.object)
    )
  );
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function objectExpressionHasProperty(node, propertyName) {
  return (
    node?.type === 'ObjectExpression' &&
    node.properties.some((property) => (
      property.type === 'Property' &&
      property.computed === false &&
      getPropertyName(property.key) === propertyName
    ))
  );
}

function getPropertyName(node) {
  if (node?.type === 'Identifier') {
    return node.name;
  }
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked ?? node.quasis[0]?.value?.raw ?? '';
  }
  return '';
}

function stringLiteralValue(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked ?? node.quasis[0]?.value?.raw ?? '';
  }
  return '';
}

function unwrapChainExpression(node) {
  return node?.type === 'ChainExpression' ? node.expression : node;
}

function isStaticMemberCall(node, objectName, propertyName) {
  return isStaticMemberExpression(node, objectName, propertyName);
}

function isStaticMemberExpression(node, objectName, propertyName) {
  return (
    node?.type === 'MemberExpression' &&
    node.computed === false &&
    isIdentifier(node.object, objectName) &&
    isIdentifier(node.property, propertyName)
  );
}

function hasExecutableControlTransfer(source) {
  const sanitized = stripCommentsAndStrings(source);
  const identifierPattern = /\b(?:return|throw|break|continue)\b/g;
  let match;
  let parenDepth = 0;
  let bracketDepth = 0;
  let searchIndex = 0;

  while ((match = identifierPattern.exec(sanitized)) !== null) {
    for (let index = searchIndex; index < match.index; index += 1) {
      const char = sanitized[index];
      if (char === '(') {
        parenDepth += 1;
      } else if (char === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (char === '[') {
        bracketDepth += 1;
      } else if (char === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1);
      }
    }

    if (parenDepth === 0 && bracketDepth === 0) {
      return true;
    }

    searchIndex = match.index + match[0].length;
  }

  return false;
}

function hasRequiredPlaywrightFixtures(callbackNode) {
  const firstParameter = callbackNode?.params?.[0];
  if (firstParameter?.type !== 'ObjectPattern') {
    return false;
  }

  const fixtureNames = firstParameter.properties
    .filter((property) => (
      property.type === 'Property' &&
      property.computed === false &&
      property.key.type === 'Identifier' &&
      property.value.type === 'Identifier' &&
      property.key.name === property.value.name
    ))
    .map((property) => property.key.name);
  return fixtureNames.includes('page') && fixtureNames.includes('request');
}

function hasRuntimeFixtureShadow(source, fixtureName) {
  const sourceWithoutTrivia = stripCommentsAndStrings(source);
  return (
    directLocalDefinitionPattern(fixtureName).test(sourceWithoutTrivia) ||
    destructuringShadowPattern(fixtureName).test(sourceWithoutTrivia)
  );
}

function hasObjectFreezeBindingDrift(source) {
  const sourceWithoutTrivia = stripCommentsAndStrings(source);
  return (
    directLocalDefinitionPattern('globalThis').test(sourceWithoutTrivia) ||
    directLocalDefinitionPattern('Object').test(sourceWithoutTrivia) ||
    destructuringShadowPattern('globalThis').test(sourceWithoutTrivia) ||
    destructuringShadowPattern('Object').test(sourceWithoutTrivia) ||
    parameterShadowPatterns('globalThis').some((pattern) => pattern.test(sourceWithoutTrivia)) ||
    parameterShadowPatterns('Object').some((pattern) => pattern.test(sourceWithoutTrivia)) ||
    /(?:^|[^\w$.])Object\s*(?:\.\s*freeze|\[\s*['"`]freeze['"`]\s*\])\s*=/.test(sourceWithoutTrivia) ||
    /(?:^|[^\w$.])globalThis\s*(?:\.\s*Object|\[\s*['"`]Object['"`]\s*\])(?:\s*(?:\.\s*freeze|\[\s*['"`]freeze['"`]\s*\]))?\s*=/.test(sourceWithoutTrivia)
  );
}

function hasDynamicMutationApi(source) {
  const sourceWithoutTrivia = stripCommentsAndStrings(source);
  return (
    /(?:^|[^\w$.])(?:Reflect|Proxy|eval|Function)\b/.test(sourceWithoutTrivia) ||
    /(?:^|[^\w$.])globalThis\b/.test(sourceWithoutTrivia) ||
    /(?:^|[^\w$.])require\s*\.\s*(?:cache|resolve)\b/.test(sourceWithoutTrivia) ||
    /(?:^|[^\w$])(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*require\b(?!\s*\()/.test(sourceWithoutTrivia) ||
    /(?:^|[^\w$])(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*Object\b(?!\s*[.\[])/.test(sourceWithoutTrivia) ||
    /(?:^|[^\w$.])Object\s*\[/.test(sourceWithoutTrivia) ||
    /(?:^|[^\w$.])Object\s*(?:\.\s*(?:assign|defineProperty|defineProperties|setPrototypeOf)|\[\s*['"`](?:assign|defineProperty|defineProperties|setPrototypeOf)['"`]\s*\])/.test(sourceWithoutTrivia)
  );
}

function hasCommonHelperExportMutation(source) {
  const sourceWithoutComments = stripComments(source);
  const sourceWithoutTrivia = stripCommentsAndStrings(source);
  const moduleAccessPattern = `require\\s*\\(\\s*['"\`]${escapeRegExp(commonHelperModule)}(?:\\.js)?['"\`]\\s*\\)`;
  const aliases = [];
  const aliasPattern = new RegExp(
    `(?:^|[^\\w$])(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${moduleAccessPattern}`,
    'g',
  );
  let aliasMatch;
  while ((aliasMatch = aliasPattern.exec(sourceWithoutComments)) !== null) {
    aliases.push(aliasMatch[1]);
  }

  for (const helperName of rawRunMetadataRuntimeHelpers) {
    const helperPattern = escapeRegExp(helperName);
    const directMutationPattern = new RegExp(
      `${moduleAccessPattern}\\s*(?:\\.\\s*${helperPattern}|\\[\\s*['"\`]${helperPattern}['"\`]\\s*\\])\\s*=`,
    );
    if (directMutationPattern.test(sourceWithoutComments)) {
      return true;
    }

    const objectAssignPattern = new RegExp(
      `Object\\.assign\\s*\\(\\s*${moduleAccessPattern}\\s*,\\s*\\{[\\s\\S]*\\b${helperPattern}\\b`,
    );
    if (objectAssignPattern.test(sourceWithoutComments)) {
      return true;
    }

    for (const alias of aliases) {
      const aliasMutationPattern = new RegExp(
        `(?:^|[^\\w$.])${escapeRegExp(alias)}\\s*` +
          `(?:\\.\\s*${helperPattern}|\\[\\s*['"\`]${helperPattern}['"\`]\\s*\\])\\s*=`,
      );
      if (aliasMutationPattern.test(sourceWithoutTrivia)) {
        return true;
      }
    }
  }

  return false;
}

function hasDestructuringReassignment(source, variableName) {
  const sourceWithoutTrivia = stripCommentsAndStrings(source);
  const escapedVariableName = escapeRegExp(variableName);
  return (
    new RegExp(`\\(\\s*\\{[^}]*\\b${escapedVariableName}\\b[^}]*\\}\\s*=`).test(sourceWithoutTrivia) ||
    new RegExp(`\\[\\s*[^\\]]*\\b${escapedVariableName}\\b[^\\]]*\\]\\s*=`).test(sourceWithoutTrivia)
  );
}

function hasVariableReassignment(source, variableName) {
  const sanitized = stripCommentsAndStrings(source);
  const identifierPattern = new RegExp(`\\b${escapeRegExp(variableName)}\\b`, 'g');
  let match;

  while ((match = identifierPattern.exec(sanitized)) !== null) {
    const tokenEnd = match.index + variableName.length;
    const previousToken = previousIdentifierToken(sanitized, match.index);
    const nextIndex = nextNonWhitespaceIndex(sanitized, tokenEnd);

    if (['const', 'let', 'var'].includes(previousToken)) {
      continue;
    }

    if (nextIndex >= 0 && isAssignmentOperatorAt(sanitized, nextIndex)) {
      return true;
    }

    if (nextIndex >= 0 && ['++', '--'].includes(sanitized.slice(nextIndex, nextIndex + 2))) {
      return true;
    }

    const previousIndex = previousNonWhitespaceIndex(sanitized, match.index - 1);
    if (previousIndex >= 1 && ['++', '--'].includes(sanitized.slice(previousIndex - 1, previousIndex + 1))) {
      return true;
    }
  }

  return false;
}

function hasVariableAssignmentOrMutation(source, variableName) {
  const sanitized = stripCommentsAndStrings(source);
  const identifierPattern = new RegExp(`\\b${escapeRegExp(variableName)}\\b`, 'g');
  let match;

  while ((match = identifierPattern.exec(sanitized)) !== null) {
    const tokenEnd = match.index + variableName.length;
    const previousToken = previousIdentifierToken(sanitized, match.index);
    const nextIndex = nextNonWhitespaceIndex(sanitized, tokenEnd);

    if (['const', 'let', 'var'].includes(previousToken)) {
      continue;
    }

    if (nextIndex >= 0 && isAssignmentOperatorAt(sanitized, nextIndex)) {
      return true;
    }

    if (nextIndex >= 0 && ['++', '--'].includes(sanitized.slice(nextIndex, nextIndex + 2))) {
      return true;
    }

    const previousIndex = previousNonWhitespaceIndex(sanitized, match.index - 1);
    if (previousIndex >= 1 && ['++', '--'].includes(sanitized.slice(previousIndex - 1, previousIndex + 1))) {
      return true;
    }

    if (nextIndex >= 0 && sanitized[nextIndex] === '[') {
      const closingBracketIndex = findClosingBracketIndex(sanitized, nextIndex);
      const afterBracketIndex = closingBracketIndex >= 0
        ? nextNonWhitespaceIndex(sanitized, closingBracketIndex + 1)
        : -1;
      if (afterBracketIndex >= 0 && isAssignmentOperatorAt(sanitized, afterBracketIndex)) {
        return true;
      }
    }

    if (nextIndex >= 0 && sanitized[nextIndex] === '.') {
      const property = readIdentifierAt(sanitized, nextIndex + 1);
      const afterPropertyIndex = nextNonWhitespaceIndex(sanitized, property.end);
      if (afterPropertyIndex >= 0 && sanitized[afterPropertyIndex] === '(') {
        return true;
      }

      if (afterPropertyIndex >= 0 && isAssignmentOperatorAt(sanitized, afterPropertyIndex)) {
        return true;
      }
    }
  }

  return false;
}

function hasExternalEventCursorProvenanceMutation(source) {
  const directVariables = [
    presentationStateVariable,
    eventsEnvelopeVariable,
    apiEventCursorsVariable,
    apiEventCursorSetVariable,
    presentedChronicleCursorsVariable,
  ];
  const memberPaths = [
    [presentationStateVariable, 'chronicleRows'],
    [eventsEnvelopeVariable, 'body'],
    [eventsEnvelopeVariable, 'body', 'events'],
  ];

  return (
    directVariables.some((variableName) => (
      hasDestructuringReassignment(source, variableName) ||
      hasMemberPathAssignmentOrMutatingCall(source, [variableName])
    )) ||
    memberPaths.some((pathParts) => hasMemberPathAssignmentOrMutatingCall(source, pathParts))
  );
}

function hasMemberPathAssignmentOrMutatingCall(source, pathParts) {
  const sanitized = stripCommentsAndStrings(source);
  const memberPattern = memberPathPattern(pathParts);
  let match;

  while ((match = memberPattern.exec(sanitized)) !== null) {
    if (
      pathParts.length === 1 &&
      ['const', 'let', 'var'].includes(previousIdentifierToken(sanitized, match.index))
    ) {
      continue;
    }

    const tokenEnd = match.index + match[0].length;
    const nextIndex = nextNonWhitespaceIndex(sanitized, tokenEnd);
    if (nextIndex < 0) {
      continue;
    }

    if (isAssignmentOperatorAt(sanitized, nextIndex)) {
      return true;
    }

    if (['++', '--'].includes(sanitized.slice(nextIndex, nextIndex + 2))) {
      return true;
    }

    if (sanitized[nextIndex] === '[') {
      const closingBracketIndex = findClosingBracketIndex(sanitized, nextIndex);
      const afterBracketIndex = closingBracketIndex >= 0
        ? nextNonWhitespaceIndex(sanitized, closingBracketIndex + 1)
        : -1;
      if (afterBracketIndex >= 0 && isAssignmentOperatorAt(sanitized, afterBracketIndex)) {
        return true;
      }
    }

    if (sanitized[nextIndex] === '.') {
      const property = readIdentifierAt(sanitized, nextIndex + 1);
      const afterPropertyIndex = nextNonWhitespaceIndex(sanitized, property.end);
      if (afterPropertyIndex >= 0 && isAssignmentOperatorAt(sanitized, afterPropertyIndex)) {
        return true;
      }
      if (
        afterPropertyIndex >= 0 &&
        sanitized[afterPropertyIndex] === '(' &&
        mutatingCollectionMethods.has(property.name)
      ) {
        return true;
      }
    }
  }

  return false;
}

function memberPathPattern(pathParts) {
  const escapedParts = pathParts.map((part) => escapeRegExp(part));
  return new RegExp(`\\b${escapedParts.join('\\s*\\.\\s*')}\\b`, 'g');
}

function previousIdentifierToken(source, beforeIndex) {
  let end = previousNonWhitespaceIndex(source, beforeIndex - 1);
  if (end === -1 || !/[A-Za-z_$]/.test(source[end])) {
    return '';
  }

  let start = end;
  while (start >= 0 && /[\w$]/.test(source[start])) {
    start -= 1;
  }

  return source.slice(start + 1, end + 1);
}

function readIdentifierAt(source, startIndex) {
  let index = startIndex;
  while (index < source.length && /\s/.test(source[index])) {
    index += 1;
  }

  const start = index;
  if (!/[A-Za-z_$]/.test(source[index] || '')) {
    return { name: '', end: start };
  }

  index += 1;
  while (index < source.length && /[\w$]/.test(source[index])) {
    index += 1;
  }

  return {
    name: source.slice(start, index),
    end: index,
  };
}

function isAssignmentOperatorAt(source, index) {
  const assignmentOperators = ['&&=', '||=', '??=', '+=', '-=', '*=', '/=', '%=', '='];
  return assignmentOperators.some((operator) => {
    if (!source.startsWith(operator, index)) {
      return false;
    }
    if (operator === '=') {
      return source[index + 1] !== '=' && source[index + 1] !== '>';
    }
    return true;
  });
}

function findClosingBracketIndex(source, openBracketIndex) {
  let depth = 0;
  for (let index = openBracketIndex; index < source.length; index += 1) {
    if (source[index] === '[') {
      depth += 1;
    } else if (source[index] === ']') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function hasRawRunMetadataHelperShadow(source, helperName) {
  const sourceWithoutComments = stripComments(source);
  const sourceWithoutCommonHelperImports = sourceWithoutComments.replace(
    commonHelperDestructureImportPattern,
    '',
  );
  const sourceWithoutTrivia = stripCommentsAndStrings(source);
  return (
    directLocalDefinitionPattern(helperName).test(sourceWithoutTrivia) ||
    destructuringShadowPattern(helperName).test(sourceWithoutCommonHelperImports) ||
    parameterShadowPatterns(helperName).some((pattern) => pattern.test(sourceWithoutTrivia))
  );
}

function directLocalDefinitionPattern(helperName) {
  const helperPattern = escapeRegExp(helperName);
  return new RegExp(
    `(?:^|[^\\w$])(?:const|let|var|class)\\s+${helperPattern}\\b|` +
      `(?:^|[^\\w$])function\\s+${helperPattern}\\b`,
  );
}

function destructuringShadowPattern(helperName) {
  return new RegExp(
    `(?:^|[^\\w$])(?:const|let|var)\\s*\\{[^}]*\\b${escapeRegExp(helperName)}\\b[^}]*\\}\\s*=`,
  );
}

function parameterShadowPatterns(helperName) {
  const helperPattern = escapeRegExp(helperName);
  return [
    new RegExp(`\\([^)]*\\b${helperPattern}\\b[^)]*\\)\\s*=>`),
    new RegExp(`function(?:\\s+[A-Za-z_$][\\w$]*)?\\s*\\([^)]*\\b${helperPattern}\\b[^)]*\\)`),
  ];
}

function assertExternalConfigTargetsExternalSpec(readSource, failures) {
  const source = readSource(files.realLiveConfig);
  const webServerProperty = /(?:^|[,{]\s*)(?:['"]webServer['"]|webServer)\s*:/m;
  const expectedExternalTestMatchPattern = /testMatch\s*:\s*\/live-real-provider\\\.spec\\\.js\//;

  if (!expectedExternalTestMatchPattern.test(source)) {
    failures.push(
      `${files.realLiveConfig}: testMatch must stay narrowed to live-real-provider.spec.js. ` +
        'Deterministic live specs belong only to deterministic Playwright configs.',
    );
  }

  if (webServerProperty.test(source)) {
    failures.push(
      `${files.realLiveConfig}: must not define a webServer property. ` +
        'The external real-provider smoke must attach to an already-running provider.',
    );
  }
}

function assertCommonHelpersStayGeneric(readSource, failures) {
  const source = readSource(files.commonHelpers);
  const sourceWithoutComments = stripComments(source);
  const ast = parseJavaScriptSource(source, failures, files.commonHelpers);

  if (!hasCommonJsNamedExport(ast, rawRunMetadataCopyHelper)) {
    failures.push(
      `${files.commonHelpers}: must export ${rawRunMetadataCopyHelper} for the ` +
        'external real-provider smoke.',
    );
  }

  if (!hasCommonJsNamedExport(ast, liveEventPresentationHelper)) {
    failures.push(
      `${files.commonHelpers}: must export ${liveEventPresentationHelper} for the ` +
        'external real-provider smoke.',
    );
  }

  if (!hasCommonJsNamedExport(ast, liveRendererFreshnessHelper)) {
    failures.push(
      `${files.commonHelpers}: must export ${liveRendererFreshnessHelper} for the ` +
        'external real-provider smoke.',
    );
  }

  if (!hasCommonJsNamedExport(ast, liveRetainedSurfacePresentationHelper)) {
    failures.push(
      `${files.commonHelpers}: must export ${liveRetainedSurfacePresentationHelper} for the ` +
        'external real-provider smoke.',
    );
  }

  if (!hasCommonJsNamedExport(ast, liveEventCursorCorrelationHelper)) {
    failures.push(
      `${files.commonHelpers}: must export ${liveEventCursorCorrelationHelper} for the ` +
        'external real-provider smoke.',
    );
  }

  if (mechanicsHelperImportPatterns.some((pattern) => pattern.test(sourceWithoutComments))) {
    failures.push(
      `${files.commonHelpers}: generic external-smoke helpers must not import ` +
        'deterministic mechanics helpers.',
    );
  }

  if (mechanicsRouteFragmentPattern.test(source)) {
    failures.push(
      `${files.commonHelpers}: generic external-smoke helpers must not contain ` +
        'deterministic mechanics route or harness vocabulary.',
    );
  }

  const rendererSummaryReference = source.match(rendererSummaryReferencePattern)?.[0];
  if (rendererSummaryReference) {
    failures.push(
      `${files.commonHelpers}: generic external-smoke helpers must not reference ` +
        `deterministic renderer summary diagnostic "${rendererSummaryReference}".`,
    );
  }

  for (const reference of bannedCommonHelperReferences) {
    if (source.includes(reference)) {
      failures.push(
        `${files.commonHelpers}: generic external-smoke helpers must not contain ` +
          `deterministic mechanics reference "${reference}".`,
      );
    }
  }
}

function assertDeterministicConfigsExcludeExternalSpec(readSource, failures) {
  for (const config of deterministicConfigs) {
    const source = readSource(config.path);

    if (!config.expectedTestMatchPattern.test(source)) {
      failures.push(
        `${config.path}: testMatch must stay narrowed to ${config.expectedSpec} ` +
          'so live-real-provider.spec.js cannot run in the deterministic harness.',
      );
    }

    if (/\blive-real-provider\\?\.spec\\?\.js\b/.test(source)) {
      failures.push(
        `${config.path}: must not reference live-real-provider.spec.js. ` +
          'External real-provider smoke belongs only to playwright.frontend-real-live.config.js.',
      );
    }
  }
}

function main() {
  const failures = runGuard();

  if (failures.length > 0) {
    console.error('External real-provider smoke guard failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('External real-provider smoke guard passed.');
}

if (require.main === module) {
  main();
}

module.exports = {
  files,
  runGuard,
};
