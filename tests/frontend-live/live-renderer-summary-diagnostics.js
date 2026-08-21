const LIVE_RENDERER_SUMMARY_KIND_POOL = Object.freeze([
  'agent-recovered-relight',
  'agent-hoard-bubble',
  'agent-hoard-shimmer',
  'bond-lifecycle',
  'combat-bubble',
  'combat-impact',
  'generic-event-arc',
  'generic-event-bubble',
  'generic-event-pulse',
  'hearth-ember',
  'home-build',
  'home-breach-bubble',
  'home-breach-shock',
  'home-collapse',
  'home-colonize-raid',
  'home-membership-join',
  'home-membership-leave',
  'home-theft-raid',
  'home-vault-hoard',
  'life-transition',
  'movement-arrival',
  'private-thought',
  'private-thought-wisp',
  'resource-harvest',
  'resource-transfer',
  'ruin-scavenge',
  'shelter-use',
  'simulation-started',
  'speech-bubble',
]);
const LIVE_RENDERER_REQUIRED_TAIL_SUMMARIES = Object.freeze([
  { eventType: 'agent_died', kind: 'generic-event-bubble' },
  { eventType: 'agent_died', kind: 'life-transition' },
]);
const LIVE_RENDERER_RAW_SUMMARY_FIELDS = Object.freeze([
  'message',
  'text',
  'fullText',
  'run_id',
  'runId',
  'worldTime',
  'provider',
  'model',
  'prompt',
  'systemPrompt',
]);
const LIVE_RENDERER_SUMMARY_TUPLE_FIELDS = Object.freeze([
  'anchorWorld',
  'homeWorld',
  'buildSiteWorld',
  'thresholdWorld',
  'vaultWorld',
  'streamFromWorld',
  'streamToWorld',
  'actorWorld',
  'targetWorld',
  'childWorld',
  'systemWorld',
]);
const LIVE_RENDERER_SUMMARY_TUPLE_ARRAY_FIELDS = Object.freeze([
  'parentWorlds',
  'relationshipThreadWorld',
  'actorPathWorld',
  'targetPathWorld',
]);
const LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS = Object.freeze([
  'agent-hoard-bubble',
  'agent-hoard-shimmer',
  'combat-bubble',
  'combat-impact',
  'generic-event-arc',
  'generic-event-bubble',
  'generic-event-pulse',
  'hearth-ember',
  'home-build',
  'home-breach-bubble',
  'home-breach-shock',
  'home-collapse',
  'home-colonize-raid',
  'home-membership-join',
  'home-membership-leave',
  'home-theft-raid',
  'home-vault-hoard',
  'movement-arrival',
  'private-thought',
  'private-thought-wisp',
  'resource-transfer',
  'ruin-scavenge',
  'shelter-use',
  'simulation-started',
  'speech-bubble',
]);

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function validateFiniteTuple(tuple, label) {
  const failures = [];
  if (!Array.isArray(tuple)) {
    failures.push(`${label} must be a 3-item tuple`);
    return failures;
  }
  if (tuple.length !== 3) {
    failures.push(`${label} must contain exactly 3 values`);
  }
  for (const value of tuple) {
    if (!Number.isFinite(value)) {
      failures.push(`${label} must contain only finite values`);
    }
  }
  return failures;
}

function validateMechanicsRendererSummaryDiagnostics(diagnostics, endCursor) {
  const failures = [];
  const effects = Array.isArray(diagnostics?.effects) ? diagnostics.effects : [];
  const appliedCursors = Array.isArray(diagnostics?.appliedCursors)
    ? diagnostics.appliedCursors
    : [];
  const motionMode = diagnostics?.motionMode?.mode;
  const summaries = effects.map((effect) => effect.summary);
  const summaryKinds = uniqueSorted(
    summaries.map((summary) => summary?.kind).filter(Boolean),
  );

  if ((diagnostics?.liveRunCursor ?? 0) < endCursor) {
    failures.push(`live run cursor must reach ${endCursor}`);
  }
  if (!appliedCursors.includes(endCursor)) {
    failures.push(`renderer applied cursors must include ${endCursor}`);
  }
  if (typeof motionMode !== 'string' || motionMode.length === 0) {
    failures.push('motion mode must expose a string mode');
  }
  if (summaryKinds.length < 2) {
    failures.push('live renderer must expose at least 2 summary kinds');
  }
  for (const kind of summaryKinds) {
    if (!LIVE_RENDERER_SUMMARY_KIND_POOL.includes(kind)) {
      failures.push(`unknown live renderer summary kind ${kind}`);
    }
  }
  for (const required of LIVE_RENDERER_REQUIRED_TAIL_SUMMARIES) {
    const hasRequiredSummary = effects.some((effect) => (
      effect.eventType === required.eventType &&
      effect.summary?.kind === required.kind
    ));
    if (!hasRequiredSummary) {
      failures.push(`missing live renderer tail summary ${required.eventType}/${required.kind}`);
    }
  }

  for (const [index, effect] of effects.entries()) {
    const summary = effect.summary;
    if (!summary) {
      failures.push(`live renderer effect ${index} must expose a summary`);
      continue;
    }

    const summaryLabel = summary.kind || `effect ${index} summary`;
    if (!summary.kind) {
      failures.push(`live renderer effect ${index} summary kind is required`);
    }
    for (const rawField of LIVE_RENDERER_RAW_SUMMARY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(summary, rawField)) {
        failures.push(`${summaryLabel} must not expose raw field ${rawField}`);
      }
    }
    if (summary.inspectorMutated !== false) {
      failures.push(`${summaryLabel} inspector mutation boundary must be false`);
    }
    if (summary.selectionMutated !== false) {
      failures.push(`${summaryLabel} selection mutation boundary must be false`);
    }

    for (const [field, value] of Object.entries(summary)) {
      if ((field.endsWith('Mutated') || field.endsWith('Created')) && value !== false) {
        failures.push(`${summaryLabel}.${field} must be false`);
      }
    }

    for (const field of LIVE_RENDERER_SUMMARY_TUPLE_FIELDS) {
      if (summary[field] !== undefined) {
        failures.push(...validateFiniteTuple(summary[field], `${summaryLabel}.${field}`));
      }
    }
    for (const field of LIVE_RENDERER_SUMMARY_TUPLE_ARRAY_FIELDS) {
      if (summary[field] !== undefined) {
        if (!Array.isArray(summary[field])) {
          failures.push(`${summaryLabel}.${field} must be an array of tuples`);
          continue;
        }
        if (summary[field].length === 0) {
          failures.push(`${summaryLabel}.${field} must include at least one tuple`);
        }
        for (const tuple of summary[field]) {
          failures.push(...validateFiniteTuple(tuple, `${summaryLabel}.${field}`));
        }
      }
    }

    if (
      LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS.includes(summary.kind) &&
      summary.motionMode !== motionMode
    ) {
      failures.push(`${summaryLabel} motion mode must match ${motionMode}`);
    }
    if (summary.kind === 'generic-event-bubble') {
      if (summary.bubbleEventType !== effect.eventType) {
        failures.push('generic-event-bubble event type must match its carrier effect');
      }
      if (summary.eventGroup !== effect.group) {
        failures.push('generic-event-bubble event group must match its carrier effect');
      }
      if (effect.hasBubble !== true) {
        failures.push('generic-event-bubble carrier effect must expose a bubble');
      }
    }
    if (summary.kind === 'generic-event-pulse') {
      if (summary.pulseEventType !== effect.eventType) {
        failures.push('generic-event-pulse event type must match its carrier effect');
      }
      if (summary.eventGroup !== effect.group) {
        failures.push('generic-event-pulse event group must match its carrier effect');
      }
      if (effect.hasBubble !== false) {
        failures.push('generic-event-pulse carrier effect must not expose a bubble');
      }
    }
    if (summary.kind === 'generic-event-arc') {
      if (summary.arcEventType !== effect.eventType) {
        failures.push('generic-event-arc event type must match its carrier effect');
      }
      if (summary.eventGroup !== effect.group) {
        failures.push('generic-event-arc event group must match its carrier effect');
      }
      if (effect.hasBubble !== false) {
        failures.push('generic-event-arc carrier effect must not expose a bubble');
      }
    }
  }

  return failures;
}

module.exports = {
  LIVE_RENDERER_SUMMARY_KIND_POOL,
  LIVE_RENDERER_REQUIRED_TAIL_SUMMARIES,
  LIVE_RENDERER_RAW_SUMMARY_FIELDS,
  LIVE_RENDERER_SUMMARY_TUPLE_FIELDS,
  LIVE_RENDERER_SUMMARY_TUPLE_ARRAY_FIELDS,
  LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS,
  validateMechanicsRendererSummaryDiagnostics,
};
