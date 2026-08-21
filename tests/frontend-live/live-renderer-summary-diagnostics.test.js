const assert = require('node:assert/strict');
const test = require('node:test');

const {
  LIVE_RENDERER_REQUIRED_TAIL_SUMMARIES,
  LIVE_RENDERER_RAW_SUMMARY_FIELDS,
  LIVE_RENDERER_SUMMARY_TUPLE_ARRAY_FIELDS,
  LIVE_RENDERER_SUMMARY_TUPLE_FIELDS,
  LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS,
  validateMechanicsRendererSummaryDiagnostics,
} = require('./live-renderer-summary-diagnostics');

const END_CURSOR = 42;

test('renderer summary diagnostics validator accepts the deterministic invariant fixture', () => {
  assert.deepEqual(
    validateMechanicsRendererSummaryDiagnostics(validDiagnostics(), END_CURSOR),
    [],
  );
});

test('renderer summary diagnostics validator rejects a missing required tail summary', () => {
  for (const required of LIVE_RENDERER_REQUIRED_TAIL_SUMMARIES) {
    const diagnostics = validDiagnostics();
    diagnostics.effects = diagnostics.effects.filter((effect) => !(
      effect.eventType === required.eventType &&
      effect.summary.kind === required.kind
    ));

    assertValidationFailureIncludes(
      diagnostics,
      `missing live renderer tail summary ${required.eventType}/${required.kind}`,
    );
  }
});

test('renderer summary diagnostics validator rejects an unknown summary kind', () => {
  const diagnostics = validDiagnostics();
  diagnostics.effects[1].summary.kind = 'unknown-summary-kind';

  assertValidationFailureIncludes(diagnostics, 'unknown live renderer summary kind unknown-summary-kind');
});

test('renderer summary diagnostics validator rejects every raw summary field', () => {
  for (const rawField of LIVE_RENDERER_RAW_SUMMARY_FIELDS) {
    const diagnostics = validDiagnostics();
    diagnostics.effects[0].summary[rawField] = 'raw event prose must stay out of summaries';

    assertValidationFailureIncludes(
      diagnostics,
      `generic-event-bubble must not expose raw field ${rawField}`,
    );
  }
});

test('renderer summary diagnostics validator rejects true mutation and creation flags', () => {
  const diagnostics = validDiagnostics();
  diagnostics.effects[0].summary.selectionMutated = true;
  diagnostics.effects[1].summary.markerCreated = true;

  assertValidationFailureIncludes(
    diagnostics,
    'generic-event-bubble selection mutation boundary must be false',
  );
  assertValidationFailureIncludes(diagnostics, 'life-transition.markerCreated must be false');
});

test('renderer summary diagnostics validator rejects every non-finite tuple field', () => {
  for (const tupleField of LIVE_RENDERER_SUMMARY_TUPLE_FIELDS) {
    const diagnostics = validDiagnostics();
    diagnostics.effects[0].summary[tupleField] = [1, Infinity, 3];

    assertValidationFailureIncludes(
      diagnostics,
      `generic-event-bubble.${tupleField} must contain only finite values`,
    );
  }
});

test('renderer summary diagnostics validator rejects every non-finite tuple-array field', () => {
  for (const tupleArrayField of LIVE_RENDERER_SUMMARY_TUPLE_ARRAY_FIELDS) {
    const diagnostics = validDiagnostics();
    diagnostics.effects[1].summary[tupleArrayField] = [[1, Number.NaN, 3]];

    assertValidationFailureIncludes(
      diagnostics,
      `life-transition.${tupleArrayField} must contain only finite values`,
    );
  }
});

test('renderer summary diagnostics validator rejects wrong generic carrier identity for every carrier kind', () => {
  for (const carrier of [
    {
      kind: 'generic-event-bubble',
      summaryEventField: 'bubbleEventType',
      eventTypeFailure: 'generic-event-bubble event type must match its carrier effect',
      groupFailure: 'generic-event-bubble event group must match its carrier effect',
      bubbleFailure: 'generic-event-bubble carrier effect must expose a bubble',
      validHasBubble: true,
      invalidHasBubble: false,
    },
    {
      kind: 'generic-event-pulse',
      summaryEventField: 'pulseEventType',
      eventTypeFailure: 'generic-event-pulse event type must match its carrier effect',
      groupFailure: 'generic-event-pulse event group must match its carrier effect',
      bubbleFailure: 'generic-event-pulse carrier effect must not expose a bubble',
      validHasBubble: false,
      invalidHasBubble: true,
    },
    {
      kind: 'generic-event-arc',
      summaryEventField: 'arcEventType',
      eventTypeFailure: 'generic-event-arc event type must match its carrier effect',
      groupFailure: 'generic-event-arc event group must match its carrier effect',
      bubbleFailure: 'generic-event-arc carrier effect must not expose a bubble',
      validHasBubble: false,
      invalidHasBubble: true,
    },
  ]) {
    const wrongTypeDiagnostics = diagnosticsWithGenericCarrier(carrier);
    carrierEffect(wrongTypeDiagnostics).summary[carrier.summaryEventField] = 'agent_paralyzed';
    assertOnlyValidationFailure(wrongTypeDiagnostics, carrier.eventTypeFailure);

    const wrongGroupDiagnostics = diagnosticsWithGenericCarrier(carrier);
    carrierEffect(wrongGroupDiagnostics).summary.eventGroup = 'resource';
    assertOnlyValidationFailure(wrongGroupDiagnostics, carrier.groupFailure);

    const wrongBubbleDiagnostics = diagnosticsWithGenericCarrier(carrier);
    carrierEffect(wrongBubbleDiagnostics).hasBubble = carrier.invalidHasBubble;
    assertOnlyValidationFailure(wrongBubbleDiagnostics, carrier.bubbleFailure);
  }
});

test('renderer summary diagnostics validator applies the motion-mode catalog exactly', () => {
  for (const kind of LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS) {
    const diagnostics = validDiagnostics();
    diagnostics.effects.push(effectWithSummaryKind(kind, { motionMode: 'reduced' }));

    assertOnlyValidationFailure(diagnostics, `${kind} motion mode must match animated`);
  }

  const diagnostics = validDiagnostics();
  diagnostics.effects.push(effectWithSummaryKind('resource-harvest', { motionMode: 'reduced' }));
  assertNoValidationFailureContaining(diagnostics, 'resource-harvest motion mode must match animated');
});

function validDiagnostics() {
  return {
    liveRunCursor: END_CURSOR,
    appliedCursors: [1, END_CURSOR],
    motionMode: { mode: 'animated' },
    effects: [
      {
        eventType: 'agent_died',
        group: 'combat',
        hasBubble: true,
        summary: {
          kind: 'generic-event-bubble',
          bubbleEventType: 'agent_died',
          eventGroup: 'combat',
          motionMode: 'animated',
          anchorWorld: [1, 2, 3],
          inspectorMutated: false,
          selectionMutated: false,
        },
      },
      {
        eventType: 'agent_died',
        group: 'combat',
        hasBubble: false,
        summary: {
          kind: 'life-transition',
          actorWorld: [4, 5, 6],
          parentWorlds: [[7, 8, 9]],
          inspectorMutated: false,
          selectionMutated: false,
        },
      },
    ],
  };
}

function diagnosticsWithGenericCarrier(carrier) {
  const diagnostics = validDiagnostics();
  diagnostics.effects.push({
    eventType: 'agent_died',
    group: 'combat',
    hasBubble: carrier.validHasBubble,
    summary: {
      kind: carrier.kind,
      [carrier.summaryEventField]: 'agent_died',
      eventGroup: 'combat',
      motionMode: 'animated',
      inspectorMutated: false,
      selectionMutated: false,
    },
  });
  return diagnostics;
}

function carrierEffect(diagnostics) {
  return diagnostics.effects[diagnostics.effects.length - 1];
}

function effectWithSummaryKind(kind, summaryFields = {}) {
  if (kind === 'generic-event-bubble') {
    return genericCarrierEffect({
      kind,
      summaryEventField: 'bubbleEventType',
      hasBubble: true,
      summaryFields,
    });
  }
  if (kind === 'generic-event-pulse') {
    return genericCarrierEffect({
      kind,
      summaryEventField: 'pulseEventType',
      hasBubble: false,
      summaryFields,
    });
  }
  if (kind === 'generic-event-arc') {
    return genericCarrierEffect({
      kind,
      summaryEventField: 'arcEventType',
      hasBubble: false,
      summaryFields,
    });
  }
  return {
    eventType: 'agent_died',
    group: 'combat',
    hasBubble: kind === 'generic-event-bubble',
    summary: {
      kind,
      inspectorMutated: false,
      selectionMutated: false,
      ...summaryFields,
    },
  };
}

function genericCarrierEffect({ kind, summaryEventField, hasBubble, summaryFields = {} }) {
  return {
    eventType: 'agent_died',
    group: 'combat',
    hasBubble,
    summary: {
      kind,
      [summaryEventField]: 'agent_died',
      eventGroup: 'combat',
      inspectorMutated: false,
      selectionMutated: false,
      ...summaryFields,
    },
  };
}

function assertValidationFailureIncludes(diagnostics, expectedFailure) {
  const failures = validateMechanicsRendererSummaryDiagnostics(diagnostics, END_CURSOR);
  assert(
    failures.some((failure) => failure.includes(expectedFailure)),
    `Expected a validation failure containing "${expectedFailure}". Got:\n${failures.join('\n')}`,
  );
}

function assertOnlyValidationFailure(diagnostics, expectedFailure) {
  const failures = validateMechanicsRendererSummaryDiagnostics(diagnostics, END_CURSOR);
  assert.deepEqual(failures, [expectedFailure]);
}

function assertNoValidationFailureContaining(diagnostics, rejectedFailure) {
  const failures = validateMechanicsRendererSummaryDiagnostics(diagnostics, END_CURSOR);
  assert(
    failures.every((failure) => !failure.includes(rejectedFailure)),
    `Expected no validation failure containing "${rejectedFailure}". Got:\n${failures.join('\n')}`,
  );
}
