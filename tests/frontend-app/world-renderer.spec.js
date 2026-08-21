const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const eventVisualIconKeys = new Set([
  'birth',
  'bond',
  'breach',
  'crown',
  'decay',
  'footstep',
  'gift',
  'harvest',
  'hearth',
  'home',
  'ruin',
  'skull',
  'spark',
  'speech',
  'theft',
  'thought',
  'wound',
  'world',
]);

const run = {
  schema: 1,
  run_id: 'seed-7-app-test',
  seed: 7,
  started_at: 1782948044.1,
  status: 'running',
  event_cursor: 4,
  world_time: 18.5,
  config_hash: 'abc123',
  constants: {
    paralysis_energy_threshold: 5,
    home_build_materials_cost: 80,
    home_upkeep_materials_per_second: 0.1,
    hoarding_energy_threshold: 500,
    hoarding_materials_threshold: 300,
    mating_cooldown_seconds: 300,
    ruins_persist_seconds: 120,
  },
  provider: 'ollama',
  model: 'llama-test',
  context_window: null,
  timing: { pace: 0, duration: 10, world_tick_interval: 0.05, refresh_interval: 0.05 },
  artifacts: {
    events: 'runs/run_7.jsonl',
    usage: 'runs/usage_7.jsonl',
    snapshots: 'runs/snapshots_7.jsonl',
    memory_root: 'memory',
  },
};

const world = {
  schema: 1,
  run_id: 'seed-7-app-test',
  world_time: 18.5,
  event_cursor: 4,
  agents: [
    {
      id: 'agent_001',
      name: 'Aster',
      persona: 'builder',
      position: 'warm_springs',
      energy: 84,
      materials: 22,
      status: 'alive',
      last_mated_at: null,
      offspring_count: 0,
      died_at: null,
      home_id: 'home_001',
      is_hoarding: false,
    },
    {
      id: 'agent_002',
      name: 'Briar',
      persona: 'scout',
      position: 'nirvana_east',
      energy: 4,
      materials: 3,
      status: 'paralyzed',
      last_mated_at: 4,
      offspring_count: 1,
      died_at: null,
      home_id: null,
      is_hoarding: false,
    },
    {
      id: 'agent_003',
      name: 'Cinder',
      persona: 'raider',
      position: 'nirvana_west',
      energy: 40,
      materials: 9,
      status: 'alive',
      last_mated_at: null,
      offspring_count: 0,
      died_at: null,
      home_id: null,
      is_hoarding: false,
    },
  ],
  regions: [
    {
      name: 'nirvana',
      description: 'A once-heavenly landscape, now thinning and picked-over.',
      connections: ['warm_springs', 'nirvana_east', 'nirvana_west'],
      energy_rate: 0.2,
      materials_rate: 0.2,
      current_energy: 60,
      current_materials: 60,
      max_energy: 120,
      max_materials: 120,
    },
    {
      name: 'nirvana_east',
      description: 'A struggling, near-barren stretch.',
      connections: ['warm_springs', 'nirvana'],
      energy_rate: 0.1,
      materials_rate: 0.1,
      current_energy: 20,
      current_materials: 15,
      max_energy: 70,
      max_materials: 70,
    },
    {
      name: 'nirvana_west',
      description: 'A nuclear wasteland, all but dead.',
      connections: ['warm_springs', 'nirvana'],
      energy_rate: 0.05,
      materials_rate: 0,
      current_energy: 15,
      current_materials: 0,
      max_energy: 50,
      max_materials: 10,
    },
    {
      name: 'warm_springs',
      description: 'Hot spring lakes and the least-poor refuge.',
      connections: ['nirvana_west', 'nirvana_east', 'nirvana'],
      energy_rate: 0.25,
      materials_rate: 0.2,
      current_energy: 90,
      current_materials: 80,
      max_energy: 130,
      max_materials: 130,
    },
  ],
  homes: [
    {
      home_id: 'home_001',
      owner_id: 'agent_001',
      region: 'warm_springs',
      integrity: 120,
      max_integrity: 120,
      built_at: 8,
      last_upkeep_at: 11,
      last_integrity_at: 11,
      stakeholders: ['agent_001'],
      vault_materials: 14,
      status: 'standing',
      ruined_at: null,
      remnant_materials: 0,
      breachers: [],
      is_hoarding: false,
    },
    {
      home_id: 'home_002',
      owner_id: 'agent_002',
      region: 'warm_springs',
      integrity: 36,
      max_integrity: 187.5,
      built_at: 10,
      last_upkeep_at: 13,
      last_integrity_at: 13,
      stakeholders: ['agent_002', 'agent_003', 'agent_004', 'agent_005'],
      vault_materials: 360,
      status: 'standing',
      ruined_at: null,
      remnant_materials: 0,
      breachers: ['agent_003'],
      is_hoarding: true,
    },
  ],
  ruins: [
    {
      home_id: 'home_old',
      owner_id: 'agent_009',
      region: 'nirvana_west',
      integrity: 0,
      max_integrity: 120,
      built_at: 1,
      last_upkeep_at: 9,
      last_integrity_at: 9,
      stakeholders: ['agent_009'],
      vault_materials: 0,
      status: 'ruin',
      ruined_at: 10,
      remnant_materials: 64,
      breachers: ['agent_003'],
      is_hoarding: false,
    },
  ],
  pending_proposals: [
    {
      initiator_id: 'agent_001',
      target_id: 'agent_002',
      timestamp: 12,
      resources: { energy: 8, materials: 2 },
    },
  ],
};

const replayArtifactBodies = {
  events: [
    replayEventRecord(13.1),
    replayEventRecord(13.2),
    replayEventRecord(13.3),
  ].map((record) => JSON.stringify(record)).join('\n'),
  snapshots: [
    replayCheckpointRecord({ ...world, event_cursor: 4, world_time: 18.5 }, 'manual'),
    replayCheckpointRecord({ ...world, event_cursor: 4, world_time: 19.5 }, 'world_tick'),
    replayCheckpointRecord({ ...world, event_cursor: 6, world_time: 21.0 }, 'world_tick'),
  ].map((record) => JSON.stringify(record)).join('\n'),
};

const envelope = {
  schema: 1,
  cursor: 4,
  oldest_cursor: 0,
  next_cursor: 5,
  events: [
    {
      cursor: 5,
      event: {
        type: 'speak',
        source: 'agent_001',
        payload: { message: 'Aster calls across the meadow.' },
        scope: 'local',
        region: 'warm_springs',
        target: null,
        timestamp: 19.1,
      },
      resolved: { actor_id: 'agent_001', region: 'warm_springs' },
      snapshot_after: null,
    },
  ],
  overflow: false,
  snapshot_required: false,
};

function routeFailure(status, body = {}) {
  return {
    __vivariumRouteFailure: true,
    status,
    body,
  };
}

function deferredArtifactBody(body) {
  let release;
  let markFulfilled;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  const fulfilled = new Promise((resolve) => {
    markFulfilled = resolve;
  });
  return {
    __vivariumDeferredArtifactBody: true,
    body,
    released,
    fulfilled,
    release,
    markFulfilled,
  };
}

function fulfillJsonRoute(route, value) {
  if (value && value.__vivariumRouteFailure) {
    return route.fulfill({
      status: value.status,
      contentType: 'application/json',
      body: JSON.stringify(value.body || {}),
    });
  }
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
}

async function fulfillReplayArtifactRoute(route, value) {
  if (value && value.__vivariumDeferredArtifactBody) {
    await value.released;
    try {
      return await fulfillReplayArtifactRoute(route, value.body);
    } finally {
      value.markFulfilled();
    }
  }
  if (value && value.__vivariumRouteFailure) {
    return fulfillJsonRoute(route, value);
  }
  return route.fulfill({ contentType: 'application/x-ndjson', body: value });
}

async function fulfillBoundedReplayRoute(route, value, buildResponse) {
  if (value && value.__vivariumDeferredArtifactBody) {
    await value.released;
    try {
      return await fulfillBoundedReplayRoute(route, value.body, buildResponse);
    } finally {
      value.markFulfilled();
    }
  }
  if (value && value.__vivariumRouteFailure) {
    return fulfillJsonRoute(route, value);
  }
  try {
    const response = buildResponse(parseReplayArtifactLines(value));
    return fulfillJsonRoute(route, response);
  } catch {
    return route.fulfill({ contentType: 'application/json', body: '{' });
  }
}

function replayArtifactValue(value) {
  return value && value.__vivariumDeferredArtifactBody
    ? replayArtifactValue(value.body)
    : value;
}

function replayArtifactRecordCount(value) {
  const body = replayArtifactValue(value);
  if (body && body.__vivariumRouteFailure) {
    return 1;
  }
  return typeof body === 'string'
    ? body.split(/\r?\n/).filter((line) => line.trim() !== '').length
    : 0;
}

function parseReplayArtifactLines(value) {
  const body = replayArtifactValue(value);
  if (typeof body !== 'string') {
    return [];
  }
  return body.split(/\r?\n/).flatMap((line, index) => {
    if (line.trim() === '') {
      return [];
    }
    return [{ line: index + 1, value: JSON.parse(line) }];
  });
}

function replayArtifactRunId(value, fallback) {
  try {
    return parseReplayArtifactLines(value)
      .find((record) => typeof record.value?.run_id === 'string')
      ?.value.run_id || fallback;
  } catch {
    return fallback;
  }
}

function boundedReplayEventEntry(record, cursor) {
  const payload = record.payload || {};
  const actorId = payload.actor_id
    || payload.attacker_id
    || payload.sender_id
    || payload.giver_id
    || payload.builder_id
    || payload.breacher_id
    || payload.speaker_id
    || payload.initiator_id
    || payload.rejecter_id
    || payload.agent_id
    || payload.killer_id
    || (record.source !== 'system' && record.source !== 'world' ? record.source : undefined);
  const targetId = payload.target_id
    || payload.receiver_id
    || payload.recipient_id
    || payload.revived_id
    || payload.victim_id
    || payload.acceptor_id
    || record.target
    || undefined;
  const region = record.region || payload.region || undefined;
  const homeId = payload.home_id || payload.target_home || undefined;
  const resolved = {};
  if (actorId) resolved.actor_id = actorId;
  if (targetId) resolved.target_id = targetId;
  if (region) resolved.region = region;
  if (homeId) resolved.home_id = homeId;
  if (typeof payload.amount === 'number') resolved.amount = payload.amount;
  if (typeof payload.resource_type === 'string') resolved.resource_type = payload.resource_type;
  return { cursor, event: record, resolved, snapshot_after: null };
}

function eventEntry(cursor, type, source, payload, resolved, overrides = {}) {
  return {
    cursor,
    event: {
      type,
      source,
      payload,
      scope: overrides.scope || 'local',
      region: overrides.region === undefined ? resolved.region || null : overrides.region,
      target: overrides.target || null,
      timestamp: 19 + (cursor - 4) / 10,
    },
    resolved,
    snapshot_after: null,
  };
}

function selectedTrailScrollOwner(state) {
  if (state.scrollHeight > state.clientHeight && /auto|scroll/.test(state.overflowY ?? '')) {
    return 'recent';
  }
  if (
    state.inspectorScrollHeight > state.inspectorClientHeight &&
    /auto|scroll/.test(state.inspectorOverflowY ?? '')
  ) {
    return 'inspector';
  }
  if (
    state.surfaceScrollHeight > state.surfaceClientHeight &&
    /auto|scroll/.test(state.surfaceOverflowY ?? '')
  ) {
    return 'surface';
  }
  if (state.documentScrollHeight > state.documentClientHeight) {
    return 'document';
  }
  return 'none';
}

function denseSelectedRegionStoryEvent(cursor) {
  switch (cursor) {
    case 30:
      return eventEntry(
        cursor,
        'mating_initiated',
        'agent_001',
        {
          message: 'Aster sends a dense-trail bond call.',
          initiator_id: 'agent_001',
          target_id: 'agent_002',
          resources: { energy: 50, materials: 30 },
        },
        { actor_id: 'agent_001', target_id: 'agent_002' },
        { scope: 'targeted', region: null, target: 'agent_002' },
      );
    case 31:
      return eventEntry(
        cursor,
        'mating_rejected',
        'agent_002',
        {
          message: 'Briar declines the dense-trail bond.',
          rejecter_id: 'agent_002',
          initiator_id: 'agent_001',
          target_id: 'agent_001',
          resources_refunded: { energy: 50, materials: 30 },
        },
        { actor_id: 'agent_002', target_id: 'agent_001' },
        { scope: 'targeted', region: null, target: 'agent_001' },
      );
    case 32:
      return eventEntry(
        cursor,
        'mating_proposal_invalidated',
        'agent_001',
        {
          initiator_id: 'agent_001',
          target_id: 'agent_002',
          reason: 'initiator_ineligible',
          resources_refunded: { energy: 50, materials: 30 },
        },
        { actor_id: 'agent_001', target_id: 'agent_001' },
        { scope: 'targeted', region: null, target: 'agent_001' },
      );
    case 33:
      return eventEntry(
        cursor,
        'mating_proposal_timeout',
        'agent_003',
        {
          initiator_id: 'agent_003',
          target_id: 'agent_002',
          reason: 'timeout',
          resources_refunded: { energy: 50, materials: 30 },
        },
        { actor_id: 'agent_003', target_id: 'agent_003' },
        { scope: 'targeted', region: null, target: 'agent_003' },
      );
    case 48:
      return eventEntry(
        cursor,
        'home_built',
        'agent_001',
        {
          builder_id: 'agent_001',
          owner_id: 'agent_001',
          home_id: 'home_001',
          target_home: 'home_001',
          region: 'warm_springs',
          materials_cost: 80,
          integrity: 120,
        },
        { actor_id: 'agent_001', home_id: 'home_001', region: 'warm_springs' },
      );
    case 52:
      return eventEntry(
        cursor,
        'hearth_used',
        'agent_001',
        {
          agent_id: 'agent_001',
          home_id: 'home_001',
          target_home: 'home_001',
          region: 'warm_springs',
          materials_burned: 8,
          energy_gained: 8,
        },
        { actor_id: 'agent_001', home_id: 'home_001', region: 'warm_springs' },
      );
    case 70:
      return eventEntry(
        cursor,
        'agent_left_region',
        'agent_003',
        {
          agent_id: 'agent_003',
          from_region: 'nirvana_west',
          to_region: 'warm_springs',
          move_energy_cost: 5,
        },
        { actor_id: 'agent_003', region: 'nirvana_west' },
        { region: 'nirvana_west' },
      );
    case 71:
      return eventEntry(
        cursor,
        'agent_entered_region',
        'agent_003',
        {
          agent_id: 'agent_003',
          from_region: 'nirvana_west',
          to_region: 'warm_springs',
          move_energy_cost: 5,
        },
        { actor_id: 'agent_003', region: 'warm_springs' },
      );
    case 90:
      return eventEntry(
        cursor,
        'home_breached',
        'agent_003',
        {
          home_id: 'home_002',
          target_home: 'home_002',
          breacher_id: 'agent_003',
          intent: 'thieve',
          region: 'warm_springs',
          integrity_damage: 80,
          integrity: 0,
          breachers: ['agent_003'],
        },
        { actor_id: 'agent_003', home_id: 'home_002', region: 'warm_springs' },
      );
    case 91:
      return eventEntry(
        cursor,
        'home_thieved',
        'agent_003',
        {
          home_id: 'home_002',
          target_home: 'home_002',
          breacher_id: 'agent_003',
          intent: 'thieve',
          region: 'warm_springs',
          recipients: ['agent_003'],
          loot: { materials: 14 },
          vault_materials: 0,
          integrity: 0,
        },
        { actor_id: 'agent_003', home_id: 'home_002', region: 'warm_springs', amount: 14 },
      );
    case 110:
      return eventEntry(
        cursor,
        'attack',
        'agent_001',
        {
          attacker_id: 'agent_001',
          victim_id: 'agent_002',
          target_id: 'agent_002',
          region: 'warm_springs',
          damage: 18,
        },
        { actor_id: 'agent_001', target_id: 'agent_002', region: 'warm_springs' },
      );
    case 111:
      return eventEntry(
        cursor,
        'agent_paralyzed',
        'agent_002',
        {
          victim_id: 'agent_002',
          attacker_id: 'agent_001',
          region: 'warm_springs',
          damage: 18,
          energy: 3,
        },
        { actor_id: 'agent_001', target_id: 'agent_002', region: 'warm_springs' },
      );
    case 120:
      return eventEntry(
        cursor,
        'agent_born',
        'child_dense',
        {
          child_id: 'child_dense',
          child_name: 'Dawn',
          parent_ids: ['agent_001', 'agent_002'],
          region: 'warm_springs',
        },
        { actor_id: 'child_dense', target_id: 'agent_001', region: 'warm_springs' },
      );
    case 130:
      return eventEntry(
        cursor,
        'ruins_scavenged',
        'agent_003',
        {
          agent_id: 'agent_003',
          home_id: 'home_old',
          target_home: 'home_old',
          region: 'warm_springs',
          resource_type: 'materials',
          amount: 6,
          remnant_materials: 12,
        },
        { actor_id: 'agent_003', home_id: 'home_old', region: 'warm_springs', amount: 6 },
      );
    case 140:
      return eventEntry(
        cursor,
        'agent_decayed',
        'agent_002',
        {
          agent_id: 'agent_002',
          agent_name: 'Briar',
          region: 'warm_springs',
          died_at: 80,
          decayed_at: 140,
        },
        { actor_id: 'agent_002', region: 'warm_springs' },
      );
    case 150:
      return eventEntry(
        cursor,
        'home_collapsed',
        'system',
        {
          home_id: 'home_001',
          target_home: 'home_001',
          owner_id: 'agent_001',
          region: 'warm_springs',
          integrity: 0,
          remnant_materials: 49,
          ruined_at: 150,
        },
        { home_id: 'home_001', region: 'warm_springs' },
      );
    case 168:
      return eventEntry(
        cursor,
        'self_talk',
        'agent_001',
        {
          agent_id: 'agent_001',
          message: 'Dense private thought should stay out of region trails.',
        },
        { actor_id: 'agent_001' },
        { scope: 'private', region: null },
      );
    default:
      return eventEntry(
        cursor,
        'speak',
        'agent_001',
        {
          speaker_id: 'agent_001',
          message: `Routine spring note ${String(cursor).padStart(3, '0')}.`,
        },
        { actor_id: 'agent_001', region: 'warm_springs' },
      );
  }
}

const denseSelectedRegionEnvelope = {
  schema: 1,
  cursor: 4,
  oldest_cursor: 0,
  next_cursor: 175,
  events: Array.from({ length: 170 }, (_, index) =>
    denseSelectedRegionStoryEvent(index + 5),
  ),
  overflow: false,
  snapshot_required: false,
};

const denseSelectedRegionWorld = {
  ...world,
  event_cursor: 175,
  agents: world.agents.map((agent) => (
    ['agent_002', 'agent_003'].includes(agent.id)
      ? { ...agent, position: 'warm_springs', status: 'alive' }
      : agent
  )),
};

function envelopeWithCursorOffset(source, offset, timestampOffset = 0) {
  return {
    ...source,
    cursor: source.cursor + offset,
    oldest_cursor: source.oldest_cursor + offset,
    next_cursor: source.next_cursor + offset,
    events: source.events.map((entry) => ({
      ...entry,
      cursor: entry.cursor + offset,
      event: {
        ...entry.event,
        payload: { ...entry.event.payload },
        timestamp: entry.event.timestamp + timestampOffset,
      },
      resolved: { ...entry.resolved },
    })),
  };
}

function snapshotRequiredEnvelope(cursor) {
  return {
    schema: 1,
    cursor,
    oldest_cursor: Math.max(0, cursor - 1),
    next_cursor: cursor,
    events: [],
    overflow: false,
    snapshot_required: true,
  };
}

const burstEnvelope = {
  schema: 1,
  cursor: 4,
  oldest_cursor: 0,
  next_cursor: 24,
  events: [
    eventEntry(
      5,
      'agent_left_region',
      'agent_001',
      {
        agent_id: 'agent_001',
        from_region: 'nirvana',
        to_region: 'warm_springs',
        move_energy_cost: 5,
        agent_energy: 88,
      },
      { actor_id: 'agent_001', region: 'nirvana' },
    ),
    eventEntry(
      6,
      'agent_entered_region',
      'agent_001',
      {
        agent_id: 'agent_001',
        from_region: 'nirvana',
        to_region: 'warm_springs',
        move_energy_cost: 5,
        agent_energy: 88,
      },
      { actor_id: 'agent_001', region: 'warm_springs' },
    ),
    eventEntry(
      7,
      'speak',
      'agent_001',
      { speaker_id: 'agent_001', message: 'Agent Npc rally with an LlM at the spring.' },
      { actor_id: 'agent_001', target_id: 'agent_002', region: 'warm_springs' },
      { target: 'agent_002' },
    ),
    eventEntry(
      8,
      'self_talk',
      'agent_002',
      { agent_id: 'agent_002', message: 'This simulation may spawn an LlM Npc plan.' },
      { actor_id: 'agent_002', region: 'nirvana_east' },
      { scope: 'private', region: null },
    ),
    eventEntry(
      9,
      'resource_changed',
      'agent_001',
      {
        agent_id: 'agent_001',
        region: 'warm_springs',
        resource_type: 'energy',
        amount: 9,
        agent_energy: 93,
        region_energy: 81,
      },
      { actor_id: 'agent_001', region: 'warm_springs', resource_type: 'energy', amount: 9 },
    ),
    eventEntry(
      10,
      'agent_recovered',
      'agent_001',
      {
        giver_id: 'agent_001',
        recipient_id: 'agent_002',
        revived_id: 'agent_002',
        region: 'warm_springs',
        resource_type: 'energy',
        amount: 4,
        giver_energy: 80,
        revived_energy: 8,
      },
      {
        actor_id: 'agent_001',
        target_id: 'agent_002',
        region: 'warm_springs',
        resource_type: 'energy',
        amount: 4,
      },
      { target: 'agent_002' },
    ),
    eventEntry(
      11,
      'resource_transferred',
      'agent_001',
      {
        sender_id: 'agent_001',
        receiver_id: 'agent_002',
        region: 'warm_springs',
        resource_type: 'energy',
        amount: 4,
        sender_energy: 76,
        receiver_energy: 8,
      },
      {
        actor_id: 'agent_001',
        target_id: 'agent_002',
        region: 'warm_springs',
        resource_type: 'energy',
        amount: 4,
      },
      { target: 'agent_002' },
    ),
    eventEntry(
      12,
      'mating_initiated',
      'agent_001',
      {
        initiator_id: 'agent_001',
        target_id: 'agent_002',
        resources: { energy: 8, materials: 2 },
        proposal_timestamp: 19.5,
      },
      { actor_id: 'agent_001', target_id: 'agent_002', region: 'warm_springs' },
      { target: 'agent_002' },
    ),
    eventEntry(
      13,
      'agent_born',
      'agent_004',
      {
        child_id: 'agent_004',
        child_name: 'Dawn',
        parent_ids: ['agent_001', 'agent_002'],
        initiator_id: 'agent_001',
        acceptor_id: 'agent_002',
        region: 'warm_springs',
        child_resources: { energy: 16, materials: 4 },
      },
      { actor_id: 'agent_004', target_id: 'agent_001', region: 'warm_springs' },
    ),
    eventEntry(
      14,
      'attack',
      'agent_003',
      {
        attacker_id: 'agent_003',
        victim_id: 'agent_001',
        region: 'nirvana_west',
        damage: 20,
        attack_energy_cost: 15,
        attacker_energy: 25,
        victim_energy: 64,
      },
      { actor_id: 'agent_003', target_id: 'agent_001', region: 'nirvana_west' },
      { target: 'agent_001' },
    ),
    eventEntry(
      15,
      'agent_died',
      'agent_002',
      {
        victim_id: 'agent_002',
        killer_id: 'agent_003',
        region: 'nirvana_west',
        looted_energy: 0,
        looted_materials: 3,
      },
      { actor_id: 'agent_003', target_id: 'agent_002', region: 'nirvana_west' },
      { target: 'agent_003' },
    ),
    eventEntry(
      16,
      'agent_paralyzed',
      'system',
      {
        agent_id: 'agent_002',
        victim_id: 'agent_002',
        attacker_id: 'agent_003',
        region: 'nirvana_west',
        trigger: 'attack',
        energy: 0,
      },
      { actor_id: 'agent_003', target_id: 'agent_002', region: 'nirvana_west' },
    ),
    eventEntry(
      17,
      'home_built',
      'agent_001',
      {
        home_id: 'home_001',
        target_home: 'home_001',
        builder_id: 'agent_001',
        owner_id: 'agent_001',
        region: 'warm_springs',
        materials_cost: 80,
        integrity: 120,
      },
      { actor_id: 'agent_001', region: 'warm_springs', home_id: 'home_001' },
    ),
    eventEntry(
      18,
      'home_breached',
      'agent_003',
      {
        home_id: 'home_001',
        target_home: 'home_001',
        breacher_id: 'agent_003',
        intent: 'thieve',
        region: 'warm_springs',
        integrity_damage: 60,
        integrity: 0,
      },
      { actor_id: 'agent_003', region: 'warm_springs', home_id: 'home_001' },
    ),
    eventEntry(
      19,
      'home_thieved',
      'agent_003',
      {
        home_id: 'home_001',
        target_home: 'home_001',
        breacher_id: 'agent_003',
        intent: 'thieve',
        region: 'warm_springs',
        recipients: ['agent_003'],
        loot: { materials: 14 },
        loot_shares: { agent_003: { materials: 14 } },
        vault_materials: 0,
        integrity: 0,
      },
      { actor_id: 'agent_003', region: 'warm_springs', home_id: 'home_001', amount: 14 },
    ),
    eventEntry(
      20,
      'home_breached',
      'agent_003',
      {
        home_id: 'home_002',
        target_home: 'home_002',
        breacher_id: 'agent_003',
        intent: 'colonize',
        region: 'warm_springs',
        integrity_damage: 80,
        integrity: 0,
      },
      { actor_id: 'agent_003', region: 'warm_springs', home_id: 'home_002' },
    ),
    eventEntry(
      21,
      'home_colonized',
      'agent_003',
      {
        home_id: 'home_002',
        target_home: 'home_002',
        breacher_id: 'agent_003',
        intent: 'colonize',
        region: 'warm_springs',
        previous_owner_id: 'agent_002',
        previous_stakeholders: ['agent_002', 'agent_003', 'agent_004', 'agent_005'],
        new_owner_id: 'agent_003',
        new_stakeholders: ['agent_003'],
        vault_materials: 360,
        integrity: 0,
      },
      { actor_id: 'agent_003', region: 'warm_springs', home_id: 'home_002' },
    ),
    eventEntry(
      22,
      'ruins_scavenged',
      'agent_003',
      {
        agent_id: 'agent_003',
        home_id: 'home_old',
        target_home: 'home_old',
        region: 'nirvana_west',
        resource_type: 'materials',
        amount: 6,
        remnant_materials: 6,
        agent_materials: 15,
      },
      { actor_id: 'agent_003', region: 'nirvana_west', home_id: 'home_old', resource_type: 'materials', amount: 6 },
    ),
    eventEntry(
      23,
      'agent_decayed',
      'agent_002',
      {
        agent_id: 'agent_002',
        agent_name: 'Briar',
        region: 'nirvana_east',
        died_at: 18,
        decayed_at: 142,
      },
      { actor_id: 'agent_002', region: 'nirvana_east' },
    ),
  ],
  overflow: false,
  snapshot_required: false,
};

const liveChronicleRetentionEnvelope = {
  schema: 1,
  cursor: 4,
  oldest_cursor: 0,
  next_cursor: 21,
  events: [
    eventEntry(
      5,
      'agent_died',
      'agent_003',
      {
        victim_id: 'agent_002',
        killer_id: 'agent_003',
        region: 'warm_springs',
        looted_energy: 0,
        looted_materials: 3,
      },
      { actor_id: 'agent_003', target_id: 'agent_002', region: 'warm_springs' },
      { target: 'agent_002' },
    ),
    ...Array.from({ length: 15 }, (_, index) => {
      const cursor = 6 + index;
      return eventEntry(
        cursor,
        'speak',
        'agent_001',
        { speaker_id: 'agent_001', message: `Routine chronicle beat ${cursor}.` },
        { actor_id: 'agent_001', region: 'warm_springs' },
      );
    }),
  ],
  overflow: false,
  snapshot_required: false,
};

const burstVisualEventTypes = [
  'agent_entered_region',
  'speak',
  'self_talk',
  'resource_changed',
  'agent_recovered',
  'mating_initiated',
  'agent_born',
  'attack',
  'agent_died',
  'home_built',
  'home_thieved',
  'home_colonized',
  'ruins_scavenged',
  'agent_decayed',
];
const burstGroupedAwayEventTypes = [
  'agent_left_region',
  'resource_transferred',
  'agent_paralyzed',
  'home_breached',
];
const burstEventCursors = burstEnvelope.events.map(({ cursor }) => cursor);
const burstRepresentativeGroupSets = [
  ['movement'],
  ['speech'],
  ['resource'],
  ['bond'],
  ['combat'],
  ['home', 'contest'],
  ['life'],
];
const groupedHomeRaidEnvelope = {
  schema: 1,
  cursor: 4,
  oldest_cursor: 0,
  next_cursor: 34,
  events: [
    eventEntry(
      30,
      'home_breached',
      'agent_003',
      {
        home_id: 'home_001',
        target_home: 'home_001',
        breacher_id: 'agent_003',
        intent: 'thieve',
        region: 'warm_springs',
        integrity_damage: 60,
        integrity: 0,
      },
      { actor_id: 'agent_003', region: 'warm_springs', home_id: 'home_001' },
    ),
    eventEntry(
      31,
      'home_thieved',
      'agent_003',
      {
        home_id: 'home_001',
        target_home: 'home_001',
        breacher_id: 'agent_003',
        intent: 'thieve',
        region: 'warm_springs',
        loot: { materials: 14 },
        vault_materials: 0,
      },
      { actor_id: 'agent_003', region: 'warm_springs', home_id: 'home_001', amount: 14 },
    ),
    eventEntry(
      32,
      'home_breached',
      'agent_003',
      {
        home_id: 'home_002',
        target_home: 'home_002',
        breacher_id: 'agent_003',
        intent: 'colonize',
        region: 'warm_springs',
        integrity_damage: 80,
        integrity: 0,
      },
      { actor_id: 'agent_003', region: 'warm_springs', home_id: 'home_002' },
    ),
    eventEntry(
      33,
      'home_colonized',
      'agent_003',
      {
        home_id: 'home_002',
        target_home: 'home_002',
        breacher_id: 'agent_003',
        intent: 'colonize',
        region: 'warm_springs',
        previous_owner_id: 'agent_002',
        previous_stakeholders: ['agent_002'],
        new_owner_id: 'agent_003',
        new_stakeholders: ['agent_003'],
      },
      { actor_id: 'agent_003', region: 'warm_springs', home_id: 'home_002' },
    ),
  ],
  overflow: false,
  snapshot_required: false,
};
const groupedHomeRaidCursors = groupedHomeRaidEnvelope.events.map(({ cursor }) => cursor);
const standaloneHomeBreachEnvelope = {
  schema: 1,
  cursor: 70,
  oldest_cursor: 4,
  next_cursor: 71,
  events: [
    eventEntry(
      70,
      'home_breached',
      'agent_003',
      {
        home_id: 'home_001',
        target_home: 'home_001',
        breacher_id: 'agent_003',
        intent: 'thieve',
        region: 'warm_springs',
        breachers: ['agent_003'],
        energy_cost: 15,
        materials_cost: 10,
        integrity_damage: 25,
        integrity: 0,
        message: 'RAW breach payload should never become renderer summary copy.',
      },
      { actor_id: 'agent_003', region: 'warm_springs', home_id: 'home_001' },
    ),
  ],
  overflow: false,
  snapshot_required: false,
};
const groupedHiddenRelevanceEnvelope = {
  schema: 1,
  cursor: 4,
  oldest_cursor: 0,
  next_cursor: 36,
  events: [
    eventEntry(
      30,
      'resource_transferred',
      'agent_001',
      {
        sender_id: 'agent_001',
        receiver_id: 'agent_002',
        region: 'warm_springs',
        resource_type: 'energy',
        amount: 40,
      },
      { actor_id: 'agent_001', target_id: 'agent_002', region: 'warm_springs', resource_type: 'energy', amount: 40 },
      { target: 'agent_002' },
    ),
    eventEntry(
      31,
      'agent_started_hoarding',
      'agent_002',
      {
        agent_id: 'agent_002',
        region: 'warm_springs',
        energy: 520,
        materials: 4,
      },
      { actor_id: 'agent_002', region: 'warm_springs' },
    ),
    eventEntry(
      32,
      'hearth_used',
      'agent_001',
      {
        agent_id: 'agent_001',
        home_id: 'home_001',
        region: 'warm_springs',
        energy_gained: 22,
      },
      { actor_id: 'agent_001', home_id: 'home_001', region: 'warm_springs' },
    ),
    eventEntry(
      33,
      'agent_started_hoarding',
      'agent_001',
      {
        agent_id: 'agent_001',
        region: 'warm_springs',
        energy: 540,
        materials: 22,
      },
      { actor_id: 'agent_001', region: 'warm_springs' },
    ),
    eventEntry(
      34,
      'attack',
      'agent_003',
      {
        attacker_id: 'agent_003',
        victim_id: 'agent_002',
        region: 'nirvana_west',
        damage: 44,
      },
      { actor_id: 'agent_003', target_id: 'agent_002', region: 'nirvana_west' },
      { target: 'agent_002' },
    ),
    eventEntry(
      35,
      'agent_died',
      'agent_002',
      {
        victim_id: 'agent_002',
        killer_id: 'agent_003',
        cause: 'combat',
      },
      { actor_id: 'agent_002', target_id: 'agent_002' },
      { target: 'agent_002', region: null },
    ),
  ],
  overflow: false,
  snapshot_required: false,
};
const groupedHiddenRelevanceCursors = groupedHiddenRelevanceEnvelope.events.map(({ cursor }) => cursor);
const bannedBackendVocabularyPattern = '(^|[^a-z0-9])(simulations?|agents?|llms?|spawn|spawns|spawned|spawning|npcs?)(?=$|[^a-z0-9])';
const requiredRunConstantRawCopyPattern = '\\b(mating_cooldown_seconds|ruins_persist_seconds|home_upkeep_materials_per_second|matingCooldownSeconds|ruinsPersistSeconds|homeUpkeepMaterialsPerSecond)\\b|/api/run\\.constants|run\\.constants';
const longSelectedSpeech = [
  'Aster keeps a careful watch from the spring path while the wind lifts ash over the old stones.',
  'The call names the east ridge, the waterline, the stored food, and the route home so every nearby traveler can follow it without guessing.',
  'No part of this report should be clamped inside the selected trail.',
].join(' ');
const longSelectedThought = [
  'Aster counts the warm stones beside the threshold and keeps the route in memory.',
  'The thought lingers on who is safe, which path is bright, and where the stored food will last through nightfall.',
  'This private line must remain full in the selected trail while the compact marker stays short.',
].join(' ');
const longSpeechEnvelope = {
  schema: 1,
  cursor: 4,
  oldest_cursor: 0,
  next_cursor: 6,
  events: [
    eventEntry(
      5,
      'speak',
      'agent_001',
      { speaker_id: 'agent_001', message: longSelectedSpeech },
      { actor_id: 'agent_001', region: 'warm_springs' },
    ),
  ],
  overflow: false,
  snapshot_required: false,
};
const selectedCompactGapFirstEnvelope = {
  schema: 1,
  cursor: 29,
  oldest_cursor: 0,
  next_cursor: 34,
  events: [
    eventEntry(
      30,
      'resource_transferred',
      'agent_001',
      {
        sender_id: 'agent_001',
        receiver_id: 'agent_002',
        region: 'warm_springs',
        resource_type: 'energy',
        amount: 40,
      },
      { actor_id: 'agent_001', target_id: 'agent_002', region: 'warm_springs', resource_type: 'energy', amount: 40 },
      { target: 'agent_002' },
    ),
    eventEntry(
      31,
      'agent_started_hoarding',
      'agent_002',
      {
        agent_id: 'agent_002',
        region: 'warm_springs',
        energy: 520,
        materials: 4,
      },
      { actor_id: 'agent_002', region: 'warm_springs' },
    ),
    eventEntry(
      32,
      'speak',
      'agent_001',
      { speaker_id: 'agent_001', message: longSelectedSpeech },
      { actor_id: 'agent_001', region: 'warm_springs' },
    ),
    eventEntry(
      33,
      'self_talk',
      'agent_001',
      { agent_id: 'agent_001', message: longSelectedThought },
      { actor_id: 'agent_001', region: 'warm_springs' },
      { scope: 'private', region: null },
    ),
  ],
  overflow: false,
  snapshot_required: false,
};
const selectedCompactGapOverflowEnvelope = {
  schema: 1,
  cursor: 34,
  oldest_cursor: 39,
  next_cursor: 41,
  events: [
    eventEntry(
      40,
      'home_built',
      'agent_001',
      {
        home_id: 'home_001',
        target_home: 'home_001',
        builder_id: 'agent_001',
        owner_id: 'agent_001',
        region: 'warm_springs',
        materials_cost: 80,
        integrity: 120,
      },
      { actor_id: 'agent_001', region: 'warm_springs', home_id: 'home_001' },
    ),
  ],
  overflow: true,
  snapshot_required: true,
};
const selectedCompactGapEnvelopePlan = [
  { delay: 20, onceKey: 'selected-compact-gap-first', body: selectedCompactGapFirstEnvelope },
  { delay: 80, onceKey: 'selected-compact-gap-overflow', body: selectedCompactGapOverflowEnvelope },
];
const selectedCompactGapRecoveredWorld = {
  ...world,
  event_cursor: 41,
  world_time: 24,
};
const arrivalSpeechEnvelope = {
  schema: 1,
  cursor: 4,
  oldest_cursor: 0,
  next_cursor: 6,
  events: [
    eventEntry(
      5,
      'speak',
      'agent_001',
      { speaker_id: 'agent_001', message: 'Aster calls from the spring path.' },
      { actor_id: 'agent_001', region: 'warm_springs' },
    ),
  ],
  overflow: false,
  snapshot_required: false,
};

async function bootApp(
  page,
  viewport,
  envelopeOverride = envelope,
  worldOverride = world,
  runOverride = run,
  artifactBodies = replayArtifactBodies,
  options = {},
) {
  if (viewport) {
    await page.setViewportSize(viewport);
  }
  await page.addInitScript((payload) => {
    window.__vivariumMockEventSources = window.__vivariumMockEventSources || [];
    window.__vivariumAllMockEventSources = window.__vivariumAllMockEventSources || [];
    window.__vivariumMockEventSourceUrlLog = window.__vivariumMockEventSourceUrlLog || [];
    window.__vivariumDispatchMockEventSource = (body) => {
      for (const source of window.__vivariumMockEventSources || []) {
        source.dispatch('events', body);
      }
    };
    const installArchiveBackwardNavigation = () => {
      const clickEarlierPage = () => {
        const button = document.querySelector('[data-testid="archive-load-older"]');
        if (
          button instanceof HTMLButtonElement
          && !button.disabled
          && button.dataset.legacyAutoLoad !== 'true'
        ) {
          button.dataset.legacyAutoLoad = 'true';
          button.click();
        }
      };
      new MutationObserver(clickEarlierPage).observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      clickEarlierPage();
    };
    if (document.documentElement) {
      installArchiveBackwardNavigation();
    } else {
      document.addEventListener('DOMContentLoaded', installArchiveBackwardNavigation, { once: true });
    }
    window.__vivariumFailMockEventSource = (error) => {
      for (const source of window.__vivariumMockEventSources || []) {
        source.fail(error || { type: 'live-stream-error' });
      }
    };
    window.__vivariumFailMockEventSourceAt = (index, error) => {
      const source = (window.__vivariumAllMockEventSources || [])[index];
      source?.fail(error || { type: 'live-stream-error' });
    };
    window.__vivariumDispatchMockEventSourceAt = (index, body) => {
      const source = (window.__vivariumAllMockEventSources || [])[index];
      source?.dispatch('events', body);
    };
    class MockEventSource {
      constructor(url) {
        this.url = url;
        this.readyState = 1;
        this.listeners = new Map();
        window.__vivariumMockEventSources.push(this);
        window.__vivariumAllMockEventSources.push(this);
        window.__vivariumMockEventSourceUrlLog.push(url);
        const plan = Array.isArray(payload.envelope)
          ? payload.envelope
          : [{ delay: 20, body: payload.envelope }];
        for (const item of plan) {
          if (item.onceKey) {
            window.__vivariumMockEventSourceOnce = window.__vivariumMockEventSourceOnce || {};
            if (window.__vivariumMockEventSourceOnce[item.onceKey]) {
              continue;
            }
            window.__vivariumMockEventSourceOnce[item.onceKey] = true;
          }
          setTimeout(() => {
            this.dispatch('events', item.body);
          }, item.delay);
        }
      }
      addEventListener(type, listener) {
        this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
      }
      dispatch(type, body) {
        for (const listener of this.listeners.get(type) || []) {
          listener({ data: JSON.stringify(body) });
        }
      }
      close() {
        this.readyState = 2;
        window.__vivariumMockEventSources = (window.__vivariumMockEventSources || [])
          .filter((source) => source !== this);
      }
      fail(error) {
        this.onerror?.(error);
      }
    }
    window.EventSource = MockEventSource;
  }, { envelope: envelopeOverride });
  await page.route('**/api/run', (route) =>
    fulfillJsonRoute(route, runOverride),
  );
  let worldRequestCount = 0;
  await page.route('**/api/world', (route) => {
    const worlds = Array.isArray(worldOverride) ? worldOverride : [worldOverride];
    const body = worlds[Math.min(worldRequestCount, worlds.length - 1)];
    worldRequestCount += 1;
    return fulfillJsonRoute(route, body);
  });
  const artifactRequestCounts = { events: 0, snapshots: 0 };
  let pendingBootstrapEventRequests = 0;
  const replayRunId = () => replayArtifactRunId(
    artifactBodies.snapshots,
    runOverride.run_id,
  );
  await page.route('**/api/replay/manifest', (route) => {
    const eventCount = replayArtifactRecordCount(artifactBodies.events);
    const checkpointCount = replayArtifactRecordCount(artifactBodies.snapshots);
    let checkpoints = [];
    try {
      checkpoints = parseReplayArtifactLines(artifactBodies.snapshots);
    } catch {
      // The selected bounded record route owns malformed-artifact reporting.
    }
    pendingBootstrapEventRequests += 1;
    return fulfillJsonRoute(route, {
      schema: 1,
      run_id: replayRunId(),
      events: {
        count: eventCount,
        first_cursor: eventCount > 0 ? 1 : null,
        last_cursor: eventCount > 0 ? eventCount : null,
      },
      checkpoints: {
        count: checkpointCount,
        first_line: checkpointCount > 0 ? 1 : null,
        last_line: checkpointCount > 0 ? checkpointCount : null,
        first_event_cursor: checkpoints[0]?.value.event_cursor ?? null,
        last_event_cursor: checkpoints.at(-1)?.value.event_cursor ?? null,
      },
      bootstrap: {
        event_after: Math.max(0, eventCount - 512),
        event_limit: 512,
      },
    });
  });
  await page.route('**/api/replay/events?*', async (route) => {
    if (pendingBootstrapEventRequests > 0) {
      pendingBootstrapEventRequests -= 1;
      artifactRequestCounts.events += 1;
    }
    const url = new URL(route.request().url());
    const after = Number(url.searchParams.get('after') || 0);
    const limit = Number(url.searchParams.get('limit') || 512);
    return fulfillBoundedReplayRoute(route, artifactBodies.events, (records) => {
      const selected = records.filter((record) => record.line > after).slice(0, limit);
      const nextAfter = selected.at(-1)?.line ?? after;
      return {
        schema: 1,
        run_id: replayRunId(),
        after,
        next_after: nextAfter,
        has_more: nextAfter < records.length,
        events: selected.map((record) => boundedReplayEventEntry(record.value, record.line)),
      };
    });
  });
  await page.route('**/api/replay/checkpoints/latest', async (route) => {
    artifactRequestCounts.snapshots += 1;
    return fulfillBoundedReplayRoute(route, artifactBodies.snapshots, (records) => {
      const latest = records.at(-1);
      if (!latest) {
        return routeFailure(404, { detail: 'No replay checkpoint is available.' });
      }
      return {
        schema: 1,
        run_id: replayRunId(),
        line: latest.line,
        checkpoint: latest.value,
      };
    });
  });
  await page.route('**/api/replay/checkpoints?*', async (route) => {
    const url = new URL(route.request().url());
    const requestedBefore = Number(url.searchParams.get('before') || 1);
    const limit = Number(url.searchParams.get('limit') || 32);
    return fulfillBoundedReplayRoute(route, artifactBodies.snapshots, (records) => {
      const before = Math.min(requestedBefore, records.length + 1);
      const selected = records.filter((record) => record.line < before).slice(-limit);
      const nextBefore = selected[0]?.line ?? before;
      return {
        schema: 1,
        run_id: replayRunId(),
        before,
        next_before: nextBefore,
        has_more: selected.length > 0 && nextBefore > 1,
        checkpoints: selected.map((record) => ({
          line: record.line,
          checkpoint: record.value,
        })),
      };
    });
  });
  await page.route('**/api/replay/artifacts/events', async (route) => {
    return fulfillReplayArtifactRoute(route, artifactBodies.events);
  });
  await page.route('**/api/replay/artifacts/snapshots', async (route) => {
    return fulfillReplayArtifactRoute(route, artifactBodies.snapshots);
  });
  await page.goto('/');
  if (options.waitForReady !== false) {
    await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);
    await page.waitForFunction(() => (
      window.__vivariumLiveRun?.diagnostics?.().lastAcceptedSnapshotCursor !== null
    ));
    if (
      typeof artifactBodies.events === 'string'
      && typeof artifactBodies.snapshots === 'string'
    ) {
      try {
        parseReplayArtifactLines(artifactBodies.events);
        const checkpointCount = parseReplayArtifactLines(artifactBodies.snapshots).length;
        if (checkpointCount > 1) {
          await page.waitForFunction(() => (
            document.querySelector('[data-testid="replay-artifact-diagnostics"]')
              ?.getAttribute('data-artifact-load-status') === 'ready'
          ));
        }
      } catch {
        // Malformed fixtures intentionally settle into the passive archive error state.
      }
    }
  }
  return {
    artifactRequestCounts,
    getWorldRequestCount: () => worldRequestCount,
  };
}

async function openAtlasSurface(page, kind) {
  const accessibleName = {
    world: 'Open world — World Beings & land',
    chronicle: 'Open chronicle — Chronicle Living memory',
    archive: 'Open archive — Archive Preserved view',
  }[kind];
  if (!accessibleName) {
    throw new Error(`No edge trigger exists for Atlas surface ${kind}`);
  }
  const trigger = page.getByRole('button', { name: accessibleName, exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const surface = page.locator('[data-atlas-surface]');
  await expect(surface).toHaveAttribute('data-atlas-surface', kind);
  await expect(surface).toHaveAttribute('data-open', 'true');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(1);
  return surface;
}

async function clickStableProjectedWorldTarget(page, kind, id) {
  await page.waitForFunction(() => {
    const source = document.querySelector('[data-testid="world-stage"]')?.getAttribute('data-stage-source');
    const expectedMode = source === 'archive' ? 'demand' : 'live';
    return Boolean(
      window.__vivariumWorld?.isReady
      && window.__viv?.ready
      && window.__vivariumWorld.renderBudgetDiagnostics().renderMode === expectedMode
      && document.querySelector('[data-testid="world-stage"] canvas')?.isConnected
    );
  });
  const focused = await page.evaluate(({ entityKind, entityId }) => {
    const debug = window.__vivariumWorld;
    return entityKind === 'agent'
      ? debug.focusAgent(entityId)
      : entityKind === 'home'
        ? debug.focusHome(entityId)
        : debug.focusRegion(entityId);
  }, { entityKind: kind, entityId: id });
  if (!focused) {
    throw new Error(`The current renderer cannot focus ${kind}:${id}.`);
  }
  await page.evaluate(() => {
    window.__vivariumProjectedPointStability = null;
  });
  await page.waitForFunction(({ kind: entityKind, id: entityId }) => {
    const debug = window.__vivariumWorld;
    const point = entityKind === 'agent'
      ? debug?.screenPointForAgent(entityId)
      : entityKind === 'region'
        ? debug?.screenPointForRegion(entityId)
        : debug?.screenPointForHome(entityId);
    if (!point) return false;
    const previous = window.__vivariumProjectedPointStability;
    const stableFrames = previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.5
      ? previous.stableFrames + 1
      : 0;
    window.__vivariumProjectedPointStability = { ...point, stableFrames };
    const canvas = document.querySelector('[data-testid="world-stage"] canvas');
    const hit = document.elementFromPoint(point.x, point.y);
    return stableFrames >= 2 && Boolean(canvas && (hit === canvas || hit?.closest('.world-stage')));
  }, { kind, id });
  const point = await page.evaluate(({ kind: entityKind, id: entityId }) => (
    entityKind === 'agent'
      ? window.__vivariumWorld.screenPointForAgent(entityId)
      : entityKind === 'region'
        ? window.__vivariumWorld.screenPointForRegion(entityId)
        : window.__vivariumWorld.screenPointForHome(entityId)
  ), { kind, id });
  await page.mouse.click(point.x, point.y);
}

async function clickUnoccludedRegionSurface(page, regionName, snapshot = world) {
  await page.waitForFunction(() => (
    window.__vivariumWorld?.isReady
    && window.__viv?.ready
    && window.__vivariumWorld.renderBudgetDiagnostics().renderMode === 'live'
  ));
  const focused = await page.evaluate((targetRegion) => (
    window.__vivariumWorld.focusRegion(targetRegion)
  ), regionName);
  if (!focused) {
    throw new Error(`The current live renderer cannot focus ${regionName}.`);
  }
  await page.waitForTimeout(900);
  const point = await page.evaluate(({ targetRegion, agentIds, homeIds }) => {
    const debug = window.__vivariumWorld;
    const worldPoint = debug.worldPointForRegion(targetRegion);
    const canvas = document.querySelector('[data-testid="world-stage"] canvas');
    if (!worldPoint || !canvas || !window.__viv?.camera || !window.__viv?.terrainHeight) {
      throw new Error(`No current live renderer can project ${targetRegion}.`);
    }
    const rect = canvas.getBoundingClientRect();
    const entityPoints = [
      ...agentIds.map((id) => debug.screenPointForAgent(id)),
      ...homeIds.map((id) => debug.screenPointForHome(id)),
    ].filter(Boolean);
    const offsets = [
      [8, 6], [8, -6], [-8, 6], [-8, -6],
      [10, 2], [2, 10], [-10, 2], [2, -10],
    ];
    const candidates = offsets.flatMap(([dx, dz]) => {
      const x = worldPoint.x + dx;
      const z = worldPoint.z + dz;
      const y = window.__viv.terrainHeight(x, z);
      if (y <= 0.05) return [];
      const projected = window.__viv.camera.position.clone().set(x, y, z)
        .project(window.__viv.camera);
      const screen = {
        x: rect.left + ((projected.x + 1) / 2) * rect.width,
        y: rect.top + ((-projected.y + 1) / 2) * rect.height,
      };
      if (
        screen.x < rect.left + 4 || screen.x > rect.right - 4
        || screen.y < rect.top + 4 || screen.y > rect.bottom - 4
      ) {
        return [];
      }
      const nearestEntity = entityPoints.reduce((nearest, entity) => (
        Math.min(nearest, Math.hypot(screen.x - entity.x, screen.y - entity.y))
      ), Number.POSITIVE_INFINITY);
      return [{ ...screen, nearestEntity }];
    }).sort((left, right) => right.nearestEntity - left.nearestEntity);
    const selected = candidates[0];
    if (!selected || selected.nearestEntity < 24) {
      throw new Error(`No unoccluded terrain point was found for ${targetRegion}.`);
    }
    return selected;
  }, {
    targetRegion: regionName,
    agentIds: snapshot.agents.map((agent) => agent.id),
    homeIds: [...snapshot.homes, ...snapshot.ruins].map((home) => home.home_id),
  });
  await page.mouse.click(point.x, point.y);
}

async function waitForLiveWorldRenderer(page) {
  await expect(page.getByTestId('world-stage')).toHaveAttribute('data-stage-source', 'live');
  await page.waitForFunction(() => (
    window.__vivariumWorld?.isReady
    && window.__viv?.ready
    && window.__vivariumWorld.renderBudgetDiagnostics().renderMode === 'live'
  ));
}

async function atlasSurfaceBounds(page) {
  return page.evaluate(() => {
    const surface = document.querySelector('[data-atlas-surface][data-open="true"]');
    const rect = surface?.getBoundingClientRect();
    return {
      openSurfaces: document.querySelectorAll(
        '[data-atlas-surface][data-open="true"]',
      ).length,
      rect: rect ? {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      } : null,
      viewport: { width: innerWidth, height: innerHeight },
      bodyScroll:
        document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
    };
  });
}

function expectAtlasSurfaceBounded(state, label = 'Atlas surface') {
  expect(state.openSurfaces, label).toBe(1);
  expect(state.rect, label).not.toBeNull();
  expect(state.rect.left, label).toBeGreaterThanOrEqual(-1);
  expect(state.rect.top, label).toBeGreaterThanOrEqual(-1);
  expect(state.rect.right, label).toBeLessThanOrEqual(state.viewport.width + 1);
  expect(state.rect.bottom, label).toBeLessThanOrEqual(state.viewport.height + 1);
  expect(state.bodyScroll, label).toBeLessThanOrEqual(1);
}

async function selectedRingAndAgentWorld(page, agentId) {
  return page.evaluate((selectedAgentId) => {
    let ring = null;
    let agent = null;
    window.__viv.scene.traverse((object) => {
      if (object.userData?.kind === 'agent' && object.userData?.id === selectedAgentId) {
        object.updateWorldMatrix(true, false);
        const elements = object.matrixWorld.elements;
        agent = { x: elements[12], y: elements[13], z: elements[14] };
      }
      if (
        object.geometry?.type === 'RingGeometry'
        && object.material?.color?.getHex?.() === 0xd9b36a
      ) {
        ring = {
          visible: object.visible,
          x: object.position.x,
          y: object.position.y,
          z: object.position.z,
        };
      }
    });
    if (!ring) {
      throw new Error('Selection ring was not found in the scene.');
    }
    return { ring, agent };
  }, agentId);
}

async function installReplayCheckpointLineNumberStripShim(page, checkpointIndex) {
  await page.addInitScript((index) => {
    window.__vivariumReplayStripCheckpointLineNumberIndex = index;
  }, checkpointIndex);
  await page.route('**/src/app/replayArtifactClient.ts*', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const target = [
      '    const checkpoint = parseSnapshotCheckpoint(input.checkpoint, { lineNumber: line });',
      '    expectCheckpointRun(checkpoint, expectedRunId, LATEST_CHECKPOINT_PATH);',
      '    return checkpoint;',
    ].join('\n');
    const pageTarget = [
      '    assertStrictCheckpointOrder(checkpoints, path);',
      '    return { runId, before: parsedBefore, nextBefore, hasMore, checkpoints };',
    ].join('\n');
    if (!body.includes(target) || !body.includes(pageTarget)) {
      throw new Error('Replay artifact client shim target changed.');
    }
    const replacement = [
      '    const checkpoint = parseSnapshotCheckpoint(input.checkpoint, { lineNumber: line });',
      '    expectCheckpointRun(checkpoint, expectedRunId, LATEST_CHECKPOINT_PATH);',
      '    const stripIndex = globalThis.window?.__vivariumReplayStripCheckpointLineNumberIndex;',
      '    if (stripIndex === "all" || (Number.isInteger(stripIndex) && stripIndex >= 0 && line === stripIndex + 1)) {',
      '      delete checkpoint.lineNumber;',
      '    }',
      '    return checkpoint;',
    ].join('\n');
    const pageReplacement = [
      '    assertStrictCheckpointOrder(checkpoints, path);',
      '    const stripIndex = globalThis.window?.__vivariumReplayStripCheckpointLineNumberIndex;',
      '    if (stripIndex === "all") {',
      '      for (const checkpoint of checkpoints) delete checkpoint.lineNumber;',
      '    } else if (Number.isInteger(stripIndex) && stripIndex >= 0) {',
      '      const checkpoint = checkpoints.find((item) => item.lineNumber === stripIndex + 1);',
      '      if (checkpoint) delete checkpoint.lineNumber;',
      '    }',
      '    return { runId, before: parsedBefore, nextBefore, hasMore, checkpoints };',
    ].join('\n');
    const headers = { ...response.headers() };
    delete headers['content-encoding'];
    delete headers['content-length'];
    return route.fulfill({
      status: response.status(),
      headers,
      body: body.replace(target, replacement).replace(pageTarget, pageReplacement),
    });
  });
}

function replayEventRecord(timestamp, agentId = 'agent_001') {
  return {
    type: 'speak',
    source: agentId,
    payload: { speaker_id: agentId, message: `Archive-only call ${timestamp}` },
    scope: 'local',
    region: 'warm_springs',
    target: null,
    timestamp,
  };
}

function replayCheckpointRecord(snapshot, reason) {
  return {
    schema: 1,
    type: 'world_snapshot_checkpoint',
    reason,
    run_id: snapshot.run_id,
    world_time: snapshot.world_time,
    event_cursor: snapshot.event_cursor,
    snapshot,
  };
}

const splitMoveEnvelopePlan = [
  {
    delay: 20,
    body: {
      schema: 1,
      cursor: 4,
      oldest_cursor: 0,
      next_cursor: 6,
      events: [
        eventEntry(
          5,
          'agent_left_region',
          'agent_001',
          {
            agent_id: 'agent_001',
            from_region: 'nirvana',
            to_region: 'warm_springs',
            move_energy_cost: 5,
            agent_energy: 79,
          },
          { actor_id: 'agent_001', region: 'nirvana' },
          { timestamp: 30, region: 'nirvana' },
        ),
      ],
      overflow: false,
      snapshot_required: false,
    },
  },
  {
    delay: 150,
    body: {
      schema: 1,
      cursor: 5,
      oldest_cursor: 0,
      next_cursor: 7,
      events: [
        eventEntry(
          6,
          'agent_entered_region',
          'agent_001',
          {
            agent_id: 'agent_001',
            from_region: 'nirvana',
            to_region: 'warm_springs',
            move_energy_cost: 5,
            agent_energy: 79,
          },
          { actor_id: 'agent_001', region: 'warm_springs' },
          { timestamp: 30.2, region: 'warm_springs' },
        ),
      ],
      overflow: false,
      snapshot_required: false,
    },
  },
];

const lowFrequencyEnvelope = {
  schema: 1,
  cursor: 4,
  oldest_cursor: 0,
  next_cursor: 16,
  events: [
    eventEntry(
      5,
      'agent_paralyzed',
      'system',
      {
        agent_id: 'agent_002',
        region: 'nirvana_east',
        trigger: 'aging',
        energy: 3,
      },
      { target_id: 'agent_002', region: 'nirvana_east' },
    ),
    eventEntry(
      6,
      'agent_started_hoarding',
      'agent_001',
      {
        agent_id: 'agent_001',
        region: 'warm_springs',
        energy: 510,
        materials: 12,
      },
      { actor_id: 'agent_001', region: 'warm_springs' },
    ),
    eventEntry(
      7,
      'home_started_hoarding',
      'agent_001',
      {
        home_id: 'home_001',
        target_home: 'home_001',
        agent_id: 'agent_001',
        region: 'warm_springs',
        vault_materials: 320,
      },
      { actor_id: 'agent_001', home_id: 'home_001', region: 'warm_springs' },
    ),
    eventEntry(
      8,
      'mating_rejected',
      'agent_002',
      {
        rejecter_id: 'agent_002',
        initiator_id: 'agent_001',
        target_id: 'agent_001',
        resources_refunded: { energy: 50, materials: 30 },
      },
      { actor_id: 'agent_002', target_id: 'agent_001', region: 'nirvana_east' },
      { scope: 'targeted', target: 'agent_001' },
    ),
    eventEntry(
      9,
      'mating_proposal_invalidated',
      'agent_001',
      {
        initiator_id: 'agent_001',
        target_id: 'agent_002',
        reason: 'initiator_ineligible',
        resources_refunded: { energy: 50, materials: 30 },
      },
      { actor_id: 'agent_001', target_id: 'agent_002', region: 'warm_springs' },
      { scope: 'targeted', target: 'agent_001' },
    ),
    eventEntry(
      10,
      'mating_proposal_timeout',
      'agent_001',
      {
        initiator_id: 'agent_001',
        target_id: 'agent_002',
        reason: 'expired',
        resources_refunded: { energy: 50, materials: 30 },
      },
      { actor_id: 'agent_001', target_id: 'agent_002', region: 'warm_springs' },
      { scope: 'targeted', target: 'agent_001' },
    ),
    eventEntry(
      11,
      'hearth_used',
      'agent_001',
      {
        agent_id: 'agent_001',
        home_id: 'home_001',
        target_home: 'home_001',
        region: 'warm_springs',
        materials_burned: 8,
        energy_gained: 8,
        agent_energy: 92,
        agent_materials: 14,
      },
      { actor_id: 'agent_001', home_id: 'home_001', region: 'warm_springs' },
    ),
    eventEntry(
      12,
      'home_joined',
      'agent_002',
      {
        agent_id: 'agent_002',
        home_id: 'home_001',
        target_home: 'home_001',
        owner_id: 'agent_001',
        region: 'warm_springs',
        stakeholders: ['agent_001', 'agent_002'],
        integrity: 120,
        max_integrity: 150,
      },
      { actor_id: 'agent_002', home_id: 'home_001', region: 'warm_springs' },
    ),
    eventEntry(
      13,
      'home_left',
      'agent_002',
      {
        agent_id: 'agent_002',
        home_id: 'home_001',
        target_home: 'home_001',
        previous_owner_id: 'agent_001',
        owner_id: 'agent_001',
        region: 'warm_springs',
        previous_stakeholders: ['agent_001', 'agent_002'],
        stakeholders: ['agent_001'],
        integrity: 110,
        max_integrity: 120,
      },
      { actor_id: 'agent_002', home_id: 'home_001', region: 'warm_springs' },
    ),
    eventEntry(
      14,
      'home_collapsed',
      'agent_001',
      {
        home_id: 'home_001',
        target_home: 'home_001',
        owner_id: 'agent_001',
        region: 'warm_springs',
        stakeholders: ['agent_001'],
        integrity: 0,
        vault_materials: 18,
        remnant_materials: 49,
        ruined_at: 42,
      },
      { actor_id: 'agent_001', home_id: 'home_001', region: 'warm_springs' },
    ),
    eventEntry(
      15,
      'simulation_started',
      'world',
      {
        run_id: 'seed-7-app-test',
        agent_count: 3,
        world_time: 0,
      },
      {},
      { scope: 'global', region: null },
    ),
  ],
  overflow: false,
  snapshot_required: false,
};

const lowFrequencyVisualEventTypes = lowFrequencyEnvelope.events.map(({ event }) => event.type);
const worldReferenceEventTypes = [
  'agent_born',
  'agent_decayed',
  'agent_died',
  'agent_entered_region',
  'agent_left_region',
  'agent_paralyzed',
  'agent_recovered',
  'agent_started_hoarding',
  'attack',
  'hearth_used',
  'home_breached',
  'home_built',
  'home_collapsed',
  'home_colonized',
  'home_joined',
  'home_left',
  'home_started_hoarding',
  'home_thieved',
  'mating_initiated',
  'mating_proposal_invalidated',
  'mating_proposal_timeout',
  'mating_rejected',
  'resource_changed',
  'resource_transferred',
  'ruins_scavenged',
  'self_talk',
  'simulation_started',
  'speak',
].sort();

const overflowEnvelope = {
  ...envelope,
  cursor: 12,
  oldest_cursor: 8,
  next_cursor: 16,
  overflow: true,
  snapshot_required: true,
  events: [
    {
      ...envelope.events[0],
      cursor: 16,
      event: {
        ...envelope.events[0].event,
        timestamp: 21,
      },
    },
  ],
};

const silentSnapshotPulse = {
  schema: 1,
  cursor: 4,
  oldest_cursor: 0,
  next_cursor: 4,
  events: [],
  overflow: false,
  snapshot_required: true,
};

const silentInitialWorld = {
  ...world,
  agents: world.agents.map((agent) =>
    agent.id === 'agent_003'
      ? { ...agent, position: 'warm_springs' }
      : agent,
  ),
};

const silentMechanicsWorld = {
  ...silentInitialWorld,
  world_time: 42.5,
  event_cursor: 4,
  agents: silentInitialWorld.agents.map((agent) => {
    if (agent.id === 'agent_001') {
      return { ...agent, materials: 0 };
    }
    if (agent.id === 'agent_002') {
      return { ...agent, position: 'warm_springs' };
    }
    if (agent.id === 'agent_003') {
      return { ...agent, energy: 25, materials: 79 };
    }
    return agent;
  }),
  regions: silentInitialWorld.regions.map((region) =>
    region.name === 'warm_springs'
      ? { ...region, current_energy: 122, current_materials: 124 }
      : region,
  ),
  homes: silentInitialWorld.homes.map((home) => {
    if (home.home_id === 'home_001') {
      return {
        ...home,
        integrity: 95,
        last_upkeep_at: 40,
        last_integrity_at: 40,
        vault_materials: 0,
        breachers: ['agent_003'],
      };
    }
    if (home.home_id === 'home_002') {
      return {
        ...home,
        integrity: 187.5,
        last_upkeep_at: 38,
        last_integrity_at: 38,
        vault_materials: 0,
        breachers: [],
        is_hoarding: false,
      };
    }
    return home;
  }),
  ruins: [],
  pending_proposals: [],
};

const homeReadinessWithoutHearthWorld = {
  ...world,
  world_time: 31,
  event_cursor: 4,
  agents: world.agents.map((agent) => (
    agent.status === 'alive'
      ? { ...agent, home_id: null }
      : agent
  )),
  homes: [
    {
      ...world.homes[0],
      stakeholders: [],
      breachers: [],
      vault_materials: 0,
      is_hoarding: false,
      integrity: 120,
      max_integrity: 120,
    },
  ],
  ruins: [],
  pending_proposals: [],
};

const homeReadinessKeptWorld = {
  ...homeReadinessWithoutHearthWorld,
  world_time: 36,
  agents: homeReadinessWithoutHearthWorld.agents.map((agent) => (
    agent.id === 'agent_001'
      ? { ...agent, home_id: 'home_001' }
      : agent
  )),
  homes: homeReadinessWithoutHearthWorld.homes.map((home) => ({
    ...home,
    stakeholders: ['agent_001', 'agent_003'],
  })),
};

const wearyWorld = {
  ...world,
  agents: world.agents.map((agent) =>
    agent.id === 'agent_001'
      ? { ...agent, energy: 12, status: 'alive' }
      : agent.id === 'agent_003'
        ? { ...agent, energy: 0, status: 'dead', died_at: 18 }
      : agent,
  ),
};

const task7MysticWorld = {
  ...world,
  agents: [
    { ...world.agents[0], id: 'agent_healthy', energy: 84, status: 'alive', materials: 0, is_hoarding: false },
    { ...world.agents[0], id: 'agent_weary', energy: 12, status: 'alive', materials: 0, is_hoarding: false },
    { ...world.agents[1], id: 'agent_fallen', energy: 4, status: 'paralyzed', materials: 0, is_hoarding: false },
    { ...world.agents[2], id: 'agent_dead', energy: 0, status: 'dead', died_at: 18, materials: 0, is_hoarding: false },
  ],
  homes: world.homes.map((home) => ({
    ...home,
    owner_id: 'agent_healthy',
    stakeholders: ['agent_healthy'],
  })),
  pending_proposals: [],
};

const task7MysticLaterWorld = {
  ...task7MysticWorld,
  world_time: task7MysticWorld.world_time + 240,
};

const task7RecoveryEnvelope = {
  schema: 1,
  cursor: 4,
  oldest_cursor: 0,
  next_cursor: 6,
  events: [
    eventEntry(
      5,
      'agent_recovered',
      'agent_healthy',
      {
        giver_id: 'agent_healthy',
        recipient_id: 'agent_fallen',
        revived_id: 'agent_fallen',
        region: 'nirvana_east',
        resource_type: 'energy',
        amount: 4,
        giver_energy: 80,
        revived_energy: 8,
      },
      {
        actor_id: 'agent_healthy',
        target_id: 'agent_fallen',
        region: 'nirvana_east',
        resource_type: 'energy',
        amount: 4,
      },
    ),
  ],
  overflow: false,
  snapshot_required: false,
};

const stagedBuiltHome = {
  ...world.homes[0],
  home_id: 'home_003',
  owner_id: 'agent_001',
  built_at: 19.1,
  last_upkeep_at: 19.1,
  last_integrity_at: 19.1,
  stakeholders: ['agent_001'],
  vault_materials: 0,
  breachers: [],
  is_hoarding: false,
};

const homeBuildBeforeSnapshotEnvelope = {
  schema: 1,
  cursor: 4,
  oldest_cursor: 0,
  next_cursor: 6,
  events: [
    eventEntry(
      5,
      'home_built',
      'agent_001',
      {
        home_id: 'home_003',
        target_home: 'home_003',
        builder_id: 'agent_001',
        owner_id: 'agent_001',
        region: 'warm_springs',
        materials_cost: 80,
        integrity: 120,
      },
      { actor_id: 'agent_001', region: 'warm_springs', home_id: 'home_003' },
    ),
  ],
  overflow: false,
  snapshot_required: false,
};

const homeBuildSnapshotPulse = {
  schema: 1,
  cursor: 5,
  oldest_cursor: 0,
  next_cursor: 6,
  events: [],
  overflow: false,
  snapshot_required: true,
};

const worldWithStagedBuiltHome = {
  ...world,
  world_time: 19.8,
  event_cursor: 6,
  homes: [...world.homes, stagedBuiltHome],
};

const denseNames = [
  'Aster',
  'Briar',
  'Cinder',
  'Dawn',
  'Eira',
  'Fenn',
  'Galen',
  'Hale',
  'Iris',
  'Jory',
  'Kael',
  'Liora',
  'Mira',
  'Nessa',
  'Orin',
  'Perrin',
  'Rowan',
  'Sable',
];

const denseAgents = denseNames.map((name, index) => ({
  ...world.agents[index % world.agents.length],
  id: `agent_${String(index + 1).padStart(3, '0')}`,
  name,
  persona: index % 4 === 0 ? 'builder' : index % 4 === 1 ? 'keeper' : index % 4 === 2 ? 'scout' : 'gatherer',
  position: 'warm_springs',
  energy: 42 + index * 3,
  materials: 8 + index,
  status: index % 11 === 0 ? 'paralyzed' : 'alive',
  home_id: `home_dense_${String((index % 24) + 1).padStart(3, '0')}`,
  is_hoarding: index % 9 === 0,
}));

const denseHomes = Array.from({ length: 24 }, (_, index) => {
  const ownerId = `agent_${String((index % denseAgents.length) + 1).padStart(3, '0')}`;
  return {
    ...world.homes[0],
    home_id: `home_dense_${String(index + 1).padStart(3, '0')}`,
    owner_id: ownerId,
    region: 'warm_springs',
    integrity: 120 - (index % 5) * 9,
    max_integrity: index % 3 === 0 ? 150 : 120,
    built_at: 4 + index,
    last_upkeep_at: 12 + index,
    last_integrity_at: 12 + index,
    stakeholders: index % 3 === 0
      ? [ownerId, `agent_${String(((index + 5) % denseAgents.length) + 1).padStart(3, '0')}`]
      : [ownerId],
    vault_materials: index % 4 === 0 ? 330 : 18 + index * 3,
    breachers: index % 7 === 0 ? ['agent_003'] : [],
    is_hoarding: index % 4 === 0,
  };
});

const denseRuins = Array.from({ length: 8 }, (_, index) => ({
  ...world.ruins[0],
  home_id: `ruin_dense_${String(index + 1).padStart(3, '0')}`,
  owner_id: `agent_${String(((index + 9) % denseAgents.length) + 1).padStart(3, '0')}`,
  region: 'warm_springs',
  ruined_at: 20 + index,
  remnant_materials: 12 + index * 6,
  breachers: [],
}));

const denseWorld = {
  ...world,
  world_time: 55,
  event_cursor: 4,
  agents: denseAgents,
  regions: world.regions.map((region) =>
    region.name === 'warm_springs'
      ? { ...region, current_energy: 126, current_materials: 128, max_energy: 150, max_materials: 150 }
      : region,
  ),
  homes: denseHomes,
  ruins: denseRuins,
  pending_proposals: [],
};

const denseWorldAfterSweep = {
  ...denseWorld,
  world_time: 58,
  event_cursor: 5,
  agents: denseAgents.filter((_, index) => index % 5 !== 1),
  homes: denseHomes.filter((_, index) => index % 4 !== 0),
  ruins: denseRuins.slice(1),
};

const denseSnapshotPulse = {
  schema: 1,
  cursor: 4,
  oldest_cursor: 0,
  next_cursor: 5,
  events: [],
  overflow: false,
  snapshot_required: true,
};

const denseWestHomes = Array.from({ length: 9 }, (_, index) => {
  const ownerId = `agent_west_${String(index + 1).padStart(3, '0')}`;
  return {
    ...world.homes[0],
    home_id: `home_west_dense_${String(index + 1).padStart(3, '0')}`,
    owner_id: ownerId,
    region: 'nirvana_west',
    integrity: 96 - (index % 4) * 8,
    max_integrity: index % 2 === 0 ? 150 : 120,
    stakeholders: [ownerId],
    vault_materials: index % 3 === 0 ? 310 : 10 + index,
    breachers: [],
    is_hoarding: index % 3 === 0,
  };
});

const denseWestRuins = Array.from({ length: 5 }, (_, index) => ({
  ...world.ruins[0],
  home_id: `ruin_west_dense_${String(index + 1).padStart(3, '0')}`,
  owner_id: `agent_west_${String(index + 10).padStart(3, '0')}`,
  region: 'nirvana_west',
  remnant_materials: 20 + index * 8,
  breachers: [],
}));

const denseSmallIslandWorld = {
  ...world,
  world_time: 62,
  event_cursor: 4,
  agents: Array.from({ length: 10 }, (_, index) => ({
    ...world.agents[index % world.agents.length],
    id: `agent_west_${String(index + 1).padStart(3, '0')}`,
    name: index === 0 ? 'Aster' : `West keeper ${index + 1}`,
    position: 'nirvana_west',
    status: 'alive',
    home_id: `home_west_dense_${String((index % denseWestHomes.length) + 1).padStart(3, '0')}`,
  })),
  homes: denseWestHomes,
  ruins: denseWestRuins,
  pending_proposals: [],
};

const denseDistributedWorld = {
  ...denseWorld,
  agents: [
    ...denseWorld.agents,
    ...denseSmallIslandWorld.agents,
  ],
  homes: [
    ...denseWorld.homes,
    ...denseSmallIslandWorld.homes,
  ],
  ruins: [
    ...denseWorld.ruins,
    ...denseSmallIslandWorld.ruins,
  ],
};

async function cameraState(page) {
  return page.evaluate(() => window.__vivariumWorld.cameraState());
}

async function corePanelOverlaps(page) {
  return page.evaluate(() => {
    const selectors = ['.top-hud', '.replay-preview', '.archive-chronicle', '.presence-rail', '.chronicle', '.inspector'];
    const boxes = selectors.flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [];
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return [];
      return [{ selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }];
    });
    const collisions = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        if (overlap) collisions.push(`${a.selector}/${b.selector}`);
      }
    }
    return collisions;
  });
}

async function viewportLayoutIssues(page) {
  return page.evaluate(() => {
    const issues = [];
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const documentOverflow = Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body.scrollWidth - document.body.clientWidth,
    );
    const scrollingElement = document.scrollingElement || document.documentElement;
    const documentStyle = getComputedStyle(scrollingElement);
    if (documentOverflow > 1) {
      issues.push(`document horizontal overflow ${documentOverflow}px`);
    }

    const boundedSelectors = ['.top-hud', '.world-stage', '.replay-preview', '.archive-chronicle', '.presence-rail', '.chronicle', '.inspector'];
    for (const selector of boundedSelectors) {
      const element = document.querySelector(selector);
      if (!element) continue;
      if (element.closest('.atlas-surface-content')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.left < -1 || rect.right > viewport.width + 1 || rect.top < -1 || rect.bottom > viewport.height + 1) {
        issues.push(
          `${selector} outside viewport ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.right)}x${Math.round(rect.bottom)}`,
        );
      }
    }

    const criticalTextSelectors = [
      '.top-hud',
      '.top-hud .brand-mark',
      '.top-hud .hud-chip',
      '.top-hud .connection-pill',
      '.top-hud .connection-label',
      '.replay-preview-heading',
      '.replay-preview-point dd',
      '.archive-chronicle .panel-title',
      '.archive-chronicle .event-medallion',
      '.archive-chronicle .event-type',
      '.archive-chronicle .event-row time',
      '.inspector-recent .event-summary-detail',
      '.inspector-recent .event-summary-chain',
      '.chronicle .event-medallion',
      '.chronicle .live-pulse-head',
      '.chronicle .live-pulse-head b',
      '.chronicle .live-pulse-head em',
      '.chronicle .live-pulse-group',
      '.chronicle .live-pulse-group-label',
      '.chronicle .live-pulse-group b',
      '.chronicle .live-pulse-footer span',
      '.chronicle .live-pulse-latest',
      '.chronicle .live-pulse-latest span',
      '.chronicle .live-now-head',
      '.chronicle .live-now-head b',
      '.chronicle .live-now-cue',
      '.chronicle .live-now-slot',
      '.chronicle .live-now-cue b',
      '.chronicle .world-condition-head',
      '.chronicle .world-condition-head b',
      '.chronicle .world-condition-head em',
      '.chronicle .world-condition-metric',
      '.chronicle .world-condition-label',
      '.chronicle .world-condition-metric b',
      '.chronicle .event-row-header',
      '.chronicle .event-group',
      '.chronicle .event-row time',
      '.timeline-strip > span',
      '.timeline-strip dl',
      '.timeline-strip dd',
      '.archive-point-scrubber span',
      '.archive-point-scrubber b',
      '.live-status-strip',
      '.live-status-strip b',
      '.live-status-strip p',
      '.live-status-strip > span',
      '.inspector-recent .event-medallion',
      '.inspector .focus-pulse-head',
      '.inspector .focus-pulse-head b',
      '.inspector .focus-pulse-head em',
      '.inspector .focus-pulse-group',
      '.inspector .focus-pulse-group-label',
      '.inspector .focus-pulse-group b',
      '.inspector .focus-pulse-latest',
      '.inspector .focus-pulse-latest-copy',
      '.inspector .focus-pulse-latest-copy span',
      '.inspector .focus-pulse-latest-copy small',
      '.inspector .focus-pulse-latest em',
      '.inspector .focus-pulse p',
      '.inspector-recent .event-summary-header',
      '.inspector-recent .event-summary p',
      '.inspector .fact-pill span',
      '.inspector .fact-pill b',
    ];
    for (const selector of criticalTextSelectors) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const horizontalClip = element.scrollWidth > element.clientWidth + 1;
        const verticalClip = element.scrollHeight > element.clientHeight + 1;
        if (!horizontalClip && !verticalClip) continue;
        const text = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 72);
        issues.push(
          `${selector} clipped "${text}" scroll=${element.scrollWidth}x${element.scrollHeight} client=${element.clientWidth}x${element.clientHeight}`,
        );
      }
    }

    return issues;
  });
}

async function retainedLiveSurfaceLayoutIssues(page) {
  return page.evaluate(() => {
    const issues = [];
    const documentOverflow = Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body.scrollWidth - document.body.clientWidth,
    );
    if (documentOverflow > 1) {
      issues.push(`document horizontal overflow ${documentOverflow}px`);
    }

    const retainedTextSelectors = [
      '.chronicle .event-row-header',
      '.chronicle .event-type',
      '.chronicle .event-group',
      '.chronicle .event-row time',
      '.chronicle .live-pulse-head',
      '.chronicle .live-pulse-head b',
      '.chronicle .live-pulse-footer span',
      '.chronicle .live-pulse-latest',
      '.chronicle .live-pulse-latest span',
      '.chronicle .live-now-head',
      '.chronicle .live-now-head b',
      '.chronicle .live-now-cue',
      '.chronicle .live-now-slot',
      '.chronicle .live-now-cue b',
      '.inspector .focus-pulse-head',
      '.inspector .focus-pulse-head b',
      '.inspector .focus-pulse-head em',
      '.inspector .focus-pulse-latest',
      '.inspector .focus-pulse-latest-copy',
      '.inspector .focus-pulse-latest-copy span',
      '.inspector .focus-pulse-latest-copy small',
      '.inspector .focus-pulse-latest em',
    ];

    for (const selector of retainedTextSelectors) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) {
          issues.push(`${selector} hidden or empty`);
          continue;
        }
        const horizontalClip = element.scrollWidth > element.clientWidth + 1;
        const verticalClip = element.scrollHeight > element.clientHeight + 1;
        if (!horizontalClip && !verticalClip) continue;
        const text = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 72);
        issues.push(
          `${selector} clipped "${text}" scroll=${element.scrollWidth}x${element.scrollHeight} client=${element.clientWidth}x${element.clientHeight}`,
        );
      }
    }

    return issues;
  });
}

async function chronicleLegibilityState(page) {
  return page.evaluate(() => {
    const documentOverflow = Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body.scrollWidth - document.body.clientWidth,
    );
    const chronicle = document.querySelector('.chronicle');
    const eventList = chronicle?.querySelector('.event-list') ?? null;
    const chronicleStyle = chronicle ? getComputedStyle(chronicle) : null;
    const eventListStyle = eventList ? getComputedStyle(eventList) : null;
    const rows = Array.from(document.querySelectorAll('.chronicle .event-row[data-event-kind="event"]'));
    const actions = Array.from(document.querySelectorAll('.chronicle .event-row-action'));
    return {
      documentOverflow,
      chronicleGridRowCount: chronicleStyle?.gridTemplateRows.split(/\s+/).filter(Boolean).length ?? 0,
      chronicleChildCount: chronicle ? Array.from(chronicle.children).filter((child) => getComputedStyle(child).display !== 'none').length : 0,
      eventList: eventList ? {
        isLastChild: eventList === chronicle?.lastElementChild,
        minHeight: eventListStyle?.minHeight,
        overflowY: eventListStyle?.overflowY,
        clientHeight: eventList.clientHeight,
        scrollHeight: eventList.scrollHeight,
      } : null,
      rows: rows.map((row) => ({
        type: row.getAttribute('data-event-type'),
        group: row.getAttribute('data-event-group'),
        tone: row.getAttribute('data-event-tone'),
        cursor: row.getAttribute('data-event-cursor'),
        headerDisplay: getComputedStyle(row.querySelector('.event-row-header')).display,
        clipped: Array.from(row.querySelectorAll('.event-row-header, .event-group, time')).some(
          (element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
        ),
      })),
      buttonCount: document.querySelectorAll('.chronicle button').length,
      actionCount: actions.length,
      malformedActionCount: actions.filter((action) => (
        !action.closest('.event-row[data-event-kind="event"]') ||
        !action.getAttribute('data-event-focus-kind') ||
        !action.getAttribute('data-event-focus-id')
      )).length,
      gapActionCount: document.querySelectorAll('.chronicle .event-gap .event-row-action').length,
    };
  });
}

function expectChronicleLegible(chronicleState) {
  expect(chronicleState.buttonCount).toBe(chronicleState.actionCount);
  expect(chronicleState.actionCount).toBeGreaterThan(0);
  expect(chronicleState.malformedActionCount).toBe(0);
  expect(chronicleState.gapActionCount).toBe(0);
  expect(chronicleState.chronicleGridRowCount).toBeGreaterThanOrEqual(chronicleState.chronicleChildCount);
  expect(chronicleState.eventList).toMatchObject({
    isLastChild: true,
    minHeight: '0px',
    overflowY: 'auto',
  });
  expect(chronicleState.eventList.clientHeight).toBeGreaterThan(0);
  expect(chronicleState.eventList.scrollHeight).toBeGreaterThanOrEqual(chronicleState.eventList.clientHeight);
  expect(chronicleState.rows.length).toBeGreaterThanOrEqual(6);
  expect([...new Set(chronicleState.rows.map((row) => row.group))]).toEqual(
    expect.arrayContaining(['contest', 'home', 'life']),
  );
  for (const row of chronicleState.rows) {
    expect(row.type).toBeTruthy();
    expect(row.group).toBeTruthy();
    expect(row.tone).toBeTruthy();
    expect(Number(row.cursor)).toBeGreaterThan(0);
    expect(row.headerDisplay).toBe('grid');
    expect(row.clipped).toBe(false);
  }
}

function currentChronicleRow(page, cursor) {
  return page.locator(
    `.chronicle .event-row[data-event-kind="event"][data-event-cursor="${cursor}"][data-current="true"]`,
  );
}

async function initialAtlasFramingState(page) {
  return page.evaluate((regionNames) => {
    const canvas = document.querySelector('[data-testid="vivarium-world-canvas"]');
    const canvasRect = canvas.getBoundingClientRect();
    const hudRect = document.querySelector('.top-hud')?.getBoundingClientRect();
    const ribbonRect = document.querySelector('.story-ribbon')?.getBoundingClientRect();
    const edgeRect = document.querySelector('.atlas-edge-controls')?.getBoundingClientRect();
    const usable = {
      left: canvasRect.left + 8,
      top: Math.max(canvasRect.top + 8, (hudRect?.bottom ?? canvasRect.top) + 8),
      right: Math.min(canvasRect.right - 8, (edgeRect?.left ?? canvasRect.right) - 8),
      bottom: Math.min(canvasRect.bottom - 8, (ribbonRect?.top ?? canvasRect.bottom) - 8),
    };
    const points = regionNames.map((name) => ({
      name,
      point: window.__vivariumWorld.screenPointForRegion(name),
    }));
    const crossingPoints = [];
    window.__viv.scene.traverse((object) => {
      if (!object.name?.startsWith('crossing:')) return;
      const point = object.position.clone();
      object.getWorldPosition(point);
      point.project(window.__viv.camera);
      crossingPoints.push({
        name: object.name,
        x: canvasRect.left + ((point.x + 1) / 2) * canvasRect.width,
        y: canvasRect.top + ((-point.y + 1) / 2) * canvasRect.height,
      });
    });
    const labelRects = Array.from(document.querySelectorAll('.viv-region-label')).map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        text: node.textContent?.trim() ?? '',
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
      };
    });
    const finitePoints = points.map(({ point }) => point).filter(Boolean);
    const bounds = finitePoints.length > 0 ? {
      left: Math.min(...finitePoints.map((point) => point.x)),
      right: Math.max(...finitePoints.map((point) => point.x)),
      top: Math.min(...finitePoints.map((point) => point.y)),
      bottom: Math.max(...finitePoints.map((point) => point.y)),
    } : null;
    const inside = (point) => point && (
      point.x >= usable.left && point.x <= usable.right &&
      point.y >= usable.top && point.y <= usable.bottom
    );
    const rectInside = (rect) => (
      rect.left >= usable.left && rect.right <= usable.right &&
      rect.top >= usable.top && rect.bottom <= usable.bottom
    );
    const usableWidth = Math.max(1, usable.right - usable.left);
    const usableHeight = Math.max(1, usable.bottom - usable.top);
    const camera = window.__viv.camera;
    const controls = window.__viv.controls;
    const fog = window.__viv.scene.fog;
    return {
      usable,
      points,
      crossingPoints,
      labelRects,
      allCentroidsInside: points.every(({ point }) => inside(point)),
      allCrossingsInside: crossingPoints.every(inside),
      allLabelsInside: labelRects.every(rectInside),
      occupancy: bounds ? Math.max(
        (bounds.right - bounds.left) / usableWidth,
        (bounds.bottom - bounds.top) / usableHeight,
      ) : 0,
      view: {
        distance: camera.position.distanceTo(controls.target),
        cameraFar: camera.far,
        fogNear: fog?.near ?? null,
        fogFar: fog?.far ?? null,
      },
    };
  }, world.regions.map((region) => region.name));
}

async function focusedSubjectFrameState(page, focusKind, focusId) {
  return page.evaluate(({ kind, id }) => {
    const canvas = document.querySelector('[data-testid="vivarium-world-canvas"]').getBoundingClientRect();
    const surface = document.querySelector('[data-atlas-surface][data-open="true"]').getBoundingClientRect();
    const point = kind === 'home'
      ? window.__vivariumWorld.screenPointForHome(id)
      : kind === 'agent'
        ? window.__vivariumWorld.screenPointForAgent(id)
        : window.__vivariumWorld.screenPointForRegion(id);
    const intersection = {
      left: Math.max(canvas.left, surface.left),
      right: Math.min(canvas.right, surface.right),
      top: Math.max(canvas.top, surface.top),
      bottom: Math.min(canvas.bottom, surface.bottom),
    };
    intersection.width = Math.max(0, intersection.right - intersection.left);
    intersection.height = Math.max(0, intersection.bottom - intersection.top);
    const orientation = intersection.width / canvas.width > 0.6 ? 'bottom' : 'right';
    const safe = orientation === 'bottom'
      ? { left: canvas.left, right: canvas.right, top: canvas.top, bottom: intersection.top }
      : { left: canvas.left, right: intersection.left, top: canvas.top, bottom: canvas.bottom };
    return { canvas, surface, intersection, orientation, safe, point };
  }, { kind: focusKind, id: focusId });
}

test('production app lazy-loads World presence on intent without replacing the live stage', async ({ page }) => {
  let releaseWorldPresence;
  let markWorldPresenceRequested;
  let worldPresenceRequestCount = 0;
  const holdWorldPresence = new Promise((resolve) => {
    releaseWorldPresence = resolve;
  });
  const worldPresenceRequested = new Promise((resolve) => {
    markWorldPresenceRequested = resolve;
  });
  await page.route('**/src/app/livingAtlas/WorldPresencePanel.tsx*', async (route) => {
    worldPresenceRequestCount += 1;
    markWorldPresenceRequested();
    await holdWorldPresence;
    await route.continue();
  });

  const source = await bootApp(page);
  const startupResources = await page.evaluate(() => (
    performance.getEntriesByType('resource').map((entry) => entry.name)
  ));
  expect(startupResources.some((name) => name.includes('eventDemoSource'))).toBe(false);
  expect(startupResources.some((name) => (
    new URL(name).pathname.endsWith('/WorldPresencePanel.tsx')
  ))).toBe(false);
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(0);
  const canvas = await page.locator('[data-testid="vivarium-world-canvas"]').elementHandle();
  const artifactRequestsBeforeIntent = { ...source.artifactRequestCounts };

  const trigger = page.getByRole('button', { name: 'Open world — World Beings & land', exact: true });
  await trigger.focus();
  await worldPresenceRequested;
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(0);
  expect(worldPresenceRequestCount).toBe(1);
  expect(source.artifactRequestCounts).toEqual(artifactRequestsBeforeIntent);

  await trigger.click();
  await expect(page.locator('[data-atlas-surface]')).toHaveAttribute('data-atlas-surface', 'world');
  await expect(page.getByTestId('world-presence-loading')).toBeVisible();
  await expect(page.getByTestId('world-presence-loading')).toHaveAttribute('aria-busy', 'true');
  const pendingGeometry = await page.evaluate(() => {
    const values = {};
    for (const [key, selector] of Object.entries({
      drawer: '[data-atlas-surface][data-open="true"]',
      content: '.atlas-surface-content',
      presence: '.presence-rail',
      inspector: '.atlas-world-content > .inspector',
    })) {
      const rect = document.querySelector(selector).getBoundingClientRect();
      values[key] = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
      };
    }
    return values;
  });
  expect(await canvas.evaluate((node) => (
    node.isConnected && node === document.querySelector('[data-testid="vivarium-world-canvas"]')
  ))).toBe(true);

  releaseWorldPresence();
  await expect(page.locator('.presence-rail')).toContainText('Aster');
  await expect(page.getByTestId('world-condition')).toBeVisible();
  await expect(page.getByTestId('world-presence-loading')).toHaveCount(0);
  expect(worldPresenceRequestCount).toBe(1);
  const settledGeometry = await page.evaluate(() => {
    const values = {};
    for (const [key, selector] of Object.entries({
      drawer: '[data-atlas-surface][data-open="true"]',
      content: '.atlas-surface-content',
      presence: '.presence-rail',
      inspector: '.atlas-world-content > .inspector',
    })) {
      const rect = document.querySelector(selector).getBoundingClientRect();
      values[key] = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
      };
    }
    return values;
  });
  for (const key of Object.keys(pendingGeometry)) {
    for (const metric of Object.keys(pendingGeometry[key])) {
      expect(
        Math.abs(pendingGeometry[key][metric] - settledGeometry[key][metric]),
        `${key}.${metric} must not shift when World presence settles`,
      ).toBeLessThanOrEqual(1);
    }
  }
  const settledResources = await page.evaluate(() => (
    performance.getEntriesByType('resource').map((entry) => entry.name)
  ));
  expect(settledResources.some((name) => name.includes('eventDemoSource'))).toBe(false);
});

test('production app contains World panel import failures and retries without losing the stage', async ({ page }) => {
  let worldPresenceRequestCount = 0;
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/src/app/livingAtlas/WorldPresencePanel.tsx*', async (route) => {
    worldPresenceRequestCount += 1;
    if (worldPresenceRequestCount === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'text/javascript',
        body: 'throw new Error("World presence test chunk unavailable")',
      });
      return;
    }
    await route.continue();
  });

  await bootApp(page);
  const canvas = await page.locator('[data-testid="vivarium-world-canvas"]').elementHandle();
  const trigger = page.getByRole('button', { name: 'Open world — World Beings & land', exact: true });

  await trigger.focus();
  await expect.poll(() => worldPresenceRequestCount).toBe(1);
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);

  await trigger.click();
  await expect(page.getByTestId('world-presence-error')).toBeVisible();
  await expect(page.getByTestId('world-presence-error')).toHaveAttribute('role', 'alert');
  await expect(page.getByRole('button', { name: 'Try reading the world again' })).toBeVisible();
  expect(worldPresenceRequestCount).toBe(1);
  expect(pageErrors).toEqual([]);
  expect(await canvas.evaluate((node) => (
    node.isConnected && node === document.querySelector('[data-testid="vivarium-world-canvas"]')
  ))).toBe(true);

  await page.getByRole('button', { name: 'Try reading the world again' }).click();
  await expect(page.locator('.presence-rail')).toContainText('Aster');
  await expect(page.getByTestId('world-presence-error')).toHaveCount(0);
  expect(worldPresenceRequestCount).toBe(2);
  expect(pageErrors).toEqual([]);
  expect(await canvas.evaluate((node) => (
    node.isConnected && node === document.querySelector('[data-testid="vivarium-world-canvas"]')
  ))).toBe(true);
});

test('production app can run the frontend event-demo source without API route mocks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?source=event-demo');
  await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);
  await expect(page.locator('.observatory')).toHaveAttribute('data-source', 'event-demo');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'live');
  await expect(page.locator('.top-hud .hud-chip', { hasText: /Source|Cursor/ })).toHaveCount(0);
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle [data-event-type="home_thieved"]')).toBeVisible({
    timeout: 20_000,
  });
  expect(await page.locator('.chronicle .event-row[data-event-kind="event"]').count()).toBeGreaterThanOrEqual(10);
  await expect(page.locator('.viv-event-bubble')).not.toHaveCount(0);

  const demoState = await page.evaluate(() => ({
    streamUrl: window.__vivariumLiveRun?.diagnostics().stream.url,
    motion: window.__vivariumWorld.motionMode(),
    renderBudget: window.__vivariumWorld.renderBudgetDiagnostics(),
    cursors: Array.from(window.__vivariumWorld.appliedEventCursors()),
    chronicleWidth: document.querySelector('.chronicle')?.getBoundingClientRect().width ?? 0,
    chronicleHeight: document.querySelector('.chronicle')?.getBoundingClientRect().height ?? 0,
  }));
  expect(demoState.streamUrl).toContain('event-demo://events/stream?cursor=0');
  expect(demoState.motion).toMatchObject({ mode: 'reduced', reduced: true, source: 'option' });
  expect(demoState.renderBudget.maxActiveEffectCount).toBeLessThanOrEqual(36);
  expect(demoState.renderBudget.activeEffectObjectCount).toBeLessThanOrEqual(20);
  expect(demoState.cursors.length).toBeGreaterThanOrEqual(10);
  expect(demoState.chronicleWidth).toBeGreaterThanOrEqual(340);
  expect(demoState.chronicleHeight).toBeGreaterThan(132);
  expectAtlasSurfaceBounded(await atlasSurfaceBounds(page), 'event-demo Chronicle');

  await openAtlasSurface(page, 'world');
  const worldSurfaceState = await page.evaluate(() => {
    const inspector = document.querySelector('.inspector');
    const content = document.querySelector('.atlas-surface-content');
    return {
      inspectorHeight: inspector?.getBoundingClientRect().height ?? 0,
      contentClientHeight: content?.clientHeight ?? 0,
      contentScrollHeight: content?.scrollHeight ?? 0,
    };
  });
  expect(worldSurfaceState.inspectorHeight).toBeGreaterThan(132);
  expect(worldSurfaceState.contentScrollHeight).toBeGreaterThanOrEqual(
    worldSurfaceState.contentClientHeight,
  );
  expectAtlasSurfaceBounded(await atlasSurfaceBounds(page), 'event-demo World');
});

test('production app fills every viewport with closed atlas surfaces by default', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 1498, height: 265 },
    { width: 1440, height: 560 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/?source=event-demo');
    await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);

    const state = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="world-stage"]').getBoundingClientRect();
      return {
        stage: {
          width: stage.width,
          height: stage.height,
        },
        viewport: { width: innerWidth, height: innerHeight },
        bodyScroll:
          document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
        openSurfaces: document.querySelectorAll(
          '[data-atlas-surface][data-open="true"]',
        ).length,
      };
    });

    expect(state.stage.width, `${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(
      state.viewport.width - 1,
    );
    expect(state.stage.height, `${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(
      state.viewport.height - 1,
    );
    expect(state.bodyScroll, `${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
    expect(state.openSurfaces, `${viewport.width}x${viewport.height}`).toBe(0);
  }
});

test('production app keeps one atlas surface and restores keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?source=event-demo');
  await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);

  const stage = page.getByTestId('world-stage');
  const worldTrigger = page.getByRole('button', { name: 'Open world' });
  const chronicleTrigger = page.getByRole('button', {
    name: 'Open chronicle — Chronicle Living memory',
    exact: true,
  });
  const surface = page.locator('[data-atlas-surface]');
  await stage.evaluate((node) => { window.__task4MountedStage = node; });

  await expect(surface).toHaveAttribute('data-open', 'false');
  await worldTrigger.click();
  await expect(surface).toHaveAttribute('data-atlas-surface', 'world');
  await expect(surface).toHaveAttribute('data-open', 'true');
  await expect(surface).toHaveAttribute('role', 'complementary');
  await expect(worldTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(1);
  await expect(page.locator('#living-atlas-surface-heading')).toBeFocused();
  await expect(stage).toHaveAttribute('tabindex', '0');
  await stage.focus();
  await expect(stage).toBeFocused();

  await chronicleTrigger.click();
  await expect(surface).toHaveAttribute('data-atlas-surface', 'chronicle');
  await expect(worldTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(chronicleTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(1);
  expect(await stage.evaluate((node) => window.__task4MountedStage === node)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(surface).toHaveAttribute('data-open', 'false');
  await expect(chronicleTrigger).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => matchMedia('(max-width: 700px), (max-height: 420px)').matches);
  await chronicleTrigger.click();
  await expect(surface).toHaveAttribute('role', 'dialog');
  await expect(surface).toHaveAttribute('aria-modal', 'true');
  await expect(surface).toHaveAttribute('data-presentation', 'sheet');
  await expect(page.locator('#living-atlas-surface-heading')).toBeFocused();

  const targets = await page.locator('.atlas-edge-trigger, .atlas-surface-close').evaluateAll(
    (nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
  );
  for (const target of targets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close chronicle' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.chronicle .event-row-action').first()).toBeFocused();
  await page.locator('.chronicle .event-row-action').last().focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close chronicle' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(chronicleTrigger).toBeFocused();
});

test('production app exposes Archive only when replay metadata can own the sole surface', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?source=event-demo');
  await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);

  await expect(page.getByRole('button', { name: 'Open archive' })).toHaveCount(0);
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(0);

  await bootApp(page, { width: 1440, height: 900 });
  const archiveTrigger = page.getByRole('button', { name: 'Open archive' });
  await expect(archiveTrigger).toBeVisible();
  await expect(archiveTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(0);

  await openAtlasSurface(page, 'archive');
  await expect(page.getByTestId('replay-preview')).toBeVisible();
  await expect(page.getByTestId('archive-chronicle')).toBeVisible();
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(1);
  expectAtlasSurfaceBounded(await atlasSurfaceBounds(page), 'Archive surface');
});

test('production app keeps one authoritative stage while Archive switches exact world points and live advances', async ({ page }) => {
  const archiveWorld = {
    ...world,
    agents: world.agents.map((agent) => (
      agent.id === 'agent_001' ? { ...agent, name: 'Archive Aster' } : agent
    )),
  };
  const archiveWithoutCinder = {
    ...archiveWorld,
    agents: archiveWorld.agents.filter((agent) => agent.id !== 'agent_003'),
  };
  const archiveArtifacts = {
    events: replayArtifactBodies.events,
    snapshots: [
      replayCheckpointRecord({ ...archiveWorld, event_cursor: 2, world_time: 16 }, 'manual'),
      replayCheckpointRecord({ ...archiveWithoutCinder, event_cursor: 3, world_time: 20 }, 'world_tick'),
    ].map((record) => JSON.stringify(record)).join('\n'),
  };

  await bootApp(page, { width: 1440, height: 900 }, envelope, world, run, archiveArtifacts);
  const stage = page.getByTestId('world-stage');
  await stage.evaluate((node) => { window.__task6Stage = node; });
  const liveBounds = await stage.boundingBox();
  await expect(stage).toHaveAttribute('data-stage-source', 'live');
  await expect(page.locator('.observer-source-pill')).toHaveCount(0);
  await expect(stage.locator('canvas')).toHaveCount(1);
  await expect(page.getByTestId('replay-preview-stage')).toHaveCount(0);
  await expect(page.getByTestId('vivarium-preview-canvas')).toHaveCount(0);
  expect(await page.evaluate(() => '__vivariumPreviewWorld' in window)).toBe(false);

  await openAtlasSurface(page, 'archive');
  await expect(stage).toHaveAttribute('data-stage-source', 'archive');
  await expect(page.locator('.observer-source-pill')).toHaveAttribute('data-observer-source', 'archive');
  await expect(page.locator('.observer-source-pill')).toContainText('Archive view');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'live');
  expect(await stage.evaluate((node) => window.__task6Stage === node)).toBe(true);
  expect(await stage.boundingBox()).toEqual(liveBounds);
  await expect(stage.locator('canvas')).toHaveCount(1);
  await expect(page.locator('.story-ribbon')).toHaveCount(0);
  await expect(page.locator('.viv-event-bubble')).toHaveCount(0);
  await page.waitForFunction(() => (
    window.__vivariumWorld?.agentVisualState('agent_003') === null
    && window.__vivariumWorld?.appliedEventCursors().includes(3)
  ));

  await page.getByTestId('archive-point-selector').selectOption('line:1');
  await expect(page.getByTestId('archive-point-selector')).toHaveValue('line:1');
  await page.waitForFunction(() => (
    window.__vivariumWorld?.agentVisualState('agent_003') !== null
    && window.__vivariumWorld?.appliedEventCursors().includes(2)
  ));
  await expect(stage).toHaveAttribute('data-stage-source', 'archive');
  expect(await stage.evaluate((node) => window.__task6Stage === node)).toBe(true);
  await expect(stage.locator('canvas')).toHaveCount(1);

  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), {
    schema: 1,
    cursor: 5,
    oldest_cursor: 0,
    next_cursor: 7,
    events: [eventEntry(
      6,
      'speak',
      'agent_001',
      { speaker_id: 'agent_001', message: 'The living world continues beyond the archive.' },
      { actor_id: 'agent_001', region: 'warm_springs' },
    )],
    overflow: false,
    snapshot_required: false,
  });
  await page.waitForFunction(() => window.__vivariumLiveRun?.diagnostics?.().eventCursor === 7);
  expect(await page.evaluate(() => window.__vivariumWorld.appliedEventCursors())).not.toContain(6);

  await page.getByRole('button', { name: 'Close archive', exact: true }).click();
  await expect(stage).toHaveAttribute('data-stage-source', 'live');
  await expect(page.locator('.observer-source-pill')).toHaveCount(0);
  expect(await stage.evaluate((node) => window.__task6Stage === node)).toBe(true);
  expect(await stage.boundingBox()).toEqual(liveBounds);
  await expect(stage.locator('canvas')).toHaveCount(1);
  await page.waitForFunction(() => (
    window.__vivariumWorld?.agentVisualState('agent_003') !== null
    && window.__vivariumWorld?.appliedEventCursors().includes(6)
  ));
  expect(await page.evaluate(() => window.__vivariumWorld.appliedEventCursors())).not.toContain(2);
  expect(await page.evaluate(() => window.__vivariumWorld.appliedEventCursors())).not.toContain(3);
});

test('production app returns focus to the stage after renderer-created Selection closes', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 });
  const stage = page.getByTestId('world-stage');
  const point = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_001'));

  await page.mouse.click(point.x, point.y);
  const surface = page.locator('[data-atlas-surface]');
  await expect(surface).toHaveAttribute('data-atlas-surface', 'selection');
  await expect(surface).toHaveAttribute('data-open', 'true');
  await expect(page.locator('.inspector strong')).toHaveText('Aster');
  await expect(page.locator('#living-atlas-surface-heading')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(surface).toHaveAttribute('data-open', 'false');
  await expect(stage).toBeFocused();
});

test('production Selection tells being truth and recent trail without World or Archive telemetry', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 });
  const agentPoint = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_001'));

  await page.mouse.click(agentPoint.x, agentPoint.y);
  const selection = page.locator('[data-atlas-surface][data-open="true"]');
  await expect(selection).toHaveAttribute('data-atlas-surface', 'selection');
  await expect(selection.locator('.inspector-heading .eyebrow')).toHaveText('Being');
  await expect(selection.locator('.inspector-heading strong')).toHaveText('Aster');
  await expect(selection.locator('.fact-section', { hasText: 'State' })).toBeVisible();
  await expect(selection.locator('.inspector-recent .eyebrow')).toHaveText('Recent trail');
  await expect(selection.locator('[data-testid="live-status-strip"], .timeline-strip')).toHaveCount(0);

  const selectionCopy = await selection.evaluate((node) => [
    node.innerText,
    ...Array.from(node.querySelectorAll('[title], [aria-label]')).flatMap((item) => [
      item.getAttribute('title') || '',
      item.getAttribute('aria-label') || '',
    ]),
  ].join(' '));
  expect(selectionCopy).not.toMatch(/\b(?:Live state|Live tail|Cursor|Window|Lines|Proof|Preview)\b/i);
  expect(selectionCopy).not.toMatch(/(?:^|[/\\])\S*\.jsonl\b/i);

  await openAtlasSurface(page, 'world');
  const worldSurface = page.locator('[data-atlas-surface][data-open="true"]');
  await expect(worldSurface.getByTestId('live-status-strip')).toBeVisible();
  await expect(worldSurface.locator('.timeline-strip')).toContainText('Cursor');
  await expect(worldSurface.locator('.timeline-strip')).toContainText('Window');
  await expect(worldSurface.locator('.timeline-strip')).toContainText('Lines');
  await expect(worldSurface.locator('.timeline-strip')).toContainText('Proof');
  await expect(worldSurface.locator('.timeline-strip')).toContainText('Preview');

  await openAtlasSurface(page, 'archive');
  const archiveSurface = page.locator('[data-atlas-surface][data-open="true"]');
  await expect(archiveSurface.getByTestId('replay-preview')).toBeVisible();
  await expect(archiveSurface.getByTestId('archive-chronicle')).toBeVisible();
  await expect(archiveSurface.getByTestId('live-status-strip')).toBeVisible();
  await expect(archiveSurface.locator('.timeline-strip')).toBeVisible();
});

test('production app keeps the world full-screen on very short desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1498, height: 265 });
  await page.goto('/?source=event-demo');
  await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);
  await page.waitForFunction(() => window.__vivariumLiveRun?.diagnostics().eventCursor >= 8, null, {
    timeout: 20_000,
  });

  const shellState = await page.evaluate(() => {
    const stage = document.querySelector('[data-testid="world-stage"]').getBoundingClientRect();
    return {
      stage: { width: stage.width, height: stage.height },
      viewport: { width: innerWidth, height: innerHeight },
      bodyScroll:
        document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
      openSurfaces: document.querySelectorAll(
        '[data-atlas-surface][data-open="true"]',
      ).length,
    };
  });

  expect(shellState.stage.width).toBeGreaterThanOrEqual(shellState.viewport.width - 1);
  expect(shellState.stage.height).toBeGreaterThanOrEqual(shellState.viewport.height - 1);
  expect(shellState.bodyScroll).toBeLessThanOrEqual(1);
  expect(shellState.openSurfaces).toBe(0);
});

test('production app keeps event-demo map bubbles readable without clipped labels', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?source=event-demo');
  await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);
  await page.waitForFunction(() => document.querySelectorAll('.viv-event-bubble').length >= 2, null, {
    timeout: 20_000,
  });

  const bubbleState = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll(
      '.viv-event-bubble-text, .viv-event-bubble-detail, .viv-event-bubble-chain',
    ));
    return nodes
      .map((node) => ({
        className: node.className,
        text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
      }))
      .filter((node) => (
        node.scrollWidth > node.clientWidth + 1 ||
        node.scrollHeight > node.clientHeight + 1
      ));
  });

  expect(bubbleState).toEqual([]);
});

test('production app mounts a bounded story ribbon and removes Source and Cursor from the primary HUD', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900, count: 3 },
    { width: 390, height: 844, count: 1 },
    { width: 1498, height: 265, count: 1 },
  ]) {
    await bootApp(page, viewport, burstEnvelope);
    const ribbon = page.locator('.story-ribbon');
    await expect(ribbon).toBeVisible();
    await expect(ribbon.locator('.story-ribbon-beat')).toHaveCount(viewport.count);
    await expect(ribbon).toHaveAttribute('data-story-beat-count', String(viewport.count));
    await expect(page.locator('.top-hud .hud-chip', { hasText: 'Source' })).toHaveCount(0);
    await expect(page.locator('.top-hud .hud-chip', { hasText: 'Cursor' })).toHaveCount(0);
    const targets = await ribbon.locator('.story-ribbon-beat').evaluateAll((nodes) => (
      nodes.map((node) => node.getBoundingClientRect().height)
    ));
    expect(targets.every((height) => height >= 44), `${viewport.width}x${viewport.height}`).toBe(true);
    expect(await corePanelOverlaps(page), `${viewport.width}x${viewport.height}`).toEqual([]);
  }
});

test('production app carries a ribbon cursor through current Chronicle row into matching Selection without recreating the renderer', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, burstEnvelope);
  await page.waitForFunction((cursors) => {
    const applied = new Set(window.__vivariumWorld?.appliedEventCursors?.() ?? []);
    return cursors.every((cursor) => applied.has(cursor));
  }, burstEventCursors);
  const beat = page.locator('.story-ribbon-beat[data-event-focus-kind]').last();
  await expect(beat).toBeVisible();
  const chosen = await beat.evaluate((node) => ({
    cursor: Number(node.getAttribute('data-event-cursor')),
    focusKind: node.getAttribute('data-event-focus-kind'),
    focusId: node.getAttribute('data-event-focus-id'),
  }));
  const before = await page.evaluate(() => {
    window.__task5Canvas = document.querySelector('[data-testid="vivarium-world-canvas"]');
    const budget = window.__vivariumWorld.renderBudgetDiagnostics();
    return {
      applied: window.__vivariumWorld.appliedEventCursors(),
      bubbleCount: document.querySelectorAll('.viv-event-bubble').length,
      entityCount: budget.entityObjectCount,
      staticRebuildCount: budget.staticRebuildCount,
    };
  });

  await beat.click();
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveAttribute('data-atlas-surface', 'chronicle');
  const current = currentChronicleRow(page, chosen.cursor);
  await expect(current).toBeVisible();
  await expect(current).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#living-atlas-surface-heading')).toBeFocused();
  const action = current.locator('.event-row-action');
  await expect(action).toHaveAttribute('data-event-focus-kind', chosen.focusKind);
  await expect(action).toHaveAttribute('data-event-focus-id', chosen.focusId);
  await expect(action.locator('div, p')).toHaveCount(0);
  const rowCount = await page.locator('.chronicle .event-row').count();

  await action.click();
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveAttribute('data-atlas-surface', 'selection');
  await expect(page.getByTestId('selected-focus-activity-pulse')).toHaveAttribute('data-focus-selection-kind', chosen.focusKind);
  await expect(page.getByTestId('selected-focus-activity-pulse')).toHaveAttribute('data-focus-selection-id', chosen.focusId);
  const after = await page.evaluate(() => {
    const budget = window.__vivariumWorld.renderBudgetDiagnostics();
    return {
      sameCanvas: window.__task5Canvas === document.querySelector('[data-testid="vivarium-world-canvas"]'),
      applied: window.__vivariumWorld.appliedEventCursors(),
      bubbleCount: document.querySelectorAll('.viv-event-bubble').length,
      entityCount: budget.entityObjectCount,
      staticRebuildCount: budget.staticRebuildCount,
    };
  });
  expect(after.sameCanvas).toBe(true);
  expect(after.applied).toEqual(before.applied);
  expect(after.entityCount).toBe(before.entityCount);
  expect(after.staticRebuildCount).toBe(before.staticRebuildCount);
  expect(after.bubbleCount).toBeLessThanOrEqual(before.bubbleCount);

  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle .event-row')).toHaveCount(rowCount);
});

test('production app carries a focusable world bubble through the same Chronicle cursor into Selection', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, burstEnvelope);
  await page.waitForFunction((cursors) => {
    const applied = new Set(window.__vivariumWorld?.appliedEventCursors?.() ?? []);
    return cursors.every((cursor) => applied.has(cursor));
  }, burstEventCursors);
  const bubble = page.locator('.viv-event-bubble[data-event-focus-kind]').last();
  await expect(bubble).toBeVisible();
  const chosen = await bubble.evaluate((node) => ({
    cursor: Number(node.getAttribute('data-event-cursor')),
    focusKind: node.getAttribute('data-event-focus-kind'),
    focusId: node.getAttribute('data-event-focus-id'),
  }));
  const before = await page.evaluate(() => ({
    applied: window.__vivariumWorld.appliedEventCursors(),
    entityCount: window.__vivariumWorld.renderBudgetDiagnostics().entityObjectCount,
  }));

  await bubble.click();
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveAttribute('data-atlas-surface', 'chronicle');
  const current = currentChronicleRow(page, chosen.cursor);
  await expect(current).toBeVisible();
  const action = current.locator('.event-row-action');
  await expect(action).toHaveAttribute('data-event-focus-kind', chosen.focusKind);
  await expect(action).toHaveAttribute('data-event-focus-id', chosen.focusId);
  await action.click();

  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveAttribute('data-atlas-surface', 'selection');
  await expect(page.getByTestId('selected-focus-activity-pulse')).toHaveAttribute('data-focus-selection-kind', chosen.focusKind);
  await expect(page.getByTestId('selected-focus-activity-pulse')).toHaveAttribute('data-focus-selection-id', chosen.focusId);
  expect(await page.evaluate(() => window.__vivariumWorld.appliedEventCursors())).toEqual(before.applied);
  expect(await page.evaluate(() => window.__vivariumWorld.renderBudgetDiagnostics().entityObjectCount)).toBe(before.entityCount);
});

test('production app projects focused story subjects into actual right-drawer and bottom-sheet safe frames', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900, orientation: 'right' },
    { width: 390, height: 844, orientation: 'bottom' },
  ]) {
    await bootApp(page, viewport, burstEnvelope);
    const beat = page.locator('.story-ribbon-beat[data-event-focus-kind]').last();
    await expect(beat).toBeVisible();
    const chosen = await beat.evaluate((node) => ({
      focusKind: node.getAttribute('data-event-focus-kind'),
      focusId: node.getAttribute('data-event-focus-id'),
    }));
    await beat.click();
    await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveAttribute('data-atlas-surface', 'chronicle');
    await page.waitForTimeout(950);

    const state = await focusedSubjectFrameState(page, chosen.focusKind, chosen.focusId);
    expect(state.intersection.width, `${viewport.width}x${viewport.height}`).toBeGreaterThan(0);
    expect(state.intersection.height, `${viewport.width}x${viewport.height}`).toBeGreaterThan(0);
    expect(state.orientation, `${viewport.width}x${viewport.height}`).toBe(viewport.orientation);
    expect(state.point.x, `${viewport.width}x${viewport.height} x`).toBeGreaterThanOrEqual(state.safe.left);
    expect(state.point.x, `${viewport.width}x${viewport.height} x`).toBeLessThanOrEqual(state.safe.right);
    expect(state.point.y, `${viewport.width}x${viewport.height} y`).toBeGreaterThanOrEqual(state.safe.top);
    expect(state.point.y, `${viewport.width}x${viewport.height} y`).toBeLessThanOrEqual(state.safe.bottom);
  }
});

test('production app reapplies direct world selection focus after the mobile Selection sheet opens', async ({ page }) => {
  await bootApp(page, { width: 390, height: 844 }, burstEnvelope);
  const canvas = page.getByTestId('vivarium-world-canvas');
  const canvasBox = await canvas.boundingBox();
  const agentPoint = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_001'));
  await canvas.click({
    position: { x: agentPoint.x - canvasBox.x, y: agentPoint.y - canvasBox.y },
    force: true,
  });
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveAttribute('data-atlas-surface', 'selection');
  await page.waitForTimeout(950);

  const state = await focusedSubjectFrameState(page, 'agent', 'agent_001');
  expect(state.orientation).toBe('bottom');
  expect(state.point.x).toBeGreaterThanOrEqual(state.safe.left);
  expect(state.point.x).toBeLessThanOrEqual(state.safe.right);
  expect(state.point.y).toBeGreaterThanOrEqual(state.safe.top);
  expect(state.point.y).toBeLessThanOrEqual(state.safe.bottom);
});

test('production app caps active bubbles by viewport with drama and newer cursor preemption', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900, cursors: [19, 21, 22] },
    { width: 390, height: 844, cursors: [22] },
    { width: 1498, height: 265, cursors: [22] },
  ]) {
    await bootApp(page, viewport, burstEnvelope);
    await page.waitForFunction((cursors) => {
      const applied = new Set(window.__vivariumWorld?.appliedEventCursors?.() ?? []);
      return cursors.every((cursor) => applied.has(cursor));
    }, burstEventCursors);
    await page.waitForFunction((count) => document.querySelectorAll('.viv-event-bubble').length === count, viewport.cursors.length);
    const state = await page.evaluate(() => ({
      bubbles: Array.from(document.querySelectorAll('.viv-event-bubble')).map((node) => ({
        cursor: Number(node.getAttribute('data-event-cursor')),
        priority: node.getAttribute('data-event-priority'),
      })),
      effectBubbleCursors: window.__vivariumWorld.activeEffects()
        .filter((effect) => effect.bubble)
        .map((effect) => effect.bubble.cursor)
        .sort((left, right) => left - right),
      applied: window.__vivariumWorld.appliedEventCursors(),
      diagnostics: window.__vivariumWorld.effectLifecycleDiagnostics(),
    }));
    expect(state.bubbles.map((bubble) => bubble.cursor).sort((left, right) => left - right)).toEqual(viewport.cursors);
    expect(state.effectBubbleCursors).toEqual(viewport.cursors);
    expect(state.bubbles.every((bubble) => bubble.priority === 'drama')).toBe(true);
    expect(state.applied).toEqual(expect.arrayContaining(burstEventCursors));
    expect(state.diagnostics.culledEffectCount).toBeGreaterThan(0);
  }
});

test('production app enforces the compact total-effect budget immediately on resize', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, []);
  const before = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    for (let index = 0; index < 80; index += 1) {
      const cursor = 1000 + index;
      debug.applyEventBeat({
        cursor,
        event: {
          type: 'speak',
          source: 'agent_001',
          payload: { speaker_id: 'agent_001', message: `Resize pressure ${cursor}` },
          scope: 'local',
          region: 'nirvana',
          target: null,
          timestamp: cursor,
        },
        resolved: { actor_id: 'agent_001', region: 'nirvana' },
        snapshot_after: null,
      });
    }
    return {
      budget: debug.renderBudgetDiagnostics(),
      lifecycle: debug.effectLifecycleDiagnostics(),
    };
  });
  expect(before.budget.activeEffectCount).toBeGreaterThan(64);
  expect(before.budget.maxActiveEffectCount).toBe(96);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  const after = await page.evaluate(() => ({
    budget: window.__vivariumWorld.renderBudgetDiagnostics(),
    lifecycle: window.__vivariumWorld.effectLifecycleDiagnostics(),
  }));
  expect(after.budget.maxActiveEffectCount).toBe(64);
  expect(after.budget.activeEffectCount).toBeLessThanOrEqual(after.budget.maxActiveEffectCount);
  expect(after.budget.activeBubbleCount).toBeLessThanOrEqual(1);
  expect(after.lifecycle.culledEffectCount).toBeGreaterThan(before.lifecycle.culledEffectCount);
  expect(after.lifecycle.disposedEffectGeometryCount).toBeGreaterThan(before.lifecycle.disposedEffectGeometryCount);
  expect(after.lifecycle.disposedEffectMaterialCount).toBeGreaterThan(before.lifecycle.disposedEffectMaterialCount);
});

test('production app fits canonical atlas into portrait and very-short default frames and preserves user navigation', async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1498, height: 265 },
  ]) {
    await bootApp(page, viewport, burstEnvelope);
    await expect(page.locator('.story-ribbon')).toBeVisible();
    const frame = await initialAtlasFramingState(page);
    expect(frame.points).toHaveLength(world.regions.length);
    expect(frame.crossingPoints.length, `${viewport.width}x${viewport.height} crossings`).toBeGreaterThan(0);
    expect(frame.labelRects).toHaveLength(world.regions.length);
    expect(frame.allCentroidsInside, `${viewport.width}x${viewport.height} centroids`).toBe(true);
    expect(frame.allCrossingsInside, `${viewport.width}x${viewport.height} crossings`).toBe(true);
    const labelsOutside = frame.labelRects.filter((rect) => (
      rect.left < frame.usable.left || rect.right > frame.usable.right ||
      rect.top < frame.usable.top || rect.bottom > frame.usable.bottom
    ));
    expect(
      labelsOutside,
      `${viewport.width}x${viewport.height} labels ${JSON.stringify({ usable: frame.usable, points: frame.points, occupancy: frame.occupancy })}`,
    ).toEqual([]);
    const labelOverflows = frame.labelRects.filter((rect) => rect.scrollWidth > rect.clientWidth + 1);
    expect(labelOverflows, `${viewport.width}x${viewport.height} label text overflow`).toEqual([]);
    const labelOverlaps = frame.labelRects.flatMap((left, leftIndex) => (
      frame.labelRects.slice(leftIndex + 1).filter((right) => (
        left.left < right.right && left.right > right.left &&
        left.top < right.bottom && left.bottom > right.top
      )).map((right) => [left.text, right.text])
    ));
    expect(labelOverlaps, `${viewport.width}x${viewport.height} label overlap`).toEqual([]);
    expect(frame.occupancy, `${viewport.width}x${viewport.height} occupancy`).toBeGreaterThanOrEqual(0.45);
    expect(frame.occupancy, `${viewport.width}x${viewport.height} occupancy`).toBeLessThanOrEqual(0.75);
    expect(frame.view.cameraFar, `${viewport.width}x${viewport.height} camera far`).toBeGreaterThanOrEqual(frame.view.distance * 2);
    expect(frame.view.fogNear, `${viewport.width}x${viewport.height} fog near`).toBeLessThan(frame.view.distance);
    expect(frame.view.fogFar, `${viewport.width}x${viewport.height} fog far`).toBeGreaterThan(frame.view.distance);
  }

  await bootApp(page, { width: 390, height: 844 }, burstEnvelope);
  const canvasBox = await page.getByTestId('vivarium-world-canvas').boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.45, canvasBox.y + canvasBox.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.68, canvasBox.y + canvasBox.height * 0.48, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -320);
  await page.waitForTimeout(700);
  const navigated = await cameraState(page);
  await page.setViewportSize({ width: 400, height: 820 });
  await page.waitForTimeout(500);
  const afterResize = await cameraState(page);
  expect(afterResize.distance).toBeCloseTo(navigated.distance, 0);
  expect(afterResize.target[0]).toBeCloseTo(navigated.target[0], 0);
  expect(afterResize.target[2]).toBeCloseTo(navigated.target[2], 0);
});

async function expectRetainedSurfaceAttributeCopyClean(page) {
  const retainedCopy = await page.evaluate(() => {
    const retainedAttributes = [
      'data-pulse-retained-event-label',
      'data-pulse-event-label',
      'data-pulse-detail-text',
      'data-pulse-chain-text',
      'data-now-retained-event-label',
      'data-now-label',
      'data-now-detail',
      'data-now-detail-text',
      'data-now-chain-text',
      'data-focus-retained-event-label',
      'data-focus-pulse-event-label',
      'data-focus-pulse-detail-text',
      'data-focus-pulse-chain-text',
      'data-event-detail-text',
      'data-event-chain-text',
    ];
    const selectors = retainedAttributes.map((attribute) => `[${attribute}]`).join(',');
    return Array.from(document.querySelectorAll(selectors))
      .flatMap((node) => retainedAttributes.map((attribute) => node.getAttribute(attribute)).filter(Boolean))
      .join(' ');
  });
  expect(retainedCopy).not.toMatch(/agent_|home_|simulation|provider|model|run_|llm|npc|spawn|prompt/i);
}

async function selectedInspectorRecentSurfaceState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.inspector-recent');
    const documentOverflow = Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body.scrollWidth - document.body.clientWidth,
    );
    const scrollingElement = document.scrollingElement || document.documentElement;
    const documentStyle = getComputedStyle(scrollingElement);
    if (!root) {
      return {
        exists: false,
        documentOverflow,
        controlCount: 0,
        clipped: [],
        documentOverflowY: documentStyle.overflowY,
        documentClientHeight: scrollingElement.clientHeight,
        documentScrollHeight: scrollingElement.scrollHeight,
        inspectorOverflowY: null,
        inspectorClientHeight: 0,
        inspectorScrollHeight: 0,
        surfaceOverflowY: null,
        surfaceClientHeight: 0,
        surfaceScrollHeight: 0,
        overflowY: null,
        clientHeight: 0,
        scrollHeight: 0,
        rows: [],
      };
    }

    const inspector = document.querySelector('.inspector');
    const inspectorStyle = inspector ? getComputedStyle(inspector) : null;
    const surface = document.querySelector('.atlas-surface-content');
    const surfaceStyle = surface ? getComputedStyle(surface) : null;
    const rootStyle = getComputedStyle(root);
    const clipped = [];
    for (const selector of [
      '.event-summary-detail',
      '.event-summary-chain',
      '.event-summary-header',
      '.event-summary p',
    ]) {
      for (const element of Array.from(root.querySelectorAll(selector))) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          continue;
        }
        const horizontalClip = element.scrollWidth > element.clientWidth + 1;
        const verticalClip = element.scrollHeight > element.clientHeight + 1;
        if (!horizontalClip && !verticalClip) {
          continue;
        }
        const text = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 72);
        clipped.push(
          `${selector} clipped "${text}" scroll=${element.scrollWidth}x${element.scrollHeight} client=${element.clientWidth}x${element.clientHeight}`,
        );
      }
    }

    return {
      exists: true,
      documentOverflow,
      controlCount: root.querySelectorAll('button, select, dialog, [role="dialog"], [role="button"]').length,
      clipped,
      documentOverflowY: documentStyle.overflowY,
      documentClientHeight: scrollingElement.clientHeight,
      documentScrollHeight: scrollingElement.scrollHeight,
      inspectorOverflowY: inspectorStyle?.overflowY ?? null,
      inspectorClientHeight: inspector?.clientHeight ?? 0,
      inspectorScrollHeight: inspector?.scrollHeight ?? 0,
      surfaceOverflowY: surfaceStyle?.overflowY ?? null,
      surfaceClientHeight: surface?.clientHeight ?? 0,
      surfaceScrollHeight: surface?.scrollHeight ?? 0,
      overflowY: rootStyle.overflowY,
      clientHeight: root.clientHeight,
      scrollHeight: root.scrollHeight,
      rows: Array.from(root.querySelectorAll('.event-summary')).map((node) => ({
        kind: node.getAttribute('data-event-kind'),
        type: node.getAttribute('data-event-type'),
        cursor: node.getAttribute('data-event-cursor'),
        detailKind: node.getAttribute('data-event-detail-kind'),
        detailText: node.getAttribute('data-event-detail-text'),
        chainKind: node.getAttribute('data-event-chain-kind'),
        chainText: node.getAttribute('data-event-chain-text'),
        icon: node.getAttribute('data-event-icon'),
        detailCount: node.querySelectorAll('.event-summary-detail').length,
        chainCount: node.querySelectorAll('.event-summary-chain').length,
        medallionCount: node.querySelectorAll('.event-medallion').length,
      })),
    };
  });
}

async function expectSelectedGapSummaryHasNoEventAttributes(gapSummary) {
  await expect(gapSummary).toBeVisible();
  await expect(gapSummary).toHaveAttribute('data-event-kind', 'gap');
  await expect(gapSummary.locator('.event-summary-detail')).toHaveCount(0);
  await expect(gapSummary.locator('.event-summary-chain')).toHaveCount(0);
  await expect(gapSummary.locator('.event-medallion')).toHaveCount(0);
  expect(await gapSummary.evaluate((node) => ({
    type: node.getAttribute('data-event-type'),
    group: node.getAttribute('data-event-group'),
    tone: node.getAttribute('data-event-tone'),
    cursor: node.getAttribute('data-event-cursor'),
    detailKind: node.getAttribute('data-event-detail-kind'),
    detailText: node.getAttribute('data-event-detail-text'),
    chainKind: node.getAttribute('data-event-chain-kind'),
    chainText: node.getAttribute('data-event-chain-text'),
    icon: node.getAttribute('data-event-icon'),
    iconLabel: node.getAttribute('data-event-icon-label'),
    medallionLabel: node.getAttribute('data-event-medallion-label'),
    priority: node.getAttribute('data-event-priority'),
    accent: node.getAttribute('data-event-accent'),
  }))).toEqual({
    type: null,
    group: null,
    tone: null,
    cursor: null,
    detailKind: null,
    detailText: null,
    chainKind: null,
    chainText: null,
    icon: null,
    iconLabel: null,
    medallionLabel: null,
    priority: null,
    accent: null,
  });
}

async function expectDenseRetainedLiveSurfacesAfterExpiry(page, label, { checkViewportBounds = true } = {}) {
  await waitForNoActiveEventBubbles(page);
  await expect(page.locator('.viv-event-bubble')).toHaveCount(0);
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle .event-row[data-event-kind="event"]')).toHaveCount(10);
  await expect(page.locator('.chronicle [data-event-cursor="23"][data-event-type="agent_decayed"]')).toBeVisible();
  await expect(page.locator('.chronicle [data-event-type="home_breached"]')).toHaveCount(0);

  const livePulse = page.getByTestId('live-pulse');
  await expect(livePulse).toHaveAttribute('data-pulse-retention-state', 'retained');
  await expect(livePulse).toHaveAttribute('data-pulse-retained-event-cursor', '23');
  await expect(livePulse).toHaveAttribute('data-pulse-retained-event-type', 'agent_decayed');
  await expect(livePulse).toHaveAttribute('data-pulse-retained-event-label', 'returned to earth');
  await expect(livePulse.locator('.live-pulse-latest')).toBeVisible();
  await expect(livePulse.locator('.live-pulse-latest')).toHaveAttribute('data-pulse-retention-state', 'retained');
  await expect(livePulse.locator('.live-pulse-latest')).toHaveAttribute('data-pulse-event-cursor', '23');
  await expect(livePulse.locator('.live-pulse-latest')).toHaveAttribute('data-pulse-event-type', 'agent_decayed');
  await expect(livePulse.locator('.live-pulse-latest')).toContainText('returned to earth');

  const now = page.getByTestId('live-now');
  await expect(now).toHaveAttribute('data-now-retention-state', 'retained');
  await expect(now).toHaveAttribute('data-now-retained-event-cursor', '23');
  await expect(now).toHaveAttribute('data-now-retained-event-type', 'agent_decayed');
  await expect(now).toHaveAttribute('data-now-retained-event-label', 'returned to earth');
  await expect(now.locator('.live-now-cue[data-now-cursor="23"][data-now-event-type="agent_decayed"]')).toBeVisible();
  await expect(now.locator('.live-now-cue[data-now-cursor="23"][data-now-event-type="agent_decayed"]')).toHaveAttribute('data-now-retention-state', 'retained');

  expectChronicleLegible(await chronicleLegibilityState(page));
  expect(await retainedLiveSurfaceLayoutIssues(page), `${label} Chronicle`).toEqual([]);
  if (checkViewportBounds) {
    expect(await viewportLayoutIssues(page), `${label} Chronicle`).toEqual([]);
  }
  expect(await corePanelOverlaps(page), `${label} Chronicle`).toEqual([]);
  expectAtlasSurfaceBounded(await atlasSurfaceBounds(page), `${label} Chronicle`);
  await expect(page.locator('.chronicle button:not(.event-row-action), .chronicle select, .chronicle dialog, .chronicle [role="dialog"], .chronicle [role="button"]')).toHaveCount(0);
  await expect(page.locator('.chronicle .event-gap .event-row-action')).toHaveCount(0);
  await expect(page.locator('.live-pulse button, .live-pulse select, .live-pulse dialog, .live-pulse [role="dialog"], .live-pulse [role="button"]')).toHaveCount(0);
  await expect(page.locator('.live-now button, .live-now select, .live-now dialog, .live-now [role="dialog"], .live-now [role="button"]')).toHaveCount(0);
  await expectRetainedSurfaceAttributeCopyClean(page);
  await expectNoBannedObserverCopy(page);

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(0);
  const agentPoint = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_001'));
  await page.mouse.click(agentPoint.x, agentPoint.y);
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveAttribute('data-atlas-surface', 'selection');
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(1);
  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  await expect(page.locator('.inspector strong')).toHaveText('Aster');
  await expect(focusPulse).toHaveAttribute('data-focus-retention-state', 'retained');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-cursor', '17');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-type', 'home_built');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-label', 'home raised');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toBeVisible();
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-retention-state', 'retained');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-event-cursor', '17');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-event-type', 'home_built');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-text', 'Aster raises shelter');

  const retainedDebug = await page.evaluate(() => ({
    bubbleEffects: window.__vivariumWorld.activeEffects().filter((effect) => effect.bubble),
    recent: window.__vivariumWorld.recentRenderedEventBeats(),
  }));
  expect(retainedDebug.bubbleEffects).toEqual([]);
  expect(retainedDebug.recent).toEqual(expect.arrayContaining([
    expect.objectContaining({ cursor: 23, eventType: 'agent_decayed', hasBubble: true }),
    expect.objectContaining({ cursor: 17, eventType: 'home_built', hasBubble: true }),
  ]));

  expect(await retainedLiveSurfaceLayoutIssues(page), `${label} Selection`).toEqual([]);
  if (checkViewportBounds) {
    expect(await viewportLayoutIssues(page), `${label} Selection`).toEqual([]);
  }
  expect(await corePanelOverlaps(page), `${label} Selection`).toEqual([]);
  expectAtlasSurfaceBounded(await atlasSurfaceBounds(page), `${label} Selection`);
  await expect(page.locator('.focus-pulse button, .focus-pulse select, .focus-pulse dialog, .focus-pulse [role="dialog"], .focus-pulse [role="button"]')).toHaveCount(0);
  await expectRetainedSurfaceAttributeCopyClean(page);
  await expectNoBannedObserverCopy(page);

  await openAtlasSurface(page, 'world');
  await expect(page.locator('.presence-rail')).toBeVisible();
  await expect(page.getByTestId('world-condition')).toBeVisible();
  await expect(page.getByTestId('live-status-strip')).toBeVisible();
  await expect(page.locator('.timeline-strip')).toBeVisible();
  expect(await corePanelOverlaps(page), `${label} World`).toEqual([]);
  if (checkViewportBounds) {
    expect(await viewportLayoutIssues(page), `${label} World`).toEqual([]);
  }
  expectAtlasSurfaceBounded(await atlasSurfaceBounds(page), `${label} World`);
  await expect(page.locator('.live-status-strip button, .timeline-strip button')).toHaveCount(0);
  await expectNoBannedObserverCopy(page);

  await openAtlasSurface(page, 'archive');
  await expect(page.getByTestId('replay-preview')).toBeVisible();
  await expect(page.getByTestId('archive-chronicle')).toBeVisible();
  expect(await corePanelOverlaps(page), `${label} Archive`).toEqual([]);
  if (checkViewportBounds) {
    expect(await viewportLayoutIssues(page), `${label} Archive`).toEqual([]);
  }
  expectAtlasSurfaceBounded(await atlasSurfaceBounds(page), `${label} Archive`);
  await expect(page.locator('.replay-preview button, .archive-chronicle button')).toHaveCount(0);
  await expectNoBannedObserverCopy(page);
}

async function expectIconMedallionMetadata(locator, expected) {
  await expect(locator).toHaveAttribute('data-event-icon', expected.iconKey);
  await expect(locator).toHaveAttribute('data-event-icon-label', expected.iconLabel);
  await expect(locator).toHaveAttribute('data-event-medallion-label', expected.medallionLabel);
  if (expected.priority) {
    await expect(locator).toHaveAttribute('data-event-priority', expected.priority);
  }
  if (expected.accent) {
    await expect(locator).toHaveAttribute('data-event-accent', expected.accent);
  }

  const medallion = locator.locator('.event-medallion').first();
  await expect(medallion).toBeVisible();
  await expect(medallion).toHaveAttribute('data-event-icon', expected.iconKey);
  await expect(medallion).toHaveAttribute('data-event-icon-label', expected.iconLabel);
  await expect(medallion).toHaveAttribute('data-event-medallion-label', expected.medallionLabel);
  await expect(medallion).toHaveText('');
  await expect(medallion.locator('svg.event-medallion-icon')).toBeVisible();
  expect(await medallion.locator('svg.event-medallion-icon path').count()).toBeGreaterThan(0);
}

function expectFiniteTuple(tuple) {
  expect(Array.isArray(tuple)).toBe(true);
  expect(tuple).toHaveLength(3);
  for (const value of tuple) {
    expect(Number.isFinite(value)).toBe(true);
  }
}

function expectSummaryHasNoRawFields(summary) {
  for (const rawField of ['message', 'text', 'fullText', 'run_id', 'runId', 'worldTime', 'provider', 'model', 'prompt', 'systemPrompt']) {
    expect(Object.prototype.hasOwnProperty.call(summary, rawField)).toBe(false);
  }
}

const summaryTupleFields = [
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
];

const summaryTupleArrayFields = [
  'parentWorlds',
  'relationshipThreadWorld',
  'actorPathWorld',
  'targetPathWorld',
];

const rendererSummaryKindCatalog = [
  'agent-hoard-bubble',
  'agent-hoard-shimmer',
  'agent-recovered-relight',
  'bond-lifecycle',
  'combat-bubble',
  'combat-impact',
  'generic-event-arc',
  'generic-event-bubble',
  'generic-event-pulse',
  'hearth-ember',
  'home-breach-bubble',
  'home-breach-shock',
  'home-build',
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
].sort();

const rendererMotionModeSummaryKinds = [
  'agent-hoard-bubble',
  'agent-hoard-shimmer',
  'combat-bubble',
  'combat-impact',
  'generic-event-arc',
  'generic-event-bubble',
  'generic-event-pulse',
  'hearth-ember',
  'home-collapse',
  'home-build',
  'home-breach-bubble',
  'home-breach-shock',
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
].sort();

const summaryMotionModeKinds = new Set(rendererMotionModeSummaryKinds);

function expectRendererSummaryCatalogIntegrity(effects, expectedKinds, motionMode = 'full') {
  const effectsWithSummaries = effects.filter((effect) => effect.summary);
  expect(effectsWithSummaries).toHaveLength(effects.length);
  const presentSummaries = effectsWithSummaries.map((effect) => effect.summary);
  expect(uniqueSorted(presentSummaries.map((summary) => summary.kind))).toEqual(expectedKinds);

  for (const effect of effectsWithSummaries) {
    const summary = effect.summary;
    expect(summary.kind).toBeTruthy();
    expectSummaryHasNoRawFields(summary);
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

    for (const field of summaryTupleFields) {
      if (summary[field] !== undefined) {
        expectFiniteTuple(summary[field]);
      }
    }
    for (const field of summaryTupleArrayFields) {
      if (summary[field] !== undefined) {
        expect(Array.isArray(summary[field])).toBe(true);
        expect(summary[field].length).toBeGreaterThan(0);
        for (const tuple of summary[field]) {
          expectFiniteTuple(tuple);
        }
      }
    }

    if (summary.kind === 'generic-event-bubble') {
      expect(summary.bubbleEventType).toBe(effect.eventType);
      expect(summary.eventGroup).toBe(effect.group);
      expect(effect.bubble).toBeTruthy();
    }
    if (summary.kind === 'generic-event-pulse') {
      expect(summary.pulseEventType).toBe(effect.eventType);
      expect(summary.eventGroup).toBe(effect.group);
      expect(effect.bubble).toBeFalsy();
    }
    if (summary.kind === 'generic-event-arc') {
      expect(summary.arcEventType).toBe(effect.eventType);
      expect(summary.eventGroup).toBe(effect.group);
      expect(effect.bubble).toBeFalsy();
    }
  }
}

function expectRendererSummarySubsetIntegrity(effects, expectedKinds, motionMode = 'full') {
  const expectedKindSet = new Set(expectedKinds);
  const matchingEffects = effects.filter((effect) => (
    effect?.summary && expectedKindSet.has(effect.summary.kind)
  ));
  expectRendererSummaryCatalogIntegrity(matchingEffects, expectedKinds, motionMode);
}

function expectGenericBubbleEffectSummary(effect, motionMode = 'full') {
  const summary = effect.summary;
  expect(effect.bubble).toBeTruthy();
  expect(summary).toMatchObject({
    kind: 'generic-event-bubble',
    bubbleEventType: effect.eventType,
    eventGroup: effect.group,
    motionCue: 'passive-event-bubble',
    motionMode,
    worldBubbleCue: true,
    passiveBubbleCue: true,
    genericBubbleCue: true,
    actualActorMutated: false,
    durableAgentMutated: false,
    targetStateMutated: false,
    regionStateMutated: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    ownerStateMutated: false,
    stakeholderStateMutated: false,
    vaultStateMutated: false,
    occupancyStateMutated: false,
    controlsMutated: false,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expect(['actor', 'home', 'target', 'region', 'toRegion', 'fromRegion', 'primary']).toContain(summary.anchorRole);
  const anchorTuples = [
    summary.actorWorld,
    summary.targetWorld,
    summary.homeWorld,
    summary.thresholdWorld,
  ].filter(Array.isArray);
  expect(anchorTuples.length).toBeGreaterThan(0);
  for (const tuple of anchorTuples) {
    expectFiniteTuple(tuple);
  }
  expectSummaryHasNoRawFields(summary);
}

function expectGenericPulseEffectSummary(effect, motionMode = 'full') {
  expect(effect).toBeTruthy();
  const summary = effect.summary;
  expect(effect.bubble).toBeFalsy();
  expect(summary).toMatchObject({
    kind: 'generic-event-pulse',
    pulseEventType: effect.eventType,
    eventGroup: effect.group,
    effectCarrier: 'pulse',
    motionCue: 'passive-event-pulse',
    motionMode,
    worldBubbleCue: false,
    pulseCue: true,
    passivePulseCue: true,
    genericPulseCue: true,
    actualActorMutated: false,
    durableAgentMutated: false,
    targetStateMutated: false,
    regionStateMutated: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    ownerStateMutated: false,
    stakeholderStateMutated: false,
    vaultStateMutated: false,
    occupancyStateMutated: false,
    liveStatusMutated: false,
    runMetadataMutated: false,
    replayArchiveMutated: false,
    controlsMutated: false,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expect(['actor', 'home', 'target', 'region', 'toRegion', 'fromRegion', 'primary']).toContain(summary.anchorRole);
  expectFiniteTuple(summary.anchorWorld);
  expectSummaryHasNoRawFields(summary);
}

function expectGenericArcEffectSummary(effect, motionMode = 'full') {
  expect(effect).toBeTruthy();
  const summary = effect.summary;
  expect(effect.bubble).toBeFalsy();
  expect(summary).toMatchObject({
    kind: 'generic-event-arc',
    arcEventType: effect.eventType,
    eventGroup: effect.group,
    effectCarrier: 'arc',
    motionCue: 'passive-event-arc',
    motionMode,
    worldBubbleCue: false,
    arcCue: true,
    passiveArcCue: true,
    genericArcCue: true,
    actualActorMutated: false,
    durableAgentMutated: false,
    targetStateMutated: false,
    regionStateMutated: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    ownerStateMutated: false,
    stakeholderStateMutated: false,
    vaultStateMutated: false,
    occupancyStateMutated: false,
    liveStatusMutated: false,
    runMetadataMutated: false,
    replayArchiveMutated: false,
    controlsMutated: false,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expect(['actor', 'home', 'target', 'region', 'toRegion', 'fromRegion']).toContain(summary.fromAnchorRole);
  expect(['actor', 'home', 'target', 'region', 'toRegion', 'fromRegion']).toContain(summary.toAnchorRole);
  expectFiniteTuple(summary.streamFromWorld);
  expectFiniteTuple(summary.streamToWorld);
  expectSummaryHasNoRawFields(summary);
}

function expectFiniteNumber(value) {
  expect(Number.isFinite(value)).toBe(true);
}

function expectHexColor(value) {
  expect(value).toMatch(/^#[0-9a-f]{6}$/i);
}

async function rendererChromeControlState(page) {
  return page.evaluate(() => ({
    worldButtons: document.querySelectorAll('.world-stage button').length,
    worldDialogs: document.querySelectorAll('.world-stage dialog, .world-stage [role="dialog"]').length,
    worldModals: document.querySelectorAll('.world-stage .modal').length,
    timelineButtons: document.querySelectorAll('.timeline-strip button').length,
    replayButtons: document.querySelectorAll('.replay-preview button').length,
    inspectorRecentButtons: document.querySelectorAll('.inspector-recent button').length,
    liveStatusButtons: document.querySelectorAll('.live-status-strip button').length,
    motionControlCopy: /\b(Reduced motion|Motion controls|Animation controls|Seek|Scrub|Playback)\b/i.test(document.body.innerText),
  }));
}

function timelineMetricValue(page, label) {
  return page
    .locator('.timeline-strip dl')
    .filter({ hasText: new RegExp(`^${label}`) })
    .locator('dd');
}

async function setArchivePointScrubber(page, index) {
  await page.getByTestId('archive-point-scrubber-input').evaluate((element, value) => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    valueSetter.call(element, String(value));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, index);
}

async function expectPassiveReplayArtifactLoading(page, boot) {
  await expect(page.getByTestId('world-stage')).toHaveAttribute('data-stage-source', 'live');
  await expect(page.locator('.observer-source-pill')).toHaveAttribute('data-observer-source', 'archive');
  await expect(page.locator('.observer-source-pill')).toContainText('Archive loading');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'live');
  await expect(timelineMetricValue(page, 'Archive')).toHaveText('loading');
  await expect(timelineMetricValue(page, 'Lines')).toHaveText('loading');
  await expect(timelineMetricValue(page, 'Points')).toHaveText('loading');
  await expect(timelineMetricValue(page, 'First')).toHaveText('loading');
  await expect(timelineMetricValue(page, 'Last')).toHaveText('loading');
  await expect(timelineMetricValue(page, 'Proof')).toHaveText('loading');
  await expect(timelineMetricValue(page, 'Preview')).toHaveText('loading');
  await expect(page.locator('.timeline-strip button')).toHaveCount(0);

  const archive = page.getByTestId('archive-chronicle');
  await expect(archive).toContainText('Archive');
  await expect(archive).toContainText('loading');
  await expect(archive).toContainText('Reading archive.');
  await expect(archive).toHaveAttribute('data-archive-status', 'loading');
  await expect(archive).toHaveAttribute('data-archive-error-source', 'none');
  await expect(archive).toHaveAttribute('data-archive-error-present', 'false');
  await expect(archive).toHaveAttribute('data-archive-window-start', '0');
  await expect(archive).toHaveAttribute('data-archive-window-end', '0');
  await expect(archive).toHaveAttribute('data-archive-window-count', '0');
  await expect(archive).toHaveAttribute('data-archive-visible-count', '0');
  await expect(archive).toHaveAttribute('data-archive-event-count', '0');
  await expect(archive).toHaveAttribute('data-archive-raw-cursor-start', 'none');
  await expect(archive).toHaveAttribute('data-archive-visible-cursor-start', 'none');
  await expect(archive.locator('[data-event-kind="event"]')).toHaveCount(0);
  await expect(archive.getByTestId('archive-window-selector')).toHaveCount(0);
  await expect(archive.locator('button')).toHaveCount(0);
  await expect(page.getByTestId('archive-point-selector')).toHaveCount(0);
  await expect(page.getByTestId('archive-point-scrubber')).toHaveCount(0);
  await expect(page.getByTestId('replay-preview')).toHaveCount(0);
  const diagnostics = page.getByTestId('replay-artifact-diagnostics');
  await expect(diagnostics).toHaveAttribute('data-artifact-load-status', 'loading');
  const loadingDiagnostics = await replayArtifactDiagnosticsState(page);
  expect(loadingDiagnostics.loadGeneration).toMatch(/^\d+$/);
  expect(loadingDiagnostics.activeLoadGeneration).toBe(loadingDiagnostics.loadGeneration);
  await expect(diagnostics).toHaveAttribute('data-artifact-completed-load-count', '0');
  await expect(diagnostics).toHaveAttribute('data-artifact-stale-dropped-load-count', '0');

  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });
  expect(await rendererChromeControlState(page)).toMatchObject({
    timelineButtons: 0,
    replayButtons: 0,
    liveStatusButtons: 0,
    motionControlCopy: false,
  });
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
  await expectNoBannedObserverCopy(page);
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('Aster calls across the meadow.');
}

async function expectPassiveReplayArtifactFailure(page, boot) {
  const timeline = page.locator('.timeline-strip');
  await expect(timeline).toContainText('Archive');
  await expect(timeline).toContainText('unavailable');
  await expect(timelineMetricValue(page, 'Archive')).toHaveAttribute(
    'title',
    'Archive unavailable',
  );
  await expect(timeline).toContainText('Preview');
  await expect(timeline).toContainText('error');
  await expect(timelineMetricValue(page, 'Preview')).toHaveAttribute(
    'title',
    'Preview unavailable',
  );
  await expect(timeline).not.toContainText('Seek');
  await expect(timeline.locator('button')).toHaveCount(0);

  const archive = page.getByTestId('archive-chronicle');
  await expect(archive).toContainText('Archive unavailable.');
  await expect(archive).toHaveAttribute('data-archive-status', 'error');
  await expect(archive).toHaveAttribute('data-archive-error-source', 'artifact_load');
  await expect(archive).toHaveAttribute('data-archive-error-present', 'true');
  await expect(archive).toHaveAttribute('data-archive-window-start', '0');
  await expect(archive).toHaveAttribute('data-archive-window-end', '0');
  await expect(archive).toHaveAttribute('data-archive-window-count', '0');
  await expect(archive).toHaveAttribute('data-archive-visible-count', '0');
  await expect(archive).toHaveAttribute('data-archive-event-count', '0');
  await expect(archive).toHaveAttribute('data-archive-raw-cursor-start', 'none');
  await expect(archive).toHaveAttribute('data-archive-visible-cursor-start', 'none');
  await expect(archive.locator('[data-event-kind="event"]')).toHaveCount(0);
  await expect(archive.getByTestId('archive-window-selector')).toHaveCount(0);
  await expect(archive.locator('button')).toHaveCount(0);
  await expect(page.getByTestId('archive-point-selector')).toHaveCount(0);
  await expect(page.getByTestId('archive-point-scrubber')).toHaveCount(0);
  await expect(page.getByTestId('replay-preview')).toHaveCount(0);

  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });
  expect(await rendererChromeControlState(page)).toMatchObject({
    timelineButtons: 0,
    replayButtons: 0,
    liveStatusButtons: 0,
    motionControlCopy: false,
  });
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
  await expectNoReplayArtifactErrorLeak(page);
  await expectNoBannedObserverCopy(page);
  await openAtlasSurface(page, 'world');
  await expect(page.locator('.presence-rail')).toContainText('Aster');
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('Aster calls across the meadow.');
}

async function replayArtifactDiagnosticsState(page) {
  return page.getByTestId('replay-artifact-diagnostics').evaluate((node) => ({
    loadStatus: node.getAttribute('data-artifact-load-status'),
    loadGeneration: node.getAttribute('data-artifact-load-generation'),
    activeLoadGeneration: node.getAttribute('data-artifact-active-load-generation'),
    completedLoadCount: node.getAttribute('data-artifact-completed-load-count'),
    staleDroppedLoadCount: node.getAttribute('data-artifact-stale-dropped-load-count'),
    lastCompletedGeneration: node.getAttribute('data-artifact-last-completed-generation'),
    lastSettledGeneration: node.getAttribute('data-artifact-last-settled-generation'),
    lastStaleDroppedGeneration: node.getAttribute('data-artifact-last-stale-dropped-generation'),
  }));
}

async function expectNoReplayArtifactErrorLeak(page) {
  const leaks = await page.evaluate(() => {
    const pattern = /\/api\/replay|returned HTTP|line \d+|malformed|event archive unavailable|snapshot archive unavailable|checkpoint\.event_cursor|snapshot checkpoint/i;
    const root = document.body;
    const leaks = [];
    const check = (source, value) => {
      const normalized = (value || '').replace(/\s+/g, ' ').trim();
      const match = normalized.match(pattern);
      if (!match) {
        return;
      }
      const index = match.index || 0;
      leaks.push(`${source}: ${normalized.slice(Math.max(0, index - 32), index + 96)}`);
    };
    check('body innerText', root.innerText);
    for (const node of Array.from(root.querySelectorAll('[title], [aria-label]'))) {
      if (node.closest('.viv-event-bubble')) {
        continue;
      }
      check('title', node.getAttribute('title'));
      check('aria-label', node.getAttribute('aria-label'));
    }
    return leaks;
  });

  expect(leaks).toEqual([]);
}

async function expectNoBannedObserverCopy(page) {
  const leaks = await page.evaluate((pattern) => {
    const banned = new RegExp(pattern, 'i');
    const root = document.body;
    const eventBubbles = Array.from(root.querySelectorAll('.viv-event-bubble'));
    const previousDisplay = eventBubbles.map((node) => [node, node.style.display]);
    const leaks = [];

    const check = (source, value) => {
      const normalized = (value || '').replace(/\s+/g, ' ').trim();
      const match = normalized.match(banned);
      if (!match) {
        return;
      }
      const index = match.index || 0;
      const start = Math.max(0, index - 48);
      const end = Math.min(normalized.length, index + 96);
      leaks.push(`${source}: ${normalized.slice(start, end)}`);
    };

    for (const bubble of eventBubbles) {
      bubble.style.display = 'none';
    }
    try {
      check('body innerText', root.innerText);
    } finally {
      for (const [node, display] of previousDisplay) {
        node.style.display = display;
      }
    }

    for (const node of Array.from(root.querySelectorAll('[title], [aria-label]'))) {
      if (node.closest('.viv-event-bubble')) {
        continue;
      }
      check('title', node.getAttribute('title'));
      check('aria-label', node.getAttribute('aria-label'));
    }

    return leaks;
  }, bannedBackendVocabularyPattern);

  expect(leaks).toEqual([]);
}

async function expectNoLiveDiagnosticCopy(page) {
  const leaks = await page.evaluate(() => {
    const pattern = /(__vivariumLiveRun|activeStream|streamSerial|recoveryRetry|refreshInFlight|lastAcceptedSnapshot|lastRejectedSnapshot|lastRejectedSnapshotReason|ignoredStaleStream|events\/stream\?cursor)/i;
    const root = document.body;
    const leaks = [];
    const check = (source, value) => {
      const normalized = (value || '').replace(/\s+/g, ' ').trim();
      const match = normalized.match(pattern);
      if (!match) {
        return;
      }
      const index = match.index || 0;
      leaks.push(`${source}: ${normalized.slice(Math.max(0, index - 32), index + 96)}`);
    };
    check('body innerText', root.innerText);
    for (const node of Array.from(root.querySelectorAll('[title], [aria-label]'))) {
      check('title', node.getAttribute('title'));
      check('aria-label', node.getAttribute('aria-label'));
    }
    return leaks;
  });

  expect(leaks).toEqual([]);
}

async function expectNoRawRequiredRunConstantCopy(page) {
  const leaks = await page.evaluate((pattern) => {
    const rawConstant = new RegExp(pattern, 'i');
    const root = document.body;
    const leaks = [];
    const check = (source, value) => {
      const normalized = (value || '').replace(/\s+/g, ' ').trim();
      const match = normalized.match(rawConstant);
      if (!match) {
        return;
      }
      const index = match.index || 0;
      leaks.push(`${source}: ${normalized.slice(Math.max(0, index - 32), index + 96)}`);
    };
    check('body innerText', root.innerText);
    for (const node of Array.from(root.querySelectorAll('[title], [aria-label]'))) {
      if (node.closest('.viv-event-bubble')) {
        continue;
      }
      check('title', node.getAttribute('title'));
      check('aria-label', node.getAttribute('aria-label'));
    }
    return leaks;
  }, requiredRunConstantRawCopyPattern);

  expect(leaks).toEqual([]);
}

async function expectNoRawRunMetadataCopy(page, bannedValues) {
  const leaks = await page.evaluate((values) => {
    const needles = values
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    const root = document.body;
    const eventBubbles = Array.from(root.querySelectorAll('.viv-event-bubble'));
    const previousDisplay = eventBubbles.map((node) => [node, node.style.display]);
    const leaks = [];

    const check = (source, value) => {
      const normalized = (value || '').replace(/\s+/g, ' ').trim();
      const searchable = normalized.toLowerCase();
      for (const needle of needles) {
        const index = searchable.indexOf(needle);
        if (index === -1) {
          continue;
        }
        leaks.push(`${source}: ${normalized.slice(Math.max(0, index - 32), index + needle.length + 96)}`);
      }
    };

    for (const bubble of eventBubbles) {
      bubble.style.display = 'none';
    }
    try {
      check('body innerText', root.innerText);
    } finally {
      for (const [node, display] of previousDisplay) {
        node.style.display = display;
      }
    }

    for (const node of Array.from(root.querySelectorAll('[title], [aria-label]'))) {
      if (node.closest('.viv-event-bubble')) {
        continue;
      }
      check('title', node.getAttribute('title'));
      check('aria-label', node.getAttribute('aria-label'));
    }

    return leaks;
  }, bannedValues);

  expect(leaks).toEqual([]);
}

async function waitForBurstEffects(page) {
  await page.waitForFunction(
    ({ eventTypes, groupSets, cursors }) => {
      const debug = window.__vivariumWorld;
      if (
        !debug?.activeEffects ||
        !debug?.eventEffectCount ||
        !debug?.screenPointForHome ||
        !debug?.appliedEventCursors
      ) {
        return false;
      }
      const effects = debug.activeEffects();
      const effectTypes = new Set(effects.map((effect) => effect.eventType));
      const effectGroups = new Set(effects.map((effect) => effect.group));
      const applied = new Set(Array.from(debug.appliedEventCursors()));
      return (
        debug.eventEffectCount() >= eventTypes.length &&
        eventTypes.every((eventType) => effectTypes.has(eventType)) &&
        groupSets.every((groupSet) => groupSet.some((group) => effectGroups.has(group))) &&
        cursors.every((cursor) => applied.has(cursor)) &&
        Boolean(debug.screenPointForHome('home_001'))
      );
    },
    {
      eventTypes: burstVisualEventTypes,
      groupSets: burstRepresentativeGroupSets,
      cursors: burstEventCursors,
    },
    { timeout: 8000 },
  );
}

async function waitForHomeBuildEffect(page, homeId) {
  await page.waitForFunction((targetHomeId) => {
    const debug = window.__vivariumWorld;
    return debug?.activeEffects?.().some((effect) => (
      effect.eventType === 'home_built' &&
      effect.summary?.kind === 'home-build' &&
      effect.summary.homeId === targetHomeId
    ));
  }, homeId, { timeout: 5000 });
}

async function waitForHomeRaidEffect(page, eventType, homeId) {
  await page.waitForFunction(
    ({ targetEventType, targetHomeId }) => {
      const debug = window.__vivariumWorld;
      return debug?.activeEffects?.().some((effect) => (
        effect.eventType === targetEventType &&
        (effect.summary?.kind === 'home-theft-raid' || effect.summary?.kind === 'home-colonize-raid') &&
        effect.summary.homeId === targetHomeId
      ));
    },
    { targetEventType: eventType, targetHomeId: homeId },
    { timeout: 5000 },
  );
}

async function waitForEventBubbleLaneMetadata(page, minimumBubbles) {
  await page.waitForFunction(
    (minimum) => {
      const bubbles = Array.from(document.querySelectorAll('.viv-event-bubble'))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return (
            rect.width > 4 &&
            rect.height > 4 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        });
      const withLaneMetadata = bubbles.filter((node) => (
        node.hasAttribute('data-event-cursor') &&
        node.hasAttribute('data-event-type') &&
        node.hasAttribute('data-event-group') &&
        node.hasAttribute('data-event-lane') &&
        node.hasAttribute('data-event-priority') &&
        node.hasAttribute('data-event-catalog-priority') &&
        node.hasAttribute('data-event-icon') &&
        node.hasAttribute('data-event-icon-label') &&
        node.hasAttribute('data-event-medallion-label') &&
        node.hasAttribute('data-event-accent') &&
        node.hasAttribute('data-event-arrival-phase') &&
        node.hasAttribute('data-event-arrival-progress') &&
        node.hasAttribute('data-event-arrival-opacity')
      ));
      return bubbles.length >= minimum && withLaneMetadata.length >= minimum;
    },
    minimumBubbles,
    { timeout: 5000 },
  );
}

async function waitForVisibleEventBubbleTypes(page, requiredTypes) {
  await page.waitForFunction(
    (types) => {
      const visibleTypes = new Set(Array.from(document.querySelectorAll('.viv-event-bubble'))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return (
            rect.width > 4 &&
            rect.height > 4 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        })
        .map((node) => node.getAttribute('data-event-type'))
        .filter(Boolean));
      return types.every((eventType) => visibleTypes.has(eventType));
    },
    requiredTypes,
    { timeout: 5000 },
  );
}

async function waitForEventBubbleCursorExpired(page, cursor) {
  await page.waitForFunction((eventCursor) => {
    const effects = window.__vivariumWorld?.activeEffects?.() || [];
    return (
      document.querySelectorAll(`.viv-event-bubble[data-event-cursor="${eventCursor}"]`).length === 0 &&
      effects.every((effect) => effect.bubble?.cursor !== eventCursor)
    );
  }, cursor, { timeout: 8000 });
}

async function waitForNoActiveEventBubbles(page) {
  await page.waitForFunction(() => {
    const effects = window.__vivariumWorld?.activeEffects?.() || [];
    return (
      document.querySelectorAll('.viv-event-bubble').length === 0 &&
      effects.every((effect) => !effect.bubble)
    );
  }, null, { timeout: 8000 });
}

async function eventBubbleLaneState(page) {
  return page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const panelSelectors = ['.top-hud', '.replay-preview', '.archive-chronicle', '.presence-rail', '.chronicle', '.inspector'];

    const plainRect = (rect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
    const overlap = (a, b) => ({
      width: Math.min(a.right, b.right) - Math.max(a.left, b.left),
      height: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
    });
    const labelFor = (bubble) => (
      `${bubble.eventType || 'unknown'}#${bubble.index}/lane${bubble.lane ?? '?'}:${bubble.priority ?? '?'}`
    );
    const rectLabel = (rect) => (
      `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`
    );

    const panels = panelSelectors.flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [];
      const rect = plainRect(element.getBoundingClientRect());
      if (rect.width === 0 || rect.height === 0) return [];
      return [{ selector, rect }];
    });

    const bubbles = Array.from(document.querySelectorAll('.viv-event-bubble'))
      .map((node, index) => {
        const style = getComputedStyle(node);
        return {
          index,
          cursor: Number(node.getAttribute('data-event-cursor')),
          eventType: node.getAttribute('data-event-type'),
          group: node.getAttribute('data-event-group'),
          lane: node.getAttribute('data-event-lane'),
          priority: node.getAttribute('data-event-priority'),
          catalogPriority: node.getAttribute('data-event-catalog-priority'),
          glyph: node.getAttribute('data-event-glyph'),
          iconKey: node.getAttribute('data-event-icon'),
          iconLabel: node.getAttribute('data-event-icon-label'),
          medallionLabel: node.getAttribute('data-event-medallion-label'),
          detailKind: node.getAttribute('data-event-detail-kind'),
          chainKind: node.getAttribute('data-event-chain-kind'),
          chainCount: node.getAttribute('data-event-chain-count'),
          chainWindow: node.getAttribute('data-event-chain-window'),
          chainText: node.getAttribute('data-event-chain-text'),
          arrivalPhase: node.getAttribute('data-event-arrival-phase'),
          arrivalProgress: Number(node.getAttribute('data-event-arrival-progress')),
          arrivalOpacity: Number(node.getAttribute('data-event-arrival-opacity')),
          medallionIconKey: node.querySelector('.event-medallion')?.getAttribute('data-event-icon'),
          medallionText: (node.querySelector('.event-medallion')?.textContent || '').replace(/\s+/g, ' ').trim(),
          iconPathCount: node.querySelectorAll('.event-medallion-icon path').length,
          accent: node.getAttribute('data-event-accent'),
          text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
          detailText: (node.querySelector('.viv-event-bubble-detail')?.textContent || '').replace(/\s+/g, ' ').trim(),
          visibleChainText: (node.querySelector('.viv-event-bubble-chain')?.textContent || '').replace(/\s+/g, ' ').trim(),
          eventColor: style.getPropertyValue('--event-color').trim(),
          arrivalScale: Number(style.getPropertyValue('--bubble-arrival-scale')),
          arrivalGlow: style.getPropertyValue('--bubble-arrival-glow').trim(),
          lineClamp: style.getPropertyValue('-webkit-line-clamp'),
          overflow: style.overflow,
          display: style.display,
          visibility: style.visibility,
          pointerEvents: style.pointerEvents,
          tagName: node.tagName.toLowerCase(),
          role: node.getAttribute('role'),
          buttonType: node.getAttribute('type'),
          focusKind: node.getAttribute('data-event-focus-kind'),
          focusId: node.getAttribute('data-event-focus-id'),
          ariaLabel: node.getAttribute('aria-label'),
          rect: plainRect(node.getBoundingClientRect()),
        };
      })
      .filter((bubble) => (
        bubble.rect.width > 4 &&
        bubble.rect.height > 4 &&
        bubble.display !== 'none' &&
        bubble.visibility !== 'hidden'
      ));

    const pairOverlaps = [];
    for (let i = 0; i < bubbles.length; i += 1) {
      for (let j = i + 1; j < bubbles.length; j += 1) {
        const amount = overlap(bubbles[i].rect, bubbles[j].rect);
        if (amount.width > 2 && amount.height > 2) {
          pairOverlaps.push(
            `${labelFor(bubbles[i])}/${labelFor(bubbles[j])} ${Math.round(amount.width)}x${Math.round(amount.height)}`,
          );
        }
      }
    }

    const panelOverlaps = bubbles.flatMap((bubble) =>
      panels.flatMap((panel) => {
        const amount = overlap(bubble.rect, panel.rect);
        return amount.width > 2 && amount.height > 2
          ? [`${labelFor(bubble)}/${panel.selector} ${Math.round(amount.width)}x${Math.round(amount.height)}`]
          : [];
      }),
    );

    const clipped = bubbles
      .filter((bubble) => (
        bubble.rect.left < -1 ||
        bubble.rect.right > viewport.width + 1 ||
        bubble.rect.top < -1 ||
        bubble.rect.bottom > viewport.height + 1
      ))
      .map((bubble) => `${labelFor(bubble)} ${rectLabel(bubble.rect)}`);

    const effectBubbles = (window.__vivariumWorld?.activeEffects?.() || [])
      .filter((effect) => effect.bubble)
      .map((effect) => ({
        cursor: effect.bubble.cursor,
        eventType: effect.eventType,
        group: effect.group,
        lane: effect.bubble.lane,
        priority: effect.bubble.priority,
        catalogPriority: effect.bubble.catalogPriority,
        glyph: effect.bubble.glyph,
        iconKey: effect.bubble.iconKey,
        iconLabel: effect.bubble.iconLabel,
        medallionLabel: effect.bubble.medallionLabel,
        accent: effect.bubble.accent,
        arrivalPhase: effect.bubble.arrivalPhase,
        arrivalProgress: effect.bubble.arrivalProgress,
        arrivalOpacity: effect.bubble.arrivalOpacity,
        offset: effect.bubble.offset,
        anchorWorld: effect.bubble.anchorWorld,
        screen: effect.bubble.screen,
        chainDetail: effect.bubble.chainDetail,
      }));

    return { bubbles, clipped, pairOverlaps, panelOverlaps, effectBubbles };
  });
}

function expectEventBubbleFocusSemantics(bubble, label) {
  const hasFocusMetadata = Boolean(bubble.focusKind || bubble.focusId);
  const observerCopy = `${bubble.ariaLabel || ''} ${bubble.text || ''}`;
  expect(observerCopy, `${label} playback semantics`).not.toMatch(
    /\b(?:play|pause|seek|scrub|playback|picker)\b/i,
  );

  if (hasFocusMetadata) {
    expect(bubble.focusKind, `${label} focus kind`).toMatch(/\S/);
    expect(bubble.focusId, `${label} focus id`).toMatch(/\S/);
    expect(bubble.tagName, `${label} focus element`).toBe('button');
    expect(bubble.buttonType, `${label} button type`).toBe('button');
    expect(bubble.pointerEvents, `${label} pointer events`).toBe('auto');
    return;
  }

  expect(bubble.focusKind, `${label} passive focus kind`).toBeNull();
  expect(bubble.focusId, `${label} passive focus id`).toBeNull();
  expect(bubble.tagName, `${label} passive element`).toBe('div');
  expect(bubble.buttonType, `${label} passive button type`).toBeNull();
  expect(bubble.pointerEvents, `${label} pointer events`).toBe('none');
  expect(bubble.role, `${label} passive role`).toBeNull();
}

function focusableEventBubbleCount(state) {
  return state.bubbles.filter((bubble) => bubble.tagName === 'button').length;
}

function expectEventBubbleLaneStateStable(state, label, minimumBubbles) {
  expect(state.bubbles.length, label).toBeGreaterThanOrEqual(minimumBubbles);

  for (const bubble of state.bubbles) {
    const laneNumber = Number(bubble.lane);
    expect(Number.isInteger(bubble.cursor), `${label} ${bubble.eventType} cursor`).toBe(true);
    expect(bubble.cursor, `${label} ${bubble.eventType} cursor`).toBeGreaterThan(0);
    expect(bubble.eventType, `${label} bubble event type`).toBeTruthy();
    expect(bubble.group, `${label} ${bubble.eventType} group`).toBeTruthy();
    expect(Number.isFinite(laneNumber), `${label} ${bubble.eventType} lane`).toBe(true);
    expect(Number.isInteger(laneNumber), `${label} ${bubble.eventType} lane`).toBe(true);
    expect(['ambient', 'featured', 'drama'], `${label} ${bubble.eventType} priority`).toContain(bubble.priority);
    expect(['ambient', 'featured', 'drama'], `${label} ${bubble.eventType} catalog priority`).toContain(bubble.catalogPriority);
    expect(eventVisualIconKeys.has(bubble.iconKey), `${label} ${bubble.eventType} icon`).toBe(true);
    expect(bubble.iconLabel, `${label} ${bubble.eventType} icon label`).toMatch(/\S/);
    expect(bubble.medallionLabel, `${label} ${bubble.eventType} medallion label`).toMatch(/\S/);
    expect(bubble.medallionIconKey, `${label} ${bubble.eventType} medallion icon`).toBe(bubble.iconKey);
    expect(bubble.medallionText, `${label} ${bubble.eventType} medallion text`).toBe('');
    expect(bubble.iconPathCount, `${label} ${bubble.eventType} icon paths`).toBeGreaterThan(0);
    expect(bubble.accent, `${label} ${bubble.eventType} accent`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(bubble.text.length, `${label} ${bubble.eventType} text`).toBeGreaterThan(0);
    expect(bubble.eventColor, `${label} ${bubble.eventType} event color`).toMatch(/^#/);
    expect(['arriving', 'held', 'fading'], `${label} ${bubble.eventType} arrival phase`).toContain(bubble.arrivalPhase);
    expect(Number.isFinite(bubble.arrivalProgress), `${label} ${bubble.eventType} arrival progress`).toBe(true);
    expect(bubble.arrivalProgress, `${label} ${bubble.eventType} arrival progress`).toBeGreaterThanOrEqual(0);
    expect(bubble.arrivalProgress, `${label} ${bubble.eventType} arrival progress`).toBeLessThanOrEqual(1);
    expect(Number.isFinite(bubble.arrivalOpacity), `${label} ${bubble.eventType} arrival opacity`).toBe(true);
    expect(bubble.arrivalOpacity, `${label} ${bubble.eventType} arrival opacity`).toBeGreaterThanOrEqual(0);
    expect(bubble.arrivalOpacity, `${label} ${bubble.eventType} arrival opacity`).toBeLessThanOrEqual(1);
    expect(Number.isFinite(bubble.arrivalScale), `${label} ${bubble.eventType} arrival scale`).toBe(true);
    expect(bubble.arrivalScale, `${label} ${bubble.eventType} arrival scale`).toBeGreaterThan(0.9);
    expect(bubble.arrivalScale, `${label} ${bubble.eventType} arrival scale`).toBeLessThan(1.1);
    expect(bubble.arrivalGlow, `${label} ${bubble.eventType} arrival glow`).toMatch(/^\d+(?:\.\d+)?%$/);
    expect(bubble.lineClamp, `${label} ${bubble.eventType} clamp`).toBe('2');
    expect(bubble.overflow, `${label} ${bubble.eventType} overflow`).toBe('hidden');
    expectEventBubbleFocusSemantics(bubble, `${label} ${bubble.eventType}`);
  }

  for (const effect of state.effectBubbles) {
    expect(Number.isFinite(effect.lane), `${label} ${effect.eventType} debug lane`).toBe(true);
    expect(Number.isInteger(effect.cursor), `${label} ${effect.eventType} debug cursor`).toBe(true);
    expect(effect.cursor, `${label} ${effect.eventType} debug cursor`).toBeGreaterThan(0);
    expect(['ambient', 'featured', 'drama'], `${label} ${effect.eventType} debug priority`).toContain(effect.priority);
    expect(['ambient', 'featured', 'drama'], `${label} ${effect.eventType} debug catalog priority`).toContain(effect.catalogPriority);
    expect(eventVisualIconKeys.has(effect.iconKey), `${label} ${effect.eventType} debug icon`).toBe(true);
    expect(effect.iconLabel, `${label} ${effect.eventType} debug icon label`).toMatch(/\S/);
    expect(effect.medallionLabel, `${label} ${effect.eventType} debug medallion label`).toMatch(/\S/);
    expect(effect.accent, `${label} ${effect.eventType} debug accent`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(['arriving', 'held', 'fading'], `${label} ${effect.eventType} debug arrival phase`).toContain(effect.arrivalPhase);
    expect(Number.isFinite(effect.arrivalProgress), `${label} ${effect.eventType} debug arrival progress`).toBe(true);
    expect(effect.arrivalProgress, `${label} ${effect.eventType} debug arrival progress`).toBeGreaterThanOrEqual(0);
    expect(effect.arrivalProgress, `${label} ${effect.eventType} debug arrival progress`).toBeLessThanOrEqual(1);
    expect(Number.isFinite(effect.arrivalOpacity), `${label} ${effect.eventType} debug arrival opacity`).toBe(true);
    expect(effect.arrivalOpacity, `${label} ${effect.eventType} debug arrival opacity`).toBeGreaterThanOrEqual(0);
    expect(effect.arrivalOpacity, `${label} ${effect.eventType} debug arrival opacity`).toBeLessThanOrEqual(1);
    expect(effect.offset.every((value) => Number.isFinite(value)), `${label} ${effect.eventType} debug offset`).toBe(true);
    expect(effect.anchorWorld.every((value) => Number.isFinite(value)), `${label} ${effect.eventType} debug anchor`).toBe(true);
    expect(effect.screen, `${label} ${effect.eventType} debug screen`).toBeTruthy();
    expect(Number.isFinite(effect.screen.x), `${label} ${effect.eventType} debug screen x`).toBe(true);
    expect(Number.isFinite(effect.screen.y), `${label} ${effect.eventType} debug screen y`).toBe(true);
  }

  expect(state.clipped, label).toEqual([]);
  expect(state.pairOverlaps, label).toEqual([]);
  expect(state.panelOverlaps, label).toEqual([]);
}

async function stressCameraAndResizeWithActiveBubbles(page) {
  const before = await cameraState(page);
  const eastPoint = await page.evaluate(() => window.__vivariumWorld.screenPointForRegion('nirvana_east'));
  await page.mouse.click(eastPoint.x, eastPoint.y);
  await page.waitForTimeout(520);
  const canvasBox = await page.getByTestId('vivarium-world-canvas').boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.wheel(0, -950);
  await page.waitForTimeout(260);
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.waitForTimeout(180);
  await page.setViewportSize({ width: 1360, height: 820 });
  await page.waitForTimeout(220);
  const after = await cameraState(page);

  expect(after.zoomToCursor).toBe(true);
  expect(after.distance).toBeLessThan(before.distance - 10);
  expect(after.target[0]).toBeGreaterThan(35);
  expect(after.target[2]).toBeLessThan(10);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

test('production app semantic event fixtures cover every world-reference event type', async () => {
  const rawFixtureTypes = uniqueSorted([
    ...burstEnvelope.events,
    ...lowFrequencyEnvelope.events,
  ].map(({ event }) => event.type));
  const declaredVisualTypes = uniqueSorted([
    ...burstVisualEventTypes,
    ...burstGroupedAwayEventTypes,
    ...lowFrequencyVisualEventTypes,
  ]);

  expect(worldReferenceEventTypes).toHaveLength(28);
  expect(rawFixtureTypes).toEqual(worldReferenceEventTypes);
  expect(declaredVisualTypes).toEqual(worldReferenceEventTypes);
  expect(uniqueSorted(burstEnvelope.events.map(({ event }) => event.type))).toEqual(
    uniqueSorted([...burstVisualEventTypes, ...burstGroupedAwayEventTypes]),
  );
});

test('production app renders a nonblank Three world on desktop', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 });
  const canvas = page.getByTestId('vivarium-world-canvas');
  await expect(canvas).toBeVisible();

  const boxes = await page.evaluate(() => {
    const stage = document.querySelector('[data-testid="world-stage"]').getBoundingClientRect();
    const canvasBox = document.querySelector('[data-testid="vivarium-world-canvas"]').getBoundingClientRect();
    return {
      stage: { width: stage.width, height: stage.height },
      canvas: { width: canvasBox.width, height: canvasBox.height },
      pixels: window.__vivariumWorld.sampleCanvasPixels(),
    };
  });

  expect(Math.abs(boxes.canvas.width - boxes.stage.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(boxes.canvas.height - boxes.stage.height)).toBeLessThanOrEqual(2);
  expect(boxes.pixels).toBeGreaterThan(20);
});

test('production app keeps canonical V4 island slots with backend-sorted regions', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 });
  const points = await page.evaluate(() => ({
    nirvana: window.__vivariumWorld.worldPointForRegion('nirvana'),
    east: window.__vivariumWorld.worldPointForRegion('nirvana_east'),
    springs: window.__vivariumWorld.worldPointForRegion('warm_springs'),
    west: window.__vivariumWorld.worldPointForRegion('nirvana_west'),
    layoutHash: window.__vivariumWorld.atlasLayoutHash(),
    topology: window.__vivariumWorld.atlasTopologyDiagnostics(),
  }));

  expect(points.nirvana.x).toBeCloseTo(0, 6);
  expect(points.nirvana.z).toBeCloseTo(-32.4, 6);
  expect(points.east.x).toBeCloseTo(62.1, 6);
  expect(points.east.z).toBeCloseTo(-13.5, 6);
  expect(points.springs.x).toBeCloseTo(8.1, 6);
  expect(points.springs.z).toBeCloseTo(29.7, 6);
  expect(points.west.x).toBeCloseTo(-54, 6);
  expect(points.west.z).toBeCloseTo(-8.1, 6);
  expect(points.layoutHash).toEqual(expect.any(String));
  expect(points.layoutHash.length).toBeGreaterThan(20);
  expect(points.topology).toEqual({ asymmetricEdges: [], fallback: false });
});

test('production app uses graph layout when a canonical region name appears outside the exact topology fixture', async ({ page }) => {
  const subsetWorld = {
    ...world,
    agents: world.agents
      .filter((agent) => agent.id === 'agent_001')
      .map((agent) => ({ ...agent, position: 'warm_springs', home_id: null })),
    regions: world.regions.filter((region) => region.name === 'warm_springs'),
    homes: [],
    ruins: [],
    pending_proposals: [],
  };
  await bootApp(page, { width: 1440, height: 900 }, envelope, subsetWorld);

  const state = await page.evaluate(() => ({
    point: window.__vivariumWorld.worldPointForRegion('warm_springs'),
    topology: window.__vivariumWorld.atlasTopologyDiagnostics(),
  }));

  expect(state.point.x).toBeCloseTo(0, 4);
  expect(state.point.z).toBeCloseTo(0, 4);
  expect(state.topology.asymmetricEdges).toEqual([
    'nirvana::warm_springs',
    'nirvana_east::warm_springs',
    'nirvana_west::warm_springs',
  ]);
  expect(state.topology.fallback).toBe(false);
});

test('production app keeps region scenery identity stable across resource abundance updates', async ({ page }) => {
  const replenishedWorld = {
    ...world,
    event_cursor: 5,
    world_time: 19.5,
    regions: world.regions.map((region) => ({
      ...region,
      current_energy: region.max_energy,
      current_materials: region.max_materials,
    })),
  };
  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    [],
    [world, replenishedWorld],
  );
  const before = await page.evaluate(() => ({
    scenery: window.__vivariumWorld.sceneryDiagnostics(),
    dynamicUpdates: window.__vivariumWorld.renderBudgetDiagnostics()
      .dynamicSnapshotUpdateCount,
  }));

  await page.evaluate((body) => {
    window.__vivariumDispatchMockEventSource(body);
  }, snapshotRequiredEnvelope(5));
  await expect.poll(() => boot.getWorldRequestCount()).toBeGreaterThan(1);
  await page.waitForFunction((previousCount) => (
    window.__vivariumWorld.renderBudgetDiagnostics().dynamicSnapshotUpdateCount > previousCount
  ), before.dynamicUpdates);

  const after = await page.evaluate(() => {
    const scenery = window.__vivariumWorld.sceneryDiagnostics();
    const springLight = window.__viv.scene.getObjectByName('spring-terraces-light');
    return {
      scenery,
      springLightParent: springLight?.parent?.name ?? null,
    };
  });

  expect(before.scenery.recipeVersion).toBe(1);
  expect(before.scenery.recipeHash).toEqual(expect.any(String));
  expect(before.scenery.recipeHash.length).toBeGreaterThan(20);
  expect(before.scenery.rebuildCount).toBe(1);
  expect(before.scenery.instanceCount).toBeGreaterThan(0);
  expect(before.scenery.objectCount).toBeGreaterThan(0);
  expect(before.scenery.crossingKinds.length).toBeGreaterThan(0);
  expect(before.scenery.regionArchetypes).toEqual({
    nirvana: 'worn_heartland',
    nirvana_east: 'dry_scrub',
    nirvana_west: 'ash_waste',
    warm_springs: 'spring_terraces',
  });
  expect(after.scenery.recipeHash).toBe(before.scenery.recipeHash);
  expect(after.scenery.rebuildCount).toBe(before.scenery.rebuildCount);
  expect(after.scenery.instanceCount).toBe(before.scenery.instanceCount);
  expect(after.scenery.regionArchetypes.nirvana_west).toBe('ash_waste');
  expect(after.springLightParent).toBe('region-scenery:warm_springs');
});

test('production renderer moves and restores dynamic scenery clearings without rebuilding the seeded scenery', async ({ page }) => {
  const movedWorld = {
    ...world,
    event_cursor: 5,
    world_time: 19.5,
    agents: world.agents.map((agent) => ({
      ...agent,
      position: {
        warm_springs: 'nirvana_east',
        nirvana_east: 'nirvana_west',
        nirvana_west: 'nirvana',
      }[agent.position] ?? agent.position,
    })),
    homes: world.homes.map((home, index) => ({
      ...home,
      region: index === 0 ? 'nirvana' : 'nirvana_east',
    })),
    ruins: world.ruins.map((ruin) => ({ ...ruin, region: 'warm_springs' })),
  };
  const clearedWorld = {
    ...movedWorld,
    event_cursor: 6,
    world_time: 20.5,
    agents: [],
    homes: [],
    ruins: [],
    pending_proposals: [],
  };
  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    [],
    [world, movedWorld, clearedWorld],
  );
  const readSceneryState = () => page.evaluate(() => {
    const entries = [];
    const roots = [];
    const sceneryRoots = [];
    window.__viv.scene.traverse((object) => {
      if (object.name.startsWith('region-scenery:')) sceneryRoots.push(object);
    });
    for (const root of sceneryRoots) {
      roots.push({ name: root.name, uuid: root.uuid });
      const region = root.name.slice('region-scenery:'.length);
      root.traverse((object) => {
        if (!object.isInstancedMesh) return;
        const values = object.instanceMatrix.array;
        for (let index = 0; index < object.count; index += 1) {
          const offset = index * 16;
          const scaleEnergy = [0, 1, 2, 4, 5, 6, 8, 9, 10]
            .reduce((sum, component) => sum + values[offset + component] ** 2, 0);
          entries.push({
            key: `${region}:${object.name}:${index}`,
            region,
            masked: scaleEnergy < 1e-10,
            x: values[offset + 12],
            z: values[offset + 14],
          });
        }
      });
    }
    return {
      diagnostics: window.__vivariumWorld.sceneryDiagnostics(),
      roots: roots.sort((left, right) => left.name.localeCompare(right.name)),
      entries: entries.sort((left, right) => left.key.localeCompare(right.key)),
      selectedAgent: window.__vivariumWorld.agentVisualState('agent_001'),
    };
  });

  const initial = await readSceneryState();
  expect(initial.diagnostics.maskedInstanceCount).toBeGreaterThan(0);
  expect(initial.diagnostics.visibleInstanceCount + initial.diagnostics.maskedInstanceCount)
    .toBe(initial.diagnostics.instanceCount);
  expect(initial.diagnostics.dynamicClearanceCount).toBe(
    world.agents.length + world.homes.length + world.ruins.length,
  );
  const selectedPoint = initial.selectedAgent.world;
  const selectedRegion = world.agents.find((agent) => agent.id === 'agent_001').position;
  const nearestVisibleScenery = initial.entries
    .filter((entry) => entry.region === selectedRegion && !entry.masked)
    .reduce((nearest, entry) => Math.min(
      nearest,
      Math.hypot(entry.x - selectedPoint.x, entry.z - selectedPoint.z),
    ), Number.POSITIVE_INFINITY);
  expect(nearestVisibleScenery).toBeGreaterThanOrEqual(3.2);

  await page.evaluate((body) => {
    window.__vivariumDispatchMockEventSource(body);
  }, snapshotRequiredEnvelope(5));
  await expect.poll(() => boot.getWorldRequestCount()).toBeGreaterThan(1);
  await page.waitForFunction((applyCount) => (
    window.__vivariumWorld.sceneryDiagnostics().dynamicClearanceApplyCount > applyCount
  ), initial.diagnostics.dynamicClearanceApplyCount);
  const moved = await readSceneryState();

  expect(moved.roots).toEqual(initial.roots);
  expect(moved.diagnostics.recipeHash).toBe(initial.diagnostics.recipeHash);
  expect(moved.diagnostics.rebuildCount).toBe(initial.diagnostics.rebuildCount);
  expect(moved.diagnostics.instanceCount).toBe(initial.diagnostics.instanceCount);
  expect(moved.diagnostics.dynamicClearanceCount).toBe(initial.diagnostics.dynamicClearanceCount);
  expect(moved.entries.filter((entry) => entry.masked).map((entry) => entry.key))
    .not.toEqual(initial.entries.filter((entry) => entry.masked).map((entry) => entry.key));

  await page.evaluate((body) => {
    window.__vivariumDispatchMockEventSource(body);
  }, snapshotRequiredEnvelope(6));
  await expect.poll(() => boot.getWorldRequestCount()).toBeGreaterThan(2);
  await page.waitForFunction((applyCount) => (
    window.__vivariumWorld.sceneryDiagnostics().dynamicClearanceApplyCount > applyCount
  ), moved.diagnostics.dynamicClearanceApplyCount);
  const cleared = await readSceneryState();

  expect(cleared.roots).toEqual(initial.roots);
  expect(cleared.diagnostics.recipeHash).toBe(initial.diagnostics.recipeHash);
  expect(cleared.diagnostics.rebuildCount).toBe(initial.diagnostics.rebuildCount);
  expect(cleared.diagnostics.instanceCount).toBe(initial.diagnostics.instanceCount);
  expect(cleared.diagnostics.dynamicClearanceCount).toBe(0);
  expect(cleared.diagnostics.maskedInstanceCount).toBe(0);
  expect(cleared.diagnostics.visibleInstanceCount).toBe(cleared.diagnostics.instanceCount);
  const clearedByKey = new Map(cleared.entries.map((entry) => [entry.key, entry]));
  for (const hidden of initial.entries.filter((entry) => entry.masked)) {
    const restored = clearedByKey.get(hidden.key);
    expect(restored).toMatchObject({ masked: false, x: hidden.x, z: hidden.z });
  }
});

test('production app rebuilds region scenery once when reduced-motion quality changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await bootApp(page, { width: 1440, height: 900 }, []);
  const full = await page.evaluate(() => window.__vivariumWorld.sceneryDiagnostics());

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction((previous) => {
    const diagnostics = window.__vivariumWorld.sceneryDiagnostics();
    return diagnostics.quality === 'reduced'
      && diagnostics.rebuildCount === previous.rebuildCount + 1;
  }, full);
  const reduced = await page.evaluate(() => window.__vivariumWorld.sceneryDiagnostics());

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const repeated = await page.evaluate(() => window.__vivariumWorld.sceneryDiagnostics());

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction((previous) => {
    const diagnostics = window.__vivariumWorld.sceneryDiagnostics();
    return diagnostics.quality === 'full'
      && diagnostics.rebuildCount === previous.rebuildCount + 1;
  }, reduced);
  const restored = await page.evaluate(() => window.__vivariumWorld.sceneryDiagnostics());

  expect(full.quality).toBe('full');
  expect(reduced.recipeHash).not.toBe(full.recipeHash);
  expect(reduced.instanceCount).toBeLessThan(full.instanceCount);
  expect(repeated.rebuildCount).toBe(reduced.rebuildCount);
  expect(repeated.recipeHash).toBe(reduced.recipeHash);
  expect(restored.recipeHash).toBe(full.recipeHash);
});

test('production app derives parametric home and ruin visuals from snapshot state', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 });

  const visuals = await page.evaluate(() => ({
    homeOne: window.__vivariumWorld.homeVisualState('home_001'),
    homeTwo: window.__vivariumWorld.homeVisualState('home_002'),
    ruin: window.__vivariumWorld.homeVisualState('home_old'),
    ownerVisual: window.__vivariumWorld.agentVisualState('agent_002')?.visual,
    stakeholderVisual: window.__vivariumWorld.agentVisualState('agent_003')?.visual,
    point: window.__vivariumWorld.worldPointForHome('home_002'),
  }));

  expect(visuals.homeOne.ruined).toBe(false);
  expect(visuals.homeOne.health).toBeCloseTo(1, 2);
  expect(visuals.homeOne.stakeholderCount).toBe(1);
  expect(visuals.homeOne.leanToCount).toBe(0);
  expect(visuals.homeOne.pennantCount).toBe(0);
  expect(visuals.homeOne.ownerId).toBe('agent_001');
  expect(visuals.homeOne.stakeholderIds).toEqual(['agent_001']);
  expect(visuals.homeOne.identityDerivedPennants).toBe(true);
  expect(visuals.homeOne.pennantColors).toEqual([]);

  expect(visuals.homeTwo.ruined).toBe(false);
  expect(visuals.homeTwo.ownerId).toBe('agent_002');
  expect(visuals.homeTwo.stakeholderIds).toEqual(['agent_002', 'agent_003', 'agent_004', 'agent_005']);
  expect(visuals.homeTwo.stakeholderCount).toBe(4);
  expect(visuals.homeTwo.growth).toBeGreaterThan(visuals.homeOne.growth);
  expect(visuals.homeTwo.health).toBeLessThan(0.25);
  expect(visuals.homeTwo.vaultRatio).toBe(1);
  expect(visuals.homeTwo.hoarding).toBe(true);
  expect(visuals.homeTwo.breached).toBe(true);
  expect(visuals.homeTwo.leanToCount).toBe(3);
  expect(visuals.homeTwo.pennantCount).toBe(3);
  expect(visuals.homeTwo.identityDerivedPennants).toBe(true);
  expect(visuals.homeTwo.pennantColors).toHaveLength(3);
  expect(visuals.homeTwo.pennantSource.map((source) => source.id)).toEqual(['agent_002', 'agent_003', 'agent_004']);
  expect(visuals.homeTwo.pennantSource.map((source) => source.index)).toEqual([0, 1, 2]);
  expect(visuals.homeTwo.pennantSource.map((source) => source.source)).toEqual(['agent-id', 'agent-id', 'agent-id']);
  expect(visuals.homeTwo.pennantSource[0]).toMatchObject({ role: 'owner', id: 'agent_002' });
  expect(visuals.homeTwo.pennantSource[1]).toMatchObject({ role: 'stakeholder', id: 'agent_003' });
  expect(visuals.homeTwo.ownerPaletteId).toBe(visuals.ownerVisual.paletteId);
  expect(visuals.homeTwo.pennantSource[1].paletteId).toBe(visuals.stakeholderVisual.paletteId);
  expect(visuals.homeTwo.pennantSource[1].color).toBe(visuals.stakeholderVisual.robeColor);
  for (const color of visuals.homeTwo.pennantColors) {
    expectHexColor(color);
  }
  expect(visuals.homeTwo.renderedParts).toBeGreaterThan(visuals.homeOne.renderedParts);

  expect(visuals.ruin.ruined).toBe(true);
  expect(visuals.ruin.ownerId).toBeNull();
  expect(visuals.ruin.stakeholderIds).toEqual([]);
  expect(visuals.ruin.stakeholderCount).toBe(0);
  expect(visuals.ruin.pennantCount).toBe(0);
  expect(visuals.ruin.identityDerivedPennants).toBe(false);
  expect(visuals.ruin.pennantColors).toEqual([]);
  expect(visuals.ruin.pennantSource).toEqual([]);
  expect(visuals.ruin.remnantRatio).toBeGreaterThan(0.75);
  expect(visuals.ruin.renderedParts).toBeGreaterThan(8);
  expect(Number.isFinite(visuals.point.x)).toBe(true);
  expect(Number.isFinite(visuals.point.z)).toBe(true);
});

test('production app keeps household pennants stable across stakeholder reorder and biography changes', async ({ page }) => {
  const reorderedWorld = {
    ...world,
    event_cursor: 5,
    world_time: 19.4,
    agents: world.agents.map((agent) => ({
      ...agent,
      name: `Renamed ${agent.id}`,
      persona: `changed persona ${agent.id}`,
      status: agent.id === 'agent_002' ? 'paralyzed' : agent.status,
      energy: agent.id === 'agent_002' ? 2 : agent.energy + 17,
      materials: agent.materials + 111,
      is_hoarding: true,
    })),
    homes: world.homes.map((home) => (
      home.home_id === 'home_002'
        ? { ...home, stakeholders: [...home.stakeholders].reverse() }
        : home
    )),
  };
  await bootApp(page, { width: 1440, height: 900 }, [], [world, reorderedWorld]);

  const before = await page.evaluate(() => ({
    home: window.__vivariumWorld.homeVisualState('home_002'),
    agents: Object.fromEntries(['agent_001', 'agent_002', 'agent_003'].map((id) => [
      id,
      window.__vivariumWorld.agentVisualState(id)?.visual,
    ])),
  }));

  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), snapshotRequiredEnvelope(5));
  await page.waitForFunction(() => window.__vivariumWorld.appliedEventCursors().includes(5));

  const after = await page.evaluate(() => ({
    home: window.__vivariumWorld.homeVisualState('home_002'),
    agents: Object.fromEntries(['agent_001', 'agent_002', 'agent_003'].map((id) => [
      id,
      window.__vivariumWorld.agentVisualState(id)?.visual,
    ])),
  }));

  expect(after.home.stakeholderIds).toEqual(before.home.stakeholderIds);
  expect(after.home.pennantColors).toEqual(before.home.pennantColors);
  expect(after.home.stakeholderPennantColors).toEqual(before.home.stakeholderPennantColors);
  expect(after.home.pennantSource).toEqual(before.home.pennantSource);
  expect(after.home.ownerPaletteId).toBe(before.home.ownerPaletteId);
  expect(after.home.ownerPennantColor).toBe(before.home.ownerPennantColor);
  expect(after.home.identityDerivedPennants).toBe(true);
  expect(after.home.pennantSource[0].color).toBe(before.home.pennantSource[0].color);
  expect(after.home.pennantSource[0].id).toBe('agent_002');
  for (const agentId of ['agent_001', 'agent_002', 'agent_003']) {
    expect(after.agents[agentId].identitySeed).toBe(before.agents[agentId].identitySeed);
    expect(after.agents[agentId].paletteId).toBe(before.agents[agentId].paletteId);
    expect(after.agents[agentId].robeColor).toBe(before.agents[agentId].robeColor);
    expect(after.agents[agentId].trimColor).toBe(before.agents[agentId].trimColor);
    expect(after.agents[agentId].accessory).toBe(before.agents[agentId].accessory);
  }

  await page.evaluate(() => {
    const visual = window.__vivariumWorld.homeVisualState('home_002');
    visual.stakeholderIds.push('mutated_agent');
    visual.pennantColors[0] = '#000000';
    visual.pennantSource[0].id = 'mutated_agent';
  });
  const reread = await page.evaluate(() => window.__vivariumWorld.homeVisualState('home_002'));
  expect(reread.stakeholderIds).toEqual(after.home.stakeholderIds);
  expect(reread.pennantColors).toEqual(after.home.pennantColors);
  expect(reread.pennantSource).toEqual(after.home.pennantSource);
});

test('production app does not treat low integrity alone as a breached home', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, envelope, {
    ...world,
    homes: world.homes.map((home) =>
      home.home_id === 'home_002'
        ? {
            ...home,
            breachers: [],
          }
        : home,
    ),
  });

  const visual = await page.evaluate(() => window.__vivariumWorld.homeVisualState('home_002'));
  expect(visual.health).toBeLessThan(0.25);
  expect(visual.breached).toBe(false);
  expect(visual.leanToCount).toBe(3);
});

test('production app keeps a home in the same world slot when another structure disappears', async ({ browser }) => {
  const withNeighbor = await browser.newPage();
  const withoutNeighbor = await browser.newPage();
  await bootApp(withNeighbor, { width: 1440, height: 900 });
  const pointWithNeighbor = await withNeighbor.evaluate(() => window.__vivariumWorld.worldPointForHome('home_002'));

  await bootApp(withoutNeighbor, { width: 1440, height: 900 }, envelope, {
    ...world,
    homes: world.homes.filter((home) => home.home_id !== 'home_001'),
  });
  const pointWithoutNeighbor = await withoutNeighbor.evaluate(() => window.__vivariumWorld.worldPointForHome('home_002'));
  await withNeighbor.close();
  await withoutNeighbor.close();

  expect(pointWithoutNeighbor.x).toBeCloseTo(pointWithNeighbor.x, 5);
  expect(pointWithoutNeighbor.z).toBeCloseTo(pointWithNeighbor.z, 5);
});

test('production app renders grouped home raid terminal choreography without mutating snapshot state', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, []);
  await openAtlasSurface(page, 'world');

  const beforeRaid = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    return {
      homeOne: debug.homeVisualState('home_001'),
      homeTwo: debug.homeVisualState('home_002'),
      homeOneWorld: debug.worldPointForHome('home_001'),
      homeTwoWorld: debug.worldPointForHome('home_002'),
      actor: debug.agentVisualState('agent_003'),
      previousOwner: debug.agentVisualState('agent_002'),
      selectedKind: document.querySelector('.inspector')?.getAttribute('data-selection-kind'),
      timelineButtons: document.querySelectorAll('.timeline-strip button').length,
    };
  });
  await openAtlasSurface(page, 'archive');
  const beforeReplayButtons = await page.locator('.replay-preview button').count();
  await openAtlasSurface(page, 'world');
  await waitForLiveWorldRenderer(page);

  await page.evaluate((body) => {
    window.__vivariumDispatchMockEventSource(body);
  }, groupedHomeRaidEnvelope);
  await waitForHomeRaidEffect(page, 'home_thieved', 'home_001');
  await waitForHomeRaidEffect(page, 'home_colonized', 'home_002');

  const afterRaid = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    const effects = debug.activeEffects();
    const theft = effects.find((effect) => (
      effect.eventType === 'home_thieved' &&
      effect.summary?.kind === 'home-theft-raid' &&
      effect.summary.homeId === 'home_001'
    ));
    const colonize = effects.find((effect) => (
      effect.eventType === 'home_colonized' &&
      effect.summary?.kind === 'home-colonize-raid' &&
      effect.summary.homeId === 'home_002'
    ));
    const bodyText = document.body.innerText;
    return {
      theft,
      colonize,
      effects,
      activeTypes: effects.map((effect) => effect.eventType),
      summaryKinds: effects.map((effect) => effect.summary?.kind).filter(Boolean),
      cursors: Array.from(debug.appliedEventCursors()),
      homeOne: debug.homeVisualState('home_001'),
      homeTwo: debug.homeVisualState('home_002'),
      homeOneWorld: debug.worldPointForHome('home_001'),
      homeTwoWorld: debug.worldPointForHome('home_002'),
      actor: debug.agentVisualState('agent_003'),
      previousOwner: debug.agentVisualState('agent_002'),
      selectedKind: document.querySelector('.inspector')?.getAttribute('data-selection-kind'),
      timelineButtons: document.querySelectorAll('.timeline-strip button').length,
    };
  });
  await openAtlasSurface(page, 'archive');
  const afterReplay = await page.evaluate(() => ({
    buttons: document.querySelectorAll('.replay-preview button').length,
    hasControlCopy: /\b(Seek|Scrub|Playback)\b/.test(document.body.innerText),
  }));

  expect(afterRaid.activeTypes).toEqual(expect.arrayContaining(['home_thieved', 'home_colonized']));
  expect(afterRaid.activeTypes).not.toContain('home_breached');
  expect(afterRaid.summaryKinds).not.toContain('home-breach-bubble');
  expect(afterRaid.summaryKinds).not.toContain('home-breach-shock');
  expect(afterRaid.cursors).toEqual(expect.arrayContaining(groupedHomeRaidCursors));
  expect(new Set(afterRaid.cursors).size).toBe(afterRaid.cursors.length);
  expectRendererSummaryCatalogIntegrity(afterRaid.effects, [
    'generic-event-arc',
    'generic-event-bubble',
    'generic-event-pulse',
    'home-colonize-raid',
    'home-theft-raid',
  ]);

  expect(afterRaid.homeOne).toEqual(beforeRaid.homeOne);
  expect(afterRaid.homeTwo).toEqual(beforeRaid.homeTwo);
  expect(afterRaid.homeOneWorld.x).toBeCloseTo(beforeRaid.homeOneWorld.x, 5);
  expect(afterRaid.homeOneWorld.z).toBeCloseTo(beforeRaid.homeOneWorld.z, 5);
  expect(afterRaid.homeTwoWorld.x).toBeCloseTo(beforeRaid.homeTwoWorld.x, 5);
  expect(afterRaid.homeTwoWorld.z).toBeCloseTo(beforeRaid.homeTwoWorld.z, 5);
  expect(afterRaid.actor.visible).toBe(true);
  expect(afterRaid.actor.world.x).toBeCloseTo(beforeRaid.actor.world.x, 5);
  expect(afterRaid.actor.world.z).toBeCloseTo(beforeRaid.actor.world.z, 5);
  expect(afterRaid.previousOwner.visible).toBe(true);
  expect(afterRaid.previousOwner.world.x).toBeCloseTo(beforeRaid.previousOwner.world.x, 5);
  expect(afterRaid.previousOwner.world.z).toBeCloseTo(beforeRaid.previousOwner.world.z, 5);
  expect(afterRaid.selectedKind).toBe(beforeRaid.selectedKind);

  expect(afterRaid.theft.summary).toMatchObject({
    kind: 'home-theft-raid',
    raidKind: 'theft',
    actorId: 'agent_003',
    targetId: 'agent_003',
    homeId: 'home_001',
    regionName: 'warm_springs',
    motionCue: 'breach-vault-strip-stream',
    anchorSource: 'home',
    anchorMode: 'home',
    homeAnchored: true,
    breachCue: true,
    thresholdGlow: true,
    thresholdLight: true,
    crackCue: true,
    vaultStream: true,
    standingHomeCue: true,
    lowIntegrityHomeCue: true,
    persistentHomeCreated: false,
    durableHomeCreated: false,
    durableHomeMutated: false,
    persistentOccupancy: false,
    actualActorMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(afterRaid.theft.summary.goldMotes).toBeGreaterThanOrEqual(8);
  expect(afterRaid.theft.summary.homeWorld[0]).toBeCloseTo(afterRaid.homeOneWorld.x, 2);
  expect(afterRaid.theft.summary.homeWorld[2]).toBeCloseTo(afterRaid.homeOneWorld.z, 2);
  expect(afterRaid.theft.summary.streamFromWorld[0]).toBeCloseTo(afterRaid.theft.summary.vaultWorld[0], 2);
  expect(afterRaid.theft.summary.streamToWorld[0]).toBeCloseTo(afterRaid.actor.world.x, 2);
  expect(afterRaid.theft.summary.streamToWorld[2]).toBeCloseTo(afterRaid.actor.world.z, 2);
  expect(afterRaid.theft.summary.actorPathWorld[0][0]).toBeCloseTo(afterRaid.actor.world.x, 2);
  expect(afterRaid.theft.summary.actorPathWorld[1][0]).toBeCloseTo(afterRaid.theft.summary.thresholdWorld[0], 2);
  expect(afterRaid.theft.summary.targetPathWorld[1][0]).toBeCloseTo(afterRaid.actor.world.x, 2);

  expect(afterRaid.colonize.summary).toMatchObject({
    kind: 'home-colonize-raid',
    raidKind: 'colonize',
    actorId: 'agent_003',
    targetId: 'agent_002',
    homeId: 'home_002',
    regionName: 'warm_springs',
    previousOwnerId: 'agent_002',
    newOwnerId: 'agent_003',
    previousStakeholderIds: ['agent_002'],
    visibleEvicteeIds: ['agent_002'],
    motionCue: 'breach-owner-flip-eviction',
    anchorSource: 'home',
    anchorMode: 'home',
    homeAnchored: true,
    breachCue: true,
    thresholdGlow: true,
    thresholdLight: true,
    crackCue: true,
    vaultStream: false,
    goldMotes: 0,
    bannerCue: true,
    pennantCue: true,
    ownerFlipCue: true,
    evictionHints: true,
    persistentHomeCreated: false,
    durableHomeCreated: false,
    durableHomeMutated: false,
    persistentOccupancy: false,
    actualActorMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(afterRaid.colonize.summary.evictionHintCount).toBeGreaterThanOrEqual(1);
  expect(afterRaid.colonize.summary.homeWorld[0]).toBeCloseTo(afterRaid.homeTwoWorld.x, 2);
  expect(afterRaid.colonize.summary.homeWorld[2]).toBeCloseTo(afterRaid.homeTwoWorld.z, 2);
  expect(afterRaid.colonize.summary.actorPathWorld[0][0]).toBeCloseTo(afterRaid.actor.world.x, 2);
  expect(afterRaid.colonize.summary.actorPathWorld[1][0]).toBeCloseTo(afterRaid.colonize.summary.thresholdWorld[0], 2);
  expect(afterRaid.colonize.summary.targetPathWorld[1][0]).toBeCloseTo(afterRaid.previousOwner.world.x, 2);
  expect(afterRaid.colonize.summary.targetPathWorld[1][2]).toBeCloseTo(afterRaid.previousOwner.world.z, 2);

  expect(beforeRaid.timelineButtons).toBe(0);
  expect(beforeReplayButtons).toBe(0);
  expect(afterRaid.timelineButtons).toBe(0);
  expect(afterReplay.buttons).toBe(0);
  expect(afterReplay.hasControlCopy).toBe(false);
});

test('production app anchors home_built scaffold to an existing snapshot home', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, burstEnvelope);
  await waitForHomeBuildEffect(page, 'home_001');

  const buildDebug = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    const build = debug.activeEffects().find((effect) => (
      effect.eventType === 'home_built' &&
      effect.summary?.kind === 'home-build' &&
      effect.summary.homeId === 'home_001'
    ));
    return {
      build,
      home: debug.worldPointForHome('home_001'),
    };
  });
  await openAtlasSurface(page, 'archive');
  const replayButtons = await page.locator('.replay-preview button').count();

  expectRendererSummarySubsetIntegrity([buildDebug.build], ['home-build']);
  expect(buildDebug.build.summary).toMatchObject({
    actorId: 'agent_001',
    anchorSource: 'home',
    anchorMode: 'home',
    buildSiteOnly: false,
    buildDust: true,
    buildRise: true,
    durableHomePresent: true,
    durableHomeCreated: false,
    homeAnchored: true,
    homeId: 'home_001',
    kind: 'home-build',
    motionCue: 'scaffold-to-home-rise',
    persistentHomeCreated: false,
    persistentOccupancy: false,
    regionName: 'warm_springs',
    scaffold: true,
    risingHome: true,
    warmRise: true,
  });
  expect(buildDebug.build.summary.scaffoldPoles).toBeGreaterThanOrEqual(4);
  expect(buildDebug.build.summary.scaffoldCrossbars).toBeGreaterThanOrEqual(8);
  expect(buildDebug.build.summary.buildSiteWorld[0]).toBeCloseTo(buildDebug.home.x, 2);
  expect(buildDebug.build.summary.buildSiteWorld[2]).toBeCloseTo(buildDebug.home.z, 2);
  expect(buildDebug.build.summary.homeWorld[0]).toBeCloseTo(buildDebug.home.x, 2);
  expect(buildDebug.build.summary.homeWorld[2]).toBeCloseTo(buildDebug.home.z, 2);
  expect(['scaffold', 'rising', 'settling']).toContain(buildDebug.build.summary.phase);
  expect(replayButtons).toBe(0);
});

test('production app keeps home_built event fallback transient until the home snapshot arrives', async ({ browser }) => {
  const staged = await browser.newPage();
  const direct = await browser.newPage();
  try {
    await bootApp(
      staged,
      { width: 1440, height: 900 },
      [{ delay: 60, body: homeBuildBeforeSnapshotEnvelope }],
      [world, worldWithStagedBuiltHome],
    );
    await waitForHomeBuildEffect(staged, 'home_003');

    const beforeSnapshot = await staged.evaluate(() => {
      const debug = window.__vivariumWorld;
      const build = debug.activeEffects().find((effect) => (
        effect.eventType === 'home_built' &&
        effect.summary?.kind === 'home-build' &&
        effect.summary.homeId === 'home_003'
      ));
      return {
        build,
        effects: debug.activeEffects(),
        actor: debug.agentVisualState('agent_001'),
        region: debug.worldPointForRegion('warm_springs'),
        home: debug.worldPointForHome('home_003'),
        homeScreen: debug.screenPointForHome('home_003'),
        homeVisual: debug.homeVisualState('home_003'),
      };
    });

    expectRendererSummaryCatalogIntegrity(beforeSnapshot.effects, [
      'generic-event-bubble',
      'home-build',
    ]);
    expect(beforeSnapshot.build.summary).toMatchObject({
      actorId: 'agent_001',
      anchorSource: 'planned',
      anchorMode: 'planned',
      buildSiteOnly: true,
      durableHomePresent: false,
      persistentHomeCreated: false,
      homeAnchored: false,
      homeId: 'home_003',
      kind: 'home-build',
      motionCue: 'scaffold-to-home-rise',
      scaffold: true,
      buildRise: true,
      buildDust: true,
      warmRise: true,
      risingHome: true,
    });
    expect(beforeSnapshot.build.summary.scaffoldPoles).toBeGreaterThanOrEqual(4);
    expect(beforeSnapshot.build.summary.scaffoldCrossbars).toBeGreaterThanOrEqual(8);
    expect(
      Math.hypot(
        beforeSnapshot.build.summary.buildSiteWorld[0] - beforeSnapshot.actor.world.x,
        beforeSnapshot.build.summary.buildSiteWorld[2] - beforeSnapshot.actor.world.z,
      ),
    ).toBeGreaterThan(1);
    expect(
      Math.hypot(
        beforeSnapshot.build.summary.buildSiteWorld[0] - beforeSnapshot.region.x,
        beforeSnapshot.build.summary.buildSiteWorld[2] - beforeSnapshot.region.z,
      ),
    ).toBeGreaterThan(1);
    expect(beforeSnapshot.home).toBeNull();
    expect(beforeSnapshot.homeScreen).toBeNull();
    expect(beforeSnapshot.homeVisual).toBeNull();

    await staged.evaluate((body) => {
      window.__vivariumDispatchMockEventSource(body);
    }, homeBuildSnapshotPulse);
    await staged.waitForFunction(() => Boolean(window.__vivariumWorld.worldPointForHome('home_003')), null, {
      timeout: 5000,
    });

    const afterSnapshot = await staged.evaluate(() => {
      const debug = window.__vivariumWorld;
      const build = debug.activeEffects().find((effect) => (
        effect.eventType === 'home_built' &&
        effect.summary?.kind === 'home-build' &&
        effect.summary.homeId === 'home_003'
      ));
      return {
        build,
        home: debug.worldPointForHome('home_003'),
        homeVisual: debug.homeVisualState('home_003'),
      };
    });
    await bootApp(direct, { width: 1440, height: 900 }, [], worldWithStagedBuiltHome);
    const directHome = await direct.evaluate(() => window.__vivariumWorld.worldPointForHome('home_003'));

    expectRendererSummarySubsetIntegrity([afterSnapshot.build], ['home-build']);
    expect(afterSnapshot.homeVisual.id).toBe('home_003');
    expect(afterSnapshot.build.summary.anchorSource).toBe('planned');
    expect(afterSnapshot.build.summary.anchorMode).toBe('planned');
    expect(afterSnapshot.build.summary.homeAnchored).toBe(true);
    expect(afterSnapshot.build.summary.buildSiteOnly).toBe(false);
    expect(afterSnapshot.build.summary.durableHomePresent).toBe(true);
    expect(afterSnapshot.build.summary.persistentHomeCreated).toBe(false);
    expect(afterSnapshot.build.summary.durableHomeCreated).toBe(false);
    expect(afterSnapshot.home.x).toBeCloseTo(beforeSnapshot.build.summary.buildSiteWorld[0], 2);
    expect(afterSnapshot.home.z).toBeCloseTo(beforeSnapshot.build.summary.buildSiteWorld[2], 2);
    expect(afterSnapshot.home.x).toBeCloseTo(directHome.x, 5);
    expect(afterSnapshot.home.z).toBeCloseTo(directHome.z, 5);
    await openAtlasSurface(staged, 'archive');
    expect(await staged.locator('.replay-preview button').count()).toBe(0);
  } finally {
    await staged.close();
    await direct.close();
  }
});

test('production app preserves deep trackpad zoom controls', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 });
  const before = await cameraState(page);
  const canvasBox = await page.getByTestId('vivarium-world-canvas').boundingBox();

  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(650);
  const after = await cameraState(page);

  expect(after.zoomSpeed).toBeGreaterThanOrEqual(3.4);
  expect(after.zoomToCursor).toBe(true);
  expect(after.minDistance).toBeLessThanOrEqual(3.2);
  expect(after.distance).toBeLessThan(before.distance - 25);
});

test('clicking a rendered region focuses the camera into that land mass', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 });
  const point = await page.evaluate(() => window.__vivariumWorld.screenPointForRegion('nirvana_east'));

  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(950);
  const after = await cameraState(page);

  expect(after.distance).toBeLessThanOrEqual(19);
  expect(after.target[0]).toBeGreaterThan(40);
  expect(after.target[2]).toBeLessThan(5);
});

test('clicking a rendered being selects the being rather than the terrain region', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 });
  const point = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_001'));

  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.inspector strong')).toHaveText('Aster');
  await expect(page.locator('.inspector')).toContainText('alive in warm springs');
  await expect(page.locator('.inspector')).toContainText('Flame');
  await expect(page.locator('.inspector')).toContainText('steady');
  await expect(page.locator('.inspector')).toContainText('Home stake');
  await expect(page.locator('.inspector')).toContainText('home 001');
  await expect(page.locator('.inspector')).toContainText('Pending offers');
  await expect(page.locator('.inspector')).toContainText('8 energy, 2 materials');
  await expect(page.locator('.inspector')).toContainText('open 6.5s');
  await expect(page.locator('.inspector')).toContainText('Cooldown');
  await expect(page.locator('.inspector')).toContainText('ready');
  await expect(page.locator('.inspector')).toContainText('Briar');
  await expect(page.locator('.inspector')).not.toContainText(/\bagent\b/i);
  await expect(page.locator('.inspector')).not.toContainText(/agent_\d+/i);

  const targetPoint = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_002'));
  await page.mouse.click(targetPoint.x, targetPoint.y);
  await expect(page.locator('.inspector strong')).toHaveText('Briar');
  await expect(page.locator('.inspector')).toContainText('Pending offers');
  await expect(page.locator('.inspector')).toContainText('Aster');
  await expect(page.locator('.inspector')).toContainText('8 energy, 2 materials');
  await expect(page.locator('.inspector')).toContainText('open 6.5s');
  await expect(page.locator('.inspector')).not.toContainText(/agent_\d+/i);
});

test('production app inspector renders region, home, and ruin snapshot facts', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 });

  const homePoint = await page.evaluate(() => window.__vivariumWorld.screenPointForHome('home_002'));
  await page.mouse.click(homePoint.x, homePoint.y);
  await expect(page.locator('.inspector strong')).toHaveText('home 002');
  await expect(page.locator('.inspector')).toContainText('Vault');
  await expect(page.locator('.inspector')).toContainText('360');
  await expect(page.locator('.inspector')).toContainText('Aster to Briar');
  await expect(page.locator('.inspector')).toContainText('open 6.5s');
  await expect(page.locator('.inspector')).toContainText('Breachers');
  await expect(page.locator('.inspector')).toContainText('Cinder');
  await expect(page.locator('.inspector')).toContainText('Repair direction');

  await clickStableProjectedWorldTarget(page, 'home', 'home_old');
  await expect(page.locator('.inspector strong')).toHaveText('home old');
  await expect(page.locator('.inspector')).toContainText('ruin in nirvana west');
  await expect(page.locator('.inspector')).toContainText('Remnant');
  await expect(page.locator('.inspector')).toContainText('64');
  await expect(page.locator('.inspector')).toContainText('Scavengeable');
  await expect(page.locator('.inspector')).toContainText('Fading');
  await expect(page.locator('.inspector')).toContainText('111.5s left');

  await expect(page.locator('.viv-event-bubble')).toHaveCount(0, { timeout: 8000 });
  await page.waitForTimeout(850);
  await expect(page.locator('.viv-event-bubble')).toHaveCount(0, { timeout: 8000 });
  await page.waitForTimeout(850);
  const regionPoint = await page.evaluate(() => window.__vivariumWorld.screenPointForRegion('warm_springs'));
  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('[data-testid="world-stage"] canvas');
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
    }));
    canvas.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: x,
      clientY: y,
    }));
  }, regionPoint);
  await expect(page.locator('.inspector strong')).toHaveText('warm springs');
  await expect(page.locator('.inspector')).toContainText('spring refuge');
  await expect(page.locator('.inspector')).toContainText('Connections');
  await expect(page.locator('.inspector')).toContainText('Aster');
  await expect(page.locator('.inspector')).toContainText('home 001');
});

test('production app uses run metadata constants for inspector timing', async ({ page }) => {
  const hostileRunId = 'hostile-run-id-stays-internal';
  const hostileUnknownConstantKey = 'hostile_unknown_constant_key_stays_internal';
  const hostileUnknownConstantValue = 987654.321;
  const hostileRunMetadataBannedCopy = [
    hostileRunId,
    'hostile-config-hash-stays-internal',
    'hostile-provider-stays-internal',
    'hostile-model-stays-internal',
    hostileUnknownConstantKey,
    String(hostileUnknownConstantValue),
    hostileUnknownConstantValue.toFixed(1),
    '987,654.321',
    'runs/',
    'hostile-events-artifact-dir',
    'hostile-events-artifact-file',
    'hostile-usage-artifact-dir',
    'hostile-usage-artifact-file',
    'hostile-snapshots-artifact-dir',
    'hostile-memory-artifact-dir',
    'hostile-memory-root',
    '/api/replay/artifacts',
  ];

  await bootApp(page, { width: 1440, height: 900 }, envelope, {
    ...world,
    run_id: hostileRunId,
  }, {
    ...run,
    run_id: hostileRunId,
    config_hash: 'hostile-config-hash-stays-internal',
    provider: 'hostile-provider-stays-internal',
    model: 'hostile-model-stays-internal',
    constants: {
      ...run.constants,
      mating_cooldown_seconds: 30,
      ruins_persist_seconds: 30,
      home_upkeep_materials_per_second: 0.1,
      [hostileUnknownConstantKey]: hostileUnknownConstantValue,
    },
    artifacts: {
      events: 'runs/hostile-events-artifact-dir/hostile-events-artifact-file.jsonl',
      usage: 'runs/hostile-usage-artifact-dir/hostile-usage-artifact-file.jsonl',
      snapshots: 'runs/hostile-snapshots-artifact-dir/snapshots_7.jsonl',
      memory_root: 'runs/hostile-memory-artifact-dir/hostile-memory-root',
    },
  }, {
    ...replayArtifactBodies,
    snapshots: replayArtifactBodies.snapshots.replaceAll(run.run_id, hostileRunId),
  });
  await openAtlasSurface(page, 'archive');
  await expect(page.getByTestId('archive-chronicle')).toHaveAttribute('data-archive-status', 'ready');
  await expect(timelineMetricValue(page, 'World view')).toHaveText('snapshots 7.jsonl');
  await expectNoRawRunMetadataCopy(page, hostileRunMetadataBannedCopy);

  await clickStableProjectedWorldTarget(page, 'agent', 'agent_002');
  await expect(page.locator('.inspector strong')).toHaveText('Briar');
  await expect(page.locator('.inspector')).toContainText('Cooldown');
  await expect(page.locator('.inspector')).toContainText('15.5s left');
  await expectNoRawRequiredRunConstantCopy(page);
  await expectNoRawRunMetadataCopy(page, hostileRunMetadataBannedCopy);

  await clickStableProjectedWorldTarget(page, 'home', 'home_old');
  await expect(page.locator('.inspector strong')).toHaveText('home old');
  await expect(page.locator('.inspector')).toContainText('Fading');
  await expect(page.locator('.inspector')).toContainText('21.5s left');
  await expectNoRawRequiredRunConstantCopy(page);
  await expectNoRawRunMetadataCopy(page, hostileRunMetadataBannedCopy);
});

test('production app derives home repair direction from stakeholder materials', async ({ page }) => {
  const repairWorld = {
    ...world,
    world_time: 20,
    agents: world.agents.map((agent) => {
      if (agent.id === 'agent_001') {
        return { ...agent, materials: 3, status: 'alive' };
      }
      if (agent.id === 'agent_002') {
        return { ...agent, materials: 1, status: 'paralyzed' };
      }
      if (agent.id === 'agent_003') {
        return { ...agent, materials: 0, status: 'alive' };
      }
      return agent;
    }),
    homes: world.homes.map((home) => {
      if (home.home_id === 'home_001') {
        return {
          ...home,
          integrity: 80,
          max_integrity: 120,
          last_upkeep_at: 18,
          vault_materials: 0,
          breachers: [],
          stakeholders: ['agent_001'],
        };
      }
      if (home.home_id === 'home_002') {
        return {
          ...home,
          integrity: 80,
          max_integrity: 187.5,
          last_upkeep_at: 18,
          vault_materials: 360,
          breachers: [],
          stakeholders: ['agent_002', 'agent_003'],
        };
      }
      return home;
    }),
  };
  await bootApp(page, { width: 1440, height: 900 }, [], repairWorld, {
    ...run,
    world_time: 20,
    constants: {
      ...run.constants,
      home_upkeep_materials_per_second: 1,
    },
  });

  const inspector = page.locator('.inspector');
  const repairDirection = inspector.locator('.fact-section dl').filter({ hasText: 'Repair direction' }).locator('dd');

  const fundedHome = await page.evaluate(() => window.__vivariumWorld.screenPointForHome('home_001'));
  await page.mouse.click(fundedHome.x, fundedHome.y);
  await expect(inspector.locator('strong')).toHaveText('home 001');
  await expect(inspector.locator('.fact-pill').filter({ hasText: 'Vault' }).locator('b')).toHaveText('0');
  await expect(repairDirection).toHaveText('mending');
  await expectNoRawRequiredRunConstantCopy(page);

  const vaultOnlyHome = await page.evaluate(() => window.__vivariumWorld.screenPointForHome('home_002'));
  await page.mouse.click(vaultOnlyHome.x, vaultOnlyHome.y);
  await expect(inspector.locator('strong')).toHaveText('home 002');
  await expect(inspector.locator('.fact-pill').filter({ hasText: 'Vault' }).locator('b')).toHaveText('360');
  await expect(repairDirection).toHaveText('wearing down');
  await expectNoRawRequiredRunConstantCopy(page);
});

test('production app chronicle and inspector recent history use structured event semantics', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, burstEnvelope);
  await waitForBurstEffects(page);
  await openAtlasSurface(page, 'chronicle');

  await expect(page.locator('.chronicle')).toContainText('ruins picked');
  await expect(page.locator('.chronicle')).toContainText('Cinder picked 6 materials from home old');
  await expect(page.locator('.chronicle')).toContainText('home seized');
  await expect(page.locator('.chronicle')).not.toContainText('home breached');
  await expect(page.locator('.chronicle')).not.toContainText('agent_003 · warm_springs');

  const homePoint = await page.evaluate(() => window.__vivariumWorld.screenPointForHome('home_002'));
  await page.mouse.click(homePoint.x, homePoint.y);
  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  await expect(focusPulse).toBeVisible();
  await expect(focusPulse).toHaveAttribute('data-focus-state', 'active');
  await expect(focusPulse).toHaveAttribute('data-focus-kind', 'home');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-kind', 'home');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-id', 'home_002');
  await expect(focusPulse).toHaveAttribute('data-focus-count', '1');
  await expect(focusPulse).toHaveAttribute('data-focus-window', '20-21');
  await expect(focusPulse).toHaveAttribute('data-focus-dominant-group', 'contest');
  await expect(focusPulse).toHaveAttribute('data-focus-latest-type', 'home_colonized');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-kind', 'home-seized');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-text', 'Cinder claims the hearth');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-chain-kind', 'breach-claim');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-chain-window', '20-21');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"] small')).toHaveText('Cinder claims the hearth');
  await expect(focusPulse.locator('[data-focus-group="contest"]')).toHaveAttribute('data-focus-group-count', '1');
  await expect(focusPulse.locator('[data-focus-latest-type="home_colonized"]')).toBeVisible();
  await expect(focusPulse.locator('[data-focus-latest-type="home_breached"]')).toHaveCount(0);
  await expect(page.locator('.inspector')).toContainText('Recent trail');
  await expect(page.locator('.inspector')).toContainText('home seized');
  await expect(page.locator('.inspector')).toContainText('Cinder');
  const homeClaimSummary = page.locator('.inspector-recent [data-event-type="home_colonized"]').first();
  await expect(homeClaimSummary).toBeVisible();
  await expect(homeClaimSummary).toHaveAttribute('data-event-group', 'contest');
  await expect(homeClaimSummary).toHaveAttribute('data-event-detail-kind', 'home-seized');
  await expect(homeClaimSummary).toHaveAttribute('data-event-detail-text', 'Cinder claims the hearth');
  await expect(homeClaimSummary).toHaveAttribute('data-event-chain-kind', 'breach-claim');
  await expect(homeClaimSummary).toHaveAttribute('data-event-chain-count', '2');
  await expect(homeClaimSummary).toHaveAttribute('data-event-chain-window', '20-21');
  await expect(homeClaimSummary).toHaveAttribute('data-event-chain-text', 'after breach');
  await expect(homeClaimSummary.locator('.event-summary-detail')).toHaveText('Cinder claims the hearth');
  await expect(homeClaimSummary.locator('.event-summary-chain')).toHaveText('after breach');
  await expect(page.locator('.inspector-recent')).not.toContainText('home breached');

  const agentPoint = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_001'));
  await page.mouse.click(agentPoint.x, agentPoint.y);
  await expect(page.locator('.inspector strong')).toHaveText('Aster');
  await expect(focusPulse).toHaveAttribute('data-focus-state', 'active');
  await expect(focusPulse).toHaveAttribute('data-focus-kind', 'being');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-kind', 'agent');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-id', 'agent_001');
  await expect(focusPulse).toHaveAttribute('data-focus-count', '8');
  await expect(focusPulse).toHaveAttribute('data-focus-window', '5-17');
  await expect(focusPulse).toHaveAttribute('data-focus-dominant-group', 'life');
  await expect(focusPulse).toHaveAttribute('data-focus-latest-type', 'home_built');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-kind', 'home-raised');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-text', 'Aster raises shelter');
  await expect(focusPulse.locator('[data-focus-group="life"]')).toBeVisible();
  await expect(focusPulse.locator('[data-focus-group="home"]')).toBeVisible();
  await expect(page.locator('.inspector-recent [data-event-type="speak"]').first()).toBeVisible();
  await expect(page.locator('.inspector-recent [data-event-type="speak"]').first()).toHaveAttribute('data-event-group', 'speech');
  const movementSummary = page.locator('.inspector-recent [data-event-cursor="6"][data-event-type="agent_entered_region"]');
  await expect(movementSummary).toBeVisible();
  await expect(movementSummary).toHaveAttribute('data-event-detail-kind', 'movement-arrival');
  await expect(movementSummary).toHaveAttribute('data-event-detail-text', 'from nirvana');
  await expect(movementSummary).toHaveAttribute('data-event-chain-kind', 'crossing');
  await expect(movementSummary).toHaveAttribute('data-event-chain-count', '2');
  await expect(movementSummary).toHaveAttribute('data-event-chain-window', '5-6');
  await expect(movementSummary).toHaveAttribute('data-event-chain-text', 'crossing complete');
  await expect(movementSummary.locator('.event-summary-detail')).toHaveText('from nirvana');
  await expect(movementSummary.locator('.event-summary-chain')).toHaveText('crossing complete');
  await expect(page.locator('.inspector-recent [data-event-cursor="5"]')).toHaveCount(0);
  await expect(page.locator('.inspector-recent')).toContainText('Being Being rally with a mind at the spring.');

  const ruinPoint = await page.evaluate(() => window.__vivariumWorld.screenPointForHome('home_old'));
  await page.mouse.click(ruinPoint.x, ruinPoint.y);
  await expect(page.locator('.inspector strong')).toHaveText('home old');
  await expect(focusPulse).toHaveAttribute('data-focus-state', 'active');
  await expect(focusPulse).toHaveAttribute('data-focus-kind', 'ruin');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-kind', 'home');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-id', 'home_old');
  await expect(focusPulse).toHaveAttribute('data-focus-count', '1');
  await expect(focusPulse).toHaveAttribute('data-focus-latest-type', 'ruins_scavenged');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-kind', 'ruin-scavenge');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-text', '6 materials gathered');
  const ruinSummary = page.locator('.inspector-recent [data-event-type="ruins_scavenged"]').first();
  await expect(ruinSummary).toBeVisible();
  await expect(ruinSummary).toHaveAttribute('data-event-group', 'contest');
  await expect(ruinSummary).toHaveAttribute('data-event-detail-kind', 'ruin-scavenge');
  await expect(ruinSummary).toHaveAttribute('data-event-detail-text', '6 materials gathered');
  await expect(ruinSummary).toHaveAttribute('data-event-chain-kind', 'none');
  await expect(ruinSummary.locator('.event-summary-detail')).toHaveText('6 materials gathered');
  await expect(ruinSummary.locator('.event-summary-chain')).toHaveCount(0);
  await expect(page.locator('.inspector-recent button')).toHaveCount(0);
  await expect(page.locator('.inspector-recent dialog')).toHaveCount(0);
  await expect(page.locator('.inspector-recent [role="dialog"]')).toHaveCount(0);

  await expect(page.locator('.viv-event-bubble')).toHaveCount(0, { timeout: 8000 });
  await page.waitForTimeout(850);
  await clickUnoccludedRegionSurface(page, 'warm_springs');
  await expect(page.locator('.inspector strong')).toHaveText('warm springs');
  await expect(focusPulse).toHaveAttribute('data-focus-state', 'active');
  await expect(focusPulse).toHaveAttribute('data-focus-kind', 'region');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-kind', 'region');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-id', 'warm_springs');
  await expect(focusPulse).toHaveAttribute('data-focus-latest-type', 'home_colonized');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-kind', 'home-seized');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-text', 'Cinder claims the hearth');
  await expect(focusPulse.locator('[data-focus-group="contest"]')).toBeVisible();
  const regionClaimSummary = page.locator('.inspector-recent [data-event-type="home_colonized"]').first();
  await expect(regionClaimSummary).toBeVisible();
  await expect(regionClaimSummary).toHaveAttribute('data-event-detail-kind', 'home-seized');
  await expect(regionClaimSummary).toHaveAttribute('data-event-detail-text', 'Cinder claims the hearth');
  await expect(regionClaimSummary.locator('.event-summary-detail')).toHaveText('Cinder claims the hearth');
  await expect(page.locator('.inspector-recent [data-event-type="agent_recovered"]').first()).toBeVisible();
  await expect(page.locator('.focus-pulse button, .focus-pulse select')).toHaveCount(0);
  await expect(page.locator('.focus-pulse dialog, .focus-pulse [role="dialog"], .focus-pulse [role="button"]')).toHaveCount(0);
  await expect(page.locator('.timeline-strip')).toHaveCount(0);
  expect(await viewportLayoutIssues(page)).toEqual([]);
});

test('production app includes regionless targeted bond events in selected region trails by participant position', async ({ page }) => {
  const regionlessBondEnvelope = {
    schema: 1,
    cursor: 4,
    oldest_cursor: 0,
    next_cursor: 11,
    events: [
      eventEntry(
        5,
        'mating_initiated',
        'agent_001',
        {
          message: 'Aster offers a regionless bond.',
          initiator_id: 'agent_001',
          target_id: 'agent_002',
          resources: { energy: 50, materials: 30 },
        },
        { actor_id: 'agent_001', target_id: 'agent_002' },
        { scope: 'targeted', region: null, target: 'agent_002' },
      ),
      eventEntry(
        6,
        'mating_rejected',
        'agent_002',
        {
          message: 'Briar declines a regionless bond.',
          rejecter_id: 'agent_002',
          initiator_id: 'agent_001',
          target_id: 'agent_002',
          resources_refunded: { energy: 50, materials: 30 },
        },
        { actor_id: 'agent_002', target_id: 'agent_001' },
        { scope: 'targeted', region: null, target: 'agent_001' },
      ),
      eventEntry(
        7,
        'mating_proposal_invalidated',
        'agent_001',
        {
          initiator_id: 'agent_001',
          target_id: 'agent_002',
          reason: 'initiator_ineligible',
          resources_refunded: { energy: 50, materials: 30 },
        },
        { actor_id: 'agent_001', target_id: 'agent_001' },
        { scope: 'targeted', region: null, target: 'agent_001' },
      ),
      eventEntry(
        8,
        'mating_proposal_timeout',
        'agent_001',
        {
          initiator_id: 'agent_001',
          target_id: 'agent_002',
          reason: 'timeout',
          resources_refunded: { energy: 50, materials: 30 },
        },
        { actor_id: 'agent_001', target_id: 'agent_001' },
        { scope: 'targeted', region: null, target: 'agent_001' },
      ),
      eventEntry(
        9,
        'self_talk',
        'agent_001',
        {
          agent_id: 'agent_001',
          message: 'Private regionless thought should stay out of region trails.',
        },
        { actor_id: 'agent_001' },
        { scope: 'private', region: null },
      ),
      eventEntry(
        10,
        'simulation_started',
        'world',
        {
          run_id: 'seed-7-app-test',
          agent_count: 3,
          world_time: 0,
        },
        {},
        { scope: 'global', region: null },
      ),
    ],
    overflow: false,
    snapshot_required: false,
  };

  await bootApp(page, { width: 1440, height: 900 }, regionlessBondEnvelope, {
    ...world,
    event_cursor: 11,
    agents: world.agents.map((agent) => (
      agent.id === 'agent_002'
        ? { ...agent, position: 'warm_springs', status: 'alive' }
        : agent
    )),
  });

  const regionPoint = await page.evaluate(() => window.__vivariumWorld.screenPointForRegion('warm_springs'));
  await page.mouse.click(regionPoint.x, regionPoint.y);
  const inspectorRecent = page.locator('.inspector-recent');
  await expect(page.locator('.inspector strong')).toHaveText('warm springs');
  await expect(page.getByTestId('selected-focus-activity-pulse')).toHaveAttribute('data-focus-selection-id', 'warm_springs');

  const offer = inspectorRecent.locator('[data-event-cursor="5"][data-event-type="mating_initiated"]');
  await expect(offer).toBeVisible();
  await expect(offer).toHaveAttribute('data-event-group', 'bond');
  await expect(offer).toHaveAttribute('data-event-detail-kind', 'bond-call');
  await expect(offer).toHaveAttribute('data-event-detail-text', 'to Briar');

  const rejected = inspectorRecent.locator('[data-event-cursor="6"][data-event-type="mating_rejected"]');
  await expect(rejected).toBeVisible();
  await expect(rejected).toHaveAttribute('data-event-detail-kind', 'bond-refused');
  await expect(rejected).toHaveAttribute('data-event-detail-text', 'Briar turns away');

  for (const cursor of ['7', '8']) {
    const faded = inspectorRecent.locator(`[data-event-cursor="${cursor}"]`);
    await expect(faded).toBeVisible();
    await expect(faded).toHaveAttribute('data-event-detail-kind', 'bond-faded');
    await expect(faded).toHaveAttribute('data-event-detail-text', 'bond thread fades');
  }
  await expect(inspectorRecent.locator('[data-event-type="self_talk"]')).toHaveCount(0);
  await expect(inspectorRecent.locator('[data-event-cursor="10"][data-event-type="simulation_started"]')).toHaveCount(0);
  await expect(inspectorRecent).not.toContainText('Private regionless thought');
  await expect(inspectorRecent).not.toContainText('3 beings awake');
  await expect(page.locator('.focus-pulse button, .focus-pulse select')).toHaveCount(0);
  await expect(page.locator('.inspector-recent button')).toHaveCount(0);
});

test('production app keeps dense selected-region trails readable across responsive viewports', async ({ page }) => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900, scrollOwner: 'surface' },
    { name: 'mobile', width: 390, height: 844, scrollOwner: 'surface' },
    { name: 'low-height desktop', width: 1440, height: 650, scrollOwner: 'surface' },
  ]) {
    await bootApp(
      page,
      { width: viewport.width, height: viewport.height },
      denseSelectedRegionEnvelope,
      denseSelectedRegionWorld,
    );

    const regionPoint = await page.evaluate(() => window.__vivariumWorld.screenPointForRegion('warm_springs'));
    await page.mouse.click(regionPoint.x, regionPoint.y);

    const inspectorRecent = page.locator('.inspector-recent');
    await expect(page.locator('.inspector strong')).toHaveText('warm springs');
    await expect(page.getByTestId('selected-focus-activity-pulse')).toHaveAttribute('data-focus-selection-id', 'warm_springs');
    await expect(inspectorRecent.locator('.event-summary[data-event-kind="event"]')).toHaveCount(160);
    await expect(inspectorRecent.locator('[data-event-cursor="174"][data-event-type="speak"]')).toBeVisible();
    await expect(inspectorRecent.locator('[data-event-cursor="11"][data-event-type="speak"]')).toBeVisible();
    await expect(inspectorRecent.locator('[data-event-cursor="10"]')).toHaveCount(0);

    await expect(inspectorRecent.locator('[data-event-cursor="30"][data-event-type="mating_initiated"]')).toHaveAttribute('data-event-detail-kind', 'bond-call');
    await expect(inspectorRecent.locator('[data-event-cursor="31"][data-event-type="mating_rejected"]')).toHaveAttribute('data-event-detail-text', 'Briar turns away');
    await expect(inspectorRecent.locator('[data-event-cursor="32"][data-event-type="mating_proposal_invalidated"]')).toHaveAttribute('data-event-detail-kind', 'bond-faded');
    await expect(inspectorRecent.locator('[data-event-cursor="33"][data-event-type="mating_proposal_timeout"]')).toHaveAttribute('data-event-detail-kind', 'bond-faded');
    await expect(inspectorRecent.locator('[data-event-cursor="48"][data-event-type="home_built"]')).toHaveAttribute('data-event-detail-text', 'Aster raises shelter');
    await expect(inspectorRecent.locator('[data-event-cursor="52"][data-event-type="hearth_used"]')).toHaveAttribute('data-event-detail-text', 'Aster takes shelter');
    await expect(inspectorRecent.locator('[data-event-cursor="71"][data-event-type="agent_entered_region"]')).toHaveAttribute('data-event-chain-text', 'crossing complete');
    await expect(inspectorRecent.locator('[data-event-cursor="91"][data-event-type="home_thieved"]')).toHaveAttribute('data-event-chain-text', 'after breach');
    await expect(inspectorRecent.locator('[data-event-cursor="111"][data-event-type="agent_paralyzed"]')).toHaveAttribute('data-event-chain-text', 'after strike');
    await expect(inspectorRecent.locator('[data-event-cursor="120"][data-event-type="agent_born"]')).toBeVisible();
    await expect(inspectorRecent.locator('[data-event-cursor="130"][data-event-type="ruins_scavenged"]')).toHaveAttribute('data-event-detail-text', '6 materials gathered');
    await expect(inspectorRecent.locator('[data-event-cursor="140"][data-event-type="agent_decayed"]')).toHaveAttribute('data-event-detail-text', 'Briar returns');
    await expect(inspectorRecent.locator('[data-event-cursor="150"][data-event-type="home_collapsed"]')).toHaveAttribute('data-event-detail-text', 'hearth crumbles');
    await expect(inspectorRecent.locator('[data-event-cursor="70"][data-event-type="agent_left_region"]')).toHaveCount(0);
    await expect(inspectorRecent.locator('[data-event-cursor="90"][data-event-type="home_breached"]')).toHaveCount(0);
    await expect(inspectorRecent.locator('[data-event-cursor="110"][data-event-type="attack"]')).toHaveCount(0);
    await expect(inspectorRecent.locator('[data-event-cursor="168"][data-event-type="self_talk"]')).toHaveCount(0);
    await expect(inspectorRecent).not.toContainText('Dense private thought');

    const state = await selectedInspectorRecentSurfaceState(page);
    expect(state.exists, viewport.name).toBe(true);
    expect(state.documentOverflow, viewport.name).toBeLessThanOrEqual(1);
    expect(state.controlCount, viewport.name).toBe(0);
    expect(state.clipped, viewport.name).toEqual([]);
    expect(state.clientHeight, viewport.name).toBeGreaterThan(0);
    expect(
      selectedTrailScrollOwner(state),
      `${viewport.name} ${JSON.stringify({
        recent: [state.overflowY, state.clientHeight, state.scrollHeight],
        inspector: [state.inspectorOverflowY, state.inspectorClientHeight, state.inspectorScrollHeight],
        surface: [state.surfaceOverflowY, state.surfaceClientHeight, state.surfaceScrollHeight],
        document: [state.documentOverflowY, state.documentClientHeight, state.documentScrollHeight],
      })}`,
    ).toBe(viewport.scrollOwner);
    expect(state.rows, viewport.name).toHaveLength(160);
    const cursors = state.rows.map((row) => Number(row.cursor));
    expect(cursors, viewport.name).toEqual([...cursors].sort((left, right) => right - left));
    expect(cursors[0], viewport.name).toBe(174);
    expect(cursors.at(-1), viewport.name).toBe(11);
    expect(state.rows.map((row) => row.type), viewport.name).toEqual(expect.arrayContaining([
      'speak',
      'mating_initiated',
      'mating_rejected',
      'mating_proposal_invalidated',
      'mating_proposal_timeout',
      'home_built',
      'hearth_used',
      'agent_entered_region',
      'home_thieved',
      'agent_paralyzed',
      'agent_born',
      'ruins_scavenged',
      'agent_decayed',
      'home_collapsed',
    ]));
    expect(state.rows.map((row) => row.type), viewport.name).not.toEqual(expect.arrayContaining([
      'agent_left_region',
      'home_breached',
      'attack',
      'self_talk',
    ]));
    const shellState = await page.evaluate(() => {
      const drawer = document.querySelector('[data-atlas-surface][data-open="true"]');
      const rect = drawer?.getBoundingClientRect();
      return {
        openSurfaces: document.querySelectorAll(
          '[data-atlas-surface][data-open="true"]',
        ).length,
        drawer: rect ? {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        } : null,
        viewport: { width: innerWidth, height: innerHeight },
        bodyScroll:
          document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
      };
    });
    expect(shellState.openSurfaces, viewport.name).toBe(1);
    expect(shellState.drawer, viewport.name).not.toBeNull();
    expect(shellState.drawer.left, viewport.name).toBeGreaterThanOrEqual(-1);
    expect(shellState.drawer.top, viewport.name).toBeGreaterThanOrEqual(-1);
    expect(shellState.drawer.right, viewport.name).toBeLessThanOrEqual(shellState.viewport.width + 1);
    expect(shellState.drawer.bottom, viewport.name).toBeLessThanOrEqual(shellState.viewport.height + 1);
    expect(shellState.bodyScroll, viewport.name).toBeLessThanOrEqual(1);
  }
});

test('production app chronicle passively retains older salient live beats through routine bursts', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, liveChronicleRetentionEnvelope);
  await openAtlasSurface(page, 'chronicle');

  const chronicle = page.locator('.chronicle');
  await expect(chronicle.locator('[data-event-cursor="20"][data-event-type="speak"]')).toBeVisible();
  await expect(chronicle.locator('[data-event-cursor="11"][data-event-type="speak"]')).toBeVisible();
  await expect(chronicle.locator('[data-event-cursor="10"][data-event-type="speak"]')).toHaveCount(0);
  await expect(chronicle.locator('[data-event-cursor="5"][data-event-type="agent_died"]')).toBeVisible();
  await expect(chronicle.locator('.event-row[data-event-kind="event"]')).toHaveCount(11);
  await expect(chronicle.locator('.event-row-action')).toHaveCount(11);
  await expect(chronicle.locator('button:not(.event-row-action), .event-gap .event-row-action')).toHaveCount(0);
  await expect(chronicle.locator('dialog')).toHaveCount(0);
  await expect(chronicle.locator('[role="dialog"]')).toHaveCount(0);
  const chronicleState = await chronicleLegibilityState(page);
  expect(chronicleState.buttonCount).toBe(chronicleState.actionCount);
  expect(chronicleState.rows).toHaveLength(11);
  expect(chronicleState.documentOverflow).toBeLessThanOrEqual(1);
  expect(chronicleState.chronicleGridRowCount).toBeGreaterThanOrEqual(chronicleState.chronicleChildCount);
  expect(chronicleState.eventList).toMatchObject({
    isLastChild: true,
    minHeight: '0px',
    overflowY: 'auto',
  });
  expect(chronicleState.eventList.clientHeight).toBeGreaterThan(0);
  expect(chronicleState.eventList.scrollHeight).toBeGreaterThanOrEqual(chronicleState.eventList.clientHeight);
  for (const row of chronicleState.rows) {
    expect(row.type).toBeTruthy();
    expect(row.group).toBeTruthy();
    expect(row.tone).toBeTruthy();
    expect(row.headerDisplay).toBe('grid');
    expect(row.clipped).toBe(false);
  }
  expectAtlasSurfaceBounded(await atlasSurfaceBounds(page), 'retained Chronicle');
  expect(await viewportLayoutIssues(page)).toEqual([]);
});

test('production app selected trails keep grouped hidden-beat relevance', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, groupedHiddenRelevanceEnvelope);
  await openAtlasSurface(page, 'chronicle');

  await expect(page.locator('.chronicle [data-event-cursor="31"][data-event-type="agent_started_hoarding"]')).toBeVisible();
  await expect(page.locator('.chronicle [data-event-cursor="33"][data-event-type="agent_started_hoarding"]')).toBeVisible();
  await expect(page.locator('.chronicle [data-event-cursor="35"][data-event-type="agent_died"]')).toBeVisible();
  await expect(page.locator('.chronicle [data-event-cursor="30"]')).toHaveCount(0);
  await expect(page.locator('.chronicle [data-event-cursor="32"]')).toHaveCount(0);
  await expect(page.locator('.chronicle [data-event-cursor="34"]')).toHaveCount(0);

  const appliedCursors = await page.evaluate(() => Array.from(window.__vivariumWorld.appliedEventCursors()));
  expect(appliedCursors).toEqual(expect.arrayContaining(groupedHiddenRelevanceCursors));
  expect(new Set(appliedCursors).size).toBe(appliedCursors.length);
  await waitForNoActiveEventBubbles(page);
  const renderedAfterExpiry = await page.evaluate(() => (
    window.__vivariumWorld.recentRenderedEventBeats().map((beat) => ({
      cursor: beat.cursor,
      eventType: beat.eventType,
      hasBubble: beat.hasBubble,
    }))
  ));
  expect(renderedAfterExpiry).toEqual(expect.arrayContaining([
    expect.objectContaining({ cursor: 31, eventType: 'agent_started_hoarding', hasBubble: true }),
    expect.objectContaining({ cursor: 33, eventType: 'agent_started_hoarding', hasBubble: true }),
    expect.objectContaining({ cursor: 35, eventType: 'agent_died', hasBubble: true }),
  ]));
  expect(renderedAfterExpiry.map((beat) => beat.cursor)).not.toEqual(expect.arrayContaining([30, 32, 34]));

  const agentPoint = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_001'));
  await page.mouse.click(agentPoint.x, agentPoint.y);
  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  await expect(page.locator('.inspector strong')).toHaveText('Aster');
  await expect(focusPulse).toHaveAttribute('data-focus-state', 'active');
  await expect(focusPulse).toHaveAttribute('data-focus-kind', 'being');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-kind', 'agent');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-id', 'agent_001');
  await expect(focusPulse).toHaveAttribute('data-focus-count', '2');
  await expect(focusPulse).toHaveAttribute('data-focus-window', '30-33');
  await expect(focusPulse).toHaveAttribute('data-focus-dominant-group', 'resource');
  await expect(focusPulse).toHaveAttribute('data-focus-latest-type', 'agent_started_hoarding');
  await expect(focusPulse).toHaveAttribute('data-focus-retention-state', 'retained');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-cursor', '33');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-type', 'agent_started_hoarding');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-kind', 'being-hoard');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-text', 'Aster holds a great store');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-chain-kind', 'hearth-hoard');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-chain-window', '32-33');
  await expect(focusPulse.locator('[data-focus-latest-type="resource_transferred"]')).toHaveCount(0);
  const selectedBeingSharedHoardSummary = page.locator('.inspector-recent [data-event-cursor="31"][data-event-type="agent_started_hoarding"]');
  await expect(selectedBeingSharedHoardSummary).toBeVisible();
  await expect(selectedBeingSharedHoardSummary).toHaveAttribute('data-event-detail-kind', 'being-hoard');
  await expect(selectedBeingSharedHoardSummary).toHaveAttribute('data-event-detail-text', 'Briar holds a great store');
  await expect(selectedBeingSharedHoardSummary).toHaveAttribute('data-event-chain-kind', 'shared-hoard');
  await expect(selectedBeingSharedHoardSummary).toHaveAttribute('data-event-chain-count', '2');
  await expect(selectedBeingSharedHoardSummary).toHaveAttribute('data-event-chain-window', '30-31');
  await expect(selectedBeingSharedHoardSummary).toHaveAttribute('data-event-chain-text', 'after sharing');
  await expect(selectedBeingSharedHoardSummary.locator('.event-summary-detail')).toHaveText('Briar holds a great store');
  await expect(selectedBeingSharedHoardSummary.locator('.event-summary-chain')).toHaveText('after sharing');
  const selectedBeingHearthHoardSummary = page.locator('.inspector-recent [data-event-cursor="33"][data-event-type="agent_started_hoarding"]');
  await expect(selectedBeingHearthHoardSummary).toBeVisible();
  await expect(selectedBeingHearthHoardSummary).toHaveAttribute('data-event-detail-kind', 'being-hoard');
  await expect(selectedBeingHearthHoardSummary).toHaveAttribute('data-event-detail-text', 'Aster holds a great store');
  await expect(selectedBeingHearthHoardSummary).toHaveAttribute('data-event-chain-kind', 'hearth-hoard');
  await expect(selectedBeingHearthHoardSummary).toHaveAttribute('data-event-chain-count', '2');
  await expect(selectedBeingHearthHoardSummary).toHaveAttribute('data-event-chain-window', '32-33');
  await expect(selectedBeingHearthHoardSummary).toHaveAttribute('data-event-chain-text', 'after hearth');
  await expect(selectedBeingHearthHoardSummary.locator('.event-summary-detail')).toHaveText('Aster holds a great store');
  await expect(selectedBeingHearthHoardSummary.locator('.event-summary-chain')).toHaveText('after hearth');
  await expect(page.locator('.inspector-recent [data-event-cursor="30"]')).toHaveCount(0);
  await expect(page.locator('.inspector-recent [data-event-cursor="35"]')).toHaveCount(0);

  const homePoint = await page.evaluate(() => window.__vivariumWorld.screenPointForHome('home_001'));
  await page.mouse.click(homePoint.x, homePoint.y);
  await expect(page.locator('.inspector strong')).toHaveText('home 001');
  await expect(focusPulse).toHaveAttribute('data-focus-kind', 'home');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-kind', 'home');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-id', 'home_001');
  await expect(focusPulse).toHaveAttribute('data-focus-count', '1');
  await expect(focusPulse).toHaveAttribute('data-focus-window', '32-33');
  await expect(focusPulse).toHaveAttribute('data-focus-latest-type', 'agent_started_hoarding');
  await expect(focusPulse).toHaveAttribute('data-focus-retention-state', 'retained');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-cursor', '33');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-type', 'agent_started_hoarding');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-kind', 'being-hoard');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-text', 'Aster holds a great store');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-chain-kind', 'hearth-hoard');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-chain-window', '32-33');
  await expect(focusPulse.locator('[data-focus-latest-type="hearth_used"]')).toHaveCount(0);
  const selectedHomeHoardSummary = page.locator('.inspector-recent [data-event-cursor="33"][data-event-type="agent_started_hoarding"]');
  await expect(selectedHomeHoardSummary).toBeVisible();
  await expect(selectedHomeHoardSummary).toHaveAttribute('data-event-detail-kind', 'being-hoard');
  await expect(selectedHomeHoardSummary).toHaveAttribute('data-event-detail-text', 'Aster holds a great store');
  await expect(selectedHomeHoardSummary).toHaveAttribute('data-event-chain-kind', 'hearth-hoard');
  await expect(selectedHomeHoardSummary).toHaveAttribute('data-event-chain-count', '2');
  await expect(selectedHomeHoardSummary).toHaveAttribute('data-event-chain-window', '32-33');
  await expect(selectedHomeHoardSummary).toHaveAttribute('data-event-chain-text', 'after hearth');
  await expect(selectedHomeHoardSummary.locator('.event-summary-detail')).toHaveText('Aster holds a great store');
  await expect(selectedHomeHoardSummary.locator('.event-summary-chain')).toHaveText('after hearth');
  await expect(page.locator('.inspector-recent [data-event-cursor="31"]')).toHaveCount(0);
  await expect(page.locator('.inspector-recent [data-event-cursor="32"]')).toHaveCount(0);
  await expect(page.locator('.inspector-recent [data-event-cursor="35"]')).toHaveCount(0);

  const regionPoint = await page.evaluate(() => window.__vivariumWorld.screenPointForRegion('nirvana_west'));
  await page.mouse.click(regionPoint.x, regionPoint.y);
  await expect(page.locator('.inspector strong')).toHaveText('nirvana west');
  await expect(focusPulse).toHaveAttribute('data-focus-kind', 'region');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-kind', 'region');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-id', 'nirvana_west');
  await expect(focusPulse).toHaveAttribute('data-focus-count', '1');
  await expect(focusPulse).toHaveAttribute('data-focus-window', '34-35');
  await expect(focusPulse).toHaveAttribute('data-focus-latest-type', 'agent_died');
  await expect(focusPulse).toHaveAttribute('data-focus-retention-state', 'retained');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-cursor', '35');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-type', 'agent_died');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-kind', 'death');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-text', 'felled by Cinder');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-chain-kind', 'strike-death');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-chain-window', '34-35');
  await expect(focusPulse.locator('[data-focus-latest-type="attack"]')).toHaveCount(0);
  const selectedRegionDeathSummary = page.locator('.inspector-recent [data-event-cursor="35"][data-event-type="agent_died"]');
  await expect(selectedRegionDeathSummary).toBeVisible();
  await expect(selectedRegionDeathSummary).toHaveAttribute('data-event-detail-kind', 'death');
  await expect(selectedRegionDeathSummary).toHaveAttribute('data-event-detail-text', 'felled by Cinder');
  await expect(selectedRegionDeathSummary).toHaveAttribute('data-event-chain-kind', 'strike-death');
  await expect(selectedRegionDeathSummary).toHaveAttribute('data-event-chain-count', '2');
  await expect(selectedRegionDeathSummary).toHaveAttribute('data-event-chain-window', '34-35');
  await expect(selectedRegionDeathSummary).toHaveAttribute('data-event-chain-text', 'after strike');
  await expect(selectedRegionDeathSummary.locator('.event-summary-detail')).toHaveText('felled by Cinder');
  await expect(selectedRegionDeathSummary.locator('.event-summary-chain')).toHaveText('after strike');
  await expect(page.locator('.inspector-recent [data-event-cursor="31"]')).toHaveCount(0);
  await expect(page.locator('.inspector-recent [data-event-cursor="33"]')).toHaveCount(0);
  await expect(page.locator('.inspector-recent [data-event-cursor="34"]')).toHaveCount(0);

  await expect(page.locator('.focus-pulse button, .focus-pulse select')).toHaveCount(0);
  await expect(page.locator('.focus-pulse dialog, .focus-pulse [role="dialog"], .focus-pulse [role="button"]')).toHaveCount(0);
  await expect(page.locator('.inspector-recent button')).toHaveCount(0);
  await expect(page.locator('.inspector-recent dialog')).toHaveCount(0);
  await expect(page.locator('.inspector-recent [role="dialog"]')).toHaveCount(0);
  await expect(page.locator('.timeline-strip')).toHaveCount(0);
});

test('production app keeps selected compact details full prose and gap rows readable on mobile and narrow desktop', async ({ page }) => {
  for (const viewport of [
    { name: 'mobile', width: 390, height: 844, checkViewportBounds: false },
    { name: 'narrow desktop', width: 981, height: 560, checkViewportBounds: true },
  ]) {
    await bootApp(
      page,
      { width: viewport.width, height: viewport.height },
      selectedCompactGapEnvelopePlan,
      [world, selectedCompactGapRecoveredWorld],
    );
    await openAtlasSurface(page, 'chronicle');

    await expect(page.locator('.chronicle .event-row.event-gap')).toBeVisible();
    await expect(page.locator('.chronicle [data-event-cursor="40"][data-event-type="home_built"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(0);
    await waitForLiveWorldRenderer(page);
    await clickStableProjectedWorldTarget(page, 'agent', 'agent_001');

    const inspectorRecent = page.locator('.inspector-recent');
    const focusPulse = page.getByTestId('selected-focus-activity-pulse');
    await expect(page.locator('.inspector strong')).toHaveText('Aster');
    await expect(focusPulse).toHaveAttribute('data-focus-state', 'active');
    await expect(focusPulse).toHaveAttribute('data-focus-selection-kind', 'agent');
    await expect(focusPulse).toHaveAttribute('data-focus-selection-id', 'agent_001');
    await expect(focusPulse).toHaveAttribute('data-focus-gap-state', 'recent');
    await expect(focusPulse).toHaveAttribute('data-focus-gap-count', '1');
    await expect(focusPulse).toHaveAttribute('data-focus-latest-type', 'home_built');
    await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-kind', 'home-raised');
    await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-text', 'Aster raises shelter');

    const selectedBuildSummary = inspectorRecent.locator('[data-event-cursor="40"][data-event-type="home_built"]').first();
    await expect(selectedBuildSummary).toBeVisible();
    await expect(selectedBuildSummary).toHaveAttribute('data-event-detail-kind', 'home-raised');
    await expect(selectedBuildSummary).toHaveAttribute('data-event-detail-text', 'Aster raises shelter');
    await expect(selectedBuildSummary.locator('.event-summary-detail')).toHaveText('Aster raises shelter');

    const gapSummary = inspectorRecent.locator('.event-summary.event-gap[data-event-kind="gap"]').first();
    await expect(gapSummary).toContainText('trail break');
    await expect(gapSummary).toContainText('The live trail moved ahead');
    await expectSelectedGapSummaryHasNoEventAttributes(gapSummary);

    const hoardSummary = inspectorRecent.locator('[data-event-cursor="31"][data-event-type="agent_started_hoarding"]').first();
    await expect(hoardSummary).toBeVisible();
    await expect(hoardSummary).toHaveAttribute('data-event-detail-kind', 'being-hoard');
    await expect(hoardSummary).toHaveAttribute('data-event-detail-text', 'Briar holds a great store');
    await expect(hoardSummary).toHaveAttribute('data-event-chain-kind', 'shared-hoard');
    await expect(hoardSummary).toHaveAttribute('data-event-chain-window', '30-31');
    await expect(hoardSummary).toHaveAttribute('data-event-chain-text', 'after sharing');
    await expect(hoardSummary.locator('.event-summary-detail')).toHaveText('Briar holds a great store');
    await expect(hoardSummary.locator('.event-summary-chain')).toHaveText('after sharing');
    await expect(inspectorRecent.locator('[data-event-cursor="30"]')).toHaveCount(0);
    await expect(inspectorRecent.locator('[data-event-type="resource_transferred"]')).toHaveCount(0);

    const speechSummary = inspectorRecent.locator('[data-event-cursor="32"][data-event-type="speak"]').first();
    await expect(speechSummary).toBeVisible();
    await expect(speechSummary).toHaveAttribute('data-event-detail-kind', 'open-speech');
    await expect(speechSummary).toHaveAttribute('data-event-detail-text', 'heard in warm springs');
    await expect(speechSummary.locator('.event-summary-detail')).toHaveText('heard in warm springs');
    await expect(speechSummary.locator('.event-summary-detail')).not.toContainText(longSelectedSpeech);
    await expect(speechSummary.locator('p')).toContainText(longSelectedSpeech);

    const thoughtSummary = inspectorRecent.locator('[data-event-cursor="33"][data-event-type="self_talk"]').first();
    await expect(thoughtSummary).toBeVisible();
    await expect(thoughtSummary).toHaveAttribute('data-event-detail-kind', 'private-thought');
    await expect(thoughtSummary).toHaveAttribute('data-event-detail-text', 'private thought');
    await expect(thoughtSummary.locator('.event-summary-detail')).toHaveText('private thought');
    await expect(thoughtSummary.locator('.event-summary-detail')).not.toContainText(longSelectedThought);
    await expect(thoughtSummary.locator('p')).toContainText(longSelectedThought);

    await expect(inspectorRecent).not.toContainText(/\b(Seek|Scrub|Playback|Picker|Play|Pause)\b/i);
    const state = await selectedInspectorRecentSurfaceState(page);
    expect(state.exists, viewport.name).toBe(true);
    expect(state.documentOverflow, viewport.name).toBeLessThanOrEqual(1);
    expect(state.controlCount, viewport.name).toBe(0);
    expect(state.clipped, viewport.name).toEqual([]);
    expect(state.rows, viewport.name).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'event',
        type: 'home_built',
        cursor: '40',
        detailKind: 'home-raised',
        detailText: 'Aster raises shelter',
        detailCount: 1,
      }),
      expect.objectContaining({
        kind: 'gap',
        type: null,
        cursor: null,
        detailKind: null,
        detailText: null,
        chainKind: null,
        chainText: null,
        icon: null,
        detailCount: 0,
        chainCount: 0,
        medallionCount: 0,
      }),
      expect.objectContaining({
        kind: 'event',
        type: 'agent_started_hoarding',
        cursor: '31',
        detailKind: 'being-hoard',
        chainKind: 'shared-hoard',
        detailCount: 1,
        chainCount: 1,
        medallionCount: 1,
      }),
      expect.objectContaining({
        kind: 'event',
        type: 'speak',
        cursor: '32',
        detailKind: 'open-speech',
        detailText: 'heard in warm springs',
        detailCount: 1,
      }),
      expect.objectContaining({
        kind: 'event',
        type: 'self_talk',
        cursor: '33',
        detailKind: 'private-thought',
        detailText: 'private thought',
        detailCount: 1,
      }),
    ]));
    if (viewport.checkViewportBounds) {
      expect(await viewportLayoutIssues(page), viewport.name).toEqual([]);
    }
    expect(await corePanelOverlaps(page), viewport.name).toEqual([]);
    await expectRetainedSurfaceAttributeCopyClean(page);
    await expectNoBannedObserverCopy(page);
  }
});

test('production app keeps long selected speech full length in the inspector trail', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, longSpeechEnvelope);
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle [data-event-type="speak"]').first()).toBeVisible();

  const agentPoint = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_001'));
  await page.mouse.click(agentPoint.x, agentPoint.y);

  const summary = page.locator('.inspector-recent [data-event-type="speak"]').first();
  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  await expect(page.locator('.inspector')).toContainText('Recent trail');
  await expect(focusPulse).toHaveAttribute('data-focus-latest-type', 'speak');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-kind', 'open-speech');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-text', 'heard in warm springs');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).not.toContainText(longSelectedSpeech);
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute('data-event-group', 'speech');
  await expect(summary).toHaveAttribute('data-event-detail-kind', 'open-speech');
  await expect(summary).toHaveAttribute('data-event-detail-text', 'heard in warm springs');
  await expect(summary.locator('.event-summary-detail')).toHaveText('heard in warm springs');
  await expect(summary.locator('.event-summary-detail')).not.toContainText(longSelectedSpeech);
  await expect(summary.locator('p')).toContainText(longSelectedSpeech);
  await expect(page.locator('.inspector-recent button')).toHaveCount(0);
  await expect(page.locator('.inspector-recent dialog')).toHaveCount(0);
  await expect(page.locator('.inspector-recent [role="dialog"]')).toHaveCount(0);

  const paragraphState = await summary.locator('p').evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      display: style.display,
      lineClamp: style.getPropertyValue('-webkit-line-clamp'),
      overflow: style.overflow,
      horizontalClip: node.scrollWidth > node.clientWidth + 1,
      verticalClip: node.scrollHeight > node.clientHeight + 1,
    };
  });
  expect(paragraphState.display).not.toBe('-webkit-box');
  expect(paragraphState.lineClamp).toBe('none');
  expect(paragraphState.overflow).toBe('visible');
  expect(paragraphState.horizontalClip).toBe(false);
  expect(paragraphState.verticalClip).toBe(false);
  const layoutIssues = await viewportLayoutIssues(page);
  expect(layoutIssues.filter((issue) => issue.includes('inspector-recent')), layoutIssues.join('\n')).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app keeps selected inspector compact details readable on mobile', async ({ page }) => {
  await bootApp(page, { width: 390, height: 844 }, burstEnvelope);
  await waitForBurstEffects(page);

  const homePoint = await page.evaluate(() => window.__vivariumWorld.screenPointForHome('home_001'));
  await page.mouse.click(homePoint.x, homePoint.y);

  const inspector = page.locator('.inspector');
  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  await expect(inspector.locator('strong')).toHaveText('home 001');
  await expect(focusPulse).toHaveAttribute('data-focus-state', 'active');
  await expect(focusPulse).toHaveAttribute('data-focus-kind', 'home');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-kind', 'home');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-id', 'home_001');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-kind', 'theft');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-text', '14 materials taken');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-chain-kind', 'breach-theft');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-chain-text', 'after breach');

  const selectedTheftSummary = page.locator('.inspector-recent [data-event-cursor="19"][data-event-type="home_thieved"]');
  await expect(selectedTheftSummary).toBeVisible();
  await expect(selectedTheftSummary).toHaveAttribute('data-event-detail-kind', 'theft');
  await expect(selectedTheftSummary).toHaveAttribute('data-event-detail-text', '14 materials taken');
  await expect(selectedTheftSummary).toHaveAttribute('data-event-chain-kind', 'breach-theft');
  await expect(selectedTheftSummary).toHaveAttribute('data-event-chain-text', 'after breach');
  await expect(selectedTheftSummary.locator('.event-summary-detail')).toHaveText('14 materials taken');
  await expect(selectedTheftSummary.locator('.event-summary-chain')).toHaveText('after breach');

  const selectedBuildSummary = page.locator('.inspector-recent [data-event-cursor="17"][data-event-type="home_built"]');
  await expect(selectedBuildSummary).toBeVisible();
  await expect(selectedBuildSummary).toHaveAttribute('data-event-detail-kind', 'home-raised');
  await expect(selectedBuildSummary).toHaveAttribute('data-event-detail-text', 'Aster raises shelter');
  await expect(selectedBuildSummary.locator('.event-summary-detail')).toHaveText('Aster raises shelter');
  await expect(page.locator('.inspector-recent [data-event-type="home_breached"]')).toHaveCount(0);

  const state = await selectedInspectorRecentSurfaceState(page);
  expect(state.exists).toBe(true);
  expect(state.documentOverflow).toBeLessThanOrEqual(1);
  expect(state.controlCount).toBe(0);
  expect(state.clipped).toEqual([]);
  expect(state.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: 'event',
      type: 'home_thieved',
      cursor: '19',
      detailKind: 'theft',
      detailText: '14 materials taken',
      chainKind: 'breach-theft',
      chainText: 'after breach',
      detailCount: 1,
      chainCount: 1,
      medallionCount: 1,
    }),
    expect.objectContaining({
      kind: 'event',
      type: 'home_built',
      cursor: '17',
      detailKind: 'home-raised',
      detailText: 'Aster raises shelter',
      detailCount: 1,
    }),
  ]));
  expect(await corePanelOverlaps(page)).toEqual([]);
  await expectRetainedSurfaceAttributeCopyClean(page);
  await expectNoBannedObserverCopy(page);
});

test('production app correlates live bubble arrival with chronicle and focus pulse', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, arrivalSpeechEnvelope);
  await waitForEventBubbleLaneMetadata(page, 1);

  const bubble = page.locator('.viv-event-bubble[data-event-cursor="5"][data-event-type="speak"]').first();
  await expect(bubble).toBeVisible();
  await expect(bubble).toHaveAttribute('data-event-arrival-phase', /^(arriving|held|fading)$/);
  const bubbleArrival = await bubble.evaluate((node) => ({
    cursor: Number(node.getAttribute('data-event-cursor')),
    progress: Number(node.getAttribute('data-event-arrival-progress')),
    opacity: Number(node.getAttribute('data-event-arrival-opacity')),
    scale: Number(getComputedStyle(node).getPropertyValue('--bubble-arrival-scale')),
  }));
  expect(bubbleArrival).toMatchObject({ cursor: 5 });
  expect(Number.isFinite(bubbleArrival.progress)).toBe(true);
  expect(bubbleArrival.progress).toBeGreaterThanOrEqual(0);
  expect(bubbleArrival.progress).toBeLessThanOrEqual(1);
  expect(Number.isFinite(bubbleArrival.opacity)).toBe(true);
  expect(bubbleArrival.opacity).toBeGreaterThanOrEqual(0);
  expect(bubbleArrival.opacity).toBeLessThanOrEqual(1);
  expect(bubbleArrival.scale).toBeGreaterThan(0.9);
  expect(bubbleArrival.scale).toBeLessThan(1.1);

  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle [data-event-cursor="5"][data-event-type="speak"]')).toBeVisible();
  await expect(page.locator('.live-pulse-latest')).toHaveAttribute('data-pulse-event-cursor', '5');
  await expect(page.locator('.live-pulse-latest')).toHaveAttribute('data-pulse-event-type', 'speak');

  const rendererCorrelation = await page.evaluate(() => {
    const effects = window.__vivariumWorld.activeEffects();
    const recent = window.__vivariumWorld.recentRenderedEventBeats();
    return {
      bubbleEffect: effects.find((effect) => effect.eventType === 'speak' && effect.bubble?.cursor === 5),
      renderedBeat: recent.find((beat) => beat.cursor === 5 && beat.eventType === 'speak'),
    };
  });
  expect(rendererCorrelation.bubbleEffect).toMatchObject({
    eventType: 'speak',
    bubble: {
      cursor: 5,
      arrivalPhase: expect.stringMatching(/^(arriving|held|fading)$/),
    },
  });
  expect(rendererCorrelation.renderedBeat).toMatchObject({
    cursor: 5,
    eventType: 'speak',
    hasBubble: true,
  });

  const point = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_001'));
  await page.mouse.click(point.x, point.y);
  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-event-cursor', '5');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-event-type', 'speak');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-kind', 'open-speech');
  await expect(page.locator('.live-pulse button, .live-pulse select, .live-pulse dialog, .live-pulse [role="dialog"]')).toHaveCount(0);
  await expect(page.locator('.focus-pulse button, .focus-pulse select, .focus-pulse dialog, .focus-pulse [role="dialog"]')).toHaveCount(0);
});

test('production app retains latest live event after world bubbles expire', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, arrivalSpeechEnvelope);
  await waitForEventBubbleLaneMetadata(page, 1);
  await expect(page.locator('.viv-event-bubble[data-event-cursor="5"][data-event-type="speak"]')).toBeVisible();
  await openAtlasSurface(page, 'archive');
  const archive = page.getByTestId('archive-chronicle');
  await expect(archive).toHaveAttribute('data-archive-status', 'ready');
  const archiveBeforeExpiry = await archive.evaluate((node) => (
    Object.fromEntries(
      Array.from(node.attributes)
        .filter((attribute) => attribute.name.startsWith('data-archive-'))
        .map((attribute) => [attribute.name, attribute.value]),
    )
  ));

  await waitForEventBubbleCursorExpired(page, 5);

  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.viv-event-bubble[data-event-cursor="5"]')).toHaveCount(0);
  await expect(page.locator('.chronicle [data-event-cursor="5"][data-event-type="speak"]')).toBeVisible();
  await expect(page.locator('.chronicle .event-row[data-event-kind="event"]')).toHaveCount(1);

  const livePulse = page.getByTestId('live-pulse');
  await expect(livePulse).toHaveAttribute('data-pulse-retention-state', 'retained');
  await expect(livePulse).toHaveAttribute('data-pulse-retained-event-cursor', '5');
  await expect(livePulse).toHaveAttribute('data-pulse-retained-event-type', 'speak');
  await expect(livePulse.locator('.live-pulse-latest')).toHaveAttribute('data-pulse-retention-state', 'retained');
  await expect(livePulse.locator('.live-pulse-latest')).toHaveAttribute('data-pulse-event-cursor', '5');
  await expect(livePulse.locator('.live-pulse-latest')).toHaveAttribute('data-pulse-event-type', 'speak');

  const now = page.getByTestId('live-now');
  await expect(now).toHaveAttribute('data-now-retention-state', 'retained');
  await expect(now).toHaveAttribute('data-now-retained-event-cursor', '5');
  await expect(now).toHaveAttribute('data-now-retained-event-type', 'speak');
  await expect(now.locator('.live-now-cue[data-now-cursor="5"][data-now-event-type="speak"]')).toHaveAttribute('data-now-retention-state', 'retained');

  const point = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_001'));
  await page.mouse.click(point.x, point.y);
  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  await expect(focusPulse).toHaveAttribute('data-focus-retention-state', 'retained');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-cursor', '5');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-type', 'speak');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-retention-state', 'retained');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-event-cursor', '5');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-event-type', 'speak');

  const retainedDebug = await page.evaluate(() => ({
    targetBubbleEffects: window.__vivariumWorld.activeEffects()
      .filter((effect) => effect.bubble?.cursor === 5),
    recent: window.__vivariumWorld.recentRenderedEventBeats(),
    diagnostics: window.__vivariumWorld.effectLifecycleDiagnostics(),
  }));
  expect(retainedDebug.targetBubbleEffects).toEqual([]);
  expect(retainedDebug.recent).toEqual(expect.arrayContaining([
    expect.objectContaining({
      cursor: 5,
      eventType: 'speak',
      hasBubble: true,
    }),
  ]));

  await expect(page.locator('.live-pulse button, .live-pulse select, .live-pulse dialog, .live-pulse [role="dialog"]')).toHaveCount(0);
  await expect(page.locator('.live-now button, .live-now select, .live-now dialog, .live-now [role="dialog"]')).toHaveCount(0);
  await expect(page.locator('.focus-pulse button, .focus-pulse select, .focus-pulse dialog, .focus-pulse [role="dialog"]')).toHaveCount(0);
  await openAtlasSurface(page, 'archive');
  await expect(archive.locator('[data-event-cursor="5"][data-event-type="speak"]')).toHaveCount(0);
  const archiveAfterExpiry = await archive.evaluate((node) => (
    Object.fromEntries(
      Array.from(node.attributes)
        .filter((attribute) => attribute.name.startsWith('data-archive-'))
        .map((attribute) => [attribute.name, attribute.value]),
    )
  ));
  expect(archiveAfterExpiry).toEqual(archiveBeforeExpiry);
});

test('production app renders pending proposal visuals from snapshots only', async ({ page }) => {
  const withoutPending = { ...world, event_cursor: 5, world_time: 19.2, pending_proposals: [] };
  await bootApp(page, { width: 1440, height: 900 }, envelope, [world, withoutPending]);

  await page.waitForFunction(() => window.__vivariumWorld?.pendingProposalVisualState?.().length === 1);
  const pending = await page.evaluate(() => window.__vivariumWorld.pendingProposalVisualState());
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({
    initiatorId: 'agent_001',
    targetId: 'agent_002',
    resources: { energy: 8, materials: 2 },
    source: 'snapshot',
    eventOwned: false,
    ageSeconds: 6.5,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expectFiniteTuple(pending[0].initiatorWorld);
  expectFiniteTuple(pending[0].targetWorld);
  expectFiniteTuple(pending[0].medallionWorld);
  expect(pending[0].relationshipThreadWorld).toHaveLength(3);
  for (const point of pending[0].relationshipThreadWorld) {
    expectFiniteTuple(point);
  }
  expect(pending[0].initiatorScreen).toBeTruthy();
  expect(pending[0].targetScreen).toBeTruthy();
  expect(pending[0].medallionScreen).toBeTruthy();

  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), silentSnapshotPulse);
  await page.waitForFunction(() => window.__vivariumWorld.pendingProposalVisualState().length === 0, null, { timeout: 7000 });
});

test('production app honors reduced motion media without hiding world information', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootApp(page, { width: 1440, height: 900 }, lowFrequencyEnvelope);

  await page.waitForFunction(() => {
    const debug = window.__vivariumWorld;
    const effects = debug?.activeEffects?.() || [];
    return (
      debug?.motionMode?.().reduced === true &&
      debug.pendingProposalVisualState().length === 1 &&
      effects.some((effect) => effect.summary?.kind === 'bond-lifecycle') &&
      effects.some((effect) => effect.eventType === 'hearth_used' && effect.summary?.kind === 'shelter-use') &&
      effects.some((effect) => effect.eventType === 'hearth_used' && effect.summary?.kind === 'hearth-ember') &&
      effects.some((effect) => effect.summary?.kind === 'agent-hoard-shimmer' && effect.summary.resourceMotes > 0) &&
      effects.some((effect) => effect.summary?.kind === 'simulation-started' && effect.summary.motionMode === 'reduced') &&
      effects.some((effect) => effect.eventType === 'mating_rejected' && effect.summary?.kind === 'generic-event-pulse' && effect.summary.motionMode === 'reduced') &&
      effects.some((effect) => effect.eventType === 'mating_rejected' && effect.summary?.kind === 'generic-event-arc' && effect.summary.motionMode === 'reduced') &&
      document.querySelectorAll('.viv-event-bubble').length > 0
    );
  }, null, { timeout: 8000 });

  await expect(page.getByTestId('vivarium-world-canvas')).toBeVisible();
  const state = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    const effects = debug.activeEffects();
    return {
      motion: debug.motionMode(),
      diagnostics: debug.effectLifecycleDiagnostics(),
      budget: debug.renderBudgetDiagnostics(),
      counts: debug.activeEffectCounts(),
      pixels: debug.sampleCanvasPixels(),
      pending: debug.pendingProposalVisualState(),
      aster: debug.agentVisualState('agent_001'),
      briar: debug.agentVisualState('agent_002'),
      homeOne: debug.homeVisualState('home_001'),
      homeTwo: debug.homeVisualState('home_002'),
      bondKinds: effects
        .map((effect) => effect.summary)
        .filter((summary) => summary?.kind === 'bond-lifecycle')
        .map((summary) => summary.bondEventKind),
      agentHoard: effects.find((effect) => (
        effect.summary?.kind === 'agent-hoard-shimmer' &&
        effect.summary.resourceMotes > 0
      ))?.summary,
      startup: effects.find((effect) => effect.summary?.kind === 'simulation-started')?.summary,
      shelter: effects.find((effect) => (
        effect.eventType === 'hearth_used' &&
        effect.summary?.kind === 'shelter-use'
      ))?.summary,
      hearthEmber: effects.find((effect) => (
        effect.eventType === 'hearth_used' &&
        effect.summary?.kind === 'hearth-ember'
      ))?.summary,
      genericHearthBubble: effects.find((effect) => (
        effect.eventType === 'hearth_used' &&
        effect.bubble &&
        effect.summary?.kind === 'generic-event-bubble'
      ))?.summary,
      recentRenderedBeats: debug.recentRenderedEventBeats(),
      genericReducedPulse: effects.find((effect) => (
        effect.eventType === 'mating_rejected' &&
        effect.summary?.kind === 'generic-event-pulse'
      )),
      genericReducedArc: effects.find((effect) => (
        effect.eventType === 'mating_rejected' &&
        effect.summary?.kind === 'generic-event-arc'
      )),
      bubbleEffectsWithoutSummary: effects
        .filter((effect) => effect.bubble && !effect.summary)
        .map((effect) => effect.eventType),
      bubbleCount: document.querySelectorAll('.viv-event-bubble').length,
      reducedMotionCopy: /\bReduced motion\b/i.test(document.body.innerText),
    };
  });

  expect(state.motion).toMatchObject({ mode: 'reduced', reduced: true, source: 'media' });
  expect(state.diagnostics.reducedMotion).toMatchObject(state.motion);
  expect(state.budget.reducedMotion).toMatchObject(state.motion);
  expect(state.budget.activeEffectCount).toBe(state.diagnostics.activeEffectCount);
  expect(state.budget.activeEffectCount).toBeLessThanOrEqual(state.budget.maxActiveEffectCount);
  expect(state.budget.activeEffectParticleCount).toBeGreaterThan(0);
  expectFiniteNumber(state.budget.averageFrameDeltaMs);
  expectFiniteNumber(state.budget.averageRenderMs);
  expect(state.diagnostics.activeEffectCount).toBe(state.counts.total);
  expect(state.diagnostics.activeEffectCountByGroup).toEqual(state.counts.byGroup);
  expect(state.diagnostics.activeEffectCountByType).toEqual(state.counts.byType);
  expect(state.diagnostics.pendingProposalVisualCount).toBe(1);
  expect(state.diagnostics.appliedEventCursorCount).toBeGreaterThan(0);
  expect(state.counts.byGroup.bond).toBeGreaterThan(0);
  expect(state.counts.byType.mating_rejected).toBeGreaterThan(0);
  expect(state.counts.byType.hearth_used).toBeGreaterThan(0);
  expect(state.pixels).toBeGreaterThan(20);
  expect(state.pending).toHaveLength(1);
  expect(state.pending[0]).toMatchObject({
    initiatorId: 'agent_001',
    targetId: 'agent_002',
    source: 'snapshot',
    eventOwned: false,
  });
  expect(state.aster.visible).toBe(true);
  expect(state.briar.visible).toBe(true);
  expect(state.homeOne.ruined).toBe(false);
  expect(state.homeTwo.stakeholderCount).toBe(4);
  expect(state.bondKinds).toEqual(expect.arrayContaining(['rejected', 'invalidated', 'timeout']));
  expect(state.agentHoard).toMatchObject({
    kind: 'agent-hoard-shimmer',
    actorId: 'agent_001',
    regionName: 'warm_springs',
    energy: 510,
    agentMaterials: 12,
    motionCue: 'being-hoard-threshold-shimmer',
    motionMode: 'reduced',
    beingHoardCue: true,
    hoardThresholdCue: true,
    hoardShimmerCue: true,
    vaultShimmer: false,
    actualActorMutated: false,
    targetStateMutated: false,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expect(state.agentHoard.resourceMotes).toBeGreaterThan(0);
  expect(state.startup).toMatchObject({
    kind: 'simulation-started',
    motionCue: 'world-awakening-system-pulse',
    motionMode: 'reduced',
    systemEventKind: 'startup',
    systemCue: true,
    startupCue: true,
    worldAwakeningCue: true,
    startupPulseCue: true,
    passiveChronicleCue: true,
    worldBubbleCue: true,
    actualActorMutated: false,
    durableAgentMutated: false,
    targetStateMutated: false,
    regionStateMutated: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    liveStatusMutated: false,
    runMetadataMutated: false,
    replayArchiveMutated: false,
    controlsMutated: false,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expect(Number.isFinite(state.startup.systemWorld[0])).toBe(true);
  expect(state.shelter).toMatchObject({
    kind: 'shelter-use',
    motionCue: 'reduced-glow-smoke-shelter',
    motionMode: 'reduced',
    thresholdGlow: true,
    thresholdSmoke: true,
    thresholdLight: true,
    doorCue: true,
    doorOpen: false,
    doorStatic: true,
    windowGlow: true,
    smokeRateCue: true,
    reducedMotionShelterCue: true,
    thresholdTravel: false,
    swallowCue: false,
    proxyFigure: false,
    proxyVisible: false,
    proxyOpacity: 0,
    actorVisible: true,
    persistentOccupancy: false,
    actualActorMutated: false,
    homeStateMutated: false,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expect(state.hearthEmber).toMatchObject({
    kind: 'hearth-ember',
    actorId: 'agent_001',
    homeId: 'home_001',
    regionName: 'warm_springs',
    materialsBurned: 8,
    energyGained: 8,
    agentEnergy: 92,
    agentMaterials: 14,
    motionCue: 'hearth-ember-glow-burst',
    motionMode: 'reduced',
    streamDirection: 'hearth-to-home-threshold',
    homeAnchored: true,
    hearthEmberCue: true,
    thresholdGlow: true,
    thresholdLight: true,
    worldBubbleCue: false,
    persistentOccupancy: false,
    actualActorMutated: false,
    durableAgentMutated: false,
    targetStateMutated: false,
    regionStateMutated: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    occupancyStateMutated: false,
    vaultStateMutated: false,
    controlsMutated: false,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expect(state.hearthEmber.emberMotes).toBeGreaterThan(0);
  expect(state.recentRenderedBeats.find((beat) => beat.cursor === 11)?.summaryKinds).toContain('generic-event-bubble');
  expectGenericPulseEffectSummary(state.genericReducedPulse, 'reduced');
  expect(state.genericReducedPulse.summary).toMatchObject({
    pulseEventType: 'mating_rejected',
    eventGroup: 'bond',
    anchorRole: 'actor',
  });
  expectGenericArcEffectSummary(state.genericReducedArc, 'reduced');
  expect(state.genericReducedArc.summary).toMatchObject({
    arcEventType: 'mating_rejected',
    eventGroup: 'bond',
    fromAnchorRole: 'actor',
    toAnchorRole: 'target',
  });
  expect(state.bubbleEffectsWithoutSummary).toEqual([]);
  expect(state.bubbleCount).toBeGreaterThan(0);
  expect(state.bubbleCount).toBeLessThanOrEqual(3);
  expect(state.reducedMotionCopy).toBe(false);
  const reducedBubbleState = await eventBubbleLaneState(page);
  expect(reducedBubbleState.bubbles.length).toBeGreaterThan(0);
  for (const bubble of reducedBubbleState.bubbles) {
    expect(['arriving', 'held', 'fading'], `${bubble.eventType} reduced arrival phase`).toContain(bubble.arrivalPhase);
    expect(Number.isFinite(bubble.arrivalProgress), `${bubble.eventType} reduced arrival progress`).toBe(true);
    expect(Number.isFinite(bubble.arrivalOpacity), `${bubble.eventType} reduced arrival opacity`).toBe(true);
    expect(bubble.arrivalScale, `${bubble.eventType} reduced arrival scale`).toBe(1);
    expectEventBubbleFocusSemantics(bubble, `reduced motion ${bubble.eventType}`);
  }
  for (const effect of reducedBubbleState.effectBubbles) {
    expect(['arriving', 'held', 'fading'], `${effect.eventType} reduced debug arrival phase`).toContain(effect.arrivalPhase);
    expect(Number.isFinite(effect.arrivalProgress), `${effect.eventType} reduced debug arrival progress`).toBe(true);
    expect(Number.isFinite(effect.arrivalOpacity), `${effect.eventType} reduced debug arrival opacity`).toBe(true);
  }
  const reducedControlState = await rendererChromeControlState(page);
  expect(reducedControlState).toMatchObject({
    worldDialogs: 0,
    worldModals: 0,
    timelineButtons: 0,
    replayButtons: 0,
    motionControlCopy: false,
  });
  expect(reducedControlState.worldButtons).toBe(focusableEventBubbleCount(reducedBubbleState));
  expect(await corePanelOverlaps(page)).toEqual([]);

  const reducedOverloadBursts = [40, 80, 120, 160].map((offset, index) =>
    envelopeWithCursorOffset(burstEnvelope, offset, 4 + index * 4),
  );
  const reducedOverloadCursors = reducedOverloadBursts.flatMap((body) => body.events.map(({ cursor }) => cursor));
  for (const body of reducedOverloadBursts) {
    await page.evaluate((eventBody) => window.__vivariumDispatchMockEventSource(eventBody), body);
  }
  await page.waitForFunction(({ cursors, previousPressure, previousScale }) => {
    const debug = window.__vivariumWorld;
    const applied = new Set(debug.appliedEventCursors());
    const budget = debug.renderBudgetDiagnostics();
    const resourceMotes = debug.activeEffects()
      .filter((effect) => effect.summary?.kind === 'resource-harvest')
      .map((effect) => effect.summary.resourceMotes);
    return (
      cursors.every((cursor) => applied.has(cursor)) &&
      budget.reducedMotion.mode === 'reduced' &&
      budget.detailBudgetPressure > previousPressure &&
      budget.adaptiveDetailScale < previousScale &&
      resourceMotes.some((count) => count >= 3)
    );
  }, {
    cursors: reducedOverloadCursors,
    previousPressure: state.budget.detailBudgetPressure,
    previousScale: state.budget.adaptiveDetailScale,
  }, { timeout: 8000 });
  const reducedOverload = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    return {
      budget: debug.renderBudgetDiagnostics(),
      resourceMotes: debug.activeEffects()
        .filter((effect) => effect.summary?.kind === 'resource-harvest')
        .map((effect) => effect.summary.resourceMotes),
    };
  });
  expect(reducedOverload.budget.reducedMotion).toMatchObject(state.motion);
  expect(Math.min(...reducedOverload.resourceMotes)).toBeGreaterThanOrEqual(3);

  await bootApp(page, { width: 1440, height: 900 }, burstEnvelope);
  await page.waitForFunction(() => {
    const debug = window.__vivariumWorld;
    const summaries = debug?.activeEffects?.().map((effect) => effect.summary) || [];
    const recent = debug?.recentRenderedEventBeats?.() || [];
    return debug?.motionMode?.().reduced === true &&
      summaries.some((summary) => summary?.kind === 'bond-lifecycle' && summary.bondEventKind === 'birth') &&
      recent.some((beat) => beat.summaryKinds.includes('speech-bubble')) &&
      recent.some((beat) => beat.summaryKinds.includes('private-thought')) &&
      summaries.some((summary) => summary?.kind === 'private-thought-wisp' && summary.motionMode === 'reduced') &&
      summaries.some((summary) => summary?.kind === 'combat-impact' && summary.motionMode === 'reduced');
  }, null, { timeout: 8000 });
  const birthState = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    const summaries = debug.activeEffects().map((effect) => effect.summary);
    return {
      motion: debug.motionMode(),
      diagnostics: debug.effectLifecycleDiagnostics(),
      birth: summaries.find((summary) => summary?.kind === 'bond-lifecycle' && summary.bondEventKind === 'birth'),
      speech: summaries.find((summary) => summary?.kind === 'speech-bubble'),
      thought: summaries.find((summary) => summary?.kind === 'private-thought'),
      thoughtWisp: summaries.find((summary) => summary?.kind === 'private-thought-wisp'),
      combatImpact: summaries.find((summary) => summary?.kind === 'combat-impact'),
      pending: debug.pendingProposalVisualState(),
      bubbleCount: document.querySelectorAll('.viv-event-bubble').length,
      recent: debug.recentRenderedEventBeats(),
    };
  });
  expect(birthState.motion).toMatchObject({ mode: 'reduced', reduced: true, source: 'media' });
  expect(birthState.diagnostics.reducedMotion).toMatchObject(birthState.motion);
  expect(birthState.pending).toHaveLength(1);
  expect(birthState.birth).toMatchObject({
    childId: 'agent_004',
    parentIds: ['agent_001', 'agent_002'],
    relationshipThreadCue: 'birth-arrival-parent-thread',
    birthCue: true,
    durableChildCreated: false,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expect(birthState.recent.find((beat) => beat.eventType === 'speak')?.summaryKinds).toContain('speech-bubble');
  expect(birthState.recent.find((beat) => beat.eventType === 'self_talk')?.summaryKinds).toContain('private-thought');
  expect(birthState.thoughtWisp).toMatchObject({
    kind: 'private-thought-wisp',
    motionMode: 'reduced',
    communicationKind: 'thought',
    worldBubbleCue: false,
    thoughtWispCue: true,
    interiorityCue: true,
    heardByOthers: false,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expect(birthState.thoughtWisp.thoughtMotes).toBeGreaterThan(0);
  expect(birthState.combatImpact).toMatchObject({
    kind: 'combat-impact',
    motionMode: 'reduced',
    combatCue: true,
    impactCue: true,
    durableAgentMutated: false,
    targetStateMutated: false,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expect(birthState.combatImpact.impactMotes).toBeGreaterThan(0);
  expect(birthState.bubbleCount).toBeGreaterThan(0);
});

test('production app renders bond lifecycle events as passive relationship cues', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, lowFrequencyEnvelope);

  await page.waitForFunction(() => {
    const summaries = window.__vivariumWorld?.activeEffects?.()
      .map((effect) => effect.summary)
      .filter((summary) => summary?.kind === 'bond-lifecycle') || [];
    const kinds = summaries.map((summary) => summary.bondEventKind);
    return ['rejected', 'invalidated', 'timeout'].every((kind) => kinds.includes(kind));
  });

  const summaries = await page.evaluate(() => window.__vivariumWorld.activeEffects()
    .map((effect) => effect.summary)
    .filter((summary) => summary?.kind === 'bond-lifecycle'));
  const byKind = Object.fromEntries(summaries.map((summary) => [summary.bondEventKind, summary]));
  expect(byKind.rejected).toMatchObject({
    participantIds: ['agent_001', 'agent_002'],
    relationshipThreadCue: 'decline-thread-refund',
    declineCue: true,
    refundCue: true,
    actualActorMutated: false,
    targetStateMutated: false,
    durableChildCreated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(byKind.invalidated).toMatchObject({
    participantIds: ['agent_001', 'agent_002'],
    relationshipThreadCue: 'broken-thread-refund',
    brokenCue: true,
    refundCue: true,
  });
  expect(byKind.timeout).toMatchObject({
    participantIds: ['agent_001', 'agent_002'],
    relationshipThreadCue: 'expired-thread-refund',
    lapsedCue: true,
    refundCue: true,
  });
  for (const summary of summaries) {
    expect(summary.relationshipThreadWorld.length).toBeGreaterThanOrEqual(3);
    for (const point of summary.relationshipThreadWorld) {
      expectFiniteTuple(point);
    }
  }

  await bootApp(page, { width: 1440, height: 900 }, burstEnvelope);
  await page.waitForFunction(() => {
    const summaries = window.__vivariumWorld?.activeEffects?.()
      .map((effect) => effect.summary)
      .filter((summary) => summary?.kind === 'bond-lifecycle') || [];
    return summaries.some((summary) => summary.bondEventKind === 'initiated') &&
      summaries.some((summary) => summary.bondEventKind === 'birth');
  });
  const birthAndOffer = await page.evaluate(() => window.__vivariumWorld.activeEffects()
    .map((effect) => effect.summary)
    .filter((summary) => summary?.kind === 'bond-lifecycle' && ['initiated', 'birth'].includes(summary.bondEventKind)));
  const offer = birthAndOffer.find((summary) => summary.bondEventKind === 'initiated');
  const birth = birthAndOffer.find((summary) => summary.bondEventKind === 'birth');
  expect(offer).toMatchObject({
    initiatorId: 'agent_001',
    targetId: 'agent_002',
    relationshipThreadCue: 'offer-thread',
    offerCue: true,
    durableChildCreated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(birth).toMatchObject({
    childId: 'agent_004',
    parentIds: ['agent_001', 'agent_002'],
    relationshipThreadCue: 'birth-arrival-parent-thread',
    birthCue: true,
    durableChildCreated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expectFiniteTuple(birth.childWorld);
  expect(birth.parentWorlds).toHaveLength(2);
  for (const point of birth.parentWorlds) {
    expectFiniteTuple(point);
  }
});

test('production app surfaces retained history gaps without exposing seek copy', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, [
    { delay: 20, onceKey: 'history-gap', body: overflowEnvelope },
  ], {
    ...world,
    event_cursor: 16,
  });
  await openAtlasSurface(page, 'chronicle');

  await expect(page.locator('.chronicle')).toContainText('trail break');
  await expect(page.locator('.chronicle')).toContainText('The live trail moved ahead');
  const pulse = page.getByTestId('live-pulse');
  await expect(pulse).toHaveAttribute('data-pulse-gap-state', 'recent');
  await expect(pulse).toHaveAttribute('data-pulse-gap-count', '1');
  await expect(pulse).toContainText('trail break');
  await expect(pulse.locator('.live-pulse-group')).toHaveCount(1);
  await expect(page.locator('.live-pulse button, .live-pulse select')).toHaveCount(0);
  await expect(page.locator('.live-pulse dialog, .live-pulse [role="dialog"], .live-pulse [role="button"]')).toHaveCount(0);
  await openAtlasSurface(page, 'world');
  await expect(page.getByTestId('live-status-strip')).toContainText('Live');
  await expect(page.getByTestId('live-status-strip')).toContainText('1 retained break');
  await expect(page.locator('.timeline-strip')).toContainText('Gaps');
  await expect(page.locator('.timeline-strip')).toContainText('1');
  await expect(page.locator('.timeline-strip')).not.toContainText('Seek');
});

test('production app keeps selected inspector gap rows passive beside compact details on narrow viewport', async ({ page }) => {
  await bootApp(page, { width: 981, height: 560 }, [
    { delay: 20, onceKey: 'selected-history-gap', body: overflowEnvelope },
  ], {
    ...world,
    event_cursor: 16,
  });
  await openAtlasSurface(page, 'chronicle');

  await expect(page.locator('.chronicle .event-row.event-gap')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(0);
  const agentPoint = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_001'));
  await page.mouse.click(agentPoint.x, agentPoint.y);

  const inspectorRecent = page.locator('.inspector-recent');
  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  await expect(page.locator('.inspector strong')).toHaveText('Aster');
  await expect(focusPulse).toHaveAttribute('data-focus-state', 'active');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-kind', 'agent');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-id', 'agent_001');
  await expect(focusPulse).toHaveAttribute('data-focus-gap-state', 'recent');
  await expect(focusPulse).toHaveAttribute('data-focus-gap-count', '1');
  await expect(focusPulse).toHaveAttribute('data-focus-latest-type', 'speak');

  const selectedSpeechSummary = inspectorRecent.locator('[data-event-cursor="16"][data-event-type="speak"]').first();
  await expect(selectedSpeechSummary).toBeVisible();
  await expect(selectedSpeechSummary).toHaveAttribute('data-event-detail-kind', 'open-speech');
  await expect(selectedSpeechSummary).toHaveAttribute('data-event-detail-text', 'heard in warm springs');
  await expect(selectedSpeechSummary).toHaveAttribute('data-event-chain-kind', 'none');
  await expect(selectedSpeechSummary.locator('.event-summary-detail')).toHaveText('heard in warm springs');
  await expect(selectedSpeechSummary.locator('.event-summary-chain')).toHaveCount(0);

  const gapSummary = inspectorRecent.locator('.event-summary.event-gap').first();
  await expect(gapSummary).toBeVisible();
  await expect(gapSummary).toHaveAttribute('data-event-kind', 'gap');
  await expect(gapSummary).toContainText('trail break');
  await expect(gapSummary).toContainText('The live trail moved ahead');
  await expect(gapSummary.locator('.event-summary-detail')).toHaveCount(0);
  await expect(gapSummary.locator('.event-summary-chain')).toHaveCount(0);
  await expect(gapSummary.locator('.event-medallion')).toHaveCount(0);
  expect(await gapSummary.evaluate((node) => ({
    type: node.getAttribute('data-event-type'),
    group: node.getAttribute('data-event-group'),
    tone: node.getAttribute('data-event-tone'),
    cursor: node.getAttribute('data-event-cursor'),
    detailKind: node.getAttribute('data-event-detail-kind'),
    detailText: node.getAttribute('data-event-detail-text'),
    chainKind: node.getAttribute('data-event-chain-kind'),
    chainText: node.getAttribute('data-event-chain-text'),
    icon: node.getAttribute('data-event-icon'),
    medallionLabel: node.getAttribute('data-event-medallion-label'),
    priority: node.getAttribute('data-event-priority'),
  }))).toEqual({
    type: null,
    group: null,
    tone: null,
    cursor: null,
    detailKind: null,
    detailText: null,
    chainKind: null,
    chainText: null,
    icon: null,
    medallionLabel: null,
    priority: null,
  });

  await expect(inspectorRecent).not.toContainText(/\b(Seek|Scrub|Playback|Picker|Play|Pause)\b/i);
  await expect(inspectorRecent.locator('button, select, dialog, [role="dialog"], [role="button"]')).toHaveCount(0);
  const state = await selectedInspectorRecentSurfaceState(page);
  expect(state.exists).toBe(true);
  expect(state.documentOverflow).toBeLessThanOrEqual(1);
  expect(state.controlCount).toBe(0);
  expect(state.clipped).toEqual([]);
  expect(state.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: 'event',
      type: 'speak',
      cursor: '16',
      detailKind: 'open-speech',
      detailText: 'heard in warm springs',
      chainKind: 'none',
      detailCount: 1,
      chainCount: 0,
      medallionCount: 1,
    }),
    expect.objectContaining({
      kind: 'gap',
      type: null,
      cursor: null,
      detailKind: null,
      detailText: null,
      chainKind: null,
      chainText: null,
      icon: null,
      detailCount: 0,
      chainCount: 0,
      medallionCount: 0,
    }),
  ]));
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
  await expectRetainedSurfaceAttributeCopyClean(page);
  await expectNoBannedObserverCopy(page);
});

test('production app exposes icon medallion metadata for retained drama recent routine and archive events', async ({ page }) => {
  const iconArchiveArtifacts = {
    ...replayArtifactBodies,
    events: [
      replayEventRecord(13.1, 'agent_001'),
      {
        type: 'simulation_started',
        source: 'world',
        payload: {
          run_id: 'seed-7-app-test',
          agent_count: 3,
          world_time: 0,
        },
        scope: 'global',
        region: null,
        target: null,
        timestamp: 13.2,
      },
    ].map((record) => JSON.stringify(record)).join('\n'),
  };
  await bootApp(
    page,
    { width: 1440, height: 900 },
    liveChronicleRetentionEnvelope,
    world,
    run,
    iconArchiveArtifacts,
  );
  await openAtlasSurface(page, 'chronicle');

  const retainedDrama = page.locator('.chronicle .event-row[data-event-type="agent_died"]').first();
  await expect(retainedDrama).toBeVisible();
  await expectIconMedallionMetadata(retainedDrama, {
    iconKey: 'skull',
    iconLabel: 'Death',
    medallionLabel: 'Death',
    priority: 'drama',
    accent: '#c74f45',
  });
  expect(await retainedDrama.evaluate((node) => getComputedStyle(node).getPropertyValue('--event-color').trim()))
    .toBe('#c74f45');

  const recentRoutine = page.locator('.chronicle .event-row[data-event-type="speak"]').first();
  await expect(recentRoutine).toBeVisible();
  await expectIconMedallionMetadata(recentRoutine, {
    iconKey: 'speech',
    iconLabel: 'Speech',
    medallionLabel: 'Speech',
    priority: 'featured',
    accent: '#6fc7bd',
  });
  expect(await recentRoutine.evaluate((node) => getComputedStyle(node).getPropertyValue('--event-color').trim()))
    .toBe('#6fc7bd');

  await openAtlasSurface(page, 'world');
  const recentSummary = page.locator('.inspector-recent .event-summary[data-event-type="speak"]').first();
  await expect(recentSummary).toBeVisible();
  await expectIconMedallionMetadata(recentSummary, {
    iconKey: 'speech',
    iconLabel: 'Speech',
    medallionLabel: 'Speech',
    priority: 'featured',
    accent: '#6fc7bd',
  });

  await openAtlasSurface(page, 'archive');
  const archive = page.getByTestId('archive-chronicle');
  await expect(archive).toHaveAttribute('data-archive-status', 'ready');
  const archiveSpeech = archive.locator('[data-event-kind="event"][data-event-type="speak"]').first();
  await expect(archiveSpeech).toBeVisible();
  await expectIconMedallionMetadata(archiveSpeech, {
    iconKey: 'speech',
    iconLabel: 'Speech',
    medallionLabel: 'Speech',
    priority: 'featured',
    accent: '#6fc7bd',
  });
  const archiveSystem = archive.locator('[data-event-kind="event"][data-event-type="simulation_started"]').first();
  await expect(archiveSystem).toBeVisible();
  await expectIconMedallionMetadata(archiveSystem, {
    iconKey: 'world',
    iconLabel: 'World start',
    medallionLabel: 'World',
    priority: 'featured',
    accent: '#ede4d2',
  });

  const shiftedGap = envelopeWithCursorOffset(overflowEnvelope, 400, 40);
  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), shiftedGap);
  await openAtlasSurface(page, 'chronicle');
  const gapRow = page.locator('.chronicle .event-row.event-gap').first();
  await expect(gapRow).toBeVisible();
  await expect(gapRow).toContainText('trail break');
  await expect(gapRow.locator('.event-medallion')).toHaveCount(0);
  expect(await gapRow.evaluate((node) => ({
    icon: node.getAttribute('data-event-icon'),
    iconLabel: node.getAttribute('data-event-icon-label'),
    medallionLabel: node.getAttribute('data-event-medallion-label'),
    priority: node.getAttribute('data-event-priority'),
    accent: node.getAttribute('data-event-accent'),
  }))).toEqual({
    icon: null,
    iconLabel: null,
    medallionLabel: null,
    priority: null,
    accent: null,
  });

  await expect(page.locator('.inspector-recent button')).toHaveCount(0);
  await expect(page.locator('.chronicle dialog, .chronicle [role="dialog"], .inspector-recent dialog, .inspector-recent [role="dialog"]')).toHaveCount(0);
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app renders representative icon medallions across chronicle groups', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, burstEnvelope);
  await openAtlasSurface(page, 'chronicle');

  const chronicleExpectations = [
    ['mating_initiated', {
      iconKey: 'bond',
      iconLabel: 'Bond proposed',
      medallionLabel: 'Bond',
      priority: 'featured',
      accent: '#d9a8bd',
    }],
    ['agent_born', {
      iconKey: 'birth',
      iconLabel: 'Birth',
      medallionLabel: 'Birth',
      priority: 'featured',
      accent: '#f0c66f',
    }],
    ['home_built', {
      iconKey: 'home',
      iconLabel: 'Home built',
      medallionLabel: 'Home',
      priority: 'featured',
      accent: '#d6b96f',
    }],
    ['home_thieved', {
      iconKey: 'theft',
      iconLabel: 'Vault theft',
      medallionLabel: 'Theft',
      priority: 'drama',
      accent: '#d96e3f',
    }],
  ];
  for (const [eventType, expected] of chronicleExpectations) {
    const row = page.locator(`.chronicle .event-row[data-event-type="${eventType}"]`).first();
    await expect(row).toBeVisible();
    await expectIconMedallionMetadata(row, expected);
  }

  const asterPoint = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_001'));
  await page.mouse.click(asterPoint.x, asterPoint.y);
  const inspectorSpeech = page.locator('.inspector-recent .event-summary[data-event-type="speak"]').first();
  await expect(inspectorSpeech).toBeVisible();
  await expectIconMedallionMetadata(inspectorSpeech, {
    iconKey: 'speech',
    iconLabel: 'Speech',
    medallionLabel: 'Speech',
    priority: 'featured',
    accent: '#6fc7bd',
  });

  await expect(page.locator('.inspector-recent button')).toHaveCount(0);
  await expect(page.locator('.chronicle dialog, .chronicle [role="dialog"], .inspector-recent dialog, .inspector-recent [role="dialog"]')).toHaveCount(0);
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app renders a passive world pulse synopsis from grouped live history', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, burstEnvelope);
  await waitForBurstEffects(page);
  await openAtlasSurface(page, 'chronicle');

  const pulse = page.getByTestId('live-pulse');
  await expect(pulse).toBeVisible();
  await expect(pulse).toHaveAttribute('data-pulse-state', 'active');
  await expect(pulse).toHaveAttribute('data-pulse-count', '14');
  await expect(pulse).toHaveAttribute('data-pulse-window', '5-23');
  await expect(pulse).toHaveAttribute('data-pulse-dominant-group', 'life');
  await expect(pulse).toHaveAttribute('data-pulse-gap-state', 'none');
  await expect(pulse).toContainText('World pulse');
  await expect(pulse).toContainText('14 beats');
  await expect(pulse).toContainText('Life');
  await expect(pulse).toContainText('cursor 5-23');
  await expect(pulse).toContainText('returned to earth');

  await expect(pulse.locator('.live-pulse-group')).toHaveCount(3);
  const lifeGroup = pulse.locator('.live-pulse-group[data-pulse-group="life"]');
  await expect(lifeGroup).toHaveAttribute('data-pulse-group-count', '4');
  await expect(lifeGroup).toHaveAttribute('data-pulse-latest-cursor', '23');
  await expectIconMedallionMetadata(lifeGroup, {
    iconKey: 'decay',
    iconLabel: 'Body decay',
    medallionLabel: 'Decay',
    priority: 'featured',
    accent: '#9b8054',
  });

  const contestGroup = pulse.locator('.live-pulse-group[data-pulse-group="contest"]');
  await expect(contestGroup).toHaveAttribute('data-pulse-group-count', '4');
  await expect(contestGroup).toHaveAttribute('data-pulse-latest-cursor', '22');
  await expectIconMedallionMetadata(contestGroup, {
    iconKey: 'ruin',
    iconLabel: 'Ruin scavenged',
    medallionLabel: 'Scavenge',
    priority: 'featured',
    accent: '#9b8054',
  });

  const latest = pulse.locator('.live-pulse-latest');
  await expect(latest).toHaveAttribute('data-pulse-event-type', 'agent_decayed');
  await expect(latest).toHaveAttribute('data-pulse-detail-kind', 'decay');
  await expect(latest).toHaveAttribute('data-pulse-detail-text', 'Briar returns');
  await expect(latest.locator('small')).toHaveText('Briar returns');
  await expectIconMedallionMetadata(latest, {
    iconKey: 'decay',
    iconLabel: 'Body decay',
    medallionLabel: 'Decay',
    priority: 'featured',
    accent: '#9b8054',
  });

  await expect(page.locator('.live-pulse button, .live-pulse select')).toHaveCount(0);
  await expect(page.locator('.live-pulse dialog, .live-pulse [role="dialog"], .live-pulse [role="button"]')).toHaveCount(0);
  await expect(page.locator('.chronicle [data-event-type="home_breached"]')).toHaveCount(0);
  await expect(page.locator('.live-pulse [data-pulse-event-type="home_breached"]')).toHaveCount(0);
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app renders passive happening-now cues from grouped live history', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, burstEnvelope);
  await waitForBurstEffects(page);
  await openAtlasSurface(page, 'chronicle');

  const now = page.getByTestId('live-now');
  await expect(now).toBeVisible();
  await expect(now).toHaveAttribute('data-now-state', 'active');
  await expect(now).toHaveAttribute('data-now-count', '6');
  await expect(now).toContainText('Now');
  await expect(now).toContainText('6 cues');

  const cueDiagnostics = await now.locator('.live-now-cue').evaluateAll((nodes) => nodes.map((node) => ({
    slot: node.getAttribute('data-now-slot'),
    slotLabel: node.getAttribute('data-now-slot-label'),
    eventType: node.getAttribute('data-now-event-type'),
    cursor: node.getAttribute('data-now-cursor'),
    label: node.getAttribute('data-now-label'),
    detail: node.getAttribute('data-now-detail'),
    detailKind: node.getAttribute('data-now-detail-kind'),
    detailText: node.getAttribute('data-now-detail-text'),
    text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  })));

  expect(cueDiagnostics).toEqual([
    expect.objectContaining({
      slot: 'voice',
      slotLabel: 'Voice',
      eventType: 'self_talk',
      cursor: '8',
      label: 'private thought',
      detailKind: 'private-thought',
      detailText: 'private thought',
      text: expect.stringContaining('private thought'),
    }),
    expect.objectContaining({
      slot: 'bond',
      slotLabel: 'Bond',
      eventType: 'agent_born',
      cursor: '13',
      label: 'born',
      detailKind: 'birth',
      detailText: 'child of Aster and Briar',
      text: expect.stringContaining('child of Aster and Briar'),
    }),
    expect.objectContaining({
      slot: 'life',
      slotLabel: 'Life',
      eventType: 'agent_decayed',
      cursor: '23',
      label: 'returned to earth',
      detailKind: 'decay',
      detailText: 'Briar returns',
      text: expect.stringContaining('Briar returns'),
    }),
    expect.objectContaining({
      slot: 'home',
      slotLabel: 'Home',
      eventType: 'ruins_scavenged',
      cursor: '22',
      label: 'ruins picked',
      detailKind: 'ruin-scavenge',
      detailText: '6 materials gathered',
      text: expect.stringContaining('6 materials gathered'),
    }),
    expect.objectContaining({
      slot: 'conflict',
      slotLabel: 'Conflict',
      eventType: 'home_colonized',
      cursor: '21',
      label: 'home seized',
      detailKind: 'home-seized',
      detailText: 'Cinder claims the hearth',
      text: expect.stringContaining('Cinder claims the hearth'),
    }),
    expect.objectContaining({
      slot: 'world',
      slotLabel: 'World',
      eventType: 'resource_changed',
      cursor: '9',
      label: 'gathered',
      detail: '9 energy gathered',
      detailKind: 'harvest',
      detailText: '9 energy gathered',
      text: expect.stringContaining('9 energy gathered'),
    }),
  ]);

  for (const cue of cueDiagnostics) {
    expect(`${cue.label} ${cue.detail} ${cue.text}`).not.toMatch(/\b(?:agent|home)_/i);
  }
  expect(await now.textContent()).not.toMatch(/agent_|home_|simulation|provider|model|run_|llm|npc|spawn/i);

  await expectIconMedallionMetadata(now.locator('.live-now-cue[data-now-slot="voice"]'), {
    iconKey: 'thought',
    iconLabel: 'Private thought',
    medallionLabel: 'Thought',
    priority: 'featured',
    accent: '#d6b96f',
  });
  await expectIconMedallionMetadata(now.locator('.live-now-cue[data-now-slot="bond"]'), {
    iconKey: 'birth',
    iconLabel: 'Birth',
    medallionLabel: 'Birth',
    priority: 'featured',
    accent: '#f0c66f',
  });
  await expectIconMedallionMetadata(now.locator('.live-now-cue[data-now-slot="life"]'), {
    iconKey: 'decay',
    iconLabel: 'Body decay',
    medallionLabel: 'Decay',
    priority: 'featured',
    accent: '#9b8054',
  });
  await expectIconMedallionMetadata(now.locator('.live-now-cue[data-now-slot="home"]'), {
    iconKey: 'ruin',
    iconLabel: 'Ruin scavenged',
    medallionLabel: 'Scavenge',
    priority: 'featured',
    accent: '#9b8054',
  });
  await expectIconMedallionMetadata(now.locator('.live-now-cue[data-now-slot="conflict"]'), {
    iconKey: 'crown',
    iconLabel: 'Home claimed',
    medallionLabel: 'Claim',
    priority: 'drama',
    accent: '#d96e3f',
  });
  await expectIconMedallionMetadata(now.locator('.live-now-cue[data-now-slot="world"]'), {
    iconKey: 'harvest',
    iconLabel: 'Harvest',
    medallionLabel: 'Harvest',
    priority: 'ambient',
    accent: '#8fac6d',
  });

  await expect(now.locator('[data-now-event-type="home_breached"]')).toHaveCount(0);
  await expect(now.locator('button, select, dialog, [role="button"], [role="dialog"]')).toHaveCount(0);
  await expect(now.locator('.event-row, .viv-event-bubble')).toHaveCount(0);
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app renders compact passive details for speech death and theft', async ({ page }) => {
  const compactDetailEnvelope = {
    schema: 1,
    cursor: 4,
    oldest_cursor: 0,
    next_cursor: 10,
    events: [
      eventEntry(
        5,
        'speak',
        'agent_001',
        { speaker_id: 'agent_001', target_id: 'agent_002', message: 'Aster calls softly near provider model prompt run_9.' },
        { actor_id: 'agent_001', target_id: 'agent_002', region: 'warm_springs' },
        { target: 'agent_002' },
      ),
      eventEntry(
        6,
        'attack',
        'agent_003',
        {
          attacker_id: 'agent_003',
          victim_id: 'agent_002',
          region: 'nirvana_west',
          damage: 24,
        },
        { actor_id: 'agent_003', target_id: 'agent_002', region: 'nirvana_west' },
        { target: 'agent_002' },
      ),
      eventEntry(
        7,
        'agent_died',
        'agent_002',
        {
          victim_id: 'agent_002',
          killer_id: 'agent_003',
          region: 'nirvana_west',
          looted_energy: 0,
          looted_materials: 3,
        },
        { actor_id: 'agent_003', target_id: 'agent_002', region: 'nirvana_west' },
        { target: 'agent_003' },
      ),
      eventEntry(
        8,
        'home_breached',
        'agent_003',
        {
          home_id: 'home_001',
          target_home: 'home_001',
          breacher_id: 'agent_003',
          intent: 'thieve',
          region: 'warm_springs',
          integrity_damage: 60,
          integrity: 0,
        },
        { actor_id: 'agent_003', region: 'warm_springs', home_id: 'home_001' },
      ),
      eventEntry(
        9,
        'home_thieved',
        'agent_003',
        {
          home_id: 'home_001',
          target_home: 'home_001',
          breacher_id: 'agent_003',
          intent: 'thieve',
          region: 'warm_springs',
          recipients: ['agent_003'],
          loot: { materials: 14 },
          loot_shares: { agent_003: { materials: 14 } },
          vault_materials: 0,
          integrity: 0,
        },
        { actor_id: 'agent_003', region: 'warm_springs', home_id: 'home_001', amount: 14 },
      ),
    ],
    overflow: false,
    snapshot_required: false,
  };

  await bootApp(page, { width: 1440, height: 900 }, compactDetailEnvelope);
  await openAtlasSurface(page, 'chronicle');

  const deathBubble = page.locator('.viv-event-bubble[data-event-type="agent_died"]').first();
  await expect(deathBubble).toHaveAttribute('data-event-chain-kind', 'strike-death');
  await expect(deathBubble).toHaveAttribute('data-event-chain-count', '2');
  await expect(deathBubble).toHaveAttribute('data-event-chain-window', '6-7');
  await expect(deathBubble).toHaveAttribute('data-event-chain-text', 'after strike');
  await expect(deathBubble.locator('.viv-event-bubble-chain')).toHaveText('after strike');

  const theftBubble = page.locator('.viv-event-bubble[data-event-type="home_thieved"]').first();
  await expect(theftBubble).toHaveAttribute('data-event-chain-kind', 'breach-theft');
  await expect(theftBubble).toHaveAttribute('data-event-chain-count', '2');
  await expect(theftBubble).toHaveAttribute('data-event-chain-window', '8-9');
  await expect(theftBubble).toHaveAttribute('data-event-chain-text', 'after breach');
  await expect(theftBubble.locator('.viv-event-bubble-chain')).toHaveText('after breach');

  const pulseLatest = page.getByTestId('live-pulse').locator('.live-pulse-latest');
  await expect(page.getByTestId('live-now')).toHaveAttribute('data-now-count', '3');
  await expect(pulseLatest).toHaveAttribute('data-pulse-event-type', 'home_thieved');
  await expect(pulseLatest).toHaveAttribute('data-pulse-detail-kind', 'theft');
  await expect(pulseLatest).toHaveAttribute('data-pulse-detail-text', '14 materials taken');
  await expect(pulseLatest).toHaveAttribute('data-pulse-chain-kind', 'breach-theft');
  await expect(pulseLatest).toHaveAttribute('data-pulse-chain-count', '2');
  await expect(pulseLatest).toHaveAttribute('data-pulse-chain-window', '8-9');
  await expect(pulseLatest).toHaveAttribute('data-pulse-chain-text', 'after breach');
  await expect(pulseLatest.locator('small')).toHaveText('14 materials taken');
  await expect(pulseLatest.locator('em')).toHaveText('after breach');

  const now = page.getByTestId('live-now');
  await expect(now.locator('.live-now-cue[data-now-slot="voice"]')).toHaveAttribute('data-now-event-type', 'speak');
  await expect(now.locator('.live-now-cue[data-now-slot="voice"]')).toHaveAttribute('data-now-detail', 'to Briar');
  await expect(now.locator('.live-now-cue[data-now-slot="voice"]')).toHaveAttribute('data-now-detail-kind', 'direct-speech');
  await expect(now.locator('.live-now-cue[data-now-slot="voice"]')).toHaveAttribute('data-now-detail-text', 'to Briar');
  await expect(now.locator('.live-now-cue[data-now-slot="voice"] small')).toHaveText('to Briar');

  await expect(now.locator('.live-now-cue[data-now-slot="life"]')).toHaveAttribute('data-now-event-type', 'agent_died');
  await expect(now.locator('.live-now-cue[data-now-slot="life"]')).toHaveAttribute('data-now-detail-kind', 'death');
  await expect(now.locator('.live-now-cue[data-now-slot="life"]')).toHaveAttribute('data-now-detail-text', 'felled by Cinder');
  await expect(now.locator('.live-now-cue[data-now-slot="life"]')).toHaveAttribute('data-now-chain-kind', 'strike-death');
  await expect(now.locator('.live-now-cue[data-now-slot="life"]')).toHaveAttribute('data-now-chain-count', '2');
  await expect(now.locator('.live-now-cue[data-now-slot="life"]')).toHaveAttribute('data-now-chain-window', '6-7');
  await expect(now.locator('.live-now-cue[data-now-slot="life"]')).toHaveAttribute('data-now-chain-text', 'after strike');
  await expect(now.locator('.live-now-cue[data-now-slot="life"] small')).toHaveText('felled by Cinder');
  await expect(now.locator('.live-now-cue[data-now-slot="life"] em')).toHaveText('after strike');

  await expect(now.locator('.live-now-cue[data-now-slot="conflict"]')).toHaveAttribute('data-now-event-type', 'home_thieved');
  await expect(now.locator('.live-now-cue[data-now-slot="conflict"]')).toHaveAttribute('data-now-detail-kind', 'theft');
  await expect(now.locator('.live-now-cue[data-now-slot="conflict"]')).toHaveAttribute('data-now-detail-text', '14 materials taken');
  await expect(now.locator('.live-now-cue[data-now-slot="conflict"]')).toHaveAttribute('data-now-chain-kind', 'breach-theft');
  await expect(now.locator('.live-now-cue[data-now-slot="conflict"]')).toHaveAttribute('data-now-chain-count', '2');
  await expect(now.locator('.live-now-cue[data-now-slot="conflict"]')).toHaveAttribute('data-now-chain-window', '8-9');
  await expect(now.locator('.live-now-cue[data-now-slot="conflict"]')).toHaveAttribute('data-now-chain-text', 'after breach');
  await expect(now.locator('.live-now-cue[data-now-slot="conflict"] small')).toHaveText('14 materials taken');
  await expect(now.locator('.live-now-cue[data-now-slot="conflict"] em')).toHaveText('after breach');
  await expect(now.locator('[data-now-event-type="attack"]')).toHaveCount(0);
  await expect(now.locator('[data-now-event-type="home_breached"]')).toHaveCount(0);

  const chronicleDeath = page.locator('.chronicle .event-row[data-event-type="agent_died"]');
  await expect(chronicleDeath).toHaveAttribute('data-event-chain-kind', 'strike-death');
  await expect(chronicleDeath).toHaveAttribute('data-event-chain-count', '2');
  await expect(chronicleDeath).toHaveAttribute('data-event-chain-window', '6-7');
  await expect(chronicleDeath).toHaveAttribute('data-event-chain-text', 'after strike');
  await expect(chronicleDeath.locator('.event-row-chain')).toHaveText('after strike');
  const chronicleTheft = page.locator('.chronicle .event-row[data-event-type="home_thieved"]');
  await expect(chronicleTheft).toHaveAttribute('data-event-chain-kind', 'breach-theft');
  await expect(chronicleTheft).toHaveAttribute('data-event-chain-count', '2');
  await expect(chronicleTheft).toHaveAttribute('data-event-chain-window', '8-9');
  await expect(chronicleTheft).toHaveAttribute('data-event-chain-text', 'after breach');
  await expect(chronicleTheft.locator('.event-row-chain')).toHaveText('after breach');
  await expect(page.locator('.chronicle [data-event-type="attack"]')).toHaveCount(0);
  await expect(page.locator('.chronicle [data-event-type="home_breached"]')).toHaveCount(0);

  const homePoint = await page.evaluate(() => window.__vivariumWorld.screenPointForHome('home_001'));
  await page.mouse.click(homePoint.x, homePoint.y);
  const focusLatest = page.getByTestId('selected-focus-activity-pulse').locator('[data-focus-pulse-latest="true"]');
  await expect(page.getByTestId('selected-focus-activity-pulse')).toHaveAttribute('data-focus-window', '8-9');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-event-type', 'home_thieved');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-detail-kind', 'theft');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-detail-text', '14 materials taken');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-chain-kind', 'breach-theft');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-chain-count', '2');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-chain-window', '8-9');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-chain-text', 'after breach');
  await expect(focusLatest.locator('small')).toHaveText('14 materials taken');
  await expect(focusLatest.locator('.focus-pulse-latest-copy em')).toHaveText('after breach');
  const selectedTheftSummary = page.locator('.inspector-recent [data-event-type="home_thieved"]').first();
  await expect(selectedTheftSummary).toHaveAttribute('data-event-detail-kind', 'theft');
  await expect(selectedTheftSummary).toHaveAttribute('data-event-detail-text', '14 materials taken');
  await expect(selectedTheftSummary).toHaveAttribute('data-event-chain-kind', 'breach-theft');
  await expect(selectedTheftSummary).toHaveAttribute('data-event-chain-count', '2');
  await expect(selectedTheftSummary).toHaveAttribute('data-event-chain-window', '8-9');
  await expect(selectedTheftSummary).toHaveAttribute('data-event-chain-text', 'after breach');
  await expect(selectedTheftSummary.locator('.event-summary-detail')).toHaveText('14 materials taken');
  await expect(selectedTheftSummary.locator('.event-summary-chain')).toHaveText('after breach');
  await expect(page.locator('.inspector-recent [data-event-type="home_breached"]')).toHaveCount(0);

  await expect(page.locator('.live-pulse button, .live-pulse select, .live-now button, .live-now select')).toHaveCount(0);
  await expect(page.locator('.live-pulse dialog, .live-pulse [role="dialog"], .live-now dialog, .live-now [role="dialog"]')).toHaveCount(0);
  await expect(page.locator('.focus-pulse button, .focus-pulse select, .focus-pulse dialog, .focus-pulse [role="dialog"]')).toHaveCount(0);
  await expectRetainedSurfaceAttributeCopyClean(page);
  await expectNoBannedObserverCopy(page);
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app renders a passive live error shell when the first world view is unavailable', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await bootApp(
      page,
      viewport,
      [],
      world,
      routeFailure(503, { message: 'missing' }),
      replayArtifactBodies,
      { waitForReady: false },
    );

    await openAtlasSurface(page, 'world');
    const status = page.getByTestId('live-status-strip');
    await expect(status).toContainText('World unavailable');
    await expect(status).toContainText('The first world view did not arrive.');
    await expect(status).toContainText('World view missing');
    await expect(status).not.toContainText(/\brun\b/i);
    await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'error');
    await expect(page.locator('.connection-pill')).toContainText('attention');
    await expect(page.locator('.top-hud')).toContainText('0.0');
    await expect(page.locator('.presence-rail')).toContainText('Beings');
    await expect(page.locator('.timeline-strip')).toContainText('Live tail');
    await expect(page.locator('.timeline-strip')).not.toContainText('Seek');
    await expect(page.getByTestId('archive-chronicle')).toHaveCount(0);
    await expect(page.getByTestId('replay-preview')).toHaveCount(0);
    await expect(page.locator('.timeline-strip button')).toHaveCount(0);
    await expect(status.locator('button')).toHaveCount(0);
    await openAtlasSurface(page, 'chronicle');
    await expect(page.locator('.chronicle')).toContainText('Chronicle');
    if (viewport.width > 980) {
      expect(await viewportLayoutIssues(page), `${viewport.width}x${viewport.height}`).toEqual([]);
    } else {
      const documentOverflow = await page.evaluate(() => Math.max(
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        document.body.scrollWidth - document.body.clientWidth,
      ));
      expect(documentOverflow, `${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
    }
    expect(await corePanelOverlaps(page), `${viewport.width}x${viewport.height}`).toEqual([]);
    await expectNoBannedObserverCopy(page);
  }
});

test('production app retries the first world view and opens live from the accepted cursor', async ({ page }) => {
  const recoveredWorld = {
    ...world,
    event_cursor: 9,
    world_time: 24.5,
  };
  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    [],
    [routeFailure(503, { message: 'missing' }), recoveredWorld],
    { ...run, event_cursor: 4 },
    replayArtifactBodies,
    { waitForReady: false },
  );

  await openAtlasSurface(page, 'world');
  const status = page.getByTestId('live-status-strip');
  await expect(status).toContainText('World unavailable');
  await expect(status).toContainText('The first world view did not arrive.');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'error');
  await expect(page.getByTestId('archive-chronicle')).toHaveCount(0);
  await expect(page.getByTestId('replay-preview')).toHaveCount(0);

  await page.getByText('Aster').first().waitFor({ timeout: 5000 });
  await expect(status).toContainText('Live');
  await expect(status).toContainText('Caught up at cursor 9');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'live');
  await page.waitForFunction(() => (window.__vivariumMockEventSourceUrlLog || []).some((url) => url.includes('cursor=9')));
  expect(boot.getWorldRequestCount()).toBeGreaterThanOrEqual(2);
  expect(await rendererChromeControlState(page)).toMatchObject({
    timelineButtons: 0,
    replayButtons: 0,
    liveStatusButtons: 0,
    motionControlCopy: false,
  });
  expect(await viewportLayoutIssues(page)).toEqual([]);
  await expectNoBannedObserverCopy(page);
});

test('production app shows passive live reconnect and resumes from the retained cursor', async ({ page }) => {
  const boot = await bootApp(page, { width: 1440, height: 900 }, []);
  await openAtlasSurface(page, 'archive');

  await expect(page.getByTestId('live-status-strip')).toContainText('Live');
  await expect(page.locator('.timeline-strip')).toContainText('Archive');
  await expect(page.locator('.timeline-strip')).toContainText('ready');
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });

  await page.evaluate(() => window.__vivariumFailMockEventSource(new Error('temporary trail break')));
  await expect(page.getByTestId('live-status-strip')).toContainText('Rejoining');
  await expect(page.getByTestId('live-status-strip')).toContainText('Last seen cursor 4');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'reconnecting');
  await expect(page.locator('.connection-pill')).toContainText('rejoining');
  expect(await viewportLayoutIssues(page)).toEqual([]);

  await page.waitForFunction(() => (window.__vivariumMockEventSourceUrlLog || []).length >= 2, null, {
    timeout: 4000,
  });
  const streamUrls = await page.evaluate(() => window.__vivariumMockEventSourceUrlLog);
  expect(streamUrls[0]).toContain('cursor=4');
  expect(streamUrls[streamUrls.length - 1]).toContain('cursor=4');

  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), envelope);
  await expect(page.getByTestId('live-status-strip')).toContainText('Live');
  await expect(page.getByTestId('live-status-strip')).toContainText('Caught up at cursor 5');
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('Aster calls across the meadow.');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'live');
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });
  await openAtlasSurface(page, 'archive');
  expect(await rendererChromeControlState(page)).toMatchObject({
    timelineButtons: 0,
    replayButtons: 0,
    liveStatusButtons: 0,
    motionControlCopy: false,
  });
  await expectNoBannedObserverCopy(page);
});

test('production app retries paused snapshot recovery and resumes from a fresh world view', async ({ page }) => {
  const recoveredWorld = {
    ...world,
    event_cursor: 18,
    world_time: 30.5,
  };
  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    [{ delay: 80, onceKey: 'recovery-retry-success', body: overflowEnvelope }],
    [world, routeFailure(503, { message: 'missing' }), recoveredWorld],
  );

  await openAtlasSurface(page, 'world');
  const status = page.getByTestId('live-status-strip');
  await expect(status).toContainText('Recovery paused');
  await expect(status).toContainText('1 retained break');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'recovery-paused');
  const streamCountWhilePaused = await page.evaluate(() => window.__vivariumMockEventSourceUrlLog.length);

  await expect(status).toContainText('Live', { timeout: 5000 });
  await expect(status).toContainText('Caught up at cursor 18');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'live');
  await page.waitForFunction(() => (window.__vivariumMockEventSourceUrlLog || []).some((url) => url.includes('cursor=18')));
  const streamUrls = await page.evaluate(() => window.__vivariumMockEventSourceUrlLog);
  expect(streamUrls.length).toBeGreaterThan(streamCountWhilePaused);
  expect(streamUrls[streamUrls.length - 1]).toContain('cursor=18');
  expect(boot.getWorldRequestCount()).toBeGreaterThanOrEqual(3);
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });

  await page.evaluate(() => window.__vivariumFailMockEventSourceAt(0, new Error('late old stream error')));
  await page.evaluate((body) => window.__vivariumDispatchMockEventSourceAt(0, body), {
    ...envelope,
    cursor: 18,
    next_cursor: 21,
    snapshot_required: true,
    events: envelope.events.map((entry) => ({
      ...entry,
      cursor: 21,
      event: {
        ...entry.event,
        timestamp: 33,
      },
    })),
  });
  await page.waitForTimeout(450);
  await expect(status).toContainText('Live');
  await expect(status).toContainText('Caught up at cursor 18');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'live');
  const streamUrlsAfterOldCallbacks = await page.evaluate(() => window.__vivariumMockEventSourceUrlLog);
  expect(streamUrlsAfterOldCallbacks).toEqual(streamUrls);

  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('trail break');
  await openAtlasSurface(page, 'world');
  await expect(page.locator('.timeline-strip')).toContainText('Gaps');
  await expect(page.locator('.timeline-strip')).toContainText('1');
  await expect(page.locator('.timeline-strip')).not.toContainText('Seek');
  expect(await rendererChromeControlState(page)).toMatchObject({
    timelineButtons: 0,
    replayButtons: 0,
    liveStatusButtons: 0,
    motionControlCopy: false,
  });
  expect(await viewportLayoutIssues(page)).toEqual([]);
  await expectNoBannedObserverCopy(page);
});

test('production app retries stale recovery snapshots until a newer world view arrives', async ({ page }) => {
  const staleWorld = {
    ...world,
    event_cursor: 8,
    world_time: 22,
  };
  const recoveredWorld = {
    ...world,
    event_cursor: 19,
    world_time: 31,
  };
  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    [{ delay: 80, onceKey: 'stale-recovery-retry', body: overflowEnvelope }],
    [world, staleWorld, recoveredWorld],
  );

  await openAtlasSurface(page, 'world');
  const status = page.getByTestId('live-status-strip');
  await expect(status).toContainText('Recovery paused');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'recovery-paused');
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('trail break');

  await openAtlasSurface(page, 'world');
  await expect(status).toContainText('Live', { timeout: 5000 });
  await expect(status).toContainText('Caught up at cursor 19');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'live');
  await page.waitForFunction(() => (window.__vivariumMockEventSourceUrlLog || []).some((url) => url.includes('cursor=19')));
  const streamUrls = await page.evaluate(() => window.__vivariumMockEventSourceUrlLog);
  expect(streamUrls[streamUrls.length - 1]).toContain('cursor=19');
  expect(boot.getWorldRequestCount()).toBeGreaterThanOrEqual(3);
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });
  expect(await rendererChromeControlState(page)).toMatchObject({
    timelineButtons: 0,
    replayButtons: 0,
    liveStatusButtons: 0,
    motionControlCopy: false,
  });
  expect(await viewportLayoutIssues(page)).toEqual([]);
  await expectNoBannedObserverCopy(page);
});

test('production app exposes debug-only live recovery diagnostics across repeated recovery cycles', async ({ page }) => {
  const recoveredWorldOne = {
    ...world,
    event_cursor: 18,
    world_time: 30.5,
  };
  const staleWorldTwo = {
    ...world,
    event_cursor: 24,
    world_time: 34,
  };
  const recoveredWorldTwo = {
    ...world,
    event_cursor: 32,
    world_time: 39.5,
  };
  const secondOverflow = {
    ...overflowEnvelope,
    cursor: 18,
    oldest_cursor: 12,
    next_cursor: 28,
    events: overflowEnvelope.events.map((entry) => ({
      ...entry,
      cursor: 28,
      event: {
        ...entry.event,
        timestamp: 35,
      },
    })),
  };

  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    [],
    [
      world,
      routeFailure(503, { message: 'missing' }),
      recoveredWorldOne,
      staleWorldTwo,
      recoveredWorldTwo,
    ],
  );

  await openAtlasSurface(page, 'archive');
  await expect(page.getByTestId('replay-preview')).toBeVisible();
  await expect(page.getByTestId('world-stage')).toHaveAttribute('data-stage-source', 'archive');
  expect(await page.evaluate(() => '__vivariumPreviewWorld' in window)).toBe(false);
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });

  await clickStableProjectedWorldTarget(page, 'agent', 'agent_001');
  await expect(page.locator('.inspector strong')).toHaveText('Aster');

  const initialDiagnostics = await page.evaluate(() => window.__vivariumLiveRun.diagnostics());
  expect(initialDiagnostics).toMatchObject({
    stream: {
      active: true,
      cursor: 4,
      url: '/api/events/stream?cursor=4',
      serial: 1,
    },
    timers: {
      recoveryRetry: false,
    },
    lastAcceptedSnapshotCursor: 4,
    lastRejectedSnapshotCursor: null,
    lastRejectedSnapshotReason: null,
    ignoredStaleStreamCallbackCount: 0,
  });

  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), overflowEnvelope);
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'recovery-paused');
  await page.waitForFunction(() => {
    const diagnostics = window.__vivariumLiveRun?.diagnostics?.();
    return diagnostics?.timers?.recoveryRetry === true &&
      diagnostics?.lastSnapshotRefresh?.status === 'failed';
  });
  const failedCycleDiagnostics = await page.evaluate(() => window.__vivariumLiveRun.diagnostics());
  expect(failedCycleDiagnostics).toMatchObject({
    eventCursor: 16,
    needsSnapshot: true,
    stream: {
      active: false,
      cursor: null,
      url: null,
    },
    timers: {
      recoveryRetry: true,
    },
    refreshInFlight: 'none',
    lastAcceptedSnapshotCursor: 4,
    lastRejectedSnapshotCursor: null,
    lastRejectedSnapshotReason: null,
    lastSnapshotRefresh: {
      status: 'failed',
      reconnect: true,
      cursor: null,
    },
  });

  await page.waitForFunction(() => window.__vivariumLiveRun?.diagnostics?.().stream.cursor === 18);
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'live');
  await expect(page.locator('.inspector strong')).toHaveText('Aster');
  const firstRecoveryDiagnostics = await page.evaluate(() => window.__vivariumLiveRun.diagnostics());
  expect(firstRecoveryDiagnostics).toMatchObject({
    eventCursor: 18,
    needsSnapshot: false,
    stream: {
      active: true,
      cursor: 18,
      url: '/api/events/stream?cursor=18',
      serial: 2,
    },
    timers: {
      recoveryRetry: false,
    },
    lastAcceptedSnapshotCursor: 18,
    lastRejectedSnapshotCursor: null,
    lastRejectedSnapshotReason: null,
    lastSnapshotRefresh: {
      status: 'applied',
      reconnect: true,
      cursor: 18,
      error: null,
    },
  });

  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), secondOverflow);
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'recovery-paused');
  await page.waitForFunction(() => {
    const diagnostics = window.__vivariumLiveRun?.diagnostics?.();
    return diagnostics?.lastRejectedSnapshotCursor === 24 &&
      diagnostics?.timers?.recoveryRetry === true;
  });
  const staleCycleDiagnostics = await page.evaluate(() => window.__vivariumLiveRun.diagnostics());
  expect(staleCycleDiagnostics).toMatchObject({
    eventCursor: 28,
    needsSnapshot: true,
    stream: {
      active: false,
      cursor: null,
      url: null,
    },
    timers: {
      recoveryRetry: true,
    },
    lastAcceptedSnapshotCursor: 18,
    lastRejectedSnapshotCursor: 24,
    lastRejectedSnapshotReason: 'Fresh world view was older than the live trail',
    lastSnapshotRefresh: {
      status: 'rejected',
      reconnect: true,
      cursor: 24,
      error: 'Fresh world view was older than the live trail',
    },
  });

  await page.waitForFunction(() => window.__vivariumLiveRun?.diagnostics?.().stream.cursor === 32);
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'live');
  await expect(page.locator('.inspector strong')).toHaveText('Aster');
  const finalDiagnostics = await page.evaluate(() => window.__vivariumLiveRun.diagnostics());
  expect(finalDiagnostics).toMatchObject({
    eventCursor: 32,
    needsSnapshot: false,
    connection: 'live',
    stream: {
      active: true,
      cursor: 32,
      url: '/api/events/stream?cursor=32',
      serial: 3,
    },
    lastAcceptedSnapshotCursor: 32,
    lastRejectedSnapshotCursor: 24,
    lastRejectedSnapshotReason: 'Fresh world view was older than the live trail',
    lastSnapshotRefresh: {
      status: 'applied',
      reconnect: true,
      cursor: 32,
      error: null,
    },
  });

  const streamUrls = await page.evaluate(() => window.__vivariumMockEventSourceUrlLog);
  expect(streamUrls).toEqual([
    '/api/events/stream?cursor=4',
    '/api/events/stream?cursor=18',
    '/api/events/stream?cursor=32',
  ]);

  const ignoredBefore = finalDiagnostics.ignoredStaleStreamCallbackCount;
  await page.evaluate(() => window.__vivariumFailMockEventSourceAt(0, new Error('late old stream error')));
  await page.evaluate((body) => window.__vivariumDispatchMockEventSourceAt(0, body), secondOverflow);
  await page.evaluate(() => window.__vivariumFailMockEventSourceAt(1, new Error('late middle stream error')));
  await page.evaluate((body) => window.__vivariumDispatchMockEventSourceAt(1, body), secondOverflow);
  await page.waitForFunction((previous) => (
    window.__vivariumLiveRun?.diagnostics?.().ignoredStaleStreamCallbackCount >= previous + 4
  ), ignoredBefore);
  const afterOldStreamDiagnostics = await page.evaluate(() => window.__vivariumLiveRun.diagnostics());
  expect(afterOldStreamDiagnostics).toMatchObject({
    eventCursor: 32,
    needsSnapshot: false,
    connection: 'live',
    stream: {
      active: true,
      cursor: 32,
      serial: 3,
    },
    ignoredStaleStreamCallbackCount: ignoredBefore + 4,
  });
  expect(await page.evaluate(() => window.__vivariumMockEventSourceUrlLog)).toEqual(streamUrls);

  await openAtlasSurface(page, 'archive');
  const previewCursors = await page.evaluate(() => Array.from(window.__vivariumWorld.appliedEventCursors()));
  expect(previewCursors).not.toContain(18);
  expect(previewCursors).not.toContain(32);
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });
  await expect(page.locator('.timeline-strip')).toContainText('Gaps');
  await expect(page.locator('.timeline-strip')).not.toContainText('Seek');
  expect(await rendererChromeControlState(page)).toMatchObject({
    timelineButtons: 0,
    replayButtons: 0,
    liveStatusButtons: 0,
    motionControlCopy: false,
  });
  await expectNoLiveDiagnosticCopy(page);
  await expectNoBannedObserverCopy(page);
});

test('production app keeps recovery paused visible when a retained break cannot refresh', async ({ page }) => {
  await bootApp(
    page,
    { width: 981, height: 560 },
    [{ delay: 80, onceKey: 'failed-recovery', body: overflowEnvelope }],
    [world, routeFailure(503, { message: 'missing' })],
  );

  await openAtlasSurface(page, 'world');
  const status = page.getByTestId('live-status-strip');
  await expect(status).toContainText('Recovery paused');
  await expect(status).toContainText('The last world view remains visible');
  await expect(status).toContainText('1 retained break');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'recovery-paused');
  await expect(page.locator('.connection-pill')).toContainText('paused');
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('trail break');
  await expect(page.locator('.chronicle')).toContainText('The live trail moved ahead');

  await openAtlasSurface(page, 'world');
  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), {
    ...envelope,
    cursor: 16,
    next_cursor: 17,
    events: envelope.events.map((entry) => ({
      ...entry,
      cursor: 17,
      event: {
        ...entry.event,
        timestamp: 22,
      },
    })),
  });
  await expect(status).toContainText('Recovery paused');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'recovery-paused');
  const streamLogBeforeFailure = await page.evaluate(() => window.__vivariumMockEventSourceUrlLog.length);
  await page.evaluate(() => window.__vivariumFailMockEventSource(new Error('old stream closed')));
  await page.waitForTimeout(1200);
  await expect(status).toContainText('Recovery paused');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'recovery-paused');
  const streamLogAfterFailure = await page.evaluate(() => window.__vivariumMockEventSourceUrlLog.length);
  expect(streamLogAfterFailure).toBe(streamLogBeforeFailure);
  await expect(page.locator('.timeline-strip')).toContainText('Gaps');
  await expect(page.locator('.timeline-strip')).toContainText('1');
  await expect(page.locator('.timeline-strip')).not.toContainText('Seek');
  expect(await rendererChromeControlState(page)).toMatchObject({
    timelineButtons: 0,
    replayButtons: 0,
    liveStatusButtons: 0,
    motionControlCopy: false,
  });
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
  await expectNoBannedObserverCopy(page);
});

test('production app surfaces replay artifact metadata without applying artifact cursors', async ({ page }) => {
  const liveNamedWorld = {
    ...world,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'Aster Live' }
        : agent.id === 'agent_003'
          ? { ...agent, name: 'Cinder Live' }
        : agent,
    ),
  };
  const archiveOlderWorld = {
    ...world,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'Archive Aster' }
        : agent.id === 'agent_003'
          ? { ...agent, name: 'Archive Echo' }
        : agent,
    ),
  };
  const archiveFinalWorld = {
    ...archiveOlderWorld,
    agents: archiveOlderWorld.agents.filter((agent) => agent.id !== 'agent_003'),
  };
  const archiveNamedArtifacts = {
    ...replayArtifactBodies,
    events: [
      replayEventRecord(13.1, 'agent_001'),
      replayEventRecord(13.2, 'agent_001'),
      replayEventRecord(13.3, 'agent_003'),
    ].map((record) => JSON.stringify(record)).join('\n'),
    snapshots: [
      replayCheckpointRecord({ ...archiveOlderWorld, event_cursor: 2, world_time: 18.5 }, 'manual'),
      replayCheckpointRecord({ ...archiveFinalWorld, event_cursor: 3, world_time: 19.5 }, 'world_tick'),
      replayCheckpointRecord({ ...archiveFinalWorld, event_cursor: 3, world_time: 21.0 }, 'world_tick'),
    ].map((record) => JSON.stringify(record)).join('\n'),
  };
  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    envelope,
    liveNamedWorld,
    run,
    archiveNamedArtifacts,
  );
  await openAtlasSurface(page, 'archive');

  const timeline = page.locator('.timeline-strip');
  await expect(timeline).toContainText('Archive');
  await expect(timeline).toContainText('ready');
  await expect(timeline).toContainText('1-3 (3)');
  await expect(timeline).toContainText('3 points, 3x2');
  await expect(timeline).toContainText('2 @ 18.5s');
  await expect(timeline).toContainText('3 @ 21.0s');
  await expect(timeline).toContainText('Proof');
  await expect(timeline).toContainText('verified');
  await expect(timeline).toContainText('Preview');
  await expect(timeline).toContainText('ready 3 @ 21.0s, exact');
  await expect(timeline).not.toContainText('Seek');
  await expect(timeline.locator('button')).toHaveCount(0);

  const archive = page.getByTestId('archive-chronicle');
  await expect(archive).toBeVisible();
  await expect(archive).toContainText('Archive');
  await expect(archive).toContainText('1-2/3');
  await expect(archive).toContainText('2/3');
  await expect(archive).toHaveAttribute('data-archive-window-start', '0');
  await expect(archive).toHaveAttribute('data-archive-window-end', '2');
  await expect(archive).toHaveAttribute('data-archive-window-size', '2');
  await expect(archive).toHaveAttribute('data-archive-window-count', '2');
  await expect(archive).toHaveAttribute('data-archive-visible-count', '3');
  await expect(archive).toHaveAttribute('data-archive-event-count', '3');
  await expect(archive).toHaveAttribute('data-archive-has-previous', 'false');
  await expect(archive).toHaveAttribute('data-archive-has-next', 'true');
  await expect(archive).toHaveAttribute('data-archive-order', 'newest_first');
  await expect(archive).toHaveAttribute('data-archive-raw-cursor-start', '1');
  await expect(archive).toHaveAttribute('data-archive-raw-cursor-end', '3');
  await expect(archive).toHaveAttribute('data-archive-visible-cursor-start', '2');
  await expect(archive).toHaveAttribute('data-archive-visible-cursor-end', '3');
  await expect(archive).toContainText('Archive Aster');
  await expect(archive).toContainText('Archive Echo');
  await expect(archive).toContainText('Archive-only call 13.3');
  await expect(archive.getByTestId('archive-window-selector')).toHaveValue('0');
  await expect(archive.getByTestId('archive-window-selector').locator('option')).toHaveCount(2);
  const archiveRows = archive.locator('[data-event-kind="event"]');
  await expect(archiveRows).toHaveCount(2);
  const echoRow = archiveRows.filter({ hasText: 'Archive-only call 13.3' });
  await expect(echoRow).toHaveAttribute('data-archive-context-primary-kind', 'preview_snapshot');
  await expect(echoRow).toHaveAttribute('data-archive-context-primary-line', 'none');
  await expect(echoRow).toHaveAttribute('data-archive-context-source-kind', 'checkpoint');
  await expect(echoRow).toHaveAttribute('data-archive-context-source-index', '0');
  await expect(echoRow).toHaveAttribute('data-archive-context-source-line', '1');
  await expect(echoRow).toHaveAttribute('data-archive-context-source-cursor', '2');
  await expect(echoRow).toHaveAttribute('data-archive-context-fallback-count', '3');
  const asterRow = archiveRows.filter({ hasText: 'Archive-only call 13.2' });
  await expect(asterRow).toHaveAttribute('data-archive-context-primary-kind', 'checkpoint');
  await expect(asterRow).toHaveAttribute('data-archive-context-primary-line', '1');
  await expect(asterRow).toHaveAttribute('data-archive-context-source-line', '1');
  await expect(asterRow).toHaveAttribute('data-archive-context-fallback-count', '0');
  await expect(archive).not.toContainText('Aster Live');
  await expect(archive).not.toContainText('Cinder Live');
  await expect(archive.locator('button')).toHaveCount(0);
  await expect(archive).not.toContainText(/\b(Seek|Scrub|Playback|Picker|Play|Pause)\b/i);
  await expect(archive).not.toContainText(/\b(Seek|Scrub|Playback|Picker|Play|Pause)\b/i);

  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('Aster Live');
  await expect(page.locator('.chronicle')).toContainText('Aster calls across the meadow.');
  await expect(page.locator('.chronicle')).not.toContainText('Archive-only call');
  await expect(page.locator('.chronicle')).not.toContainText('Archive Aster');
  await expect(page.locator('.chronicle')).not.toContainText('Archive Echo');

  await openAtlasSurface(page, 'archive');
  const preview = page.getByTestId('replay-preview');
  await expect(preview).toContainText('Archive view');
  await expect(preview).toContainText('Exact');
  await expect(preview).toContainText('Last shown point');
  await expect(preview).toContainText('3 @ 21.0s');
  await expect(preview).toHaveAttribute('data-replay-mode', 'archive-preview');
  await expect(preview).toHaveAttribute('data-replay-entry-status', 'ready');
  await expect(preview).toHaveAttribute('data-replay-exactness', 'exact');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity-kind', 'lineNumber');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity', '3');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-index', '2');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-line', '3');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-cursor', '3');
  await expect(preview).toHaveAttribute('data-replay-rendered-cursor', '3');
  await expect(preview.locator('button')).toHaveCount(0);
  await expect(page.getByTestId('world-stage')).toHaveAttribute('data-stage-source', 'archive');
  await expect(page.getByTestId('world-stage').locator('canvas')).toHaveCount(1);
  await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);

  const previewDebug = await page.evaluate(() => ({
    pixels: window.__vivariumWorld.sampleCanvasPixels(),
    cursors: Array.from(window.__vivariumWorld.appliedEventCursors()),
    missingArchiveEcho: window.__vivariumWorld.agentVisualState('agent_003') === null,
  }));
  expect(previewDebug.pixels).toBeGreaterThan(20);
  expect(previewDebug.cursors).toContain(3);
  expect(previewDebug.missingArchiveEcho).toBe(true);
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });

  await openAtlasSurface(page, 'chronicle');
  await clickStableProjectedWorldTarget(page, 'agent', 'agent_001');
  const inspector = page.locator('.inspector');
  await expect(inspector).toHaveAttribute('data-selection-kind', 'being');
  await expect(inspector.locator('strong')).toHaveText('Aster Live');

  await openAtlasSurface(page, 'archive');
  await archive.getByTestId('archive-window-selector').selectOption('2');
  await expect(archive).toHaveAttribute('data-archive-window-start', '2');
  await expect(archive).toHaveAttribute('data-archive-window-end', '3');
  await expect(archive).toHaveAttribute('data-archive-window-count', '1');
  await expect(archive).toHaveAttribute('data-archive-has-previous', 'true');
  await expect(archive).toHaveAttribute('data-archive-has-next', 'false');
  await expect(archive).toHaveAttribute('data-archive-visible-cursor-start', '1');
  await expect(archive).toHaveAttribute('data-archive-visible-cursor-end', '1');
  await expect(archive).toContainText('3-3/3');
  await expect(archive).toContainText('Archive-only call 13.1');
  await expect(archive).not.toContainText('Archive-only call 13.3');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity-kind', 'lineNumber');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity', '3');
  await expect(preview).toHaveAttribute('data-replay-rendered-cursor', '3');
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });

  await archive.getByTestId('archive-window-selector').selectOption('0');
  await archive.getByTestId('archive-window-selector').selectOption('2');
  await page.getByTestId('archive-point-selector').selectOption('line:1');
  await expect(archive).toHaveAttribute('data-archive-window-start', '2');
  await expect(archive).toHaveAttribute('data-archive-window-end', '3');
  await expect(archive).toContainText('Archive-only call 13.1');
  await expect(archive).not.toContainText('Archive-only call 13.3');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity-kind', 'lineNumber');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity', '1');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-index', '0');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-line', '1');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-cursor', '2');
  await expect(preview).toHaveAttribute('data-replay-rendered-cursor', '2');
  await openAtlasSurface(page, 'chronicle');
  await clickStableProjectedWorldTarget(page, 'agent', 'agent_001');
  await expect(inspector).toHaveAttribute('data-selection-kind', 'being');
  await expect(inspector.locator('strong')).toHaveText('Aster Live');
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('Aster Live');
  await expect(page.locator('.chronicle')).not.toContainText('Archive-only call');
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });

  await openAtlasSurface(page, 'archive');
  const beforeArchivePointer = await page.evaluate(() => ({
    surfaceKind: document.querySelector('[data-atlas-surface][data-open="true"]')?.getAttribute('data-atlas-surface'),
    camera: window.__vivariumWorld.cameraState(),
    archiveCursors: Array.from(window.__vivariumWorld.appliedEventCursors()),
  }));
  const stageBox = await page.getByTestId('world-stage').boundingBox();
  await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(100);
  const afterArchivePointer = await page.evaluate(() => ({
    surfaceKind: document.querySelector('[data-atlas-surface][data-open="true"]')?.getAttribute('data-atlas-surface'),
    camera: window.__vivariumWorld.cameraState(),
    archiveCursors: Array.from(window.__vivariumWorld.appliedEventCursors()),
  }));
  expect(afterArchivePointer.surfaceKind).toBe(beforeArchivePointer.surfaceKind);
  expect(afterArchivePointer.archiveCursors).toEqual(beforeArchivePointer.archiveCursors);
  expect(afterArchivePointer.camera.distance).not.toBeCloseTo(beforeArchivePointer.camera.distance, 3);
});

test('production app explains grouped archive representatives without restoring hidden rows', async ({ page }) => {
  const archiveEventRecord = (type, source, payload, overrides = {}) => ({
    type,
    source,
    payload,
    scope: overrides.scope || 'local',
    region: overrides.region === undefined ? payload.region || null : overrides.region,
    target: overrides.target || null,
    timestamp: overrides.timestamp,
  });
  const chainArchiveArtifacts = {
    ...replayArtifactBodies,
    events: [
      archiveEventRecord(
        'home_breached',
        'agent_003',
        {
          home_id: 'home_001',
          target_home: 'home_001',
          breacher_id: 'agent_003',
          intent: 'thieve',
          region: 'warm_springs',
          integrity: 0,
        },
        { timestamp: 40 },
      ),
      archiveEventRecord(
        'home_thieved',
        'agent_003',
        {
          home_id: 'home_001',
          target_home: 'home_001',
          breacher_id: 'agent_003',
          intent: 'thieve',
          region: 'warm_springs',
          loot: { materials: 14 },
          vault_materials: 0,
          integrity: 0,
        },
        { timestamp: 40.1 },
      ),
      archiveEventRecord(
        'attack',
        'agent_003',
        {
          attacker_id: 'agent_003',
          victim_id: 'agent_002',
          region: 'nirvana_west',
          damage: 24,
        },
        { target: 'agent_002', timestamp: 40.2 },
      ),
      archiveEventRecord(
        'agent_died',
        'agent_002',
        {
          victim_id: 'agent_002',
          killer_id: 'agent_003',
          region: 'nirvana_west',
          looted_energy: 0,
          looted_materials: 3,
        },
        { target: 'agent_003', timestamp: 40.3 },
      ),
      archiveEventRecord(
        'agent_left_region',
        'agent_001',
        {
          agent_id: 'agent_001',
          from_region: 'nirvana',
          to_region: 'warm_springs',
          move_energy_cost: 5,
          agent_energy: 88,
        },
        { region: 'nirvana', timestamp: 40.4 },
      ),
      archiveEventRecord(
        'agent_entered_region',
        'agent_001',
        {
          agent_id: 'agent_001',
          from_region: 'nirvana',
          to_region: 'warm_springs',
          move_energy_cost: 5,
          agent_energy: 88,
        },
        { region: 'warm_springs', timestamp: 40.5 },
      ),
    ].map((record) => JSON.stringify(record)).join('\n'),
    snapshots: [
      replayCheckpointRecord({ ...world, event_cursor: 6, world_time: 41 }, 'world_tick'),
    ].map((record) => JSON.stringify(record)).join('\n'),
  };

  await bootApp(page, { width: 1440, height: 900 }, envelope, world, run, chainArchiveArtifacts);
  await openAtlasSurface(page, 'archive');

  const archive = page.getByTestId('archive-chronicle');
  await expect(archive).toHaveAttribute('data-archive-status', 'ready');
  await expect(archive).toHaveAttribute('data-archive-event-count', '6');
  await expect(archive).toHaveAttribute('data-archive-visible-count', '3');
  await expect(archive).toHaveAttribute('data-archive-window-count', '2');
  await expect(archive.locator('[data-event-type="agent_left_region"], [data-event-type="attack"], [data-event-type="home_breached"]')).toHaveCount(0);

  const movementRow = archive.locator('[data-event-kind="event"][data-event-type="agent_entered_region"]');
  await expect(movementRow).toBeVisible();
  await expect(movementRow).toHaveAttribute('data-event-chain-kind', 'crossing');
  await expect(movementRow).toHaveAttribute('data-event-chain-count', '2');
  await expect(movementRow).toHaveAttribute('data-event-chain-window', '5-6');
  await expect(movementRow).toHaveAttribute('data-event-chain-text', 'crossing complete');
  await expect(movementRow.locator('.event-row-chain')).toHaveText('crossing complete');

  const deathRow = archive.locator('[data-event-kind="event"][data-event-type="agent_died"]');
  await expect(deathRow).toBeVisible();
  await expect(deathRow).toHaveAttribute('data-event-chain-kind', 'strike-death');
  await expect(deathRow).toHaveAttribute('data-event-chain-count', '2');
  await expect(deathRow).toHaveAttribute('data-event-chain-window', '3-4');
  await expect(deathRow).toHaveAttribute('data-event-chain-text', 'after strike');
  await expect(deathRow.locator('.event-row-chain')).toHaveText('after strike');

  await archive.getByTestId('archive-window-selector').selectOption('2');
  await expect(archive).toHaveAttribute('data-archive-window-start', '2');
  await expect(archive).toHaveAttribute('data-archive-window-count', '1');
  const theftRow = archive.locator('[data-event-kind="event"][data-event-type="home_thieved"]');
  await expect(theftRow).toBeVisible();
  await expect(theftRow).toHaveAttribute('data-event-chain-kind', 'breach-theft');
  await expect(theftRow).toHaveAttribute('data-event-chain-count', '2');
  await expect(theftRow).toHaveAttribute('data-event-chain-window', '1-2');
  await expect(theftRow).toHaveAttribute('data-event-chain-text', 'after breach');
  await expect(theftRow.locator('.event-row-chain')).toHaveText('after breach');

  await expect(archive.locator('button, dialog, [role="button"], [role="dialog"]')).toHaveCount(0);
  await expect(archive).not.toContainText(/provider|model|prompt|run_|agent_|home_/i);
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app keeps empty replay artifacts passive and layout-stable', async ({ page }) => {
  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    envelope,
    world,
    run,
    { events: '', snapshots: '' },
  );
  await openAtlasSurface(page, 'archive');

  const timeline = page.locator('.timeline-strip');
  await expect(timeline.locator('dl').filter({ hasText: 'Archive' }).locator('dd')).toHaveText('ready');
  await expect(timeline.locator('dl').filter({ hasText: 'Lines' }).locator('dd')).toHaveText('none (0)');
  await expect(timeline.locator('dl').filter({ hasText: 'Points' }).locator('dd')).toHaveText('0 points');
  await expect(timeline.locator('dl').filter({ hasText: 'First' }).locator('dd')).toHaveText('none');
  await expect(timeline.locator('dl').filter({ hasText: 'Last' }).locator('dd')).toHaveText('none');
  await expect(timeline.locator('dl').filter({ hasText: 'Proof' }).locator('dd')).toHaveText('none');
  await expect(timeline.locator('dl').filter({ hasText: 'Preview' }).locator('dd')).toHaveText('none');
  await expect(timeline.locator('button')).toHaveCount(0);
  await expect(page.getByTestId('archive-point-selector')).toHaveCount(0);
  await expect(page.getByTestId('archive-point-scrubber')).toHaveCount(0);
  await expect(page.getByTestId('replay-preview')).toHaveCount(0);

  const archive = page.getByTestId('archive-chronicle');
  await expect(archive).toBeVisible();
  await expect(archive).toContainText('Archive');
  await expect(archive).toContainText('0/0');
  await expect(archive).toContainText('No archive lines.');
  await expect(archive).toHaveAttribute('data-archive-window-start', '0');
  await expect(archive).toHaveAttribute('data-archive-window-end', '0');
  await expect(archive).toHaveAttribute('data-archive-window-size', '2');
  await expect(archive).toHaveAttribute('data-archive-window-count', '0');
  await expect(archive).toHaveAttribute('data-archive-visible-count', '0');
  await expect(archive).toHaveAttribute('data-archive-event-count', '0');
  await expect(archive).toHaveAttribute('data-archive-has-previous', 'false');
  await expect(archive).toHaveAttribute('data-archive-has-next', 'false');
  await expect(archive).toHaveAttribute('data-archive-raw-cursor-start', 'none');
  await expect(archive).toHaveAttribute('data-archive-raw-cursor-end', 'none');
  await expect(archive).toHaveAttribute('data-archive-visible-cursor-start', 'none');
  await expect(archive).toHaveAttribute('data-archive-visible-cursor-end', 'none');
  await expect(archive.locator('[data-event-kind="event"]')).toHaveCount(0);
  await expect(archive.getByTestId('archive-window-selector')).toHaveCount(0);
  await expect(archive.locator('button')).toHaveCount(0);
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });

  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('Aster calls across the meadow.');
  expect(await rendererChromeControlState(page)).toMatchObject({
    timelineButtons: 0,
    replayButtons: 0,
    liveStatusButtons: 0,
    motionControlCopy: false,
  });
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
  await expectNoBannedObserverCopy(page);
});

test('production app presents event-only replay artifacts without checkpoint preview controls', async ({ page }) => {
  const eventOnlyArtifacts = {
    events: JSON.stringify(replayEventRecord(13.1, 'agent_001')),
    snapshots: '',
  };
  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    envelope,
    world,
    run,
    eventOnlyArtifacts,
  );
  await openAtlasSurface(page, 'archive');

  const timeline = page.locator('.timeline-strip');
  await expect(timeline.locator('dl').filter({ hasText: 'Archive' }).locator('dd')).toHaveText('ready');
  await expect(timeline.locator('dl').filter({ hasText: 'Lines' }).locator('dd')).toHaveText('1-1 (1)');
  await expect(timeline.locator('dl').filter({ hasText: 'Points' }).locator('dd')).toHaveText('0 points');
  await expect(timeline.locator('dl').filter({ hasText: 'First' }).locator('dd')).toHaveText('none');
  await expect(timeline.locator('dl').filter({ hasText: 'Last' }).locator('dd')).toHaveText('none');
  await expect(timeline.locator('dl').filter({ hasText: 'Proof' }).locator('dd')).toHaveText('none');
  await expect(timeline.locator('dl').filter({ hasText: 'Preview' }).locator('dd')).toHaveText('none');
  await expect(timeline.locator('button')).toHaveCount(0);
  await expect(page.getByTestId('archive-point-selector')).toHaveCount(0);
  await expect(page.getByTestId('archive-point-scrubber')).toHaveCount(0);
  await expect(page.getByTestId('replay-preview')).toHaveCount(0);

  const archive = page.getByTestId('archive-chronicle');
  await expect(archive).toBeVisible();
  await expect(archive).toContainText('1/1');
  await expect(archive).toContainText('Archive-only call 13.1');
  await expect(archive).toHaveAttribute('data-archive-window-start', '0');
  await expect(archive).toHaveAttribute('data-archive-window-end', '1');
  await expect(archive).toHaveAttribute('data-archive-window-count', '1');
  await expect(archive).toHaveAttribute('data-archive-visible-count', '1');
  await expect(archive).toHaveAttribute('data-archive-event-count', '1');
  await expect(archive).toHaveAttribute('data-archive-raw-cursor-start', '1');
  await expect(archive).toHaveAttribute('data-archive-raw-cursor-end', '1');
  await expect(archive).toHaveAttribute('data-archive-visible-cursor-start', '1');
  await expect(archive).toHaveAttribute('data-archive-visible-cursor-end', '1');
  await expect(archive.getByTestId('archive-window-selector')).toHaveCount(0);
  await expect(archive.locator('button')).toHaveCount(0);
  const archiveRows = archive.locator('[data-event-kind="event"]');
  await expect(archiveRows).toHaveCount(1);
  await expect(archiveRows.first()).toHaveAttribute('data-archive-context-source-kind', 'none');
  await expect(archiveRows.first()).toHaveAttribute('data-archive-context-fallback-count', '0');
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });

  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('Aster calls across the meadow.');
  await expect(page.locator('.chronicle')).not.toContainText('Archive-only call');
  expect(await rendererChromeControlState(page)).toMatchObject({
    timelineButtons: 0,
    replayButtons: 0,
    liveStatusButtons: 0,
    motionControlCopy: false,
  });
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
  await expectNoBannedObserverCopy(page);
});

test('production app presents checkpoint-only replay artifacts without archive rows', async ({ page }) => {
  const checkpointOnlyArtifacts = {
    events: '',
    snapshots: JSON.stringify(
      replayCheckpointRecord({ ...world, event_cursor: 4, world_time: 18.5 }, 'world_tick'),
    ),
  };
  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    envelope,
    world,
    run,
    checkpointOnlyArtifacts,
  );
  await openAtlasSurface(page, 'archive');

  const timeline = page.locator('.timeline-strip');
  await expect(timeline.locator('dl').filter({ hasText: 'Archive' }).locator('dd')).toHaveText('ready');
  await expect(timeline.locator('dl').filter({ hasText: 'Lines' }).locator('dd')).toHaveText('none (0)');
  await expect(timeline.locator('dl').filter({ hasText: 'Points' }).locator('dd')).toHaveText('1 points');
  await expect(timeline.locator('dl').filter({ hasText: 'First' }).locator('dd')).toHaveText('4 @ 18.5s');
  await expect(timeline.locator('dl').filter({ hasText: 'Last' }).locator('dd')).toHaveText('4 @ 18.5s');
  await expect(timeline.locator('dl').filter({ hasText: 'Proof' }).locator('dd')).toHaveText('verified 4 @ 18.5s, exact');
  await expect(timeline.locator('dl').filter({ hasText: 'Preview' }).locator('dd')).toHaveText('ready 4 @ 18.5s, exact');
  await expect(timeline.locator('button')).toHaveCount(0);
  await expect(page.getByTestId('archive-point-selector')).toHaveCount(0);
  await expect(page.getByTestId('archive-point-scrubber')).toHaveCount(0);

  const archive = page.getByTestId('archive-chronicle');
  await expect(archive).toBeVisible();
  await expect(archive).toContainText('0/0');
  await expect(archive).toContainText('No archive lines.');
  await expect(archive).toHaveAttribute('data-archive-window-start', '0');
  await expect(archive).toHaveAttribute('data-archive-window-end', '0');
  await expect(archive).toHaveAttribute('data-archive-window-count', '0');
  await expect(archive).toHaveAttribute('data-archive-visible-count', '0');
  await expect(archive).toHaveAttribute('data-archive-event-count', '0');
  await expect(archive.locator('[data-event-kind="event"]')).toHaveCount(0);
  await expect(archive.locator('button')).toHaveCount(0);

  const preview = page.getByTestId('replay-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Archive view');
  await expect(preview).toContainText('Exact');
  await expect(preview).toContainText('Last shown point');
  await expect(preview).toContainText('4 @ 18.5s');
  await expect(preview).toHaveAttribute('data-replay-mode', 'archive-preview');
  await expect(preview).toHaveAttribute('data-replay-entry-status', 'ready');
  await expect(preview).toHaveAttribute('data-replay-exactness', 'exact');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity-kind', 'lineNumber');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity', '1');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-index', '0');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-line', '1');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-cursor', '4');
  await expect(preview).toHaveAttribute('data-replay-rendered-cursor', '4');
  await expect(preview.locator('button')).toHaveCount(0);
  await expect(page.getByTestId('world-stage')).toHaveAttribute('data-stage-source', 'archive');
  await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);
  const previewDebug = await page.evaluate(() => ({
    pixels: window.__vivariumWorld.sampleCanvasPixels(),
  }));
  expect(previewDebug.pixels).toBeGreaterThan(20);
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });

  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('Aster calls across the meadow.');
  expect(await rendererChromeControlState(page)).toMatchObject({
    timelineButtons: 0,
    replayButtons: 0,
    liveStatusButtons: 0,
    motionControlCopy: false,
  });
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
  await expectNoBannedObserverCopy(page);
});

test('production app keeps archive point scrubber available for approximate preview metadata', async ({ page }) => {
  const archiveOlderWorld = {
    ...world,
    event_cursor: 1,
    world_time: 18.5,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'Approx Aster' }
        : agent.id === 'agent_003'
          ? { ...agent, name: 'Approx Echo' }
        : agent,
    ),
  };
  const archiveFinalWorld = {
    ...archiveOlderWorld,
    world_time: 21,
    agents: archiveOlderWorld.agents.filter((agent) => agent.id !== 'agent_003'),
  };
  const approximateArtifacts = {
    ...replayArtifactBodies,
    events: [
      replayEventRecord(13.1, 'agent_001'),
      replayEventRecord(13.2, 'agent_001'),
      replayEventRecord(13.3, 'agent_003'),
    ].map((record) => JSON.stringify(record)).join('\n'),
    snapshots: [
      replayCheckpointRecord({ ...archiveOlderWorld, world_time: 18.5 }, 'manual'),
      replayCheckpointRecord({ ...archiveOlderWorld, world_time: 19.5 }, 'world_tick'),
      replayCheckpointRecord(archiveFinalWorld, 'world_tick'),
    ].map((record) => JSON.stringify(record)).join('\n'),
  };

  await bootApp(
    page,
    { width: 1440, height: 900 },
    envelope,
    world,
    run,
    approximateArtifacts,
  );
  await openAtlasSurface(page, 'archive');

  const timeline = page.locator('.timeline-strip');
  const archivePoint = page.getByTestId('archive-point-selector');
  const archiveScrubber = page.getByTestId('archive-point-scrubber');
  const archiveScrubberInput = page.getByTestId('archive-point-scrubber-input');
  await expect(timeline).toContainText('metadata 3 @ 21.0s, +2');
  await expect(page.getByTestId('replay-preview')).toHaveCount(0);
  await expect(archivePoint).toBeVisible();
  await expect(archivePoint).toHaveValue('line:3');
  await expect(archiveScrubber).toBeVisible();
  await expect(archiveScrubberInput).toHaveValue('2');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-value', 'line:3');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-identity-kind', 'lineNumber');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-cursor', '1');
  await expect(timeline).not.toContainText(/\b(Seek|Scrub|Playback|Play|Pause|Speed)\b/i);
  await expect(timeline.locator('button')).toHaveCount(0);

  await setArchivePointScrubber(page, 0);
  await expect(archivePoint).toHaveValue('line:1');
  await expect(archiveScrubberInput).toHaveValue('0');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-value', 'line:1');
  await expect(timeline).toContainText('ready 1 @ 18.5s, exact');

  const preview = page.getByTestId('replay-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity-kind', 'lineNumber');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity', '1');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-index', '0');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-line', '1');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-cursor', '1');
  await expect(preview).toHaveAttribute('data-replay-rendered-cursor', '1');
  await expect(preview.locator('button')).toHaveCount(0);
  await expect(preview).not.toContainText(/\b(Seek|Scrub|Playback|Play|Pause|Speed)\b/i);
  await expect(page.getByTestId('world-stage')).toHaveAttribute('data-stage-source', 'archive');
  await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);

  const debug = await page.evaluate(() => ({
    pixels: window.__vivariumWorld.sampleCanvasPixels(),
    previewCursors: Array.from(window.__vivariumWorld.appliedEventCursors()),
    archiveEcho: window.__vivariumWorld.agentVisualState('agent_003'),
  }));
  expect(debug.pixels).toBeGreaterThan(20);
  expect(debug.previewCursors).toContain(1);
  expect(debug.archiveEcho).not.toBeNull();
  await expectNoBannedObserverCopy(page);
});

test('production app keeps replay archive passive while artifact metadata is loading', async ({ page }) => {
  const heldEvents = deferredArtifactBody(replayArtifactBodies.events);
  const heldSnapshots = deferredArtifactBody(replayArtifactBodies.snapshots);
  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    envelope,
    world,
    run,
    { events: heldEvents, snapshots: heldSnapshots },
  );
  await openAtlasSurface(page, 'archive');

  await expectPassiveReplayArtifactLoading(page, boot);

  heldEvents.release();
  heldSnapshots.release();

  await openAtlasSurface(page, 'archive');
  const timeline = page.locator('.timeline-strip');
  const archive = page.getByTestId('archive-chronicle');
  await expect(timeline.locator('dl').filter({ hasText: 'Archive' }).locator('dd')).toHaveText('ready');
  await expect(timeline.locator('dl').filter({ hasText: 'Preview' }).locator('dd')).toContainText('ready');
  await expect(archive).toHaveAttribute('data-archive-status', 'ready');
  await expect(archive).toContainText('1-2/3');
  await expect(archive).toContainText('Archive-only call 13.3');
  await expect(page.getByTestId('replay-preview')).toBeVisible();
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });
  expect(await rendererChromeControlState(page)).toMatchObject({
    timelineButtons: 0,
    replayButtons: 0,
    liveStatusButtons: 0,
    motionControlCopy: false,
  });
});

test('production app ignores delayed stale replay artifact loads after artifact identity changes', async ({ page }) => {
  const liveNamedWorld = {
    ...world,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'Aster Live' }
        : agent,
    ),
  };
  const staleArchiveWorld = {
    ...world,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'Stale Archive Aster' }
        : agent.id === 'agent_003'
          ? { ...agent, name: 'Stale Archive Echo' }
        : agent,
    ),
  };
  const staleArchiveFinalWorld = {
    ...staleArchiveWorld,
    agents: staleArchiveWorld.agents.filter((agent) => agent.id !== 'agent_003'),
  };
  const freshArchiveWorld = {
    ...world,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'Fresh Archive Aster' }
        : agent.id === 'agent_003'
          ? { ...agent, name: 'Fresh Archive Echo' }
        : agent,
    ),
  };
  const freshArchiveFinalWorld = {
    ...freshArchiveWorld,
    agents: freshArchiveWorld.agents.filter((agent) => agent.id !== 'agent_003'),
  };
  const staleArtifacts = {
    events: [
      replayEventRecord(61.1, 'agent_001'),
      replayEventRecord(61.2, 'agent_001'),
      replayEventRecord(61.3, 'agent_003'),
    ].map((record) => JSON.stringify(record)).join('\n'),
    snapshots: [
      replayCheckpointRecord({ ...staleArchiveWorld, event_cursor: 2, world_time: 18.5 }, 'manual'),
      replayCheckpointRecord({ ...staleArchiveFinalWorld, event_cursor: 3, world_time: 19.5 }, 'world_tick'),
      replayCheckpointRecord({ ...staleArchiveFinalWorld, event_cursor: 3, world_time: 21.0 }, 'world_tick'),
    ].map((record) => JSON.stringify(record)).join('\n'),
  };
  const freshArtifacts = {
    events: [
      replayEventRecord(71.1, 'agent_001'),
      replayEventRecord(71.2, 'agent_001'),
      replayEventRecord(71.3, 'agent_003'),
    ].map((record) => JSON.stringify(record)).join('\n'),
    snapshots: [
      replayCheckpointRecord({ ...freshArchiveWorld, event_cursor: 2, world_time: 38.5 }, 'manual'),
      replayCheckpointRecord({ ...freshArchiveFinalWorld, event_cursor: 3, world_time: 39.5 }, 'world_tick'),
      replayCheckpointRecord({ ...freshArchiveFinalWorld, event_cursor: 3, world_time: 41.0 }, 'world_tick'),
    ].map((record) => JSON.stringify(record)).join('\n'),
  };
  const heldStaleEvents = deferredArtifactBody(staleArtifacts.events);
  const heldStaleSnapshots = deferredArtifactBody(staleArtifacts.snapshots);
  const mutableArtifacts = {
    events: heldStaleEvents,
    snapshots: heldStaleSnapshots,
  };
  const firstRun = {
    ...run,
    artifacts: {
      ...run.artifacts,
      events: 'runs/archive-stale-a-events.jsonl',
      snapshots: 'runs/archive-stale-a-snapshots.jsonl',
    },
  };
  const nextRun = {
    ...firstRun,
    artifacts: {
      ...firstRun.artifacts,
      events: 'runs/archive-stale-b-events.jsonl',
      snapshots: 'runs/archive-stale-b-snapshots.jsonl',
    },
  };
  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    envelope,
    liveNamedWorld,
    firstRun,
    mutableArtifacts,
  );

  await openAtlasSurface(page, 'archive');
  await expectPassiveReplayArtifactLoading(page, boot);
  const diagnostics = page.getByTestId('replay-artifact-diagnostics');
  const staleLoadGeneration = (await replayArtifactDiagnosticsState(page)).loadGeneration;
  expect(staleLoadGeneration).toMatch(/^\d+$/);

  await clickStableProjectedWorldTarget(page, 'agent', 'agent_001');
  const inspector = page.locator('.inspector');
  await expect(inspector).toHaveAttribute('data-selection-kind', 'being');
  await expect(inspector.locator('strong')).toHaveText('Aster Live');

  mutableArtifacts.events = freshArtifacts.events;
  mutableArtifacts.snapshots = freshArtifacts.snapshots;
  await page.evaluate((metadata) => {
    window.__vivariumLiveRun.applyRunMetadataForTest(metadata);
  }, nextRun);

  await openAtlasSurface(page, 'archive');
  const archive = page.getByTestId('archive-chronicle');
  const preview = page.getByTestId('replay-preview');
  await expect(archive).toHaveAttribute('data-archive-status', 'ready');
  await expect(archive).toHaveAttribute('data-archive-window-start', '0');
  await expect(archive).toContainText('Fresh Archive Aster');
  await expect(archive).toContainText('Fresh Archive Echo');
  await expect(archive).toContainText('Archive-only call 71.3');
  await expect(archive).not.toContainText('Stale Archive Aster');
  await expect(archive).not.toContainText('Archive-only call 61.3');
  await expect(preview).toContainText('3 @ 41.0s');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-line', '3');
  await expect(page.getByTestId('archive-point-selector')).toHaveValue('line:3');
  await expect(page.getByTestId('archive-point-scrubber-input')).toHaveValue('2');
  await expect(page.getByTestId('archive-point-scrubber')).toHaveAttribute(
    'data-archive-scrub-selected-value',
    'line:3',
  );
  const freshDiagnostics = await replayArtifactDiagnosticsState(page);
  expect(freshDiagnostics.loadGeneration).toMatch(/^\d+$/);
  expect(freshDiagnostics.loadGeneration).not.toBe(staleLoadGeneration);
  expect(freshDiagnostics.lastCompletedGeneration).toBe(freshDiagnostics.loadGeneration);
  await expect(diagnostics).toHaveAttribute('data-artifact-active-load-generation', 'none');
  await expect(diagnostics).toHaveAttribute('data-artifact-completed-load-count', '1');
  await expect(diagnostics).toHaveAttribute('data-artifact-stale-dropped-load-count', '0');
  expect(boot.artifactRequestCounts).toEqual({ events: 2, snapshots: 2 });

  heldStaleEvents.release();
  heldStaleSnapshots.release();
  await Promise.all([heldStaleEvents.fulfilled, heldStaleSnapshots.fulfilled]);
  await expect(diagnostics).toHaveAttribute('data-artifact-load-status', 'stale_ready');
  await expect(diagnostics).toHaveAttribute('data-artifact-completed-load-count', '1');
  await expect(diagnostics).toHaveAttribute('data-artifact-stale-dropped-load-count', '1');
  await expect(diagnostics).toHaveAttribute(
    'data-artifact-last-stale-dropped-generation',
    staleLoadGeneration,
  );
  await expect(diagnostics).toHaveAttribute(
    'data-artifact-last-settled-generation',
    staleLoadGeneration,
  );

  await expect(archive).toHaveAttribute('data-archive-status', 'ready');
  await expect(archive).toContainText('Fresh Archive Aster');
  await expect(archive).toContainText('Archive-only call 71.3');
  await expect(archive).not.toContainText('Stale Archive Aster');
  await expect(archive).not.toContainText('Archive-only call 61.3');
  await expect(preview).toContainText('3 @ 41.0s');
  await openAtlasSurface(page, 'chronicle');
  await clickStableProjectedWorldTarget(page, 'agent', 'agent_001');
  await expect(inspector).toHaveAttribute('data-selection-kind', 'being');
  await expect(inspector.locator('strong')).toHaveText('Aster Live');
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('Aster Live');
  await expect(page.locator('.chronicle')).not.toContainText('Archive-only call');
  expect(boot.artifactRequestCounts).toEqual({ events: 2, snapshots: 2 });
  expect(await rendererChromeControlState(page)).toMatchObject({
    timelineButtons: 0,
    replayButtons: 0,
    liveStatusButtons: 0,
    motionControlCopy: false,
  });
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
  await expectNoBannedObserverCopy(page);
});

test('production app resets archive selectors when same-run artifact identity changes', async ({ page }) => {
  const liveNamedWorld = {
    ...world,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'Aster Live' }
        : agent,
    ),
  };
  const firstArchiveWorld = {
    ...world,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'First Archive Aster' }
        : agent.id === 'agent_003'
          ? { ...agent, name: 'First Archive Echo' }
        : agent,
    ),
  };
  const firstArchiveFinalWorld = {
    ...firstArchiveWorld,
    agents: firstArchiveWorld.agents.filter((agent) => agent.id !== 'agent_003'),
  };
  const nextArchiveWorld = {
    ...world,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'Next Archive Aster' }
        : agent.id === 'agent_003'
          ? { ...agent, name: 'Next Archive Echo' }
        : agent,
    ),
  };
  const nextArchiveFinalWorld = {
    ...nextArchiveWorld,
    agents: nextArchiveWorld.agents.filter((agent) => agent.id !== 'agent_003'),
  };
  const mutableArtifacts = {
    events: [
      replayEventRecord(31.1, 'agent_001'),
      replayEventRecord(31.2, 'agent_001'),
      replayEventRecord(31.3, 'agent_003'),
    ].map((record) => JSON.stringify(record)).join('\n'),
    snapshots: [
      replayCheckpointRecord({ ...firstArchiveWorld, event_cursor: 2, world_time: 18.5 }, 'manual'),
      replayCheckpointRecord({ ...firstArchiveFinalWorld, event_cursor: 3, world_time: 19.5 }, 'world_tick'),
      replayCheckpointRecord({ ...firstArchiveFinalWorld, event_cursor: 3, world_time: 21.0 }, 'world_tick'),
    ].map((record) => JSON.stringify(record)).join('\n'),
  };
  const nextArtifacts = {
    events: [
      replayEventRecord(41.1, 'agent_001'),
      replayEventRecord(41.2, 'agent_001'),
      replayEventRecord(41.3, 'agent_003'),
    ].map((record) => JSON.stringify(record)).join('\n'),
    snapshots: [
      replayCheckpointRecord({ ...nextArchiveWorld, event_cursor: 2, world_time: 28.5 }, 'manual'),
      replayCheckpointRecord({ ...nextArchiveFinalWorld, event_cursor: 3, world_time: 29.5 }, 'world_tick'),
      replayCheckpointRecord({ ...nextArchiveFinalWorld, event_cursor: 3, world_time: 31.0 }, 'world_tick'),
    ].map((record) => JSON.stringify(record)).join('\n'),
  };
  const heldNextEvents = deferredArtifactBody(nextArtifacts.events);
  const heldNextSnapshots = deferredArtifactBody(nextArtifacts.snapshots);
  const firstRun = {
    ...run,
    artifacts: {
      ...run.artifacts,
      events: 'runs/archive-identity-a-events.jsonl',
      snapshots: 'runs/archive-identity-a-snapshots.jsonl',
    },
  };
  const nextRun = {
    ...firstRun,
    artifacts: {
      ...firstRun.artifacts,
      events: 'runs/archive-identity-b-events.jsonl',
      snapshots: 'runs/archive-identity-b-snapshots.jsonl',
    },
  };
  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    envelope,
    liveNamedWorld,
    firstRun,
    mutableArtifacts,
  );

  await openAtlasSurface(page, 'archive');
  const archive = page.getByTestId('archive-chronicle');
  const preview = page.getByTestId('replay-preview');
  await expect(archive).toContainText('First Archive Aster');
  await expect(archive).toContainText('Archive-only call 31.3');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-line', '3');
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });

  await openAtlasSurface(page, 'chronicle');
  await clickStableProjectedWorldTarget(page, 'agent', 'agent_001');
  const inspector = page.locator('.inspector');
  await expect(inspector).toHaveAttribute('data-selection-kind', 'being');
  await expect(inspector.locator('strong')).toHaveText('Aster Live');

  await openAtlasSurface(page, 'archive');
  await archive.getByTestId('archive-window-selector').selectOption('2');
  await page.getByTestId('archive-point-selector').selectOption('line:1');
  await expect(archive).toHaveAttribute('data-archive-window-start', '2');
  await expect(archive.getByTestId('archive-window-selector')).toHaveValue('2');
  await expect(page.getByTestId('archive-point-selector')).toHaveValue('line:1');
  await expect(page.getByTestId('archive-point-scrubber-input')).toHaveValue('0');
  await expect(page.getByTestId('archive-point-scrubber')).toHaveAttribute(
    'data-archive-scrub-selected-value',
    'line:1',
  );
  await expect(archive).toContainText('Archive-only call 31.1');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-line', '1');
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });

  mutableArtifacts.events = heldNextEvents;
  mutableArtifacts.snapshots = heldNextSnapshots;
  await page.evaluate((metadata) => {
    window.__vivariumLiveRun.applyRunMetadataForTest(metadata);
  }, nextRun);

  await expect(archive).toHaveAttribute('data-archive-status', 'loading');
  await expect(page.getByTestId('world-stage')).toHaveAttribute('data-stage-source', 'live');
  await expect(page.locator('.observer-source-pill')).toContainText('Archive loading');
  await expect(page.getByTestId('replay-preview')).toHaveCount(0);
  const liveFallbackCursors = await page.evaluate(() => window.__vivariumWorld.appliedEventCursors());
  expect(liveFallbackCursors).toContain(5);
  expect(liveFallbackCursors).not.toContain(2);

  heldNextEvents.release();
  heldNextSnapshots.release();
  await Promise.all([heldNextEvents.fulfilled, heldNextSnapshots.fulfilled]);

  await expect(archive).toHaveAttribute('data-archive-window-start', '0');
  await expect(archive).toHaveAttribute('data-archive-window-end', '2');
  await expect(archive).toHaveAttribute('data-archive-has-previous', 'false');
  await expect(archive).toHaveAttribute('data-archive-has-next', 'true');
  await expect(archive.getByTestId('archive-window-selector')).toHaveValue('0');
  await expect(page.getByTestId('archive-point-selector')).toHaveValue('line:3');
  await expect(page.getByTestId('archive-point-scrubber-input')).toHaveValue('2');
  await expect(page.getByTestId('archive-point-scrubber')).toHaveAttribute(
    'data-archive-scrub-selected-value',
    'line:3',
  );
  await expect(archive).toContainText('Next Archive Aster');
  await expect(archive).toContainText('Next Archive Echo');
  await expect(archive).toContainText('Archive-only call 41.3');
  await expect(archive).not.toContainText('Archive-only call 31.1');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-line', '3');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity', '3');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-cursor', '3');
  await expect(preview).toHaveAttribute('data-replay-rendered-cursor', '3');
  await openAtlasSurface(page, 'chronicle');
  await clickStableProjectedWorldTarget(page, 'agent', 'agent_001');
  await expect(inspector).toHaveAttribute('data-selection-kind', 'being');
  await expect(inspector.locator('strong')).toHaveText('Aster Live');
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('Aster Live');
  await expect(page.locator('.chronicle')).not.toContainText('Archive-only call');
  const resetDebug = await page.evaluate(() => ({
    liveCursors: Array.from(window.__vivariumWorld.appliedEventCursors()),
    noPreviewHandle: !('__vivariumPreviewWorld' in window),
  }));
  expect(resetDebug.liveCursors).toContain(5);
  for (const cursor of [1, 2, 3, 6]) {
    expect(resetDebug.liveCursors).not.toContain(cursor);
  }
  expect(resetDebug.noPreviewHandle).toBe(true);
  expect(await page.evaluate(() => ({
    topLevelApplyRunMetadata: typeof window.applyRunMetadata,
    topLevelApplyRunMetadataForTest: typeof window.applyRunMetadataForTest,
    debugHandleKeys: Object.keys(window.__vivariumLiveRun || {}).sort(),
  }))).toEqual({
    topLevelApplyRunMetadata: 'undefined',
    topLevelApplyRunMetadataForTest: 'undefined',
    debugHandleKeys: ['applyRunMetadataForTest', 'diagnostics'],
  });
  await expect(page.locator('.timeline-strip').locator('button')).toHaveCount(0);
  await expect(preview.locator('button')).toHaveCount(0);
  await expect(archive.locator('button')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/\b(applyRunMetadata|applyRunMetadataForTest)\b/);
  await expect(page.locator('body')).not.toContainText(/\b(Seek|Scrub|Playback|Picker|Play|Pause)\b/i);
  expect(boot.artifactRequestCounts).toEqual({ events: 2, snapshots: 2 });
});

test('production app falls back to checkpoint index identity when archive line metadata is absent', async ({ page }) => {
  await installReplayCheckpointLineNumberStripShim(page, 2);
  const liveNamedWorld = {
    ...world,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'Aster Live' }
        : agent.id === 'agent_003'
          ? { ...agent, name: 'Cinder Live' }
        : agent,
    ),
  };
  const archiveOlderWorld = {
    ...world,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'Index Aster' }
        : agent.id === 'agent_003'
          ? { ...agent, name: 'Index Echo' }
        : agent,
    ),
  };
  const archiveFinalWorld = {
    ...archiveOlderWorld,
    agents: archiveOlderWorld.agents.filter((agent) => agent.id !== 'agent_003'),
  };
  const archiveNamedArtifacts = {
    ...replayArtifactBodies,
    events: [
      replayEventRecord(13.1, 'agent_001'),
      replayEventRecord(13.2, 'agent_001'),
      replayEventRecord(13.3, 'agent_003'),
    ].map((record) => JSON.stringify(record)).join('\n'),
    snapshots: [
      replayCheckpointRecord({ ...archiveOlderWorld, event_cursor: 2, world_time: 18.5 }, 'manual'),
      replayCheckpointRecord({ ...archiveFinalWorld, event_cursor: 3, world_time: 19.5 }, 'world_tick'),
      replayCheckpointRecord({ ...archiveFinalWorld, event_cursor: 3, world_time: 21.0 }, 'world_tick'),
    ].map((record) => JSON.stringify(record)).join('\n'),
  };

  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    envelope,
    liveNamedWorld,
    run,
    archiveNamedArtifacts,
  );

  await openAtlasSurface(page, 'archive');
  const timeline = page.locator('.timeline-strip');
  await expect(timeline).toContainText('Archive');
  await expect(timeline).toContainText('ready');
  await expect(timeline).toContainText('3 points, 3x2');
  await expect(timeline).toContainText('Preview');
  await expect(timeline).toContainText('ready 3 @ 21.0s, exact');
  await expect(timeline).not.toContainText('Seek');
  await expect(timeline.locator('button')).toHaveCount(0);

  const archive = page.getByTestId('archive-chronicle');
  await expect(archive).toBeVisible();
  await expect(archive).toContainText('Index Aster');
  await expect(archive).toContainText('Index Echo');
  await expect(archive).toContainText('Archive-only call 13.3');
  await expect(archive).not.toContainText('Aster Live');
  await expect(archive).not.toContainText('Cinder Live');
  await expect(archive.locator('button')).toHaveCount(0);

  const preview = page.getByTestId('replay-preview');
  await expect(preview).toContainText('Archive view');
  await expect(preview).toContainText('Exact');
  await expect(preview).toContainText('Last shown point');
  await expect(preview).toContainText('3 @ 21.0s');
  await expect(preview).toHaveAttribute('data-replay-mode', 'archive-preview');
  await expect(preview).toHaveAttribute('data-replay-entry-status', 'ready');
  await expect(preview).toHaveAttribute('data-replay-exactness', 'exact');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity-kind', 'index');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity', '2');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-index', '2');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-line', 'none');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-cursor', '3');
  await expect(preview).toHaveAttribute('data-replay-rendered-cursor', '3');
  await expect(preview.locator('button')).toHaveCount(0);
  await expect(preview).not.toContainText(/\b(Seek|Scrub|Playback|Picker|Play|Pause)\b/i);
  await expect(page.getByTestId('world-stage')).toHaveAttribute('data-stage-source', 'archive');
  await expect(page.getByTestId('world-stage').locator('canvas')).toHaveCount(1);
  await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);

  const previewDebug = await page.evaluate(() => ({
    pixels: window.__vivariumWorld.sampleCanvasPixels(),
    cursors: Array.from(window.__vivariumWorld.appliedEventCursors()),
    missingArchiveEcho: window.__vivariumWorld.agentVisualState('agent_003') === null,
  }));
  expect(previewDebug.pixels).toBeGreaterThan(20);
  expect(previewDebug.cursors).toContain(3);
  expect(previewDebug.missingArchiveEcho).toBe(true);
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('Aster Live');
  await expect(page.locator('.chronicle')).not.toContainText('Archive-only call');
  await expectNoBannedObserverCopy(page);
});

test('production app resets the archive renderer when index fallback pages reuse the same index', async ({ page }) => {
  await installReplayCheckpointLineNumberStripShim(page, 'all');
  const pagedArtifacts = {
    events: '',
    snapshots: Array.from({ length: 220 }, (_, index) => {
      const point = index + 1;
      const snapshot = {
        ...world,
        event_cursor: point,
        world_time: point,
        agents: world.agents.map((agent) => (
          agent.id === 'agent_001'
            ? { ...agent, name: `Archive Aster ${point}` }
            : agent
        )),
      };
      return JSON.stringify(replayCheckpointRecord(snapshot, 'world_tick'));
    }).join('\n'),
  };

  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    envelope,
    world,
    run,
    pagedArtifacts,
  );
  await openAtlasSurface(page, 'archive');
  const preview = page.getByTestId('replay-preview');
  const earlier = page.getByTestId('archive-load-older');
  const selector = page.getByTestId('archive-point-selector');
  await expect(selector.locator('option')).toHaveCount(64);
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity-kind', 'index');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity', '63');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-cursor', '219');
  await page.waitForFunction(() => (
    window.__vivariumWorld?.isReady === true
    && window.__vivariumWorld.appliedEventCursors().includes(219)
  ));
  await page.evaluate(() => { window.__task6IndexFallbackHandle = window.__vivariumWorld; });

  await earlier.click();
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity', '63');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-cursor', '155');
  await page.waitForFunction(() => (
    window.__vivariumWorld?.isReady === true
    && window.__vivariumWorld !== window.__task6IndexFallbackHandle
    && window.__vivariumWorld.appliedEventCursors().includes(155)
  ));
  await page.evaluate(() => { window.__task6IndexFallbackHandle = window.__vivariumWorld; });

  await earlier.click();
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity', '63');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-cursor', '91');
  await page.waitForFunction(() => (
    window.__vivariumWorld?.isReady === true
    && window.__vivariumWorld !== window.__task6IndexFallbackHandle
    && window.__vivariumWorld.appliedEventCursors().includes(91)
  ));
  expect(await page.evaluate(() => window.__vivariumWorld.appliedEventCursors())).toContain(91);
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });
});

test('production app selects exact archive checkpoints without playback controls', async ({ page }) => {
  const liveNamedWorld = {
    ...world,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'Aster Live' }
        : agent.id === 'agent_003'
          ? { ...agent, name: 'Cinder Live' }
        : agent,
    ),
  };
  const archiveOlderWorld = {
    ...world,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'Selectable Aster' }
        : agent.id === 'agent_003'
          ? { ...agent, name: 'Selectable Echo' }
        : agent,
    ),
  };
  const archiveFinalWorld = {
    ...archiveOlderWorld,
    agents: archiveOlderWorld.agents.filter((agent) => agent.id !== 'agent_003'),
  };
  const selectableArtifacts = {
    ...replayArtifactBodies,
    events: [
      replayEventRecord(13.1, 'agent_001'),
      replayEventRecord(13.2, 'agent_001'),
      replayEventRecord(13.3, 'agent_003'),
    ].map((record) => JSON.stringify(record)).join('\n'),
    snapshots: [
      replayCheckpointRecord({ ...archiveOlderWorld, event_cursor: 2, world_time: 18.5 }, 'manual'),
      replayCheckpointRecord({ ...archiveFinalWorld, event_cursor: 3, world_time: 19.5 }, 'world_tick'),
      replayCheckpointRecord({ ...archiveFinalWorld, event_cursor: 3, world_time: 21.0 }, 'world_tick'),
    ].map((record) => JSON.stringify(record)).join('\n'),
  };

  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    envelope,
    liveNamedWorld,
    run,
    selectableArtifacts,
  );

  await openAtlasSurface(page, 'archive');
  const timeline = page.locator('.timeline-strip');
  const archivePoint = page.getByTestId('archive-point-selector');
  const archiveScrubber = page.getByTestId('archive-point-scrubber');
  const archiveScrubberInput = page.getByTestId('archive-point-scrubber-input');
  await expect(archivePoint).toBeVisible();
  await expect(archivePoint.locator('option')).toHaveCount(3);
  await expect(archivePoint).toHaveValue('line:3');
  await expect(archiveScrubber).toBeVisible();
  await expect(archiveScrubberInput).toHaveValue('2');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-status', 'ready');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-point-count', '3');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-min', '0');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-max', '2');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-step', '1');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-index', '2');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-value', 'line:3');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-checkpoint-index', '2');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-identity-kind', 'lineNumber');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-identity', '3');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-line', '3');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-cursor', '3');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-time', '21');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-cursor-start', '2');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-cursor-end', '3');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-time-start', '18.5');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-time-end', '21');
  await expect(timeline).toContainText('ready 3 @ 21.0s, exact');
  await expect(timeline).not.toContainText(/\b(Seek|Scrub|Playback|Play|Pause|Speed)\b/i);
  await expect(timeline.locator('button')).toHaveCount(0);

  const preview = page.getByTestId('replay-preview');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity-kind', 'lineNumber');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity', '3');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-index', '2');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-line', '3');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-cursor', '3');
  await expect(preview).toHaveAttribute('data-replay-rendered-cursor', '3');

  await setArchivePointScrubber(page, 0);
  await expect(archivePoint).toHaveValue('line:1');
  await expect(archiveScrubberInput).toHaveValue('0');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-index', '0');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-value', 'line:1');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-checkpoint-index', '0');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-identity-kind', 'lineNumber');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-identity', '1');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-line', '1');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-cursor', '2');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-time', '18.5');
  await expect(timeline).toContainText('ready 2 @ 18.5s, exact');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity-kind', 'lineNumber');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity', '1');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-index', '0');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-line', '1');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-cursor', '2');
  await expect(preview).toHaveAttribute('data-replay-rendered-cursor', '2');
  await expect(preview.locator('button')).toHaveCount(0);
  await expect(preview).not.toContainText(/\b(Seek|Scrub|Playback|Play|Pause|Speed)\b/i);
  await expect(page.getByTestId('world-stage')).toHaveAttribute('data-stage-source', 'archive');
  await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);

  const debug = await page.evaluate(() => ({
    pixels: window.__vivariumWorld.sampleCanvasPixels(),
    previewCursors: Array.from(window.__vivariumWorld.appliedEventCursors()),
    archiveEcho: window.__vivariumWorld.agentVisualState('agent_003'),
  }));
  expect(debug.pixels).toBeGreaterThan(20);
  expect(debug.previewCursors).toContain(2);
  expect(debug.archiveEcho).not.toBeNull();
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('Aster Live');
  await expect(page.locator('.chronicle')).not.toContainText('Archive-only call');
  await expectNoBannedObserverCopy(page);
});

test('production app selects index-fallback archive points across repeated cursors', async ({ page }) => {
  await installReplayCheckpointLineNumberStripShim(page, 1);
  const liveNamedWorld = {
    ...world,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'Aster Live' }
        : agent.id === 'agent_003'
          ? { ...agent, name: 'Cinder Live' }
        : agent,
    ),
  };
  const archiveOlderWorld = {
    ...world,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'Index Aster' }
        : agent.id === 'agent_003'
          ? { ...agent, name: 'Middle Echo' }
        : agent,
    ),
  };
  const archiveFinalWorld = {
    ...archiveOlderWorld,
    agents: archiveOlderWorld.agents.filter((agent) => agent.id !== 'agent_003'),
  };
  const selectableArtifacts = {
    ...replayArtifactBodies,
    events: [
      replayEventRecord(13.1, 'agent_001'),
      replayEventRecord(13.2, 'agent_001'),
      replayEventRecord(13.3, 'agent_003'),
    ].map((record) => JSON.stringify(record)).join('\n'),
    snapshots: [
      replayCheckpointRecord({ ...archiveOlderWorld, event_cursor: 2, world_time: 18.5 }, 'manual'),
      replayCheckpointRecord({ ...archiveOlderWorld, event_cursor: 3, world_time: 19.5 }, 'world_tick'),
      replayCheckpointRecord({ ...archiveFinalWorld, event_cursor: 3, world_time: 21.0 }, 'world_tick'),
    ].map((record) => JSON.stringify(record)).join('\n'),
  };

  const boot = await bootApp(
    page,
    { width: 1440, height: 900 },
    envelope,
    liveNamedWorld,
    run,
    selectableArtifacts,
  );

  await openAtlasSurface(page, 'archive');
  const timeline = page.locator('.timeline-strip');
  const archivePoint = page.getByTestId('archive-point-selector');
  const archiveScrubber = page.getByTestId('archive-point-scrubber');
  const archiveScrubberInput = page.getByTestId('archive-point-scrubber-input');
  await expect(archivePoint).toBeVisible();
  await expect(archivePoint.locator('option')).toHaveCount(3);
  await expect(archivePoint.locator('option').nth(0)).toHaveAttribute('value', 'line:1');
  await expect(archivePoint.locator('option').nth(1)).toHaveAttribute('value', 'index:1');
  await expect(archivePoint.locator('option').nth(2)).toHaveAttribute('value', 'line:3');
  await expect(archivePoint).toHaveValue('line:3');
  await expect(archiveScrubber).toBeVisible();
  await expect(archiveScrubberInput).toHaveValue('2');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-point-count', '3');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-index', '2');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-value', 'line:3');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-checkpoint-index', '2');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-identity-kind', 'lineNumber');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-identity', '3');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-line', '3');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-cursor', '3');

  const preview = page.getByTestId('replay-preview');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity-kind', 'lineNumber');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity', '3');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-index', '2');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-cursor', '3');
  await expect(timeline).toContainText('ready 3 @ 21.0s, exact');
  await expect(timeline).not.toContainText(/\b(Seek|Scrub|Playback|Play|Pause|Speed)\b/i);

  await setArchivePointScrubber(page, 1);
  await expect(archivePoint).toHaveValue('index:1');
  await expect(archiveScrubberInput).toHaveValue('1');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-index', '1');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-value', 'index:1');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-checkpoint-index', '1');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-identity-kind', 'index');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-identity', '1');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-line', 'none');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-cursor', '3');
  await expect(archiveScrubber).toHaveAttribute('data-archive-scrub-selected-time', '19.5');
  await expect(timeline).toContainText('ready 3 @ 19.5s, exact');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity-kind', 'index');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-identity', '1');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-index', '1');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-line', 'none');
  await expect(preview).toHaveAttribute('data-replay-checkpoint-cursor', '3');
  await expect(preview).toHaveAttribute('data-replay-rendered-cursor', '3');
  await expect(preview.locator('button')).toHaveCount(0);
  await expect(preview).not.toContainText(/\b(Seek|Scrub|Playback|Play|Pause|Speed)\b/i);
  await expect(page.getByTestId('world-stage')).toHaveAttribute('data-stage-source', 'archive');
  await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);

  const debug = await page.evaluate(() => ({
    pixels: window.__vivariumWorld.sampleCanvasPixels(),
    previewCursors: Array.from(window.__vivariumWorld.appliedEventCursors()),
    middleEcho: window.__vivariumWorld.agentVisualState('agent_003'),
  }));
  expect(debug.pixels).toBeGreaterThan(20);
  expect(debug.previewCursors).toContain(3);
  expect(debug.middleEcho).not.toBeNull();
  expect(boot.artifactRequestCounts).toEqual({ events: 1, snapshots: 1 });
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('Aster Live');
  await expect(page.locator('.chronicle')).not.toContainText('Archive-only call');
  await expectNoBannedObserverCopy(page);
});

test('production app keeps live and archive DOM copy observer-facing', async ({ page }) => {
  const vocabularyWorld = {
    ...world,
    agents: world.agents.map((agent) =>
      agent.id === 'agent_001'
        ? { ...agent, name: 'Aster Agent NPC' }
        : agent,
    ),
    regions: world.regions.map((region) =>
      region.name === 'warm_springs'
        ? { ...region, description: 'Simulation LLM spawn refuge.' }
        : region,
    ).concat({
      name: 'simulation_spawn',
      description: 'A quiet archive edge.',
      connections: ['warm_springs'],
      energy_rate: 0.05,
      materials_rate: 0.05,
      current_energy: 10,
      current_materials: 8,
      max_energy: 40,
      max_materials: 40,
    }),
  };
  const vocabularyRun = {
    ...run,
    artifacts: {
      ...run.artifacts,
      snapshots: 'runs/simulation_snapshots.jsonl',
    },
  };

  await bootApp(page, { width: 1440, height: 900 }, burstEnvelope, vocabularyWorld, vocabularyRun);
  await waitForBurstEffects(page);
  await openAtlasSurface(page, 'archive');
  await expect(page.getByTestId('replay-preview')).toBeVisible();
  await expectNoBannedObserverCopy(page);

  await page.keyboard.press('Escape');
  await waitForLiveWorldRenderer(page);
  await expect(page.locator('.viv-event-bubble')).toHaveCount(0, { timeout: 8000 });
  await page.waitForTimeout(850);
  await clickUnoccludedRegionSurface(page, 'warm_springs', vocabularyWorld);
  await expect(page.locator('.inspector')).toContainText('World Mind birth refuge.');
  await expectNoBannedObserverCopy(page);
});

[
  {
    name: 'event endpoint HTTP failure',
    artifacts: {
      events: routeFailure(503, { message: 'event archive unavailable' }),
      snapshots: replayArtifactBodies.snapshots,
    },
  },
  {
    name: 'malformed event line',
    artifacts: {
      events: `${replayArtifactBodies.events}\n{`,
      snapshots: replayArtifactBodies.snapshots,
    },
  },
  {
    name: 'snapshot endpoint HTTP failure',
    artifacts: {
      events: replayArtifactBodies.events,
      snapshots: routeFailure(503, { message: 'snapshot archive unavailable' }),
    },
  },
  {
    name: 'malformed snapshot line',
    artifacts: {
      events: replayArtifactBodies.events,
      snapshots: `${replayArtifactBodies.snapshots}\n{`,
    },
  },
].forEach(({ name, artifacts }) => {
  test(`production app keeps live mode running when replay artifact metadata fails: ${name}`, async ({ page }) => {
    const boot = await bootApp(
      page,
      { width: 1440, height: 900 },
      envelope,
      world,
      run,
      artifacts,
    );

    await openAtlasSurface(page, 'archive');
    await expectPassiveReplayArtifactFailure(page, boot);
  });
});

test('production app keeps stale selected being fallback copy observer-facing', async ({ page }) => {
  const worldWithoutAster = {
    ...world,
    event_cursor: 8,
    agents: world.agents.filter((agent) => agent.id !== 'agent_001'),
  };
  await bootApp(
    page,
    { width: 1440, height: 900 },
    [{
      onceKey: 'selected-being-refresh',
      delay: 1500,
      body: {
        ...envelope,
        cursor: 4,
        next_cursor: 5,
        events: [],
        overflow: false,
        snapshot_required: true,
      },
    }],
    [world, worldWithoutAster],
  );

  const point = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_001'));
  await page.mouse.click(point.x, point.y);
  const inspector = page.locator('.inspector');
  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  await expect(inspector).toContainText('Aster');
  await expect(inspector).toContainText('Missing being', { timeout: 5000 });
  await expect(focusPulse).toBeVisible();
  await expect(focusPulse).toHaveAttribute('data-focus-kind', 'missing');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-kind', 'agent');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-id', 'agent_001');
  await expect(focusPulse).toHaveAttribute('data-focus-state', 'gap');
  await expect(focusPulse).toHaveAttribute('data-focus-count', '0');
  await expect(focusPulse).toHaveAttribute('data-focus-gap-state', 'recent');
  await expect(focusPulse).toHaveAttribute('data-focus-gap-count', '1');
  await expect(focusPulse).toHaveAttribute('data-focus-latest-type', 'none');
  await expect(focusPulse).toContainText('Trail break retained.');
  await expect(page.locator('.focus-pulse button, .focus-pulse select')).toHaveCount(0);
  await expect(page.locator('.focus-pulse dialog, .focus-pulse [role="dialog"], .focus-pulse [role="button"]')).toHaveCount(0);
  await expect(inspector).not.toContainText(/\bagent\b/i);
});

test('production app keeps stale selected being focus pulse from retained events', async ({ page }) => {
  const worldWithoutAster = {
    ...world,
    event_cursor: 24,
    agents: world.agents.filter((agent) => agent.id !== 'agent_001'),
  };
  await bootApp(page, { width: 1440, height: 900 }, burstEnvelope, [world, worldWithoutAster]);
  await waitForBurstEffects(page);
  await waitForNoActiveEventBubbles(page);

  const point = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_001'));
  await page.mouse.click(point.x, point.y);
  const inspector = page.locator('.inspector');
  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  await expect(inspector.locator('strong')).toHaveText('Aster');
  await expect(focusPulse).toHaveAttribute('data-focus-kind', 'being');
  await expect(focusPulse).toHaveAttribute('data-focus-state', 'active');
  await expect(focusPulse).toHaveAttribute('data-focus-count', '8');
  await expect(focusPulse).toHaveAttribute('data-focus-window', '5-17');
  await expect(focusPulse).toHaveAttribute('data-focus-latest-type', 'home_built');
  await expect(focusPulse).toHaveAttribute('data-focus-retention-state', 'retained');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-cursor', '17');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-type', 'home_built');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-kind', 'home-raised');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-text', 'Aster raises shelter');

  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), {
    ...envelope,
    cursor: 23,
    next_cursor: 24,
    events: [],
    overflow: false,
    snapshot_required: true,
  });

  await expect(inspector).toContainText('Missing being', { timeout: 5000 });
  await waitForNoActiveEventBubbles(page);
  await expect(focusPulse).toHaveAttribute('data-focus-kind', 'missing');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-kind', 'agent');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-id', 'agent_001');
  await expect(focusPulse).toHaveAttribute('data-focus-state', 'active');
  await expect(focusPulse).toHaveAttribute('data-focus-count', '8');
  await expect(focusPulse).toHaveAttribute('data-focus-window', '0-24');
  await expect(focusPulse).toHaveAttribute('data-focus-gap-state', 'recent');
  await expect(focusPulse).toHaveAttribute('data-focus-gap-count', '1');
  await expect(focusPulse).toHaveAttribute('data-focus-dominant-group', 'life');
  await expect(focusPulse).toHaveAttribute('data-focus-latest-type', 'home_built');
  await expect(focusPulse).toHaveAttribute('data-focus-retention-state', 'retained');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-cursor', '17');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-type', 'home_built');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-kind', 'home-raised');
  await expect(focusPulse.locator('[data-focus-pulse-latest="true"]')).toHaveAttribute('data-focus-pulse-detail-text', 'Aster raises shelter');
  await expect(focusPulse.locator('[data-focus-latest-type="home_built"]')).toBeVisible();
  await expect(page.locator('.focus-pulse button, .focus-pulse select')).toHaveCount(0);
  await expect(page.locator('.focus-pulse dialog, .focus-pulse [role="dialog"], .focus-pulse [role="button"]')).toHaveCount(0);
  await expect(inspector).not.toContainText(/\bagent\b/i);
});

test('production app reapplies selected being ring after entity rebuild and hides it after removal', async ({ page }) => {
  const movedWorld = {
    ...world,
    event_cursor: 5,
    world_time: world.world_time + 1,
    agents: world.agents.map((agent) => (
      agent.id === 'agent_001' ? { ...agent, position: 'nirvana_east' } : agent
    )),
  };
  const removedWorld = {
    ...movedWorld,
    event_cursor: 6,
    world_time: movedWorld.world_time + 1,
    agents: movedWorld.agents.filter((agent) => agent.id !== 'agent_001'),
  };
  await bootApp(page, { width: 1440, height: 900 }, [], [world, movedWorld, removedWorld]);

  const point = await page.evaluate(() => window.__vivariumWorld.screenPointForAgent('agent_001'));
  await page.mouse.click(point.x, point.y);
  const selectedBefore = await selectedRingAndAgentWorld(page, 'agent_001');
  expect(selectedBefore.ring.visible).toBe(true);
  expect(selectedBefore.ring.x).toBeCloseTo(selectedBefore.agent.x, 5);
  expect(selectedBefore.ring.z).toBeCloseTo(selectedBefore.agent.z, 5);

  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), snapshotRequiredEnvelope(5));
  await page.waitForFunction(() => window.__vivariumWorld.appliedEventCursors().includes(5));
  const selectedAfterMove = await selectedRingAndAgentWorld(page, 'agent_001');
  expect(selectedAfterMove.agent.x).not.toBeCloseTo(selectedBefore.agent.x, 2);
  expect(selectedAfterMove.ring.visible).toBe(true);
  expect(selectedAfterMove.ring.x).toBeCloseTo(selectedAfterMove.agent.x, 5);
  expect(selectedAfterMove.ring.z).toBeCloseTo(selectedAfterMove.agent.z, 5);

  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), snapshotRequiredEnvelope(6));
  await page.waitForFunction(() => window.__vivariumWorld.appliedEventCursors().includes(6));
  const selectedAfterRemoval = await selectedRingAndAgentWorld(page, 'agent_001');
  expect(selectedAfterRemoval.agent).toBeNull();
  expect(selectedAfterRemoval.ring.visible).toBe(false);
});

test('production app reconciles silent mechanics and world condition from staged snapshots without fake event beats', async ({ page }) => {
  await bootApp(
    page,
    { width: 1440, height: 900 },
    [],
    [silentInitialWorld, silentMechanicsWorld],
  );

  await openAtlasSurface(page, 'chronicle');
  const chronicleEventRowsBefore = await page.locator('.chronicle .event-row:not(.event-gap)').count();
  expect(chronicleEventRowsBefore).toBe(0);
  await expect(page.locator('.chronicle .event-row')).toHaveCount(0);
  await openAtlasSurface(page, 'world');
  await expect(page.locator('.timeline-strip')).not.toContainText('Seek');
  await expect(page.locator('.timeline-strip button')).toHaveCount(0);

  const condition = page.getByTestId('world-condition');
  await expect(condition).toBeVisible();
  await expect(condition).toHaveAttribute('data-condition-state', 'strained');
  await expect(condition).toHaveAttribute('data-condition-living-count', '2');
  await expect(condition).toHaveAttribute('data-condition-fallen-count', '1');
  await expect(condition).toHaveAttribute('data-condition-returned-count', '0');
  await expect(condition).toHaveAttribute('data-condition-hoarding-being-count', '0');
  await expect(condition).toHaveAttribute('data-condition-care-state', 'alone');
  await expect(condition).toHaveAttribute('data-condition-care-near', '0');
  await expect(condition).toHaveAttribute('data-condition-care-alone', '1');
  await expect(condition).toHaveAttribute('data-condition-care-label', '1 fallen alone');
  await expect(condition).toHaveAttribute('data-condition-land-region', 'nirvana_east');
  await expect(condition).toHaveAttribute('data-condition-land-label', 'nirvana east');
  await expect(condition).toHaveAttribute('data-condition-land-state', 'depleted');
  await expect(condition).toHaveAttribute('data-condition-land-percent', '25');
  await expect(condition).toHaveAttribute('data-condition-contested-homes', '1');
  await expect(condition).toHaveAttribute('data-condition-worn-homes', '1');
  await expect(condition).toHaveAttribute('data-condition-ruins', '1');
  await expect(condition).toHaveAttribute('data-condition-home-state', 'contested');
  await expect(condition).toHaveAttribute('data-condition-home-kept', '1');
  await expect(condition).toHaveAttribute('data-condition-home-standing', '2');
  await expect(condition).toHaveAttribute('data-condition-home-contested', '1');
  await expect(condition).toHaveAttribute('data-condition-home-worn', '1');
  await expect(condition).toHaveAttribute('data-condition-home-heavy-vaults', '1');
  await expect(condition).toHaveAttribute('data-condition-home-ruins', '1');
  await expect(condition).toHaveAttribute('data-condition-home-with-hearth', '2');
  await expect(condition).toHaveAttribute('data-condition-home-without-hearth', '0');
  await expect(condition).toHaveAttribute('data-condition-pending-offers', '1');
  await expect(condition).toHaveAttribute('data-condition-bond-state', 'fallen');
  await expect(condition).toHaveAttribute('data-condition-bond-living-pairs', '0');
  await expect(condition).toHaveAttribute('data-condition-bond-held-fallen', '1');
  await expect(condition).toHaveAttribute('data-condition-bond-held-returned', '0');
  await expect(condition).toHaveAttribute('data-condition-bond-missing', '0');
  await expect(condition).toHaveAttribute('data-condition-bond-oldest-age', '6.5');
  await expect(condition).toHaveAttribute('data-condition-bond-oldest-label', '7s');
  await expect(condition).toContainText('World condition');
  await expect(condition).toContainText('Land under strain');
  await expect(condition.locator('[data-condition-key]')).toHaveCount(4);
  await expect(condition.locator('[data-condition-key="life"]')).toHaveAttribute('data-condition-value', '1 fallen alone');
  await expect(condition.locator('[data-condition-key="land"]')).toHaveAttribute('data-condition-value', 'nirvana east 25%');
  await expect(condition.locator('[data-condition-key="homes"]')).toHaveAttribute('data-condition-value', '1 contested');
  await expect(condition.locator('[data-condition-key="bonds"]')).toHaveAttribute('data-condition-value', '1 fallen offer');
  await expect(condition.locator('button, select, dialog, [role="button"], [role="dialog"]')).toHaveCount(0);
  await expect(condition.locator('[data-event-kind], [data-event-type], [data-event-group], [data-event-tone], [data-event-cursor]')).toHaveCount(0);
  expect(await condition.textContent()).not.toMatch(/agent_|home_|snapshot|simulation|provider|model|run_/i);

  const initialDebug = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    return {
      cursors: Array.from(debug.appliedEventCursors()),
      effectCount: debug.eventEffectCount(),
      activeEffects: debug.activeEffects(),
      homeOne: debug.homeVisualState('home_001'),
      homeTwo: debug.homeVisualState('home_002'),
      ruin: debug.homeVisualState('home_old'),
      homeOneWorld: debug.worldPointForHome('home_001'),
      homeTwoWorld: debug.worldPointForHome('home_002'),
      ruinWorld: debug.worldPointForHome('home_old'),
      ruinScreen: debug.screenPointForHome('home_old'),
      warmSpringsAbundance: debug.regionAbundanceState('warm_springs'),
      aster: debug.agentVisualState('agent_001'),
      briar: debug.agentVisualState('agent_002'),
      cinder: debug.agentVisualState('agent_003'),
    };
  });

  expect(initialDebug.effectCount).toBe(0);
  expect(initialDebug.activeEffects).toEqual([]);
  expect(initialDebug.homeOne.health).toBeCloseTo(1, 2);
  expect(initialDebug.homeOne.breached).toBe(false);
  expect(initialDebug.homeOne.vaultRatio).toBeCloseTo(14 / 300, 2);
  expect(initialDebug.homeTwo.breached).toBe(true);
  expect(initialDebug.homeTwo.vaultRatio).toBe(1);
  expect(initialDebug.ruin.ruined).toBe(true);
  expect(Number.isFinite(initialDebug.ruinWorld.x)).toBe(true);
  expect(Number.isFinite(initialDebug.ruinScreen.x)).toBe(true);
  expect(initialDebug.warmSpringsAbundance.currentEnergy).toBe(90);
  expect(initialDebug.warmSpringsAbundance.currentMaterials).toBe(80);
  expect(initialDebug.warmSpringsAbundance.energyRatio).toBeCloseTo(90 / 130, 3);
  expect(initialDebug.warmSpringsAbundance.materialRatio).toBeCloseTo(80 / 130, 3);
  expect(initialDebug.warmSpringsAbundance.energyMoteCount).toBeGreaterThan(0);
  expect(initialDebug.warmSpringsAbundance.materialScatterCount).toBeGreaterThan(0);
  expect(initialDebug.warmSpringsAbundance.terrainTint).toBe('lush');
  expect(initialDebug.warmSpringsAbundance.sampleWorld.length).toBeGreaterThan(0);
  for (const point of initialDebug.warmSpringsAbundance.sampleWorld) {
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
    expect(Number.isFinite(point.z)).toBe(true);
  }
  expect(initialDebug.cinder.visual.materials).toBe(9);
  expect(initialDebug.cinder.visual.carriedGoodsVisible).toBe(false);
  expect(initialDebug.aster.visual.flameState).toBe('healthy');
  expect(initialDebug.aster.visual.flameVisible).toBe(true);
  expect(initialDebug.aster.visual.flameLevel).toBeGreaterThan(0.9);
  expect(initialDebug.aster.visual.flameSmokeCue).toBe(false);
  expect(initialDebug.briar.visual.flameState).toBe('fallen');
  expect(initialDebug.briar.visual.flameVisible).toBe(false);
  expect(initialDebug.briar.visual.flameLevel).toBe(0);
  expect(initialDebug.briar.visual.flameSmokeCue).toBe(true);
  expect(initialDebug.cinder.visual.flameState).toBe('healthy');
  expect(initialDebug.cinder.visual.flameVisible).toBe(true);

  await page.mouse.click(initialDebug.ruinScreen.x, initialDebug.ruinScreen.y);
  const inspector = page.locator('.inspector');
  await expect(inspector.locator('strong')).toHaveText('home old');
  await expect(inspector).toContainText('Remnant');
  await expect(inspector).toContainText('64');

  await page.evaluate((body) => {
    window.__vivariumDispatchMockEventSource(body);
  }, silentSnapshotPulse);

  await page.waitForFunction(() => {
    const debug = window.__vivariumWorld;
    const homeOne = debug.homeVisualState('home_001');
    const homeTwo = debug.homeVisualState('home_002');
    return (
      debug.homeVisualState('home_old') === null &&
      homeOne?.breached === true &&
      Math.abs(homeOne.health - 95 / 120) < 0.01 &&
      homeOne.vaultRatio === 0 &&
      homeTwo?.breached === false &&
      Math.abs(homeTwo.health - 1) < 0.01 &&
      homeTwo.vaultRatio === 0 &&
      homeTwo.hoarding === false
    );
  }, null, { timeout: 5000 });

  await expect(inspector).toHaveAttribute('data-selection-kind', 'missing');
  await expect(inspector.locator('strong')).toHaveText('home old');
  await expect(inspector).toContainText('No current snapshot');

  const refreshedDebug = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    return {
      cursors: Array.from(debug.appliedEventCursors()),
      effectCount: debug.eventEffectCount(),
      activeEffects: debug.activeEffects(),
      homeOne: debug.homeVisualState('home_001'),
      homeTwo: debug.homeVisualState('home_002'),
      ruin: debug.homeVisualState('home_old'),
      homeOneWorld: debug.worldPointForHome('home_001'),
      homeTwoWorld: debug.worldPointForHome('home_002'),
      ruinWorld: debug.worldPointForHome('home_old'),
      homeOneScreen: debug.screenPointForHome('home_001'),
      homeTwoScreen: debug.screenPointForHome('home_002'),
      ruinScreen: debug.screenPointForHome('home_old'),
      warmSpringsAbundance: debug.regionAbundanceState('warm_springs'),
      cinder: debug.agentVisualState('agent_003'),
      aster: debug.agentVisualState('agent_001'),
    };
  });

  expect(refreshedDebug.cursors).toEqual(initialDebug.cursors);
  expect(refreshedDebug.effectCount).toBe(0);
  expect(refreshedDebug.activeEffects).toEqual([]);
  await expect(page.locator('.viv-event-bubble')).toHaveCount(0);
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle .event-row:not(.event-gap)')).toHaveCount(chronicleEventRowsBefore);
  await expect(page.locator('.chronicle .event-row.event-gap')).toHaveCount(1);
  await expect(page.locator('.chronicle .event-row.event-gap')).toContainText('view refresh');
  await expect(page.locator('.chronicle .event-row.event-gap')).toContainText('The live trail paused');
  await openAtlasSurface(page, 'world');
  await expect(condition).toHaveAttribute('data-condition-state', 'strained');
  await expect(condition).toHaveAttribute('data-condition-care-state', 'near_life');
  await expect(condition).toHaveAttribute('data-condition-care-near', '1');
  await expect(condition).toHaveAttribute('data-condition-care-alone', '0');
  await expect(condition).toHaveAttribute('data-condition-care-label', '1 fallen near life');
  await expect(condition).toHaveAttribute('data-condition-contested-homes', '1');
  await expect(condition).toHaveAttribute('data-condition-worn-homes', '0');
  await expect(condition).toHaveAttribute('data-condition-ruins', '0');
  await expect(condition).toHaveAttribute('data-condition-home-state', 'contested');
  await expect(condition).toHaveAttribute('data-condition-home-kept', '1');
  await expect(condition).toHaveAttribute('data-condition-home-standing', '2');
  await expect(condition).toHaveAttribute('data-condition-home-contested', '1');
  await expect(condition).toHaveAttribute('data-condition-home-worn', '0');
  await expect(condition).toHaveAttribute('data-condition-home-heavy-vaults', '0');
  await expect(condition).toHaveAttribute('data-condition-home-ruins', '0');
  await expect(condition).toHaveAttribute('data-condition-home-with-hearth', '2');
  await expect(condition).toHaveAttribute('data-condition-home-without-hearth', '0');
  await expect(condition).toHaveAttribute('data-condition-pending-offers', '0');
  await expect(condition).toHaveAttribute('data-condition-bond-state', 'none');
  await expect(condition).toHaveAttribute('data-condition-bond-living-pairs', '0');
  await expect(condition).toHaveAttribute('data-condition-bond-held-fallen', '0');
  await expect(condition).toHaveAttribute('data-condition-bond-held-returned', '0');
  await expect(condition).toHaveAttribute('data-condition-bond-missing', '0');
  await expect(condition).toHaveAttribute('data-condition-bond-oldest-age', 'none');
  await expect(condition).toHaveAttribute('data-condition-bond-oldest-label', 'new');
  await expect(condition.locator('[data-condition-key="life"]')).toHaveAttribute('data-condition-value', '1 fallen near life');
  await expect(condition.locator('[data-condition-key="bonds"]')).toHaveAttribute('data-condition-value', 'quiet');
  await expect(condition.locator('[data-condition-key="homes"]')).toHaveAttribute('data-condition-value', '1 contested');
  await expect(condition).not.toContainText('1 ruin');
  await expect(condition).not.toContainText('1 offer');
  await expect(condition.locator('button, select, dialog, [role="button"], [role="dialog"]')).toHaveCount(0);
  await expect(condition.locator('[data-event-kind], [data-event-type], [data-event-group], [data-event-tone], [data-event-cursor]')).toHaveCount(0);

  expect(refreshedDebug.homeOne.health).toBeCloseTo(95 / 120, 2);
  expect(refreshedDebug.homeOne.health).toBeGreaterThan(0.75);
  expect(refreshedDebug.homeOne.vaultRatio).toBe(0);
  expect(refreshedDebug.homeOne.breached).toBe(true);
  expect(refreshedDebug.homeTwo.health).toBe(1);
  expect(refreshedDebug.homeTwo.vaultRatio).toBe(0);
  expect(refreshedDebug.homeTwo.breached).toBe(false);
  expect(refreshedDebug.homeTwo.hoarding).toBe(false);
  expect(refreshedDebug.ruin).toBeNull();
  expect(refreshedDebug.ruinWorld).toBeNull();
  expect(refreshedDebug.ruinScreen).toBeNull();
  expect(Number.isFinite(refreshedDebug.homeOneScreen.x)).toBe(true);
  expect(Number.isFinite(refreshedDebug.homeTwoScreen.y)).toBe(true);
  expect(refreshedDebug.homeOneWorld.x).toBeCloseTo(initialDebug.homeOneWorld.x, 5);
  expect(refreshedDebug.homeOneWorld.z).toBeCloseTo(initialDebug.homeOneWorld.z, 5);
  expect(refreshedDebug.homeTwoWorld.x).toBeCloseTo(initialDebug.homeTwoWorld.x, 5);
  expect(refreshedDebug.homeTwoWorld.z).toBeCloseTo(initialDebug.homeTwoWorld.z, 5);
  expect(refreshedDebug.warmSpringsAbundance.currentEnergy).toBe(122);
  expect(refreshedDebug.warmSpringsAbundance.currentMaterials).toBe(124);
  expect(refreshedDebug.warmSpringsAbundance.energyRatio).toBeCloseTo(122 / 130, 3);
  expect(refreshedDebug.warmSpringsAbundance.materialRatio).toBeCloseTo(124 / 130, 3);
  expect(refreshedDebug.warmSpringsAbundance.energyMoteCount).toBeGreaterThanOrEqual(initialDebug.warmSpringsAbundance.energyMoteCount);
  expect(refreshedDebug.warmSpringsAbundance.materialScatterCount).toBeGreaterThanOrEqual(initialDebug.warmSpringsAbundance.materialScatterCount);
  expect(refreshedDebug.cinder.visual.materials).toBe(79);
  expect(refreshedDebug.cinder.visual.materialLoadRatio).toBeCloseTo(79 / 80, 3);
  expect(refreshedDebug.cinder.visual.carriedGoodsVisible).toBe(true);
  expect(refreshedDebug.cinder.visual.satchelCount).toBe(3);
  expect(refreshedDebug.cinder.visual.renderedParts).toBeGreaterThan(initialDebug.cinder.visual.renderedParts);
  expect(refreshedDebug.cinder.visual.flameState).toBe('healthy');
  expect(refreshedDebug.cinder.visual.flameLevel).toBeLessThan(initialDebug.cinder.visual.flameLevel);
  expect(refreshedDebug.cinder.visual.flameVisible).toBe(true);
  expect(refreshedDebug.aster.visual.materials).toBe(0);
  expect(refreshedDebug.aster.visual.carriedGoodsVisible).toBe(false);
  expect(refreshedDebug.aster.visual.flameState).toBe('healthy');
  expect(refreshedDebug.aster.visual.flameVisible).toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__vivariumWorld.focusHome('home_001'))).toBe(true);
  await clickStableProjectedWorldTarget(page, 'home', 'home_001');
  await expect(inspector.locator('strong')).toHaveText('home 001');
  await expect(inspector.locator('.fact-pill').filter({ hasText: 'Health' }).locator('b')).toHaveText('79%');
  await expect(inspector.locator('.fact-pill').filter({ hasText: 'Vault' }).locator('b')).toHaveText('0');
  await expect(inspector.locator('.fact-pill').filter({ hasText: 'Breachers' }).locator('b')).toHaveText('1');
  await expect(inspector.locator('.fact-section dl').filter({ hasText: 'Integrity' }).locator('dd')).toHaveText('95/120');
  await expect(inspector.locator('.fact-section dl').filter({ hasText: 'Repair direction' }).locator('dd')).toHaveText('contested');
  await expect(inspector.locator('.fact-section dl').filter({ hasText: 'Breach state' }).locator('dd')).toHaveText('Cinder');

  expect(await page.evaluate(() => window.__vivariumWorld.focusHome('home_002'))).toBe(true);
  await clickStableProjectedWorldTarget(page, 'home', 'home_002');
  await expect(inspector.locator('strong')).toHaveText('home 002');
  await expect(inspector.locator('.fact-pill').filter({ hasText: 'Health' }).locator('b')).toHaveText('100%');
  await expect(inspector.locator('.fact-pill').filter({ hasText: 'Vault' }).locator('b')).toHaveText('0');
  await expect(inspector.locator('.fact-pill').filter({ hasText: 'Breachers' }).locator('b')).toHaveText('0');
  await expect(inspector.locator('.fact-section dl').filter({ hasText: 'Integrity' }).locator('dd')).toHaveText('187.5/187.5');
  await expect(inspector.locator('.fact-section dl').filter({ hasText: 'Repair direction' }).locator('dd')).toHaveText('sound');
  await expect(inspector.locator('.fact-section dl').filter({ hasText: 'Breach state' }).locator('dd')).toHaveText('clear');

  expect(await page.evaluate(() => window.__vivariumWorld.focusRegion('warm_springs'))).toBe(true);
  await clickStableProjectedWorldTarget(page, 'region', 'warm_springs');
  await expect(inspector.locator('strong')).toHaveText('warm springs');
  await expect(inspector).toContainText('122/130');
  await expect(inspector).toContainText('124/130');
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app updates passive home readiness from staged snapshots without shelter overclaiming', async ({ page }) => {
  await bootApp(
    page,
    { width: 1440, height: 900 },
    [],
    [homeReadinessWithoutHearthWorld, homeReadinessKeptWorld],
  );

  await openAtlasSurface(page, 'world');
  const condition = page.getByTestId('world-condition');
  await expect(condition).toBeVisible();
  await expect(condition).toHaveAttribute('data-condition-home-state', 'without_hearth');
  await expect(condition).toHaveAttribute('data-condition-home-kept', '1');
  await expect(condition).toHaveAttribute('data-condition-home-standing', '1');
  await expect(condition).toHaveAttribute('data-condition-home-contested', '0');
  await expect(condition).toHaveAttribute('data-condition-home-worn', '0');
  await expect(condition).toHaveAttribute('data-condition-home-heavy-vaults', '0');
  await expect(condition).toHaveAttribute('data-condition-home-ruins', '0');
  await expect(condition).toHaveAttribute('data-condition-home-with-hearth', '0');
  await expect(condition).toHaveAttribute('data-condition-home-without-hearth', '2');
  await expect(condition.locator('[data-condition-key="homes"]')).toHaveAttribute('data-condition-value', '2 without hearth');
  await expect(condition).not.toContainText(/\b(inside|sheltered|occupancy)\b/i);
  await expect(condition.locator('button, select, dialog, [role="button"], [role="dialog"]')).toHaveCount(0);
  await expect(condition.locator('[data-event-kind], [data-event-type], [data-event-group], [data-event-tone], [data-event-cursor]')).toHaveCount(0);

  await openAtlasSurface(page, 'chronicle');
  const eventRowsBefore = await page.locator('.chronicle .event-row:not(.event-gap)').count();
  await openAtlasSurface(page, 'world');
  const effectCountBefore = await page.evaluate(() => window.__vivariumWorld.eventEffectCount());
  await page.evaluate((body) => {
    window.__vivariumDispatchMockEventSource(body);
  }, silentSnapshotPulse);

  await expect(condition).toHaveAttribute('data-condition-home-state', 'kept');
  await expect(condition).toHaveAttribute('data-condition-home-with-hearth', '2');
  await expect(condition).toHaveAttribute('data-condition-home-without-hearth', '0');
  await expect(condition.locator('[data-condition-key="homes"]')).toHaveAttribute('data-condition-value', '1 kept home');
  await expect(condition).not.toContainText(/\b(inside|sheltered|occupancy)\b/i);
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle .event-row:not(.event-gap)')).toHaveCount(eventRowsBefore);
  await expect(page.locator('.viv-event-bubble')).toHaveCount(0);
  expect(await page.evaluate(() => window.__vivariumWorld.eventEffectCount())).toBe(effectCountBefore);
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app renders a weary being with a guttering flame from snapshot state', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, [], wearyWorld);

  const visual = await page.evaluate(() => window.__vivariumWorld.agentVisualState('agent_001').visual);
  const fallenVisual = await page.evaluate(() => window.__vivariumWorld.agentVisualState('agent_002').visual);
  const deadVisual = await page.evaluate(() => window.__vivariumWorld.agentVisualState('agent_003').visual);
  expect(visual.energy).toBe(12);
  expect(visual.flameState).toBe('weary');
  expect(visual.flameVisible).toBe(true);
  expect(visual.flameLevel).toBeGreaterThan(0.18);
  expect(visual.flameLevel).toBeLessThan(0.5);
  expect(visual.flameSmokeCue).toBe(false);
  expect(fallenVisual.flameState).toBe('fallen');
  expect(fallenVisual.flameVisible).toBe(false);
  expect(fallenVisual.flameSmokeCue).toBe(true);
  expect(deadVisual.flameState).toBe('dead');
  expect(deadVisual.flameVisible).toBe(false);
  expect(deadVisual.flameSmokeCue).toBe(false);
});

test('production app renders the locked mystic silhouette and state-owned flame light', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, [], task7MysticWorld);

  const diagnostics = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    return {
      healthy: debug.agentVisualState('agent_healthy')?.visual,
      weary: debug.agentVisualState('agent_weary')?.visual,
      fallen: debug.agentVisualState('agent_fallen')?.visual,
      dead: debug.agentVisualState('agent_dead')?.visual,
      home: debug.homeVisualState('home_001'),
      ruin: debug.homeVisualState('home_old'),
      budget: debug.renderBudgetDiagnostics(),
      atmosphere: debug.atmosphereState(),
      focused: debug.focusAgent('agent_healthy'),
    };
  });
  const requiredParts = [
    'under-robe',
    'open-cloak-left',
    'open-cloak-right',
    'shoulder-cape',
    'deep-cowl',
    'shadow-face',
    'open-palm',
    'hand-flame',
  ];

  expect(diagnostics.focused).toBe(true);
  expect(diagnostics.healthy.semanticParts).toEqual(expect.arrayContaining(requiredParts));
  expect(diagnostics.weary.semanticParts).toEqual(expect.arrayContaining(requiredParts));
  expect(diagnostics.fallen.semanticParts).toEqual(expect.arrayContaining(requiredParts.filter((part) => part !== 'hand-flame')));
  expect(diagnostics.dead.semanticParts).toEqual(expect.arrayContaining(requiredParts.filter((part) => part !== 'hand-flame')));
  expect(diagnostics.healthy.flameState).toBe('healthy');
  expect(diagnostics.weary.flameState).toBe('weary');
  expect(diagnostics.fallen.flameState).toBe('fallen');
  expect(diagnostics.dead.flameState).toBe('dead');
  expect(diagnostics.healthy.flameLightActive).toBe(true);
  expect(diagnostics.weary.flameLightActive).toBe(true);
  expect(diagnostics.fallen.flameLightActive).toBe(false);
  expect(diagnostics.dead.flameLightActive).toBe(false);
  for (const visual of [diagnostics.healthy, diagnostics.weary, diagnostics.fallen, diagnostics.dead]) {
    expect(visual.meshCount).toBeLessThanOrEqual(14);
    expect(visual.objectCount).toBeLessThanOrEqual(18);
    expect(visual.lightCount).toBeLessThanOrEqual(1);
  }
  expect(diagnostics.home.windowEmissive).toBe(true);
  expect(diagnostics.home.hearthLightActive).toBe(false);
  expect(diagnostics.home.visualHeight).toBeGreaterThanOrEqual(
    diagnostics.healthy.visualHeight * 1.6,
  );
  expect(diagnostics.ruin.ownedLightCount).toBe(0);
  expect(diagnostics.budget.globalLightCount).toBe(2);
  expect(diagnostics.budget.stateOwnedPointLightCount).toBeLessThanOrEqual(
    diagnostics.budget.maxStateOwnedPointLights,
  );
  expect(diagnostics.atmosphere.phaseSource).toBe('snapshot');
  expect(['day', 'golden-hour', 'night']).toContain(diagnostics.atmosphere.key);

  expect(await page.evaluate(() => window.__vivariumWorld.focusAgent('agent_healthy'))).toBe(true);
  await page.waitForFunction(() => window.__vivariumWorld.cameraState().distance <= 9.1);
  await clickStableProjectedWorldTarget(page, 'agent', 'agent_healthy');
  const focused = await page.evaluate(() => window.__vivariumWorld.agentVisualState('agent_healthy'));
  const focusedCamera = await page.evaluate(() => window.__vivariumWorld.cameraState());
  expect(focusedCamera.distance).toBeLessThanOrEqual(9.1);
  expect(focused.screenHeight).toBeGreaterThanOrEqual(165);

  await page.evaluate(() => {
    const visual = window.__vivariumWorld.agentVisualState('agent_healthy')?.visual;
    visual?.semanticParts.push('mutated-in-test');
  });
  const reread = await page.evaluate(() => window.__vivariumWorld.agentVisualState('agent_healthy')?.visual);
  expect(reread.semanticParts).not.toContain('mutated-in-test');
});

test('production app anchors recovery relight to the fallen recipient open palm', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, [], task7MysticWorld);

  const before = await page.evaluate(() => window.__vivariumWorld.agentVisualState('agent_fallen'));
  expect(before.visual.flameState).toBe('fallen');
  expect(before.visual.flameVisible).toBe(false);
  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), task7RecoveryEnvelope);
  await page.waitForFunction(() => (
    window.__vivariumWorld.activeEffects().some((effect) => (
      effect.summary?.kind === 'agent-recovered-relight'
    ))
  ));

  const state = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    const target = debug.agentVisualState('agent_fallen');
    const effect = debug.activeEffects().find((entry) => (
      entry.summary?.kind === 'agent-recovered-relight'
    ));
    return {
      palm: target.semanticWorldPoints?.['open-palm'],
      visual: target.visual,
      summary: effect?.summary,
    };
  });
  const distance = (left, right) => Math.hypot(
    left[0] - right.x,
    left[1] - right.y,
    left[2] - right.z,
  );

  expect(state.palm).toBeTruthy();
  expect(distance(state.summary.streamToWorld, state.palm)).toBeLessThan(0.01);
  expect(distance(state.summary.proxyFlameWorld, state.palm)).toBeLessThan(0.01);
  expect(distance(state.summary.relightLightWorld, state.palm)).toBeLessThan(0.01);
  expect(state.visual.flameState).toBe('fallen');
  expect(state.visual.flameVisible).toBe(false);
  expect(state.summary.targetStateMutated).toBe(false);
});

test('production app caps state-owned local lights and keeps ruins dark', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, [], denseWorld);

  const state = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    const agentIds = Array.from({ length: 18 }, (_, index) => (
      `agent_${String(index + 1).padStart(3, '0')}`
    ));
    const homeIds = Array.from({ length: 24 }, (_, index) => (
      `home_dense_${String(index + 1).padStart(3, '0')}`
    ));
    const ruinIds = Array.from({ length: 8 }, (_, index) => (
      `ruin_dense_${String(index + 1).padStart(3, '0')}`
    ));
    const spring = window.__viv.scene.getObjectByName('spring-terraces-light');
    return {
      budget: debug.renderBudgetDiagnostics(),
      agents: agentIds.map((id) => debug.agentVisualState(id)?.visual),
      homes: homeIds.map((id) => debug.homeVisualState(id)),
      ruins: ruinIds.map((id) => debug.homeVisualState(id)),
      springParent: spring?.parent?.name ?? null,
    };
  });

  expect(state.budget.globalLightCount).toBe(2);
  expect(state.budget.maxStateOwnedPointLights).toBe(12);
  expect(state.budget.stateOwnedPointLightCount).toBe(12);
  expect(state.budget.sceneLightCount).toBe(
    state.budget.globalLightCount + state.budget.stateOwnedPointLightCount,
  );
  expect(Object.values(state.budget.stateOwnedPointLightCountByOwnerKind)
    .reduce((total, count) => total + count, 0)).toBe(state.budget.stateOwnedPointLightCount);
  expect(state.springParent).toBe('region-scenery:warm_springs');
  for (const agent of state.agents) {
    expect(agent.meshCount).toBeLessThanOrEqual(14);
    expect(agent.objectCount).toBeLessThanOrEqual(18);
    expect(agent.lightCount).toBeLessThanOrEqual(1);
    if (agent.flameState === 'healthy' || agent.flameState === 'weary') {
      expect(agent.flameVisible).toBe(true);
      expect(agent.semanticParts).toContain('hand-flame');
    }
  }
  for (const home of state.homes) {
    expect(home.hearthLightActive).toBe(false);
    expect(home.ownedLightCount).toBeLessThanOrEqual(1);
  }
  for (const ruin of state.ruins) {
    expect(ruin.ruined).toBe(true);
    expect(ruin.ownedLightCount).toBe(0);
    expect(ruin.hearthLightActive).toBe(false);
    expect(ruin.lightSource).toBeNull();
  }
});

test('production app reallocates bounded state lights after focus flight and controls end', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, [], denseDistributedWorld);

  expect(await page.evaluate(() => window.__vivariumWorld.focusAgent('agent_002'))).toBe(true);
  await page.waitForFunction(() => window.__vivariumWorld.cameraState().distance <= 9.1);
  await clickStableProjectedWorldTarget(page, 'agent', 'agent_002');
  const selected = await page.evaluate(() => window.__vivariumWorld.renderBudgetDiagnostics());

  expect(selected.stateOwnedPointLightOwners).toContain('agent:agent_002');
  expect(selected.stateOwnedPointLightOwners).toHaveLength(12);
  expect(await page.evaluate(() => window.__vivariumWorld.focusHome('home_west_dense_009'))).toBe(true);
  await page.waitForFunction(() => window.__vivariumWorld.cameraState().distance <= 16.1);
  await page.waitForTimeout(900);
  const afterFocus = await page.evaluate(() => window.__vivariumWorld.renderBudgetDiagnostics());

  expect(afterFocus.stateOwnedPointLightOwners).toContain('agent:agent_002');
  expect(afterFocus.stateOwnedPointLightOwners).toHaveLength(12);
  expect(afterFocus.stateOwnedPointLightOwners).not.toEqual(selected.stateOwnedPointLightOwners);

  await page.evaluate(() => {
    const point = window.__vivariumWorld.worldPointForHome('home_dense_001');
    window.__viv.camera.position.set(point.x + 5, point.y + 7, point.z + 5);
    window.__viv.controls.target.set(point.x, point.y, point.z);
    window.__viv.controls.update();
    window.__viv.controls.dispatchEvent({ type: 'end' });
  });
  const afterControlsEnd = await page.evaluate(() => (
    window.__vivariumWorld.renderBudgetDiagnostics()
  ));

  expect(afterControlsEnd.stateOwnedPointLightOwners).toContain('agent:agent_002');
  expect(afterControlsEnd.stateOwnedPointLightOwners).toHaveLength(12);
  expect(afterControlsEnd.stateOwnedPointLightOwners).not.toEqual(
    afterFocus.stateOwnedPointLightOwners,
  );
});

test('production app buries the central terrain edge in a continuous far seabed', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, [], task7MysticWorld);

  const { seam, cameraFar } = await page.evaluate(() => ({
    seam: window.__vivariumWorld.terrainContinuityDiagnostics(),
    cameraFar: window.__viv.camera.far,
  }));

  expect(seam.centralSize).toBe(200);
  expect(seam.centralSegments).toBe(132);
  expect(seam.continuationSize).toBeGreaterThanOrEqual(900);
  expect(seam.continuationSize).toBeGreaterThanOrEqual(cameraFar * 3);
  expect(seam.continuationFadeStart).toBeGreaterThanOrEqual(
    Math.SQRT2 * seam.centralSize / 2,
  );
  expect(seam.continuationFadeEnd).toBeLessThan(seam.continuationSize / 2);
  expect(seam.centralAlpha).toBe(1);
  expect(seam.edgeAlpha).toBe(0);
  expect(seam.maxBoundaryHeightDelta).toBeLessThanOrEqual(0.01);
  expect(seam.boundaryTriangleCount).toBe(0);
  expect(seam.terrainMaterialTransparent).toBe(false);
  expect(seam.sourceTriangleCount).toBe(132 * 132 * 2);
  expect(seam.sourceLandCoastTriangleCount).toBeGreaterThan(0);
  expect(seam.retainedTriangleCount).toBe(seam.sourceLandCoastTriangleCount);
  expect(seam.retainedLandCoastTriangleCount).toBe(seam.sourceLandCoastTriangleCount);
  expect(seam.retainedFullyUnderwaterTriangleCount).toBe(0);
  expect(seam.continuationBelowWater).toBe(true);
});

test('production app derives readable observer atmosphere from world time', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await bootApp(page, { width: 1440, height: 900 });

  const baseline = await page.evaluate(() => ({
    atmosphere: window.__vivariumWorld.atmosphereState(),
    budget: window.__vivariumWorld.renderBudgetDiagnostics(),
    scenery: window.__vivariumWorld.sceneryDiagnostics(),
  }));
  const states = [];
  for (const phase of [0.4, 0.14, 0.92]) {
    states.push(await page.evaluate((value) => {
      const debug = window.__vivariumWorld;
      debug.setObserverVisualPhaseForTest(value);
      return {
        atmosphere: debug.atmosphereState(),
        budget: debug.renderBudgetDiagnostics(),
        scenery: debug.sceneryDiagnostics(),
      };
    }, phase));
  }

  expect(states.map((state) => state.atmosphere.key)).toEqual([
    'day',
    'golden-hour',
    'night',
  ]);
  expect(new Set(states.map((state) => state.atmosphere.waterTint)).size).toBe(3);
  for (const state of states) {
    expect(state.atmosphere.phaseSource).toBe('test-override');
    expect(state.atmosphere.fogColor).toBe(state.atmosphere.skyHorizonColor);
    expect(state.atmosphere.hemisphereIntensity).toBeGreaterThanOrEqual(0.15);
    expect(state.atmosphere.directionalIntensity).toBeGreaterThanOrEqual(0.6);
    expect(state.atmosphere.exposure).toBeGreaterThanOrEqual(0.9);
    expect(state.atmosphere.exposure).toBeLessThanOrEqual(1.12);
    expect(state.budget.staticRebuildCount).toBe(baseline.budget.staticRebuildCount);
    expect(state.budget.entityRebuildCount).toBe(baseline.budget.entityRebuildCount);
    expect(state.scenery.rebuildCount).toBe(baseline.scenery.rebuildCount);
    expect(state.scenery.recipeHash).toBe(baseline.scenery.recipeHash);
  }

  await page.evaluate(() => window.__vivariumWorld.setObserverVisualPhaseForTest(null));
  const restored = await page.evaluate(() => window.__vivariumWorld.atmosphereState());
  expect(restored.phaseSource).toBe('snapshot');
  expect(restored.phase).toBeCloseTo(baseline.atmosphere.phase, 6);

  await openAtlasSurface(page, 'archive');
  await expect(page.getByTestId('world-stage')).toHaveAttribute('data-stage-source', 'archive');
  await page.waitForFunction((livePhase) => (
    window.__vivariumWorld?.atmosphereState().phase !== livePhase
  ), baseline.atmosphere.phase);
  const archive = await page.evaluate(() => window.__vivariumWorld.atmosphereState());
  expect(archive.phaseSource).toBe('snapshot');
  expect(archive.phase).not.toBeCloseTo(baseline.atmosphere.phase, 6);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('world-stage')).toHaveAttribute('data-stage-source', 'live');
  await page.waitForFunction((livePhase) => {
    const atmosphere = window.__vivariumWorld?.atmosphereState?.();
    return atmosphere
      ? Math.abs(atmosphere.phase - livePhase) < 1e-6
      : false;
  }, baseline.atmosphere.phase);
});

test('production app applies world-time-only atmosphere snapshots without rebuilding world layers', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    window.__vivariumEnableSnapshotRefreshForTest = true;
  });
  await bootApp(
    page,
    { width: 1440, height: 900 },
    [],
    [task7MysticWorld, task7MysticLaterWorld],
  );

  const before = await page.evaluate(() => ({
    atmosphere: window.__vivariumWorld.atmosphereState(),
    budget: window.__vivariumWorld.renderBudgetDiagnostics(),
    scenery: window.__vivariumWorld.sceneryDiagnostics(),
  }));
  await page.evaluate(() => window.__vivariumLiveRun.refreshSnapshotForTest());
  const after = await page.evaluate(() => ({
    atmosphere: window.__vivariumWorld.atmosphereState(),
    budget: window.__vivariumWorld.renderBudgetDiagnostics(),
    scenery: window.__vivariumWorld.sceneryDiagnostics(),
  }));

  expect(after.atmosphere.phaseSource).toBe('snapshot');
  expect(after.atmosphere.phase).not.toBeCloseTo(before.atmosphere.phase, 6);
  expect(after.atmosphere.waterTint).not.toBe(before.atmosphere.waterTint);
  expect(after.budget.dynamicSnapshotUpdateCount).toBe(
    before.budget.dynamicSnapshotUpdateCount + 1,
  );
  expect(after.budget.staticRebuildCount).toBe(before.budget.staticRebuildCount);
  expect(after.budget.entityRebuildCount).toBe(before.budget.entityRebuildCount);
  expect(after.budget.resourceColorRebuildCount).toBe(before.budget.resourceColorRebuildCount);
  expect(after.budget.proposalRebuildCount).toBe(before.budget.proposalRebuildCount);
  expect(after.scenery.rebuildCount).toBe(before.scenery.rebuildCount);
  expect(after.scenery.recipeHash).toBe(before.scenery.recipeHash);
});

test('production app keeps reduced-motion observer atmosphere at static golden phase', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.__vivariumEnableSnapshotRefreshForTest = true;
  });
  await bootApp(
    page,
    { width: 1440, height: 900 },
    [],
    [task7MysticWorld, task7MysticLaterWorld],
  );

  const before = await page.evaluate(() => ({
    atmosphere: window.__vivariumWorld.atmosphereState(),
    budget: window.__vivariumWorld.renderBudgetDiagnostics(),
    scenery: window.__vivariumWorld.sceneryDiagnostics(),
  }));
  await page.evaluate(() => window.__vivariumLiveRun.refreshSnapshotForTest());
  await page.evaluate(() => window.__vivariumWorld.setObserverVisualPhaseForTest(0.92));
  const after = await page.evaluate(() => ({
    atmosphere: window.__vivariumWorld.atmosphereState(),
    budget: window.__vivariumWorld.renderBudgetDiagnostics(),
    scenery: window.__vivariumWorld.sceneryDiagnostics(),
  }));

  expect(before.atmosphere.phaseSource).toBe('reduced-motion');
  expect(before.atmosphere.key).toBe('golden-hour');
  expect(before.atmosphere.phase).toBeCloseTo(0.14, 8);
  expect(after.atmosphere).toEqual(before.atmosphere);
  expect(after.budget.staticRebuildCount).toBe(before.budget.staticRebuildCount);
  expect(after.budget.entityRebuildCount).toBe(before.budget.entityRebuildCount);
  expect(after.budget.resourceColorRebuildCount).toBe(before.budget.resourceColorRebuildCount);
  expect(after.budget.proposalRebuildCount).toBe(before.budget.proposalRebuildCount);
  expect(after.scenery.rebuildCount).toBe(before.scenery.rebuildCount);
  expect(after.scenery.recipeHash).toBe(before.scenery.recipeHash);
});

if (process.env.VIVARIUM_CAPTURE_TASK7 === '1') {
  test('task7 visual evidence capture', async ({ page }) => {
    const outputDirectory = path.resolve('scratchpad/living-atlas-task7');
    fs.mkdirSync(outputDirectory, { recursive: true });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await bootApp(page, { width: 1440, height: 900 }, [], task7MysticWorld);
    await page.addStyleTag({
      content: '.viv-region-label { display: none !important; }',
    });

    const captureAtmosphere = async (name, phase, key) => {
      await page.evaluate((value) => {
        window.__vivariumWorld.setObserverVisualPhaseForTest(value);
      }, phase);
      await page.waitForFunction(({ phase: expectedPhase, key: expectedKey }) => {
        const state = window.__vivariumWorld?.atmosphereState?.();
        return state?.key === expectedKey && Math.abs(state.phase - expectedPhase) < 1e-6;
      }, { phase, key });
      await page.evaluate(() => new Promise((resolve) => (
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )));
      await page.screenshot({
        path: path.join(outputDirectory, `atlas-${name}.png`),
        fullPage: true,
      });
    };

    await captureAtmosphere('day', 0.4, 'day');
    await captureAtmosphere('golden', 0.14, 'golden-hour');
    await captureAtmosphere('night', 0.92, 'night');
    if (process.env.VIVARIUM_CAPTURE_TASK7_DIAGNOSTIC === '1') {
      await page.evaluate(() => window.__vivariumWorld.setObserverVisualPhaseForTest(0.4));
      for (const [name, hiddenNames] of [
        ['no-seabed', ['observer-seabed-continuation']],
        ['no-water', ['observer-water']],
        ['no-ocean-layers', ['observer-seabed-continuation', 'observer-water']],
      ]) {
        await page.evaluate((targets) => {
          for (const target of targets) {
            const object = window.__viv.scene.getObjectByName(target);
            if (object) object.visible = false;
          }
        }, hiddenNames);
        await page.evaluate(() => new Promise((resolve) => (
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )));
        await page.screenshot({
          path: path.join(outputDirectory, `diagnostic-${name}.png`),
          fullPage: true,
        });
        await page.evaluate((targets) => {
          for (const target of targets) {
            const object = window.__viv.scene.getObjectByName(target);
            if (object) object.visible = true;
          }
        }, hiddenNames);
      }
    }
    await captureAtmosphere('day-selected', 0.4, 'day');

    const focusAgentFrame = async (agentId, select = false) => {
      expect(await page.evaluate((id) => window.__vivariumWorld.focusAgent(id), agentId)).toBe(true);
      await page.waitForFunction((id) => {
        const state = window.__vivariumWorld.agentVisualState(id);
        const camera = window.__vivariumWorld.cameraState();
        return Boolean(
          state?.screen
          && camera.distance <= 9.1
          && state.screenHeight >= 165
          && Math.abs(state.screen.x - 720) < 220
          && Math.abs(state.screen.y - 450) < 220
        );
      }, agentId);
      if (select) {
        await clickStableProjectedWorldTarget(page, 'agent', agentId);
        await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveAttribute(
          'data-atlas-surface',
          'selection',
        );
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(0);
      }
      await page.waitForFunction((id) => (
        (window.__vivariumWorld.agentVisualState(id)?.screenHeight ?? 0) >= 120
      ), agentId);
      return page.evaluate((id) => window.__vivariumWorld.agentVisualState(id), agentId);
    };

    const screenshotAgent = async (name, agentId, select = false) => {
      const state = await focusAgentFrame(agentId, select);
      const clipSize = 360;
      const clip = {
        x: Math.max(0, Math.min(1440 - clipSize, state.screen.x - clipSize / 2)),
        y: Math.max(0, Math.min(900 - clipSize, state.screen.y - clipSize / 2)),
        width: clipSize,
        height: clipSize,
      };
      await page.screenshot({
        path: path.join(outputDirectory, `state-${name}.png`),
        clip,
      });
      return state;
    };

    const selected = await screenshotAgent('healthy', 'agent_healthy', true);
    expect(selected.screenHeight).toBeGreaterThanOrEqual(120);
    await page.screenshot({
      path: path.join(outputDirectory, 'selected-mystic.png'),
      fullPage: true,
    });
    await screenshotAgent('weary', 'agent_weary');
    await screenshotAgent('fallen', 'agent_fallen');
    await screenshotAgent('dead', 'agent_dead');

    await focusAgentFrame('agent_fallen');
    await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), task7RecoveryEnvelope);
    await page.waitForFunction(() => (
      window.__vivariumWorld.activeEffects().some((effect) => effect.eventType === 'agent_recovered')
    ));
    const revived = await page.evaluate(() => window.__vivariumWorld.agentVisualState('agent_fallen'));
    const reviveClipSize = 360;
    await page.screenshot({
      path: path.join(outputDirectory, 'state-revived.png'),
      clip: {
        x: Math.max(0, Math.min(1440 - reviveClipSize, revived.screen.x - reviveClipSize / 2)),
        y: Math.max(0, Math.min(900 - reviveClipSize, revived.screen.y - reviveClipSize / 2)),
        width: reviveClipSize,
        height: reviveClipSize,
      },
    });

    const densePage = await page.context().newPage();
    try {
      await densePage.emulateMedia({ reducedMotion: 'no-preference' });
      await bootApp(densePage, { width: 1440, height: 900 }, [], denseWorld);
      await densePage.evaluate(() => window.__vivariumWorld.setObserverVisualPhaseForTest(0.4));
      await densePage.waitForFunction(() => (
        window.__vivariumWorld?.atmosphereState?.().key === 'day'
      ));
      await densePage.screenshot({
        path: path.join(outputDirectory, 'dense-atlas.png'),
        fullPage: true,
      });
    } finally {
      await densePage.close();
    }
  });
}

test('production app layout does not overlap core panels on desktop or mobile', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1440, height: 650 },
    { width: 390, height: 844 },
  ]) {
    await bootApp(page, viewport);
    for (const kind of ['world', 'chronicle', 'archive']) {
      await openAtlasSurface(page, kind);
      expectAtlasSurfaceBounded(
        await atlasSurfaceBounds(page),
        `${viewport.width}x${viewport.height} ${kind}`,
      );
      expect(await corePanelOverlaps(page), `${viewport.width}x${viewport.height} ${kind}`).toEqual([]);
      expect(await viewportLayoutIssues(page), `${viewport.width}x${viewport.height} ${kind}`).toEqual([]);
    }

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(0);
    await waitForLiveWorldRenderer(page);
    await clickStableProjectedWorldTarget(page, 'agent', 'agent_001');
    await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveAttribute('data-atlas-surface', 'selection');
    await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(1);
    expectAtlasSurfaceBounded(
      await atlasSurfaceBounds(page),
      `${viewport.width}x${viewport.height} selection`,
    );
    expect(await corePanelOverlaps(page), `${viewport.width}x${viewport.height} selection`).toEqual([]);
    expect(await viewportLayoutIssues(page), `${viewport.width}x${viewport.height} selection`).toEqual([]);
  }
});

test('production app keeps the authoritative archive stage readable on narrow desktop', async ({ page }) => {
  for (const viewport of [
    { width: 981, height: 700 },
    { width: 981, height: 560 },
    { width: 1024, height: 650 },
    { width: 1100, height: 600 },
  ]) {
    await bootApp(page, viewport);
    await openAtlasSurface(page, 'archive');
    await expect(page.getByTestId('replay-preview')).toBeVisible();
    await expect(page.getByTestId('world-stage')).toHaveAttribute('data-stage-source', 'archive');
    await expect(page.getByTestId('world-stage').locator('canvas')).toHaveCount(1);
    await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);

    const timeline = page.locator('.timeline-strip');
    await expect(timeline).toContainText('Live tail');
    await expect(timeline).toContainText('Archive');
    await expect(timeline).toContainText('Preview');
    await expect(timeline).toContainText('ready 6 @ 21.0s, exact');
    await expect(page.getByTestId('replay-preview')).toContainText('Last shown point');
    await expect(page.getByTestId('replay-preview')).toContainText('6 @ 21.0s');
    await expect(page.getByTestId('archive-chronicle')).toContainText('Archive');
    await expect(page.getByTestId('archive-chronicle')).toContainText('Archive-only call 13.3');
    await expect(page.locator('body')).not.toContainText(/\b(Seek|Scrub|Playback|Picker|Play|Pause)\b/i);

    const passiveState = await page.evaluate(() => ({
      timelineButtons: document.querySelectorAll('.timeline-strip button').length,
      replayButtons: document.querySelectorAll('.replay-preview button').length,
      archiveButtons: document.querySelectorAll('.archive-chronicle button').length,
      previewPointerEvents: getComputedStyle(document.querySelector('.replay-preview')).pointerEvents,
      archiveStagePointerEvents: getComputedStyle(document.querySelector('.world-stage')).pointerEvents,
      archivePointerEvents: getComputedStyle(document.querySelector('.archive-chronicle')).pointerEvents,
      previewHandlePresent: '__vivariumPreviewWorld' in window,
    }));
    expect(passiveState.timelineButtons, `${viewport.width}x${viewport.height}`).toBe(0);
    expect(passiveState.replayButtons, `${viewport.width}x${viewport.height}`).toBe(0);
    expect(passiveState.archiveButtons, `${viewport.width}x${viewport.height}`).toBe(0);
    expect(passiveState.previewPointerEvents, `${viewport.width}x${viewport.height}`).toBe('none');
    expect(passiveState.archiveStagePointerEvents, `${viewport.width}x${viewport.height}`).toBe('auto');
    expect(passiveState.archivePointerEvents, `${viewport.width}x${viewport.height}`).toBe('none');
    expect(passiveState.previewHandlePresent, `${viewport.width}x${viewport.height}`).toBe(false);
    expect(await corePanelOverlaps(page), `${viewport.width}x${viewport.height}`).toEqual([]);
    expect(await viewportLayoutIssues(page), `${viewport.width}x${viewport.height}`).toEqual([]);
  }
});

test('production app keeps dense history readable on low-height desktop', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 650 }, burstEnvelope);

  await waitForBurstEffects(page);
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('ruins picked');
  expectChronicleLegible(await chronicleLegibilityState(page));
  expectAtlasSurfaceBounded(await atlasSurfaceBounds(page), 'low-height Chronicle');
  expect(await corePanelOverlaps(page)).toEqual([]);
  expect(await viewportLayoutIssues(page)).toEqual([]);
});

test('production app keeps burst chronicle readable on mobile', async ({ page }) => {
  await bootApp(page, { width: 390, height: 844 }, burstEnvelope);

  await waitForBurstEffects(page);
  await openAtlasSurface(page, 'chronicle');
  await expect(page.locator('.chronicle')).toContainText('ruins picked');
  const chronicleState = await chronicleLegibilityState(page);
  expectChronicleLegible(chronicleState);
  expect(chronicleState.documentOverflow).toBeLessThanOrEqual(1);
  expectAtlasSurfaceBounded(await atlasSurfaceBounds(page), 'mobile Chronicle');
  expect(await corePanelOverlaps(page)).toEqual([]);
});

[
  {
    name: 'desktop',
    viewport: { width: 1440, height: 900 },
    checkViewportBounds: true,
  },
  {
    name: 'mobile',
    viewport: { width: 390, height: 844 },
    checkViewportBounds: false,
  },
  {
    name: 'low-height desktop',
    viewport: { width: 1440, height: 650 },
    checkViewportBounds: true,
  },
].forEach(({ name, viewport, checkViewportBounds }) => {
  test(`production app keeps dense retained live surfaces readable after bubbles expire on ${name}`, async ({ page }) => {
    await bootApp(page, viewport, burstEnvelope);
    await waitForBurstEffects(page);

    await expectDenseRetainedLiveSurfacesAfterExpiry(page, `${viewport.width}x${viewport.height}`, {
      checkViewportBounds,
    });
  });
});

test('production app keeps dense homes and beings readable and stable on very short desktop', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 560 }, [], [denseWorld, denseWorldAfterSweep]);
  await openAtlasSurface(page, 'archive');
  const replayButtons = await page.locator('.replay-preview button').count();
  await openAtlasSurface(page, 'world');
  const timelineButtons = await page.locator('.timeline-strip button').count();

  const before = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    const homeIds = ['home_dense_006', 'home_dense_010', 'home_dense_018'];
    const identityHomeIds = ['home_dense_007', 'home_dense_010'];
    const denseHomeIds = Array.from({ length: 24 }, (_, index) => `home_dense_${String(index + 1).padStart(3, '0')}`);
    const agentIds = Array.from({ length: 12 }, (_, index) => `agent_${String(index + 1).padStart(3, '0')}`);
    return {
      homes: Object.fromEntries(homeIds.map((id) => [id, debug.worldPointForHome(id)])),
      homeVisuals: Object.fromEntries(identityHomeIds.map((id) => [id, debug.homeVisualState(id)])),
      homeScreens: Object.fromEntries(homeIds.map((id) => [id, debug.screenPointForHome(id)])),
      homeLayouts: denseHomeIds.map((id) => debug.homeLayoutState(id)).filter(Boolean),
      agentScreens: agentIds.map((id) => ({ id, point: debug.screenPointForAgent(id) })).filter((item) => item.point),
      agentVisuals: Object.fromEntries(agentIds.map((id) => [id, debug.agentVisualState(id)?.visual]).filter(([, visual]) => visual)),
      heavyHome: debug.homeVisualState('home_dense_009'),
      removedHome: debug.worldPointForHome('home_dense_001'),
    };
  });

  expect(await corePanelOverlaps(page)).toEqual([]);
  expect(timelineButtons).toBe(0);
  expect(replayButtons).toBe(0);
  expect(before.heavyHome.hoarding).toBe(true);
  expect(before.removedHome).toBeTruthy();
  expect(before.homeLayouts).toHaveLength(24);
  for (const layout of before.homeLayouts) {
    expect(layout.regionName).toBe('warm_springs');
    expect(layout.onLand).toBe(true);
    expect(layout.terrainHeight).toBeGreaterThan(0.05);
    expect(layout.islandMask).toBeGreaterThan(0.12);
    expect(layout.nearestDistance, `${layout.id} nearest ${layout.nearestHomeId}`).toBeGreaterThan(2.2);
    expect(layout.nearestDistance, `${layout.id} nearest ${layout.nearestHomeId}`).toBeGreaterThan(layout.footprintRadius * 0.92);
    expect(Number.isFinite(layout.screen.x)).toBe(true);
    expect(Number.isFinite(layout.screen.y)).toBe(true);
  }

  for (const point of Object.values(before.homes)) {
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.z)).toBe(true);
  }
  for (const point of Object.values(before.homeScreens)) {
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  }

  const uniqueAgentScreenSlots = new Set(before.agentScreens.map(({ point }) => (
    `${Math.round(point.x / 3)}:${Math.round(point.y / 3)}`
  )));
  expect(uniqueAgentScreenSlots.size).toBeGreaterThanOrEqual(10);
  const paletteIds = new Set(Object.values(before.agentVisuals).map((visual) => visual.paletteId));
  const robeColors = new Set(Object.values(before.agentVisuals).map((visual) => visual.robeColor));
  const accessories = new Set(Object.values(before.agentVisuals).map((visual) => visual.accessory));
  expect(paletteIds.size).toBeGreaterThanOrEqual(4);
  expect(robeColors.size).toBeGreaterThanOrEqual(4);
  expect(accessories.size).toBeGreaterThanOrEqual(2);
  expect(before.agentVisuals.agent_001.paletteId).toBeTruthy();
  expect(before.agentVisuals.agent_001.trimColor).toMatch(/^#[0-9a-f]{6}$/i);
  expect(before.agentVisuals.agent_001.robeColor).toMatch(/^#[0-9a-f]{6}$/i);

  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), denseSnapshotPulse);
  await page.waitForFunction(() => window.__vivariumWorld.homeVisualState('home_dense_001') === null);

  const after = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    const homeIds = ['home_dense_006', 'home_dense_010', 'home_dense_018'];
    const identityHomeIds = ['home_dense_007', 'home_dense_010'];
    return {
      homes: Object.fromEntries(homeIds.map((id) => [id, debug.worldPointForHome(id)])),
      homeVisuals: Object.fromEntries(identityHomeIds.map((id) => [id, debug.homeVisualState(id)])),
      removedHome: debug.worldPointForHome('home_dense_001'),
      removedAgent: debug.agentVisualState('agent_002'),
      remainingAgent: debug.agentVisualState('agent_003'),
      remainingVisuals: Object.fromEntries(['agent_001', 'agent_003', 'agent_004'].map((id) => [id, debug.agentVisualState(id)?.visual])),
    };
  });

  for (const [homeId, point] of Object.entries(after.homes)) {
    expect(point.x).toBeCloseTo(before.homes[homeId].x, 5);
    expect(point.z).toBeCloseTo(before.homes[homeId].z, 5);
  }
  expect(after.removedHome).toBeNull();
  expect(after.removedAgent).toBeNull();
  expect(after.remainingAgent.visible).toBe(true);
  for (const homeId of ['home_dense_007', 'home_dense_010']) {
    expect(after.homeVisuals[homeId].ownerId).toBe(before.homeVisuals[homeId].ownerId);
    expect(after.homeVisuals[homeId].stakeholderIds).toEqual(before.homeVisuals[homeId].stakeholderIds);
    expect(after.homeVisuals[homeId].pennantColors).toEqual(before.homeVisuals[homeId].pennantColors);
    expect(after.homeVisuals[homeId].pennantSource).toEqual(before.homeVisuals[homeId].pennantSource);
    expect(after.homeVisuals[homeId].identityDerivedPennants).toBe(true);
  }
  for (const agentId of ['agent_001', 'agent_003', 'agent_004']) {
    expect(after.remainingVisuals[agentId].paletteId).toBe(before.agentVisuals[agentId].paletteId);
    expect(after.remainingVisuals[agentId].robeColor).toBe(before.agentVisuals[agentId].robeColor);
    expect(after.remainingVisuals[agentId].trimColor).toBe(before.agentVisuals[agentId].trimColor);
    expect(after.remainingVisuals[agentId].accessory).toBe(before.agentVisuals[agentId].accessory);
  }
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app keeps dense structures on the small west island landmass', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 560 }, [], denseSmallIslandWorld);

  const layouts = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    return [
      ...Array.from({ length: 9 }, (_, index) => `home_west_dense_${String(index + 1).padStart(3, '0')}`),
      ...Array.from({ length: 5 }, (_, index) => `ruin_west_dense_${String(index + 1).padStart(3, '0')}`),
    ].map((id) => debug.homeLayoutState(id));
  });

  expect(layouts).toHaveLength(14);
  for (const layout of layouts) {
    expect(layout).toBeTruthy();
    expect(layout.regionName).toBe('nirvana_west');
    expect(layout.onLand).toBe(true);
    expect(layout.terrainHeight).toBeGreaterThan(0.05);
    expect(layout.islandMask).toBeGreaterThan(0.12);
    expect(layout.nearestDistance, `${layout.id} nearest ${layout.nearestHomeId}`).toBeGreaterThan(1.75);
    expect(Number.isFinite(layout.screen.x)).toBe(true);
    expect(Number.isFinite(layout.screen.y)).toBe(true);
  }
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app renders live event burst effects without panel overlap', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, burstEnvelope);

  await waitForBurstEffects(page);
  await page.evaluate(() => {
    const startedAt = performance.now();
    while (performance.now() - startedAt < 70) {
      // Proves frame telemetry uses wall-clock delay, not clamped simulation dt.
    }
  });
  await page.waitForFunction(() => (
    window.__vivariumWorld.renderBudgetDiagnostics().maxFrameDeltaMs > 50
  ), null, { timeout: 4000 });
  const bubbleText = await page.locator('.viv-event-bubble').evaluateAll((nodes) =>
    nodes.map((node) => node.textContent || '').join(' '),
  );
  expect(bubbleText).not.toMatch(/\b(simulation|agent|LLM|spawn|NPC)\b/i);

  const debugSnapshot = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    return {
      count: debug.eventEffectCount(),
      effects: debug.activeEffects(),
      budget: debug.renderBudgetDiagnostics(),
      cursors: Array.from(debug.appliedEventCursors()),
      recent: debug.recentRenderedEventBeats(),
      homePoint: debug.screenPointForHome('home_001'),
      secondHomePoint: debug.screenPointForHome('home_002'),
    };
  });

  const activeTypes = debugSnapshot.effects.map((effect) => effect.eventType);
  const countByType = (eventType) => debugSnapshot.effects.filter((effect) => effect.eventType === eventType).length;
  const speechEffect = debugSnapshot.effects.find((effect) => effect.summary?.kind === 'speech-bubble');
  const thoughtEffect = debugSnapshot.effects.find((effect) => effect.summary?.kind === 'private-thought');
  const thoughtWispEffect = debugSnapshot.effects.find((effect) => effect.summary?.kind === 'private-thought-wisp');
  const harvestEffect = debugSnapshot.effects.find((effect) => effect.summary?.kind === 'resource-harvest');
  const recoveryEffect = debugSnapshot.effects.find((effect) => effect.summary?.kind === 'agent-recovered-relight');
  const attackEffect = debugSnapshot.effects.find((effect) => effect.summary?.kind === 'combat-bubble');
  const attackImpactEffect = debugSnapshot.effects.find((effect) => effect.summary?.kind === 'combat-impact');
  const genericBubbleEffects = debugSnapshot.effects.filter((effect) => (
    effect.bubble &&
    effect.summary?.kind === 'generic-event-bubble'
  ));
  const genericBubbleTypes = genericBubbleEffects.map((effect) => effect.eventType);
  const genericPulseEffects = debugSnapshot.effects.filter((effect) => (
    !effect.bubble &&
    effect.summary?.kind === 'generic-event-pulse'
  ));
  const genericPulseTypes = genericPulseEffects.map((effect) => effect.eventType);
  const genericArcEffects = debugSnapshot.effects.filter((effect) => (
    !effect.bubble &&
    effect.summary?.kind === 'generic-event-arc'
  ));
  const genericArcTypes = genericArcEffects.map((effect) => effect.eventType);
  const bubbleEffectsWithoutSummary = debugSnapshot.effects
    .filter((effect) => effect.bubble && !effect.summary)
    .map((effect) => effect.eventType);
  const nonBubbleEffectsWithoutSummary = debugSnapshot.effects
    .filter((effect) => !effect.bubble && !effect.summary)
    .map((effect) => effect.eventType);
  const deathEffect = debugSnapshot.effects.find((effect) => (
    effect.summary?.kind === 'life-transition' &&
    effect.summary.lifeEventKind === 'died'
  ));
  const decayEffect = debugSnapshot.effects.find((effect) => (
    effect.summary?.kind === 'life-transition' &&
    effect.summary.lifeEventKind === 'decayed'
  ));
  const bondKinds = debugSnapshot.effects
    .filter((effect) => effect.summary?.kind === 'bond-lifecycle')
    .map((effect) => effect.summary.bondEventKind);
  expect(debugSnapshot.count).toBeGreaterThanOrEqual(burstVisualEventTypes.length);
  expect(debugSnapshot.budget.activeEffectCount).toBe(debugSnapshot.count);
  expect(debugSnapshot.budget.activeEffectCount).toBeLessThanOrEqual(debugSnapshot.budget.maxActiveEffectCount);
  expect(debugSnapshot.budget.activeBubbleCount).toBe(3);
  expect(debugSnapshot.budget.activeEffectParticleCount).toBeGreaterThan(0);
  expect(debugSnapshot.budget.css2DObjectCount).toBeGreaterThanOrEqual(debugSnapshot.budget.regionLabelCount);
  expect(debugSnapshot.budget.sceneObjectCount).toBeGreaterThan(debugSnapshot.budget.entityObjectCount);
  expect(debugSnapshot.budget.activeEffectObjectCount).toBeGreaterThan(0);
  expect(debugSnapshot.budget.pendingProposalVisualCount).toBe(1);
  expect(debugSnapshot.budget.reducedMotion.mode).toBe('full');
  for (const value of [
    debugSnapshot.budget.frameCount,
    debugSnapshot.budget.lastFrameDeltaMs,
    debugSnapshot.budget.averageFrameDeltaMs,
    debugSnapshot.budget.maxFrameDeltaMs,
    debugSnapshot.budget.lastRenderMs,
    debugSnapshot.budget.averageRenderMs,
    debugSnapshot.budget.maxRenderMs,
    debugSnapshot.budget.rendererInfo.calls,
    debugSnapshot.budget.rendererInfo.triangles,
    debugSnapshot.budget.rendererInfo.geometries,
  ]) {
    expectFiniteNumber(value);
  }
  expect(debugSnapshot.budget.maxFrameDeltaMs).toBeGreaterThan(50);
  expect(activeTypes).toEqual(expect.arrayContaining(burstVisualEventTypes));
  expect(bubbleEffectsWithoutSummary).toEqual([]);
  expect(nonBubbleEffectsWithoutSummary).toEqual([]);
  expectRendererSummarySubsetIntegrity(debugSnapshot.effects, [
    'agent-recovered-relight',
    'bond-lifecycle',
    'combat-impact',
    'generic-event-arc',
    'generic-event-pulse',
    'home-build',
    'home-colonize-raid',
    'home-theft-raid',
    'life-transition',
    'private-thought-wisp',
    'resource-harvest',
    'ruin-scavenge',
  ]);
  const expectedGenericBubbleTypes = [
    'agent_born',
    'agent_decayed',
    'agent_died',
    'agent_recovered',
    'home_built',
    'home_colonized',
    'home_thieved',
    'mating_initiated',
    'resource_changed',
    'ruins_scavenged',
  ];
  expect(genericBubbleTypes.length).toBeLessThanOrEqual(3);
  expect(uniqueSorted(debugSnapshot.recent
    .filter((beat) => beat.summaryKinds.includes('generic-event-bubble'))
    .map((beat) => beat.eventType))).toEqual(expectedGenericBubbleTypes);
  expect(uniqueSorted(genericPulseTypes)).toEqual([
    'agent_born',
    'agent_entered_region',
    'agent_recovered',
    'attack',
    'home_colonized',
    'home_thieved',
    'mating_initiated',
    'resource_changed',
    'ruins_scavenged',
    'self_talk',
    'speak',
  ]);
  expect(uniqueSorted(genericArcTypes)).toEqual([
    'agent_died',
    'agent_entered_region',
    'agent_recovered',
    'attack',
    'home_colonized',
    'home_thieved',
    'mating_initiated',
    'resource_changed',
    'ruins_scavenged',
    'speak',
  ]);
  for (const eventType of ['agent_entered_region', 'speak', 'self_talk', 'attack']) {
    expect(genericBubbleTypes).not.toContain(eventType);
  }
  for (const eventType of ['agent_died', 'agent_decayed', 'home_built']) {
    expect(genericPulseTypes).not.toContain(eventType);
  }
  for (const eventType of ['agent_decayed', 'home_built', 'self_talk']) {
    expect(genericArcTypes).not.toContain(eventType);
  }
  expect(debugSnapshot.recent.find((beat) => beat.eventType === 'agent_entered_region')?.summaryKinds).toContain('movement-arrival');
  expect(debugSnapshot.recent.find((beat) => beat.eventType === 'speak')?.summaryKinds).toContain('speech-bubble');
  expect(debugSnapshot.recent.find((beat) => beat.eventType === 'self_talk')?.summaryKinds).toContain('private-thought');
  expect(debugSnapshot.recent.find((beat) => beat.eventType === 'attack')?.summaryKinds).toContain('combat-bubble');
  expect(bondKinds).toEqual(expect.arrayContaining(['initiated', 'birth']));
  expect(countByType('home_thieved')).toBeGreaterThanOrEqual(3);
  expect(countByType('home_colonized')).toBeGreaterThanOrEqual(3);
  expect(countByType('ruins_scavenged')).toBeGreaterThanOrEqual(3);
  expect(thoughtWispEffect).toBeTruthy();
  expect(thoughtWispEffect.summary).toMatchObject({
    kind: 'private-thought-wisp',
    actorId: 'agent_002',
    regionName: 'nirvana_east',
    motionCue: 'private-thought-wisp',
    motionMode: 'full',
    communicationKind: 'thought',
    worldBubbleCue: false,
    leaderLineCue: false,
    thoughtWispCue: true,
    interiorityCue: true,
    heardByOthers: false,
    actualActorMutated: false,
    targetStateMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(thoughtWispEffect.summary.actorVisible).toBe(true);
  expect(thoughtWispEffect.summary.thoughtMotes).toBeGreaterThan(0);
  expect(Number.isFinite(thoughtWispEffect.summary.actorWorld[0])).toBe(true);
  for (const summary of [thoughtWispEffect.summary]) {
    expect(Object.prototype.hasOwnProperty.call(summary, 'message')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(summary, 'text')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(summary, 'fullText')).toBe(false);
  }
  for (const effect of genericBubbleEffects) {
    expectGenericBubbleEffectSummary(effect);
  }
  for (const effect of genericPulseEffects) {
    expectGenericPulseEffectSummary(effect);
  }
  for (const effect of genericArcEffects) {
    expectGenericArcEffectSummary(effect);
  }
  for (const eventType of burstGroupedAwayEventTypes) {
    expect(activeTypes).not.toContain(eventType);
  }
  expect(debugSnapshot.cursors).toEqual(expect.arrayContaining(burstEventCursors));
  expect(harvestEffect).toBeTruthy();
  expect(harvestEffect.summary).toMatchObject({
    kind: 'resource-harvest',
    actorId: 'agent_001',
    regionName: 'warm_springs',
    resourceType: 'energy',
    amount: 9,
    motionCue: 'land-to-being-resource-stream',
    streamDirection: 'region-to-actor',
    resourceStream: true,
    actualActorMutated: false,
    regionStateMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(harvestEffect.summary.resourceMotes).toBeGreaterThan(0);
  expect(harvestEffect.summary.regionEnergyRatio).toBeCloseTo(90 / 130, 3);
  expect(harvestEffect.summary.regionMaterialRatio).toBeCloseTo(80 / 130, 3);
  expect(Number.isFinite(harvestEffect.summary.streamFromWorld[0])).toBe(true);
  expect(Number.isFinite(harvestEffect.summary.streamToWorld[0])).toBe(true);
  expect(recoveryEffect).toBeTruthy();
  expect(recoveryEffect.summary).toMatchObject({
    kind: 'agent-recovered-relight',
    actorId: 'agent_001',
    targetId: 'agent_002',
    regionName: 'warm_springs',
    resourceType: 'energy',
    amount: 4,
    motionCue: 'gift-relights-flame',
    streamDirection: 'actor-to-target',
    relightCue: true,
    resourceStream: true,
    targetFlameLevel: 0,
    actualActorMutated: false,
    targetStateMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(recoveryEffect.summary.sourceFlameLevel).toBeGreaterThan(0.9);
  expect(recoveryEffect.summary.resourceMotes).toBeGreaterThan(0);
  expect(Number.isFinite(recoveryEffect.summary.streamToWorld[0])).toBe(true);
  expect(attackImpactEffect).toBeTruthy();
  expect(attackImpactEffect.summary).toMatchObject({
    kind: 'combat-impact',
    actorId: 'agent_003',
    targetId: 'agent_001',
    regionName: 'nirvana_west',
    motionCue: 'nonlethal-hit-line-impact-ring',
    motionMode: 'full',
    combatCue: true,
    impactCue: true,
    worldBubbleCue: false,
    hitLineCue: true,
    durableAgentMutated: false,
    actualActorMutated: false,
    targetStateMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(attackImpactEffect.summary.impactMotes).toBeGreaterThan(0);
  expect(deathEffect).toBeTruthy();
  expect(deathEffect.summary).toMatchObject({
    kind: 'life-transition',
    lifeEventKind: 'died',
    actorId: 'agent_003',
    targetId: 'agent_002',
    regionName: 'nirvana_west',
    motionCue: 'being-dies-flame-extinguishes',
    flameState: 'dead',
    flameDropCue: true,
    deathCue: true,
    paralysisCue: false,
    decayCue: false,
    durableAgentMutated: false,
    actualActorMutated: false,
    targetStateMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(Number.isFinite(deathEffect.summary.actorWorld[0])).toBe(true);
  expect(Number.isFinite(deathEffect.summary.targetWorld[0])).toBe(true);
  expect(decayEffect).toBeTruthy();
  expect(decayEffect.summary).toMatchObject({
    kind: 'life-transition',
    lifeEventKind: 'decayed',
    actorId: 'agent_002',
    targetId: 'agent_002',
    regionName: 'nirvana_east',
    diedAt: 18,
    decayedAt: 142,
    motionCue: 'body-dissolves-to-earth',
    flameState: 'dead',
    flameDropCue: true,
    deathCue: false,
    paralysisCue: false,
    decayCue: true,
    bodyDissolveCue: true,
    durableAgentMutated: false,
    actualActorMutated: false,
    targetStateMutated: false,
    regionStateMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(Number.isFinite(decayEffect.summary.thresholdWorld[0])).toBe(true);
  expect(Number.isFinite(debugSnapshot.homePoint.x)).toBe(true);
  expect(Number.isFinite(debugSnapshot.homePoint.y)).toBe(true);
  expect(Number.isFinite(debugSnapshot.secondHomePoint.x)).toBe(true);
  expect(Number.isFinite(debugSnapshot.secondHomePoint.y)).toBe(true);
  expect(
    Math.hypot(
      debugSnapshot.homePoint.x - debugSnapshot.secondHomePoint.x,
      debugSnapshot.homePoint.y - debugSnapshot.secondHomePoint.y,
    ),
  ).toBeGreaterThan(8);
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app expires repeated burst effects and refreshes snapshot-owned proposals cleanly', async ({ page }) => {
  test.setTimeout(50_000);
  const refreshedPendingWorld = {
    ...world,
    world_time: 31.5,
    event_cursor: 224,
    pending_proposals: [
      {
        ...world.pending_proposals[0],
        timestamp: 28,
        resources: { energy: 3, materials: 1 },
      },
    ],
  };
  const clearedPendingWorld = {
    ...refreshedPendingWorld,
    world_time: 32,
    event_cursor: 225,
    pending_proposals: [],
  };
  const calmBurst = envelopeWithCursorOffset(burstEnvelope, 40, 4);
  const overloadBursts = [
    envelopeWithCursorOffset(burstEnvelope, 80, 8),
    envelopeWithCursorOffset(burstEnvelope, 120, 12),
    envelopeWithCursorOffset(burstEnvelope, 150, 15),
    envelopeWithCursorOffset(burstEnvelope, 180, 18),
  ];
  const loadedHarvestEnvelope = {
    schema: 1,
    cursor: 222,
    oldest_cursor: 203,
    next_cursor: 223,
    events: [
      eventEntry(
        222,
        'resource_changed',
        'agent_001',
        {
          agent_id: 'agent_001',
          region: 'warm_springs',
          resource_type: 'energy',
          amount: 9,
          agent_energy: 93,
          region_energy: 81,
        },
        { actor_id: 'agent_001', region: 'warm_springs', resource_type: 'energy', amount: 9 },
      ),
    ],
    overflow: false,
    snapshot_required: false,
  };
  const calmBurstCursors = calmBurst.events.map(({ cursor }) => cursor);
  const overloadBurstCursors = overloadBursts.flatMap((body) => body.events.map(({ cursor }) => cursor));
  const loadedHarvestCursors = loadedHarvestEnvelope.events.map(({ cursor }) => cursor);
  const allBurstCursors = [
    ...calmBurstCursors,
    ...overloadBurstCursors,
    ...loadedHarvestCursors,
  ];

  await bootApp(
    page,
    { width: 1440, height: 900 },
    [],
    [world, refreshedPendingWorld, clearedPendingWorld],
  );
  await page.waitForFunction(() => window.__vivariumWorld.pendingProposalVisualState().length === 1);
  const initialDiagnostics = await page.evaluate(() => window.__vivariumWorld.effectLifecycleDiagnostics());
  expect(initialDiagnostics.activeEffectCount).toBe(0);
  expect(initialDiagnostics.pendingProposalVisualCount).toBe(1);

  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), calmBurst);
  await page.waitForFunction((expectedCursors) => {
    const debug = window.__vivariumWorld;
    const diagnostics = debug.effectLifecycleDiagnostics();
    const applied = new Set(debug.appliedEventCursors());
    return (
      expectedCursors.every((cursor) => applied.has(cursor)) &&
      diagnostics.activeEffectCountByGroup.speech > 0 &&
      diagnostics.activeEffectCountByType.home_thieved > 0
    );
  }, calmBurstCursors, { timeout: 8000 });

  const calmDiagnostics = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    const harvest = debug.activeEffects().find((effect) => effect.summary?.kind === 'resource-harvest');
    return {
      budget: debug.renderBudgetDiagnostics(),
      harvestMotes: harvest?.summary?.resourceMotes ?? 0,
    };
  });
  expect(calmDiagnostics.harvestMotes).toBeGreaterThan(0);
  expect(calmDiagnostics.budget.detailBudgetPressure).toBeLessThan(0.5);
  expect(calmDiagnostics.budget.adaptiveDetailScale).toBeGreaterThan(0.7);

  for (const body of overloadBursts) {
    await page.evaluate((eventBody) => window.__vivariumDispatchMockEventSource(eventBody), body);
  }
  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), loadedHarvestEnvelope);
  await page.waitForFunction((expectedCursors) => {
    const debug = window.__vivariumWorld;
    const diagnostics = debug.effectLifecycleDiagnostics();
    const harvest = debug.activeEffects()
      .find((effect) => effect.summary?.kind === 'resource-harvest' && effect.eventType === 'resource_changed');
    const applied = new Set(debug.appliedEventCursors());
    return (
      expectedCursors.every((cursor) => applied.has(cursor)) &&
      diagnostics.activeEffectCountByGroup.contest > 0 &&
      diagnostics.activeEffectCountByType.home_colonized > 0 &&
      harvest?.summary?.amount === 9
    );
  }, allBurstCursors, { timeout: 8000 });
  await page.waitForFunction((expectedCursors) => {
    const debug = window.__vivariumWorld;
    const budget = debug.renderBudgetDiagnostics();
    const applied = new Set(debug.appliedEventCursors());
    return (
      expectedCursors.every((cursor) => applied.has(cursor)) &&
      budget.activeEffectCount <= budget.maxActiveEffectCount &&
      budget.culledEffectCount > 0 &&
      budget.disposedEffectGeometryCount > 0 &&
      budget.activeBubbleCount > 0
    );
  }, allBurstCursors, { timeout: 8000 });

  const activeDiagnostics = await page.evaluate(() => ({
    diagnostics: window.__vivariumWorld.effectLifecycleDiagnostics(),
    budget: window.__vivariumWorld.renderBudgetDiagnostics(),
    resourceMoteCounts: window.__vivariumWorld.activeEffects()
      .filter((effect) => effect.summary?.kind === 'resource-harvest')
      .map((effect) => effect.summary.resourceMotes),
    protectedHomeBuildEffects: window.__vivariumWorld.activeEffects()
      .filter((effect) => effect.summary?.kind === 'home-build').length,
  }));
  expect(activeDiagnostics.diagnostics.activeEffectCount).toBeGreaterThan(burstVisualEventTypes.length);
  expect(activeDiagnostics.diagnostics.activeEffectCount).toBeLessThanOrEqual(activeDiagnostics.diagnostics.maxActiveEffectCount);
  expect(activeDiagnostics.diagnostics.culledEffectCount).toBeGreaterThan(0);
  expect(activeDiagnostics.diagnostics.activeEffectCountByGroup.speech).toBeGreaterThan(0);
  expect(activeDiagnostics.diagnostics.activeEffectCountByGroup.contest).toBeGreaterThan(0);
  expect(activeDiagnostics.diagnostics.activeEffectCountByType.speak).toBeGreaterThan(0);
  expect(activeDiagnostics.diagnostics.appliedEventCursorCount).toBeGreaterThanOrEqual(allBurstCursors.length);
  expect(activeDiagnostics.budget.activeEffectCount).toBe(activeDiagnostics.diagnostics.activeEffectCount);
  expect(activeDiagnostics.budget.activeEffectCount).toBeLessThanOrEqual(activeDiagnostics.budget.maxActiveEffectCount);
  expect(activeDiagnostics.budget.culledEffectCount).toBe(activeDiagnostics.diagnostics.culledEffectCount);
  expect(activeDiagnostics.budget.activeEffectParticleCount).toBeGreaterThan(0);
  expect(activeDiagnostics.budget.detailScaleParticleThreshold).toBeGreaterThan(0);
  expect(activeDiagnostics.budget.detailBudgetPressure).toBeGreaterThan(calmDiagnostics.budget.detailBudgetPressure);
  expect(activeDiagnostics.budget.adaptiveDetailScale).toBeLessThan(calmDiagnostics.budget.adaptiveDetailScale);
  expect(activeDiagnostics.resourceMoteCounts.length).toBeGreaterThan(0);
  expect(Math.min(...activeDiagnostics.resourceMoteCounts)).toBeLessThan(calmDiagnostics.harvestMotes);
  expect(activeDiagnostics.protectedHomeBuildEffects).toBeGreaterThan(0);
  for (const value of [
    activeDiagnostics.budget.frameCount,
    activeDiagnostics.budget.averageFrameDeltaMs,
    activeDiagnostics.budget.averageRenderMs,
    activeDiagnostics.budget.sceneObjectCount,
    activeDiagnostics.budget.activeEffectObjectCount,
    activeDiagnostics.budget.rendererInfo.calls,
  ]) {
    expectFiniteNumber(value);
  }

  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), snapshotRequiredEnvelope(224));
  await page.waitForFunction(() => {
    const pending = window.__vivariumWorld.pendingProposalVisualState();
    return (
      pending.length === 1 &&
      pending[0].resources.energy === 3 &&
      pending[0].resources.materials === 1 &&
      pending[0].openTimestamp === 28
    );
  }, null, { timeout: 7000 });

  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), snapshotRequiredEnvelope(225));
  await page.waitForFunction(() => window.__vivariumWorld.effectLifecycleDiagnostics().pendingProposalVisualCount === 0, null, { timeout: 7000 });
  await page.waitForFunction(() => window.__vivariumWorld.effectLifecycleDiagnostics().activeEffectCount === 0, null, { timeout: 15000 });

  const settledDiagnostics = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    const counts = debug.activeEffectCounts();
    return {
      diagnostics: debug.effectLifecycleDiagnostics(),
      counts,
      cursors: debug.appliedEventCursors(),
      pending: debug.pendingProposalVisualState(),
      active: debug.activeEffects(),
    };
  });
  expect(settledDiagnostics.pending).toEqual([]);
  expect(settledDiagnostics.active).toEqual([]);
  expect(settledDiagnostics.cursors).toEqual(expect.arrayContaining(allBurstCursors));
  expect(settledDiagnostics.diagnostics.activeEffectCount).toBe(settledDiagnostics.counts.total);
  expect(settledDiagnostics.diagnostics.activeEffectCountByGroup).toEqual(settledDiagnostics.counts.byGroup);
  expect(settledDiagnostics.diagnostics.activeEffectCountByType).toEqual(settledDiagnostics.counts.byType);
  expect(settledDiagnostics.diagnostics.pendingProposalVisualCount).toBe(settledDiagnostics.pending.length);
  expect(settledDiagnostics.diagnostics.appliedEventCursorCount).toBe(settledDiagnostics.cursors.length);
  expect(settledDiagnostics.diagnostics.disposedEffectGeometryCount).toBeGreaterThan(initialDiagnostics.disposedEffectGeometryCount);
  expect(settledDiagnostics.diagnostics.disposedEffectMaterialCount).toBeGreaterThan(initialDiagnostics.disposedEffectMaterialCount);
  expect(settledDiagnostics.diagnostics.disposedProposalGeometryCount).toBeGreaterThan(initialDiagnostics.disposedProposalGeometryCount);
  expect(settledDiagnostics.diagnostics.disposedProposalMaterialCount).toBeGreaterThan(initialDiagnostics.disposedProposalMaterialCount);

  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), calmBurst);
  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), overloadBursts[0]);
  await page.waitForTimeout(450);
  const afterStaleDispatch = await page.evaluate(() => window.__vivariumWorld.effectLifecycleDiagnostics());
  expect(afterStaleDispatch.activeEffectCount).toBe(0);
  expect(afterStaleDispatch.appliedEventCursorCount).toBe(settledDiagnostics.diagnostics.appliedEventCursorCount);
  expect(afterStaleDispatch.disposedEffectGeometryCount).toBe(settledDiagnostics.diagnostics.disposedEffectGeometryCount);

  expect(await rendererChromeControlState(page)).toMatchObject({
    worldButtons: 0,
    worldDialogs: 0,
    worldModals: 0,
    timelineButtons: 0,
    replayButtons: 0,
    motionControlCopy: false,
  });
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app separates dense live event bubble lanes on desktop and mobile', async ({ page }) => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900, bubbleCount: 3 },
    { name: 'mobile', width: 390, height: 844, bubbleCount: 1 },
  ]) {
    const label = `${viewport.name} ${viewport.width}x${viewport.height}`;
    await bootApp(page, { width: viewport.width, height: viewport.height }, burstEnvelope);
    await waitForBurstEffects(page);
    await waitForEventBubbleLaneMetadata(page, viewport.bubbleCount);

    const state = await eventBubbleLaneState(page);
    const bubblesWithLaneMetadata = state.bubbles.filter((bubble) => (
      bubble.eventType &&
      bubble.group &&
      bubble.lane !== null &&
      bubble.priority
    ));
    expect(state.bubbles.length, label).toBe(viewport.bubbleCount);
    expect(bubblesWithLaneMetadata.length, label).toBe(state.bubbles.length);

    for (const bubble of state.bubbles) {
      const laneNumber = Number(bubble.lane);
      expect(Number.isInteger(bubble.cursor), `${label} ${bubble.eventType} cursor`).toBe(true);
      expect(bubble.cursor, `${label} ${bubble.eventType} cursor`).toBeGreaterThan(0);
      expect(Number.isFinite(laneNumber), `${label} ${bubble.eventType} lane`).toBe(true);
      expect(Number.isInteger(laneNumber), `${label} ${bubble.eventType} lane`).toBe(true);
      expect(['ambient', 'featured', 'drama'], `${label} ${bubble.eventType} priority`).toContain(bubble.priority);
      expect(bubble.text.length, `${label} ${bubble.eventType} text`).toBeGreaterThan(0);
      expect(bubble.eventColor, `${label} ${bubble.eventType} event color`).toMatch(/^#/);
      expect(['arriving', 'held', 'fading'], `${label} ${bubble.eventType} arrival phase`).toContain(bubble.arrivalPhase);
      expect(Number.isFinite(bubble.arrivalProgress), `${label} ${bubble.eventType} arrival progress`).toBe(true);
      expect(bubble.arrivalProgress, `${label} ${bubble.eventType} arrival progress`).toBeGreaterThanOrEqual(0);
      expect(bubble.arrivalProgress, `${label} ${bubble.eventType} arrival progress`).toBeLessThanOrEqual(1);
      expect(Number.isFinite(bubble.arrivalOpacity), `${label} ${bubble.eventType} arrival opacity`).toBe(true);
      expect(bubble.arrivalOpacity, `${label} ${bubble.eventType} arrival opacity`).toBeGreaterThanOrEqual(0);
      expect(bubble.arrivalOpacity, `${label} ${bubble.eventType} arrival opacity`).toBeLessThanOrEqual(1);
      expect(bubble.lineClamp, `${label} ${bubble.eventType} clamp`).toBe('2');
      expect(bubble.overflow, `${label} ${bubble.eventType} overflow`).toBe('hidden');
      expectEventBubbleFocusSemantics(bubble, `${label} ${bubble.eventType}`);
    }

    for (const bubble of state.bubbles) {
      expect(bubble.priority, `${label} ${bubble.eventType} priority`).toBe('drama');
    }

    for (const effect of state.effectBubbles) {
      expect(Number.isInteger(effect.cursor), `${label} ${effect.eventType} debug cursor`).toBe(true);
      expect(effect.cursor, `${label} ${effect.eventType} debug cursor`).toBeGreaterThan(0);
      expect(Number.isFinite(effect.lane), `${label} ${effect.eventType} debug lane`).toBe(true);
      expect(['ambient', 'featured', 'drama'], `${label} ${effect.eventType} debug priority`).toContain(effect.priority);
      expect(effect.offset.every((value) => Number.isFinite(value)), `${label} ${effect.eventType} debug offset`).toBe(true);
      expect(effect.anchorWorld.every((value) => Number.isFinite(value)), `${label} ${effect.eventType} debug anchor`).toBe(true);
      expect(effect.screen, `${label} ${effect.eventType} debug screen`).toBeTruthy();
      expect(Number.isFinite(effect.screen.x), `${label} ${effect.eventType} debug screen x`).toBe(true);
      expect(Number.isFinite(effect.screen.y), `${label} ${effect.eventType} debug screen y`).toBe(true);
      expect(['arriving', 'held', 'fading'], `${label} ${effect.eventType} debug arrival phase`).toContain(effect.arrivalPhase);
      expect(Number.isFinite(effect.arrivalProgress), `${label} ${effect.eventType} debug arrival progress`).toBe(true);
      expect(Number.isFinite(effect.arrivalOpacity), `${label} ${effect.eventType} debug arrival opacity`).toBe(true);
      expect(effect.priority, `${label} ${effect.eventType} debug priority`).toBe('drama');
    }

    expect(state.clipped, label).toEqual([]);
    expect(state.pairOverlaps, label).toEqual([]);
    expect(state.panelOverlaps, label).toEqual([]);
    expect(await corePanelOverlaps(page), label).toEqual([]);
  }
});

test('production app exposes bubble metadata for representative speech bond life home and contest icon medallions without playback controls', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, burstEnvelope);
  await page.waitForFunction((cursors) => {
    const applied = new Set(window.__vivariumWorld?.appliedEventCursors?.() ?? []);
    return cursors.every((cursor) => applied.has(cursor)) &&
      document.querySelectorAll('.viv-event-bubble').length === 3;
  }, burstEventCursors);
  await waitForEventBubbleLaneMetadata(page, 3);

  const state = await eventBubbleLaneState(page);
  expectEventBubbleLaneStateStable(state, 'catalog bubble metadata', 3);

  const arrivalEventTypes = [...new Set(state.bubbles.map((bubble) => bubble.eventType))];
  const bubbleByType = Object.fromEntries(
    arrivalEventTypes.map((eventType) => [
      eventType,
      state.bubbles.find((bubble) => bubble.eventType === eventType),
    ]),
  );
  for (const [eventType, bubble] of Object.entries(bubbleByType)) {
    expect(bubble, `${eventType} arrival bubble`).toBeTruthy();
    expect(['arriving', 'held', 'fading'], `${eventType} arrival phase`).toContain(bubble.arrivalPhase);
    expect(bubble.arrivalProgress, `${eventType} arrival progress`).toBeGreaterThanOrEqual(0);
    expect(bubble.arrivalProgress, `${eventType} arrival progress`).toBeLessThanOrEqual(1);
    expect(bubble.arrivalOpacity, `${eventType} arrival opacity`).toBeGreaterThanOrEqual(0);
    expect(bubble.arrivalOpacity, `${eventType} arrival opacity`).toBeLessThanOrEqual(1);
    expect(bubble.arrivalScale, `${eventType} arrival scale`).toBeGreaterThan(0.9);
    expect(bubble.arrivalScale, `${eventType} arrival scale`).toBeLessThan(1.1);
    expect(bubble.arrivalGlow, `${eventType} arrival glow`).toMatch(/^\d+(?:\.\d+)?%$/);
    if (bubble.detailKind) {
      expect(bubble.detailText, `${eventType} detail`).toMatch(/\S/);
    } else {
      expect(bubble.detailText, `${eventType} detail`).toBe('');
    }
    expect(bubble.text, `${eventType} raw ids`).not.toMatch(/\b(agent|home)_\d+\b/i);
    expect(bubble.text, `${eventType} raw run metadata`).not.toMatch(/\b(run_id|provider|model|prompt|systemPrompt)\b/i);
    expect(bubble.text, `${eventType} backend vocabulary`).not.toMatch(/\b(simulation|agent|LLM|spawn|NPC)\b/i);
  }

  const debugBubbleByType = Object.fromEntries(
    arrivalEventTypes.map((eventType) => [
      eventType,
      state.effectBubbles.find((effect) => effect.eventType === eventType),
    ]),
  );
  for (const [eventType, effect] of Object.entries(debugBubbleByType)) {
    expect(effect, `${eventType} debug arrival bubble`).toBeTruthy();
    expect(['arriving', 'held', 'fading'], `${eventType} debug arrival phase`).toContain(effect.arrivalPhase);
    expect(effect.arrivalProgress, `${eventType} debug arrival progress`).toBeGreaterThanOrEqual(0);
    expect(effect.arrivalProgress, `${eventType} debug arrival progress`).toBeLessThanOrEqual(1);
    expect(effect.arrivalOpacity, `${eventType} debug arrival opacity`).toBeGreaterThanOrEqual(0);
    expect(effect.arrivalOpacity, `${eventType} debug arrival opacity`).toBeLessThanOrEqual(1);
  }

  await page.waitForFunction(() => (
    Array.from(document.querySelectorAll('.viv-event-bubble'))
      .some((bubble) => (
        bubble.getAttribute('data-event-arrival-phase') === 'fading' &&
        Number(bubble.getAttribute('data-event-arrival-opacity')) < 1
      ))
  ), null, { timeout: 4000 });
  const fadingState = await eventBubbleLaneState(page);
  expect(fadingState.bubbles.some((bubble) => (
    bubble.arrivalPhase === 'fading' &&
    bubble.arrivalOpacity < 1 &&
    bubble.arrivalProgress >= 0.78
  ))).toBe(true);

  await expect(page.locator('.viv-event-bubble dialog, .viv-event-bubble [role="dialog"]')).toHaveCount(0);
  const catalogControlState = await rendererChromeControlState(page);
  expect(catalogControlState).toMatchObject({
    worldDialogs: 0,
    worldModals: 0,
    timelineButtons: 0,
    replayButtons: 0,
    inspectorRecentButtons: 0,
    liveStatusButtons: 0,
    motionControlCopy: false,
  });
  expect(catalogControlState.worldButtons).toBe(focusableEventBubbleCount(fadingState));
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app exposes system bubble metadata with an icon medallion without controls', async ({ page }) => {
  const systemEnvelope = {
    schema: 1,
    cursor: 4,
    oldest_cursor: 0,
    next_cursor: 6,
    events: [
      eventEntry(
        5,
        'simulation_started',
        'world',
        {
          run_id: 'seed-7-app-test',
          agent_count: 3,
          world_time: 0,
        },
        {},
        { scope: 'global', region: null },
      ),
    ],
    overflow: false,
    snapshot_required: false,
  };
  await bootApp(page, { width: 1440, height: 900 }, systemEnvelope);
  await waitForEventBubbleLaneMetadata(page, 1);
  await page.waitForFunction(() => (
    Array.from(document.querySelectorAll('.viv-event-bubble'))
      .some((bubble) => bubble.getAttribute('data-event-type') === 'simulation_started')
  ));

  const state = await eventBubbleLaneState(page);
  expectEventBubbleLaneStateStable(state, 'system bubble metadata', 1);
  const systemBubble = state.bubbles.find((bubble) => bubble.eventType === 'simulation_started');
  expect(systemBubble).toMatchObject({
    group: 'system',
    iconKey: 'world',
    iconLabel: 'World start',
    medallionLabel: 'World',
    priority: 'featured',
    catalogPriority: 'featured',
    accent: '#ede4d2',
    eventColor: '#ede4d2',
    pointerEvents: 'none',
  });
  const debugSystemBubble = state.effectBubbles.find((effect) => effect.eventType === 'simulation_started');
  expect(debugSystemBubble).toMatchObject({
    iconKey: 'world',
    iconLabel: 'World start',
    medallionLabel: 'World',
    priority: 'featured',
    catalogPriority: 'featured',
    accent: '#ede4d2',
  });

  await openAtlasSurface(page, 'world');
  const systemSummary = page.locator('.inspector-recent [data-event-type="simulation_started"]').first();
  await expect(systemSummary).toBeVisible();
  await expect(systemSummary).toHaveAttribute('data-event-detail-kind', 'world-wake');
  await expect(systemSummary).toHaveAttribute('data-event-detail-text', '3 beings awake');
  await expect(systemSummary).toHaveAttribute('data-event-chain-kind', 'none');
  await expect(systemSummary.locator('.event-summary-detail')).toHaveText('3 beings awake');
  await expect(systemSummary.locator('.event-summary-chain')).toHaveCount(0);

  await expect(page.locator('.viv-event-bubble button, .viv-event-bubble [role="button"], .viv-event-bubble dialog, .viv-event-bubble [role="dialog"]')).toHaveCount(0);
  expect(await rendererChromeControlState(page)).toMatchObject({
    worldButtons: 0,
    worldDialogs: 0,
    worldModals: 0,
    timelineButtons: 0,
    replayButtons: 0,
    inspectorRecentButtons: 0,
    liveStatusButtons: 0,
    motionControlCopy: false,
  });
  expect(await viewportLayoutIssues(page)).toEqual([]);
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app keeps active event bubbles bounded through camera movement and resize', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, burstEnvelope);
  await waitForBurstEffects(page);
  await waitForEventBubbleLaneMetadata(page, 3);
  expectEventBubbleLaneStateStable(await eventBubbleLaneState(page), 'initial active bubbles', 3);

  await stressCameraAndResizeWithActiveBubbles(page);
  expectEventBubbleLaneStateStable(await eventBubbleLaneState(page), 'after camera stress', 0);

  const followup = envelopeWithCursorOffset(burstEnvelope, 240, 24);
  const followupEvents = followup.events.filter(({ event }) => (
    ['speak', 'attack', 'agent_died', 'home_thieved'].includes(event.type)
  ));
  const followupCursors = followupEvents.map(({ cursor }) => cursor);
  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), {
    ...followup,
    events: followupEvents,
    cursor: Math.min(...followupCursors) - 1,
    oldest_cursor: Math.min(...followupCursors) - 1,
    next_cursor: Math.max(...followupCursors) + 1,
  });
  await page.waitForFunction((expectedCursors) => {
    const debug = window.__vivariumWorld;
    const applied = new Set(Array.from(debug?.appliedEventCursors?.() ?? []));
    const recent = debug?.recentRenderedEventBeats?.() ?? [];
    return (
      expectedCursors.every((cursor) => applied.has(cursor)) &&
      expectedCursors.every((cursor) => recent.some((beat) => beat.cursor === cursor))
    );
  }, followupCursors, { timeout: 5000 });

  await waitForEventBubbleLaneMetadata(page, 1);
  const afterFollowup = await eventBubbleLaneState(page);
  expectEventBubbleLaneStateStable(afterFollowup, 'after camera stress follow-up burst', 1);
  expect(afterFollowup.bubbles.length).toBeLessThanOrEqual(3);
  expect(await page.evaluate(() => window.__vivariumWorld.sampleCanvasPixels())).toBeGreaterThan(20);
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app renders raid theft and colonize chains as transient home choreography', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, burstEnvelope);
  await waitForBurstEffects(page);
  await openAtlasSurface(page, 'world');

  const debugSnapshot = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    const effects = debug.activeEffects();
    return {
      theft: effects.find((effect) => effect.summary?.kind === 'home-theft-raid'),
      colonize: effects.find((effect) => effect.summary?.kind === 'home-colonize-raid'),
      scavenge: effects.find((effect) => effect.summary?.kind === 'ruin-scavenge'),
      activeTypes: effects.map((effect) => effect.eventType),
      summaryKinds: effects.map((effect) => effect.summary?.kind).filter(Boolean),
      cursors: Array.from(debug.appliedEventCursors()),
      homeOne: debug.homeVisualState('home_001'),
      homeTwo: debug.homeVisualState('home_002'),
      ruin: debug.homeVisualState('home_old'),
      homeOnePoint: debug.screenPointForHome('home_001'),
      homeTwoPoint: debug.screenPointForHome('home_002'),
      ruinPoint: debug.screenPointForHome('home_old'),
      timelineButtons: document.querySelectorAll('.timeline-strip button').length,
    };
  });
  await openAtlasSurface(page, 'archive');
  const replayButtons = await page.locator('.replay-preview button').count();
  await page.keyboard.press('Escape');
  await waitForLiveWorldRenderer(page);

  expect(debugSnapshot.activeTypes).toEqual(expect.arrayContaining(['home_thieved', 'home_colonized']));
  expect(debugSnapshot.activeTypes).not.toContain('home_breached');
  expect(debugSnapshot.summaryKinds).not.toContain('home-breach-bubble');
  expect(debugSnapshot.summaryKinds).not.toContain('home-breach-shock');
  expect(debugSnapshot.cursors).toEqual(expect.arrayContaining([18, 19, 20, 21]));
  expectRendererSummarySubsetIntegrity([
    debugSnapshot.theft,
    debugSnapshot.colonize,
    debugSnapshot.scavenge,
  ], [
    'home-colonize-raid',
    'home-theft-raid',
    'ruin-scavenge',
  ]);
  expect(debugSnapshot.theft.summary).toMatchObject({
    kind: 'home-theft-raid',
    raidKind: 'theft',
    actorId: 'agent_003',
    targetId: 'agent_003',
    homeId: 'home_001',
    recipientIds: ['agent_003'],
    lootMaterials: 14,
    motionCue: 'breach-vault-strip-stream',
    streamDirection: 'home-to-recipient',
    homeAnchored: true,
    breachCue: true,
    crackCue: true,
    vaultStream: true,
    standingHomeCue: true,
    lowIntegrityHomeCue: true,
    durableHomeMutated: false,
    ownerStateMutated: false,
    stakeholderStateMutated: false,
    vaultStateMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(debugSnapshot.theft.summary.goldMotes).toBeGreaterThan(0);
  expect(Number.isFinite(debugSnapshot.theft.summary.streamFromWorld[0])).toBe(true);
  expect(Number.isFinite(debugSnapshot.theft.summary.streamToWorld[0])).toBe(true);

  expect(debugSnapshot.colonize.summary).toMatchObject({
    kind: 'home-colonize-raid',
    raidKind: 'colonize',
    actorId: 'agent_003',
    targetId: 'agent_002',
    homeId: 'home_002',
    previousOwnerId: 'agent_002',
    newOwnerId: 'agent_003',
    previousStakeholderIds: ['agent_002', 'agent_003', 'agent_004', 'agent_005'],
    newStakeholderIds: ['agent_003'],
    motionCue: 'breach-owner-flip-eviction',
    streamDirection: 'actor-to-home',
    homeAnchored: true,
    breachCue: true,
    bannerCue: true,
    pennantCue: true,
    ownerFlipCue: true,
    evictionHints: true,
    durableHomeMutated: false,
    ownerStateMutated: false,
    stakeholderStateMutated: false,
    vaultStateMutated: false,
  });
  expect(debugSnapshot.colonize.summary.visibleEvicteeIds).toContain('agent_002');
  expect(debugSnapshot.colonize.summary.evictionHintCount).toBeGreaterThan(0);

  expect(debugSnapshot.scavenge.summary).toMatchObject({
    kind: 'ruin-scavenge',
    homeEventKind: 'scavenge',
    actorId: 'agent_003',
    homeId: 'home_old',
    amount: 6,
    resourceType: 'materials',
    remnantMaterials: 6,
    agentMaterials: 15,
    motionCue: 'ruin-remnant-stream-to-scavenger',
    streamDirection: 'ruin-to-scavenger',
    homeAnchored: true,
    remnantStream: true,
    scavengeStream: true,
    persistentOccupancy: false,
    actualActorMutated: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    ruinStateMutated: false,
    remnantStateMutated: false,
    vaultStateMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(debugSnapshot.scavenge.summary.goldMotes).toBeGreaterThan(0);
  expect(Number.isFinite(debugSnapshot.scavenge.summary.streamFromWorld[0])).toBe(true);
  expect(Number.isFinite(debugSnapshot.scavenge.summary.streamToWorld[0])).toBe(true);

  expect(debugSnapshot.homeOne.vaultRatio).toBeCloseTo(14 / 300, 4);
  expect(debugSnapshot.homeOne.stakeholderCount).toBe(1);
  expect(debugSnapshot.homeOne.breached).toBe(false);
  expect(debugSnapshot.homeTwo.vaultRatio).toBe(1);
  expect(debugSnapshot.homeTwo.stakeholderCount).toBe(4);
  expect(debugSnapshot.homeTwo.breached).toBe(true);
  expect(debugSnapshot.ruin.ruined).toBe(true);
  expect(debugSnapshot.ruin.remnantRatio).toBeCloseTo(64 / 80, 4);
  expect(debugSnapshot.timelineButtons).toBe(0);
  expect(replayButtons).toBe(0);

  const inspector = page.locator('.inspector');
  await clickStableProjectedWorldTarget(page, 'home', 'home_001');
  await expect(inspector).toContainText('kept by Aster');
  await expect(inspector).toContainText('Vault');
  await expect(inspector).toContainText('14');
  await expect(inspector).toContainText('Breach state');
  await expect(inspector).toContainText('clear');

  await clickStableProjectedWorldTarget(page, 'home', 'home_002');
  await expect(inspector).toContainText('kept by Briar');
  await expect(inspector).toContainText('Vault');
  await expect(inspector).toContainText('360');
  await expect(inspector).toContainText('Breach state');
  await expect(inspector).toContainText('Cinder');

  await clickStableProjectedWorldTarget(page, 'home', 'home_old');
  await expect(inspector).toContainText('ruin in nirvana west');
  await expect(inspector).toContainText('Remnant');
  await expect(inspector).toContainText('64');
});

test('production app renders standalone home breach as transient shock without mutating home state', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, standaloneHomeBreachEnvelope);

  const breachBubble = page.locator('.viv-event-bubble[data-event-type="home_breached"]').first();
  await expect(breachBubble).toBeVisible();
  await expect(breachBubble.locator('.viv-event-bubble-text')).toHaveText('breached');
  await expect(breachBubble).toHaveAttribute('data-event-detail-kind', 'raid-threshold');
  await expect(breachBubble.locator('.viv-event-bubble-detail')).toHaveText('Cinder breaks the threshold');

  await page.waitForFunction(() => {
    const effects = window.__vivariumWorld?.activeEffects?.() || [];
    return effects.some((effect) => effect.summary?.kind === 'home-breach-bubble') &&
      effects.some((effect) => (
        effect.summary?.kind === 'home-breach-shock' &&
        effect.summary.breachMotes > 0
      ));
  }, null, { timeout: 8000 });

  const state = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    const effects = debug.activeEffects();
    return {
      motion: debug.motionMode(),
      effects,
      bubble: effects.find((effect) => effect.summary?.kind === 'home-breach-bubble'),
      shock: effects.find((effect) => effect.summary?.kind === 'home-breach-shock'),
      activeTypes: effects.map((effect) => effect.eventType),
      cursors: Array.from(debug.appliedEventCursors()),
      homeOne: debug.homeVisualState('home_001'),
    };
  });

  expect(state.motion).toMatchObject({ mode: 'full', reduced: false });
  expect(state.activeTypes).toContain('home_breached');
  expect(state.activeTypes).not.toContain('home_thieved');
  expect(state.activeTypes).not.toContain('home_colonized');
  expect(state.cursors).toContain(70);
  expect(state.homeOne.breached).toBe(false);
  expect(state.bubble.group).toBe('contest');
  expectRendererSummaryCatalogIntegrity(state.effects, [
    'generic-event-arc',
    'generic-event-pulse',
    'home-breach-bubble',
    'home-breach-shock',
  ]);
  expect(state.bubble.summary).toMatchObject({
    kind: 'home-breach-bubble',
    actorId: 'agent_003',
    homeId: 'home_001',
    regionName: 'warm_springs',
    participantIds: ['agent_003'],
    breacherIds: ['agent_003'],
    breachIntent: 'thieve',
    energyCost: 15,
    materialsCost: 10,
    integrityDamage: 25,
    integrity: 0,
    motionCue: 'standalone-breach-shock-crack',
    motionMode: 'full',
    streamDirection: 'actor-to-home',
    homeAnchored: true,
    breachCue: true,
    crackCue: true,
    breachShockCue: false,
    worldBubbleCue: true,
    terminalRaidCue: false,
    vaultStream: false,
    ownerFlipCue: false,
    persistentOccupancy: false,
    actualActorMutated: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    ownerStateMutated: false,
    stakeholderStateMutated: false,
    vaultStateMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(state.bubble.summary.actorVisible).toBe(true);
  expect(Number.isFinite(state.bubble.summary.homeWorld[0])).toBe(true);
  expect(Number.isFinite(state.bubble.summary.actorWorld[0])).toBe(true);
  expect(state.bubble.summary.actorPathWorld).toHaveLength(2);
  expect(state.shock.summary).toMatchObject({
    kind: 'home-breach-shock',
    actorId: 'agent_003',
    homeId: 'home_001',
    regionName: 'warm_springs',
    breachIntent: 'thieve',
    motionCue: 'standalone-breach-shock-crack',
    motionMode: 'full',
    breachCue: true,
    crackCue: true,
    breachShockCue: true,
    worldBubbleCue: false,
    terminalRaidCue: false,
    vaultStream: false,
    ownerFlipCue: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    ownerStateMutated: false,
    stakeholderStateMutated: false,
    vaultStateMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(state.shock.summary.breachMotes).toBeGreaterThan(0);
  for (const summary of [state.bubble.summary, state.shock.summary]) {
    expect(Object.prototype.hasOwnProperty.call(summary, 'message')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(summary, 'text')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(summary, 'fullText')).toBe(false);
  }
  const breachBubbleState = await eventBubbleLaneState(page);
  for (const bubble of breachBubbleState.bubbles) {
    expectEventBubbleFocusSemantics(bubble, `home breach ${bubble.eventType}`);
  }
  const breachControlState = await rendererChromeControlState(page);
  expect(breachControlState).toMatchObject({
    worldDialogs: 0,
    worldModals: 0,
    timelineButtons: 0,
    replayButtons: 0,
    motionControlCopy: false,
  });
  expect(breachControlState.worldButtons).toBe(focusableEventBubbleCount(breachBubbleState));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootApp(page, { width: 1440, height: 900 }, standaloneHomeBreachEnvelope);
  await page.waitForFunction(() => {
    const debug = window.__vivariumWorld;
    const summaries = debug?.activeEffects?.().map((effect) => effect.summary) || [];
    return debug?.motionMode?.().reduced === true &&
      summaries.some((summary) => summary?.kind === 'home-breach-bubble' && summary.motionMode === 'reduced') &&
      summaries.some((summary) => summary?.kind === 'home-breach-shock' && summary.motionMode === 'reduced');
  }, null, { timeout: 8000 });
  const reducedState = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    const effects = debug.activeEffects();
    return {
      motion: debug.motionMode(),
      effects,
      bubble: effects.find((effect) => effect.summary?.kind === 'home-breach-bubble'),
      shock: effects.find((effect) => effect.summary?.kind === 'home-breach-shock'),
      homeOne: debug.homeVisualState('home_001'),
    };
  });
  expect(reducedState.motion).toMatchObject({ mode: 'reduced', reduced: true, source: 'media' });
  expectRendererSummaryCatalogIntegrity(reducedState.effects, [
    'generic-event-arc',
    'generic-event-pulse',
    'home-breach-bubble',
    'home-breach-shock',
  ], 'reduced');
  expect(reducedState.bubble.summary).toMatchObject({
    kind: 'home-breach-bubble',
    motionMode: 'reduced',
    breachCue: true,
    crackCue: true,
    breachShockCue: false,
    worldBubbleCue: true,
    terminalRaidCue: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expect(reducedState.shock.summary).toMatchObject({
    kind: 'home-breach-shock',
    motionMode: 'reduced',
    breachCue: true,
    crackCue: true,
    breachShockCue: true,
    worldBubbleCue: false,
    terminalRaidCue: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expect(reducedState.shock.summary.breachMotes).toBeGreaterThan(0);
  expect(reducedState.homeOne.breached).toBe(false);
  const reducedBreachBubbleState = await eventBubbleLaneState(page);
  for (const bubble of reducedBreachBubbleState.bubbles) {
    expectEventBubbleFocusSemantics(bubble, `reduced home breach ${bubble.eventType}`);
  }
  const reducedBreachControlState = await rendererChromeControlState(page);
  expect(reducedBreachControlState).toMatchObject({
    worldDialogs: 0,
    worldModals: 0,
    timelineButtons: 0,
    replayButtons: 0,
    motionControlCopy: false,
  });
  expect(reducedBreachControlState.worldButtons).toBe(
    focusableEventBubbleCount(reducedBreachBubbleState),
  );
});

test('production app caps crowded colonize eviction hints while preserving owner-flip semantics', async ({ page }) => {
  const extraEvictees = ['agent_004', 'agent_005', 'agent_006', 'agent_007', 'agent_008'];
  const crowdedWorld = {
    ...world,
    agents: [
      ...world.agents,
      ...extraEvictees.map((id, index) => ({
        id,
        name: `Evictee ${index + 1}`,
        persona: 'former stakeholder',
        position: index % 2 === 0 ? 'warm_springs' : 'nirvana_east',
        energy: 32 - index,
        materials: 4 + index,
        status: 'alive',
        last_mated_at: null,
        offspring_count: 0,
        died_at: null,
        home_id: 'home_002',
        is_hoarding: false,
      })),
    ],
    homes: world.homes.map((home) => (
      home.home_id === 'home_002'
        ? {
            ...home,
            stakeholders: ['agent_002', 'agent_003', ...extraEvictees],
          }
        : home
    )),
  };
  const previousStakeholders = [
    'agent_002',
    'agent_003',
    'agent_004',
    'agent_005',
    'agent_missing',
    'agent_006',
    'agent_007',
    'agent_004',
    'agent_008',
  ];
  const crowdedColonizeEnvelope = {
    ...groupedHomeRaidEnvelope,
    events: groupedHomeRaidEnvelope.events.map((entry) => (
      entry.event.type === 'home_colonized'
        ? {
            ...entry,
            event: {
              ...entry.event,
              payload: {
                ...entry.event.payload,
                previous_stakeholders: previousStakeholders,
              },
            },
          }
        : entry
    )),
  };

  await bootApp(page, { width: 1440, height: 900 }, crowdedColonizeEnvelope, crowdedWorld);
  await page.waitForFunction(() => (
    window.__vivariumWorld.activeEffects()
      .some((effect) => effect.summary?.kind === 'home-colonize-raid' && effect.summary.evictionHintCount === 4)
  ), null, { timeout: 8000 });

  const colonize = await page.evaluate(() => (
    window.__vivariumWorld.activeEffects()
      .find((effect) => effect.summary?.kind === 'home-colonize-raid')
  ));

  expect(colonize.summary).toMatchObject({
    kind: 'home-colonize-raid',
    previousOwnerId: 'agent_002',
    newOwnerId: 'agent_003',
    ownerFlipCue: true,
    bannerCue: true,
    pennantCue: true,
    evictionHints: true,
    evictionHintCount: 4,
    durableHomeMutated: false,
    ownerStateMutated: false,
    stakeholderStateMutated: false,
  });
  expectRendererSummarySubsetIntegrity([colonize], ['home-colonize-raid']);
  expect(colonize.summary.previousStakeholderIds).toEqual(previousStakeholders);
  expect(colonize.summary.visibleEvicteeIds).toEqual(['agent_002', 'agent_004', 'agent_005', 'agent_006']);
  expect(colonize.summary.visibleEvicteeIds).not.toContain('agent_missing');
  expect(colonize.summary.visibleEvicteeIds).not.toContain('agent_007');
  expect(colonize.summary.visibleEvicteeIds).not.toContain('agent_008');
  expect(await corePanelOverlaps(page)).toEqual([]);
});

test('production app groups movement split across adjacent SSE envelopes', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, splitMoveEnvelopePlan);

  await page.waitForFunction(() => {
    const debug = window.__vivariumWorld;
    const effects = debug.activeEffects();
    const types = effects.map((effect) => effect.eventType);
    const cursors = Array.from(debug.appliedEventCursors());
    return (
      types.includes('agent_entered_region') &&
      !types.includes('agent_left_region') &&
      cursors.includes(5) &&
      cursors.includes(6)
    );
  });
  const movementState = await page.evaluate(() => {
    const effects = window.__vivariumWorld.activeEffects();
    return {
      effects,
      movement: effects.find((effect) => effect.summary?.kind === 'movement-arrival'),
    };
  });
  const { movement } = movementState;
  expect(movement).toBeTruthy();
  expectRendererSummarySubsetIntegrity(movementState.effects, [
    'movement-arrival',
  ]);
  expect(movement.summary).toMatchObject({
    kind: 'movement-arrival',
    actorId: 'agent_001',
    regionName: 'warm_springs',
    fromRegionName: 'nirvana',
    toRegionName: 'warm_springs',
    motionCue: 'region-to-region-arrival-path',
    motionMode: 'full',
    streamDirection: 'from-region-to-region',
    movementCue: true,
    pathCue: true,
    arrivalCue: true,
    actualActorMutated: false,
    regionStateMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(movement.summary.actorPathWorld).toHaveLength(2);
  expect(Number.isFinite(movement.summary.streamFromWorld[0])).toBe(true);
  expect(Number.isFinite(movement.summary.streamToWorld[0])).toBe(true);
  const movementBubble = page.locator('.viv-event-bubble[data-event-type="agent_entered_region"]').first();
  await expect(movementBubble).toHaveAttribute('data-event-chain-kind', 'crossing');
  await expect(movementBubble).toHaveAttribute('data-event-chain-count', '2');
  await expect(movementBubble).toHaveAttribute('data-event-chain-window', '5-6');
  await expect(movementBubble).toHaveAttribute('data-event-chain-text', 'crossing complete');
  await expect(movementBubble.locator('.viv-event-bubble-chain')).toHaveText('crossing complete');
  await openAtlasSurface(page, 'chronicle');
  const pulseLatest = page.locator('.live-pulse-latest');
  await expect(pulseLatest).toHaveAttribute('data-pulse-event-type', 'agent_entered_region');
  await expect(pulseLatest).toHaveAttribute('data-pulse-chain-kind', 'crossing');
  await expect(pulseLatest).toHaveAttribute('data-pulse-chain-count', '2');
  await expect(pulseLatest).toHaveAttribute('data-pulse-chain-window', '5-6');
  await expect(pulseLatest).toHaveAttribute('data-pulse-chain-text', 'crossing complete');
  await expect(pulseLatest.locator('em')).toHaveText('crossing complete');
  const nowCue = page.locator('.live-now-cue[data-now-slot="world"]');
  await expect(nowCue).toHaveAttribute('data-now-event-type', 'agent_entered_region');
  await expect(nowCue).toHaveAttribute('data-now-chain-kind', 'crossing');
  await expect(nowCue).toHaveAttribute('data-now-chain-count', '2');
  await expect(nowCue).toHaveAttribute('data-now-chain-window', '5-6');
  await expect(nowCue).toHaveAttribute('data-now-chain-text', 'crossing complete');
});

test('production app renders standalone resource transfer as a transient gift thread', async ({ page }) => {
  const transferEnvelope = {
    schema: 1,
    cursor: 40,
    oldest_cursor: 0,
    next_cursor: 42,
    events: [
      eventEntry(
        41,
        'resource_transferred',
        'agent_001',
        {
          sender_id: 'agent_001',
          receiver_id: 'agent_003',
          region: 'warm_springs',
          resource_type: 'materials',
          amount: 6,
          sender_materials: 18,
          receiver_materials: 11,
        },
        { actor_id: 'agent_001', target_id: 'agent_003', region: 'warm_springs', resource_type: 'materials', amount: 6 },
        { target: 'agent_003' },
      ),
    ],
    overflow: false,
    snapshot_required: false,
  };
  await bootApp(page, { width: 1440, height: 900 }, transferEnvelope);

  await page.waitForFunction(() => (
    window.__vivariumWorld.activeEffects()
      .some((effect) => effect.summary?.kind === 'resource-transfer')
  ), null, { timeout: 5000 });
  const transfer = await page.evaluate(() => ({
    effects: window.__vivariumWorld.activeEffects(),
    effect: window.__vivariumWorld.activeEffects()
      .find((effect) => effect.summary?.kind === 'resource-transfer'),
    recoveryRelightCount: window.__vivariumWorld.activeEffects()
      .filter((effect) => effect.summary?.kind === 'agent-recovered-relight').length,
  }));

  expect(transfer.effect).toBeTruthy();
  expectRendererSummaryCatalogIntegrity(transfer.effects, [
    'generic-event-arc',
    'generic-event-pulse',
    'resource-transfer',
  ]);
  expect(transfer.effect.summary).toMatchObject({
    kind: 'resource-transfer',
    actorId: 'agent_001',
    targetId: 'agent_003',
    regionName: 'warm_springs',
    resourceType: 'materials',
    amount: 6,
    motionCue: 'actor-to-recipient-gift-thread',
    motionMode: 'full',
    streamDirection: 'actor-to-target',
    transferCue: true,
    giftThreadCue: true,
    resourceStream: true,
    actualActorMutated: false,
    targetStateMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(transfer.effect.summary.actorVisible).toBe(true);
  expect(transfer.effect.summary.targetVisible).toBe(true);
  expect(Number.isFinite(transfer.effect.summary.streamFromWorld[0])).toBe(true);
  expect(Number.isFinite(transfer.effect.summary.streamToWorld[0])).toBe(true);
  expect(transfer.recoveryRelightCount).toBe(0);
  expect(await corePanelOverlaps(page)).toEqual([]);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootApp(page, { width: 1440, height: 900 }, transferEnvelope);
  await page.waitForFunction(() => (
    window.__vivariumWorld.activeEffects()
      .some((effect) => effect.summary?.kind === 'resource-transfer' && effect.summary.motionMode === 'reduced')
  ), null, { timeout: 5000 });
  const reducedTransfer = await page.evaluate(() => ({
    motion: window.__vivariumWorld.motionMode(),
    effects: window.__vivariumWorld.activeEffects(),
    effect: window.__vivariumWorld.activeEffects()
      .find((effect) => effect.summary?.kind === 'resource-transfer'),
    controlState: {
      worldButtons: document.querySelectorAll('.world-stage button, .world-labels button').length,
      unstructuredWorldButtons: document.querySelectorAll(
        '.world-stage button:not(.viv-event-bubble[data-event-focus-kind]), .world-labels button:not(.viv-event-bubble[data-event-focus-kind])',
      ).length,
      motionControlCopy: /\bReduced motion\b|\bmotion setting\b/i.test(document.body.innerText),
    },
  }));
  expect(reducedTransfer.motion).toMatchObject({ mode: 'reduced', reduced: true, source: 'media' });
  expectRendererSummaryCatalogIntegrity(reducedTransfer.effects, [
    'generic-event-arc',
    'generic-event-pulse',
    'resource-transfer',
  ], 'reduced');
  expect(reducedTransfer.effect.summary).toMatchObject({
    kind: 'resource-transfer',
    motionMode: 'reduced',
    transferCue: true,
    giftThreadCue: true,
    resourceStream: true,
    actualActorMutated: false,
    targetStateMutated: false,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expect(reducedTransfer.controlState).toMatchObject({
    unstructuredWorldButtons: 0,
    motionControlCopy: false,
  });
  expect(reducedTransfer.controlState.worldButtons).toBeLessThanOrEqual(1);
});

test('production app renders lower-frequency catalog event effects', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, lowFrequencyEnvelope);

  await page.waitForFunction((eventTypes) => {
    const debug = window.__vivariumWorld;
    const effects = debug.activeEffects();
    const activeTypes = effects.map((effect) => effect.eventType);
    return eventTypes.every((eventType) => activeTypes.includes(eventType));
  }, lowFrequencyVisualEventTypes);
  await page.waitForFunction(() => {
    const counts = window.__vivariumWorld.activeEffectCounts().byType;
    return counts.hearth_used >= 2 && counts.home_collapsed >= 2;
  });
  const initialEffectCounts = await page.evaluate(() => window.__vivariumWorld.activeEffectCounts().byType);
  expect(initialEffectCounts.hearth_used).toBeGreaterThanOrEqual(2);
  expect(initialEffectCounts.home_collapsed).toBeGreaterThanOrEqual(2);
  await page.waitForFunction(() => window.__vivariumWorld.activeEffects().some((effect) => (
    effect.eventType === 'hearth_used' &&
    effect.summary?.kind === 'shelter-use' &&
    effect.summary.doorOpen === true &&
    effect.summary.phase === 'threshold' &&
    effect.summary.proxyOpacity <= 0.08
  )));

  const effects = await page.evaluate(() => window.__vivariumWorld.activeEffects());
  const recentRenderedBeats = await page.evaluate(() => window.__vivariumWorld.recentRenderedEventBeats());
  const activeTypes = effects.map((effect) => effect.eventType);
  const countByType = (eventType) => effects.filter((effect) => effect.eventType === eventType).length;
  const hearthEffects = effects.filter((effect) => effect.eventType === 'hearth_used');
  const shelterEffect = hearthEffects.find((effect) => (
    effect.summary?.kind === 'shelter-use' &&
    effect.summary.phase === 'threshold' &&
    effect.summary.proxyOpacity <= 0.08
  ));
  const hearthEmberEffect = hearthEffects.find((effect) => effect.summary?.kind === 'hearth-ember');
  const genericBubbleEffects = effects.filter((effect) => (
    effect.bubble &&
    effect.summary?.kind === 'generic-event-bubble'
  ));
  const genericBubbleTypes = genericBubbleEffects.map((effect) => effect.eventType);
  const genericPulseEffects = effects.filter((effect) => (
    !effect.bubble &&
    effect.summary?.kind === 'generic-event-pulse'
  ));
  const genericPulseTypes = genericPulseEffects.map((effect) => effect.eventType);
  const genericArcEffects = effects.filter((effect) => (
    !effect.bubble &&
    effect.summary?.kind === 'generic-event-arc'
  ));
  const genericArcTypes = genericArcEffects.map((effect) => effect.eventType);
  const bubbleEffectsWithoutSummary = effects
    .filter((effect) => effect.bubble && !effect.summary)
    .map((effect) => effect.eventType);
  const nonBubbleEffectsWithoutSummary = effects
    .filter((effect) => !effect.bubble && !effect.summary)
    .map((effect) => effect.eventType);
  const genericHearthBubble = genericBubbleEffects.find((effect) => effect.eventType === 'hearth_used');
  const joinEffect = effects.find((effect) => effect.summary?.kind === 'home-membership-join');
  const leaveEffect = effects.find((effect) => effect.summary?.kind === 'home-membership-leave');
  const hoardEffect = effects.find((effect) => effect.summary?.kind === 'home-vault-hoard');
  const agentHoardEffect = effects.find((effect) => (
    effect.summary?.kind === 'agent-hoard-shimmer' &&
    effect.summary.resourceMotes > 0
  ));
  const startupEffect = effects.find((effect) => effect.summary?.kind === 'simulation-started');
  const collapseEffect = effects.find((effect) => effect.summary?.kind === 'home-collapse');
  const paralyzedEffect = effects.find((effect) => (
    effect.summary?.kind === 'life-transition' &&
    effect.summary.lifeEventKind === 'paralyzed'
  ));
  const bondKinds = effects
    .filter((effect) => effect.summary?.kind === 'bond-lifecycle')
    .map((effect) => effect.summary.bondEventKind);
  expect(activeTypes).toEqual(expect.arrayContaining(lowFrequencyVisualEventTypes));
  expect(effects.map((effect) => effect.group)).toEqual(
    expect.arrayContaining(['combat', 'resource', 'bond', 'home', 'contest', 'system']),
  );
  expect(shelterEffect).toBeTruthy();
  expect(joinEffect).toBeTruthy();
  expect(leaveEffect).toBeTruthy();
  expect(hoardEffect).toBeTruthy();
  expect(agentHoardEffect).toBeTruthy();
  expect(startupEffect).toBeTruthy();
  expect(collapseEffect).toBeTruthy();
  expect(paralyzedEffect).toBeTruthy();
  expect(hearthEmberEffect).toBeTruthy();
  expect(bubbleEffectsWithoutSummary).toEqual([]);
  expect(nonBubbleEffectsWithoutSummary).toEqual([]);
  expectRendererSummaryCatalogIntegrity(effects, [
    'agent-hoard-shimmer',
    'bond-lifecycle',
    'generic-event-arc',
    'generic-event-bubble',
    'generic-event-pulse',
    'hearth-ember',
    'home-collapse',
    'home-membership-join',
    'home-membership-leave',
    'home-vault-hoard',
    'life-transition',
    'shelter-use',
    'simulation-started',
  ]);
  const expectedGenericBubbleTypes = [
    'agent_paralyzed',
    'hearth_used',
    'home_collapsed',
    'home_joined',
    'home_left',
    'home_started_hoarding',
    'mating_proposal_invalidated',
    'mating_proposal_timeout',
    'mating_rejected',
  ];
  expect(genericBubbleTypes.length).toBeLessThanOrEqual(3);
  expect(expectedGenericBubbleTypes).toEqual(expect.arrayContaining(uniqueSorted(genericBubbleTypes)));
  expect(uniqueSorted(recentRenderedBeats
    .filter((beat) => beat.summaryKinds.includes('generic-event-bubble'))
    .map((beat) => beat.eventType))).toEqual(expectedGenericBubbleTypes);
  expect(uniqueSorted(genericPulseTypes)).toEqual([
    'agent_started_hoarding',
    'home_collapsed',
    'home_joined',
    'home_left',
    'home_started_hoarding',
    'mating_proposal_invalidated',
    'mating_proposal_timeout',
    'mating_rejected',
    'simulation_started',
  ]);
  expect(uniqueSorted(genericArcTypes)).toEqual([
    'home_joined',
    'home_left',
    'mating_proposal_invalidated',
    'mating_proposal_timeout',
    'mating_rejected',
  ]);
  for (const eventType of ['agent_started_hoarding', 'simulation_started']) {
    expect(genericBubbleTypes).not.toContain(eventType);
  }
  for (const eventType of ['agent_paralyzed', 'hearth_used']) {
    expect(genericPulseTypes).not.toContain(eventType);
  }
  for (const eventType of ['agent_paralyzed', 'agent_started_hoarding', 'hearth_used', 'simulation_started']) {
    expect(genericArcTypes).not.toContain(eventType);
  }
  expect(effects).toEqual(expect.arrayContaining([
    expect.objectContaining({ eventType: 'simulation_started', summary: expect.objectContaining({ kind: 'simulation-started' }) }),
  ]));
  expect(recentRenderedBeats.find((beat) => beat.eventType === 'agent_started_hoarding')?.summaryKinds).toContain('agent-hoard-bubble');
  expect(bondKinds).toEqual(expect.arrayContaining(['rejected', 'invalidated', 'timeout']));
  expect(paralyzedEffect.summary).toMatchObject({
    kind: 'life-transition',
    lifeEventKind: 'paralyzed',
    targetId: 'agent_002',
    regionName: 'nirvana_east',
    trigger: 'aging',
    energy: 3,
    motionCue: 'being-collapses-flame-falls',
    flameState: 'fallen',
    flameDropCue: true,
    paralysisCue: true,
    deathCue: false,
    decayCue: false,
    durableAgentMutated: false,
    targetStateMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(Number.isFinite(paralyzedEffect.summary.targetWorld[0])).toBe(true);
  expect(shelterEffect.summary).toMatchObject({
    actorId: 'agent_001',
    homeId: 'home_001',
    kind: 'shelter-use',
    motionCue: 'actor-threshold-enter-exit',
    motionMode: 'full',
    homeAnchored: true,
    proxyFigure: true,
    thresholdGlow: true,
    thresholdSmoke: true,
    thresholdLight: true,
    doorCue: true,
    doorOpen: true,
    doorStatic: false,
    windowGlow: true,
    smokeRateCue: true,
    reducedMotionShelterCue: false,
    thresholdTravel: true,
    swallowCue: true,
    proxyVisible: true,
    persistentOccupancy: false,
    actualActorMutated: false,
    homeStateMutated: false,
    selectionMutated: false,
    inspectorMutated: false,
    actorVisible: true,
  });
  expect(shelterEffect.summary.proxyOpacity).toBeGreaterThanOrEqual(0);
  expect(shelterEffect.summary.proxyOpacity).toBeLessThanOrEqual(0.08);
  expect(hearthEmberEffect.summary).toMatchObject({
    kind: 'hearth-ember',
    actorId: 'agent_001',
    homeId: 'home_001',
    regionName: 'warm_springs',
    materialsBurned: 8,
    energyGained: 8,
    agentEnergy: 92,
    agentMaterials: 14,
    motionCue: 'hearth-ember-glow-burst',
    motionMode: 'full',
    streamDirection: 'hearth-to-home-threshold',
    homeAnchored: true,
    hearthEmberCue: true,
    thresholdGlow: true,
    thresholdLight: true,
    worldBubbleCue: false,
    persistentOccupancy: false,
    actualActorMutated: false,
    durableAgentMutated: false,
    targetStateMutated: false,
    regionStateMutated: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    occupancyStateMutated: false,
    vaultStateMutated: false,
    controlsMutated: false,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expect(hearthEmberEffect.summary.actorVisible).toBe(true);
  expect(hearthEmberEffect.summary.emberMotes).toBeGreaterThan(0);
  expect(Number.isFinite(hearthEmberEffect.summary.homeWorld[0])).toBe(true);
  expect(Number.isFinite(hearthEmberEffect.summary.thresholdWorld[0])).toBe(true);
  expect(hearthEmberEffect.summary.thresholdWorld[0]).toBeCloseTo(shelterEffect.summary.thresholdWorld[0], 3);
  expect(hearthEmberEffect.summary.thresholdWorld[2]).toBeCloseTo(shelterEffect.summary.thresholdWorld[2], 3);
  for (const effect of genericBubbleEffects) {
    expectGenericBubbleEffectSummary(effect);
  }
  for (const effect of genericPulseEffects) {
    expectGenericPulseEffectSummary(effect);
  }
  for (const effect of genericArcEffects) {
    expectGenericArcEffectSummary(effect);
  }
  expect(joinEffect.summary).toMatchObject({
    kind: 'home-membership-join',
    homeEventKind: 'join',
    actorId: 'agent_002',
    homeId: 'home_001',
    newOwnerId: 'agent_001',
    stakeholderIds: ['agent_001', 'agent_002'],
    motionCue: 'actor-to-home-pledge-growth',
    streamDirection: 'actor-to-home',
    homeAnchored: true,
    membershipCue: true,
    pledgeCue: true,
    growthPreview: true,
    persistentOccupancy: false,
    actualActorMutated: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    ownerStateMutated: false,
    stakeholderStateMutated: false,
    vaultStateMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(joinEffect.summary.actorPathWorld).toHaveLength(2);
  expect(joinEffect.summary.actorVisible).toBe(true);

  expect(leaveEffect.summary).toMatchObject({
    kind: 'home-membership-leave',
    homeEventKind: 'left',
    actorId: 'agent_002',
    homeId: 'home_001',
    previousOwnerId: 'agent_001',
    newOwnerId: 'agent_001',
    previousStakeholderIds: ['agent_001', 'agent_002'],
    stakeholderIds: ['agent_001'],
    motionCue: 'home-to-actor-departure-shrink',
    streamDirection: 'home-to-actor',
    homeAnchored: true,
    membershipCue: true,
    departureCue: true,
    shrinkPreview: true,
    persistentOccupancy: false,
    actualActorMutated: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    ownerStateMutated: false,
    stakeholderStateMutated: false,
    vaultStateMutated: false,
  });
  expect(leaveEffect.summary.actorPathWorld).toHaveLength(2);

  expect(agentHoardEffect.summary).toMatchObject({
    kind: 'agent-hoard-shimmer',
    actorId: 'agent_001',
    regionName: 'warm_springs',
    energy: 510,
    agentMaterials: 12,
    motionCue: 'being-hoard-threshold-shimmer',
    motionMode: 'full',
    streamDirection: 'being-hoard-shimmer',
    beingHoardCue: true,
    hoardThresholdCue: true,
    hoardShimmerCue: true,
    vaultShimmer: false,
    resourceStream: false,
    actualActorMutated: false,
    targetStateMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(agentHoardEffect.summary.actorVisible).toBe(true);
  expect(agentHoardEffect.summary.resourceMotes).toBeGreaterThan(0);
  expect(Number.isFinite(agentHoardEffect.summary.actorWorld[0])).toBe(true);
  expect(startupEffect.group).toBe('system');
  expect(startupEffect.summary).toMatchObject({
    kind: 'simulation-started',
    motionCue: 'world-awakening-system-pulse',
    motionMode: 'full',
    systemEventKind: 'startup',
    systemCue: true,
    startupCue: true,
    worldAwakeningCue: true,
    startupPulseCue: true,
    passiveChronicleCue: true,
    worldBubbleCue: true,
    actualActorMutated: false,
    durableAgentMutated: false,
    targetStateMutated: false,
    regionStateMutated: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    liveStatusMutated: false,
    runMetadataMutated: false,
    replayArchiveMutated: false,
    controlsMutated: false,
    inspectorMutated: false,
    selectionMutated: false,
  });
  expect(Number.isFinite(startupEffect.summary.systemWorld[0])).toBe(true);
  for (const key of ['run_id', 'runId', 'worldTime', 'provider', 'model', 'prompt', 'systemPrompt', 'message', 'text', 'fullText']) {
    expect(Object.prototype.hasOwnProperty.call(startupEffect.summary, key)).toBe(false);
  }
  expect(recentRenderedBeats.find((beat) => beat.eventType === 'agent_started_hoarding')?.summaryKinds).toContain('agent-hoard-bubble');
  for (const summary of effects
    .filter((effect) => effect.summary?.kind === 'agent-hoard-shimmer')
    .map((effect) => effect.summary)) {
    expect(summary.resourceMotes).toBeGreaterThan(0);
    expect(summary.worldBubbleCue).toBe(false);
  }

  expect(hoardEffect.summary).toMatchObject({
    kind: 'home-vault-hoard',
    homeEventKind: 'hoard',
    actorId: 'agent_001',
    homeId: 'home_001',
    vaultMaterials: 320,
    motionCue: 'vault-threshold-shimmer',
    streamDirection: 'vault-shimmer',
    homeAnchored: true,
    vaultShimmer: true,
    hoardThresholdCue: true,
    vaultStream: true,
    persistentOccupancy: false,
    actualActorMutated: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    vaultStateMutated: false,
  });
  expect(hoardEffect.summary.goldMotes).toBeGreaterThan(0);
  expect(Number.isFinite(hoardEffect.summary.vaultWorld[0])).toBe(true);

  expect(collapseEffect.summary).toMatchObject({
    kind: 'home-collapse',
    homeEventKind: 'collapse',
    actorId: 'agent_001',
    homeId: 'home_001',
    newOwnerId: 'agent_001',
    stakeholderIds: ['agent_001'],
    vaultMaterials: 18,
    remnantMaterials: 49,
    motionCue: 'standing-home-fall-ruin-preview',
    streamDirection: 'home-to-ruin',
    homeAnchored: true,
    collapseCue: true,
    ruinPreview: true,
    standingHomeCue: true,
    persistentOccupancy: false,
    actualActorMutated: false,
    durableHomeMutated: false,
    homeStateMutated: false,
    ruinStateMutated: false,
    remnantStateMutated: false,
    ownerStateMutated: false,
    stakeholderStateMutated: false,
    vaultStateMutated: false,
  });
  expect(collapseEffect.summary.goldMotes).toBeGreaterThan(0);
  expect(countByType('hearth_used')).toBeGreaterThanOrEqual(2);
  expect(countByType('home_collapsed')).toBeGreaterThanOrEqual(2);
  await openAtlasSurface(page, 'world');
  const hearthDebug = await page.evaluate(() => {
    const debug = window.__vivariumWorld;
    return {
      agent: debug.agentVisualState('agent_001'),
      fallenAgent: debug.agentVisualState('agent_002'),
      home: debug.worldPointForHome('home_001'),
      homeScreen: debug.screenPointForHome('home_001'),
      homeVisual: debug.homeVisualState('home_001'),
      ruinVisual: debug.homeVisualState('home_old'),
      cursors: Array.from(debug.appliedEventCursors()),
      diagnostics: debug.effectLifecycleDiagnostics(),
      occupancyNodes: document.querySelectorAll(
        '[data-testid*="occup"], [data-testid*="resident"], .occupancy, .resident, [data-occupancy]',
      ).length,
      timelineButtons: document.querySelectorAll('.timeline-strip button').length,
    };
  });
  await openAtlasSurface(page, 'archive');
  const replayButtons = await page.locator('.replay-preview button').count();
  await page.keyboard.press('Escape');
  await waitForLiveWorldRenderer(page);
  const restoredLiveState = await page.evaluate(() => ({
    cursors: Array.from(window.__vivariumWorld.appliedEventCursors()),
    hearthEffects: window.__vivariumWorld.activeEffects()
      .filter((effect) => effect.eventType === 'hearth_used').length,
  }));
  expect(hearthDebug.agent.visible).toBe(true);
  expect(Number.isFinite(hearthDebug.agent.screen.x)).toBe(true);
  expect(hearthDebug.agent.visual.flameState).toBe('healthy');
  expect(hearthDebug.agent.visual.flameVisible).toBe(true);
  expect(hearthDebug.fallenAgent.visual.flameState).toBe('fallen');
  expect(hearthDebug.fallenAgent.visual.flameVisible).toBe(false);
  expect(hearthDebug.fallenAgent.visual.flameSmokeCue).toBe(true);
  expect(shelterEffect.summary.homeWorld[0]).toBeCloseTo(hearthDebug.home.x, 2);
  expect(shelterEffect.summary.homeWorld[2]).toBeCloseTo(hearthDebug.home.z, 2);
  expect(Math.abs(shelterEffect.summary.thresholdWorld[2] - hearthDebug.home.z)).toBeGreaterThan(0.25);
  expect(shelterEffect.summary).toMatchObject({
    motionMode: 'full',
    doorCue: true,
    doorStatic: false,
    windowGlow: true,
    smokeRateCue: true,
    thresholdTravel: true,
    swallowCue: true,
    proxyVisible: true,
    persistentOccupancy: false,
    actualActorMutated: false,
    homeStateMutated: false,
    selectionMutated: false,
    inspectorMutated: false,
  });
  expect(shelterEffect.summary.proxyOpacity).toBeGreaterThanOrEqual(0);
  expect(shelterEffect.summary.proxyOpacity).toBeLessThanOrEqual(0.08);
  expect(hearthDebug.homeVisual.ruined).toBe(false);
  expect(hearthDebug.homeVisual.stakeholderCount).toBe(1);
  expect(hearthDebug.homeVisual.vaultRatio).toBeCloseTo(14 / 300, 4);
  expect(hearthDebug.homeVisual.hoarding).toBe(false);
  expect(hearthDebug.homeVisual.leanToCount).toBe(0);
  expect(hearthDebug.homeVisual.pennantCount).toBe(0);
  expect(hearthDebug.ruinVisual.remnantRatio).toBeCloseTo(64 / 80, 4);
  expect(hearthDebug.cursors.filter((cursor) => cursor === 11)).toHaveLength(1);
  expect(new Set(hearthDebug.cursors).size).toBe(hearthDebug.cursors.length);
  expect(hearthDebug.occupancyNodes).toBe(0);
  expect(hearthDebug.timelineButtons).toBe(0);
  expect(replayButtons).toBe(0);
  await expect(page.locator('[data-event-type="agent_paralyzed"]').first()).toBeVisible();
  await expect(page.locator('[data-event-type="home_collapsed"]').first()).toBeVisible();
  const simulationStartedBubble = page.locator('.viv-event-bubble[data-event-type="simulation_started"]').first();
  await expect(simulationStartedBubble.locator('.viv-event-bubble-text')).toHaveText('world wakes');
  await expect(simulationStartedBubble).toHaveAttribute('data-event-detail-kind', 'world-wake');
  await expect(simulationStartedBubble.locator('.viv-event-bubble-detail')).toHaveText('3 beings awake');

  await clickStableProjectedWorldTarget(page, 'home', 'home_001');
  const inspector = page.locator('.inspector');
  await expect(inspector).toContainText('kept by Aster');
  await expect(inspector).toContainText('Tenders');
  await expect(inspector).toContainText('1');
  await expect(inspector).toContainText('Vault');
  await expect(inspector).toContainText('14');

  await page.evaluate((body) => window.__vivariumDispatchMockEventSource(body), lowFrequencyEnvelope);
  await page.waitForTimeout(150);
  const afterDuplicate = await page.evaluate(() => ({
    cursors: Array.from(window.__vivariumWorld.appliedEventCursors()),
    hearthEffects: window.__vivariumWorld.activeEffects().filter((effect) => effect.eventType === 'hearth_used').length,
  }));
  expect(afterDuplicate.cursors).toEqual(restoredLiveState.cursors);
  expect(new Set(afterDuplicate.cursors).size).toBe(afterDuplicate.cursors.length);
  expect(afterDuplicate.hearthEffects).toBe(restoredLiveState.hearthEffects);

  await page.waitForFunction(() => (
    !window.__vivariumWorld.activeEffects().some((effect) => effect.eventType === 'hearth_used')
  ));
  await page.waitForFunction(() => (
    !window.__vivariumWorld.activeEffects().some((effect) => [
      'home-membership-join',
      'home-membership-leave',
      'home-vault-hoard',
      'home-collapse',
    ].includes(effect.summary?.kind))
  ));
  const restoredState = await page.evaluate(() => ({
    actor: window.__vivariumWorld.agentVisualState('agent_001'),
    home: window.__vivariumWorld.homeVisualState('home_001'),
    diagnostics: window.__vivariumWorld.effectLifecycleDiagnostics(),
    occupancyNodes: document.querySelectorAll(
      '[data-testid*="occup"], [data-testid*="resident"], .occupancy, .resident, [data-occupancy]',
    ).length,
  }));
  const restoredActor = restoredState.actor;
  expect(restoredActor.visible).toBe(true);
  expect(restoredActor.world.x).toBeCloseTo(hearthDebug.agent.world.x, 5);
  expect(restoredActor.world.z).toBeCloseTo(hearthDebug.agent.world.z, 5);
  expect(restoredState.home).toMatchObject({
    ruined: false,
    stakeholderCount: 1,
    hoarding: false,
  });
  expect(restoredState.home.vaultRatio).toBeCloseTo(14 / 300, 4);
  expect(restoredState.occupancyNodes).toBe(0);
  expect(restoredState.diagnostics.disposedEffectGeometryCount)
    .toBeGreaterThan(hearthDebug.diagnostics.disposedEffectGeometryCount);
  expect(restoredState.diagnostics.disposedEffectMaterialCount)
    .toBeGreaterThan(hearthDebug.diagnostics.disposedEffectMaterialCount);
});

test('snapshot cursor suppresses stale retained event effects', async ({ page }) => {
  await bootApp(page, { width: 1440, height: 900 }, envelope, {
    ...world,
    event_cursor: 20,
  });
  await page.waitForTimeout(250);

  await page.evaluate((entry) => {
    window.__vivariumWorld.markSnapshotCursorHandled(20);
    window.__vivariumWorld.applyEventBeat(entry);
  }, envelope.events[0]);

  const effects = await page.evaluate(() => ({
    count: window.__vivariumWorld.eventEffectCount(),
    active: window.__vivariumWorld.activeEffects(),
    cursors: Array.from(window.__vivariumWorld.appliedEventCursors()),
  }));

  expect(effects.count).toBe(0);
  expect(effects.active).toEqual([]);
  expect(effects.cursors).toContain(20);
  expect(effects.cursors).not.toContain(5);
});

test('debug applyEventBeat forwards grouped chain context to active bubbles', async ({ page }) => {
  const quietEnvelope = {
    ...envelope,
    next_cursor: envelope.cursor,
    events: [],
  };
  const chainDetail = {
    kind: 'debug-chain',
    text: 'after breach',
    count: 2,
    window: '5-6',
  };

  await bootApp(page, { width: 1440, height: 900 }, quietEnvelope, {
    ...world,
    event_cursor: 4,
  });
  await page.waitForTimeout(250);

  await page.evaluate(({ entry, chain }) => {
    window.__vivariumWorld.applyEventBeat(entry, { chainDetail: chain });
  }, { entry: envelope.events[0], chain: chainDetail });
  await page.waitForFunction(() => (
    document
      .querySelector('.viv-event-bubble[data-event-type="speak"]')
      ?.getAttribute('data-event-chain-kind') === 'debug-chain'
  ));

  const debugState = await page.evaluate(() => {
    const bubble = document.querySelector('.viv-event-bubble[data-event-type="speak"]');
    const effect = window.__vivariumWorld.activeEffects()
      .find((entry) => entry.eventType === 'speak' && entry.bubble);
    return {
      chainKind: bubble?.getAttribute('data-event-chain-kind'),
      chainCount: bubble?.getAttribute('data-event-chain-count'),
      chainWindow: bubble?.getAttribute('data-event-chain-window'),
      chainText: bubble?.getAttribute('data-event-chain-text'),
      visibleChainText: bubble?.querySelector('.viv-event-bubble-chain')?.textContent?.trim(),
      debugChain: effect?.bubble?.chainDetail || null,
    };
  });

  expect(debugState).toMatchObject({
    chainKind: 'debug-chain',
    chainCount: '2',
    chainWindow: '5-6',
    chainText: 'after breach',
    visibleChainText: 'after breach',
    debugChain: chainDetail,
  });
});

test('recent rendered event beats record fresh visual effects without raw payloads', async ({ page }) => {
  const quietEnvelope = {
    ...envelope,
    next_cursor: envelope.cursor,
    events: [],
  };
  const staleEntry = {
    ...envelope.events[0],
    cursor: 5,
    event: {
      ...envelope.events[0].event,
      payload: {
        message: 'stale private provider prose /Users/example/runs/private/events.jsonl',
      },
    },
  };
  const freshEntry = {
    ...envelope.events[0],
    cursor: 6,
    event: {
      ...envelope.events[0].event,
      payload: {
        message: 'fresh private provider prose /Users/example/runs/private/events.jsonl',
      },
    },
  };

  await bootApp(page, { width: 1440, height: 900 }, quietEnvelope, {
    ...world,
    event_cursor: 4,
  });
  await page.waitForTimeout(250);

  const debugState = await page.evaluate(({ stale, fresh }) => {
    const debug = window.__vivariumWorld;
    debug.markSnapshotCursorHandled(5);
    debug.applyEventBeat(stale);
    debug.applyEventBeat(fresh);
    return {
      appliedCursors: debug.appliedEventCursors(),
      recentRenderedEventBeats: debug.recentRenderedEventBeats(),
      activeEffects: debug.activeEffects(),
    };
  }, { stale: staleEntry, fresh: freshEntry });

  expect(debugState.appliedCursors).toContain(5);
  expect(debugState.appliedCursors).toContain(6);
  expect(debugState.recentRenderedEventBeats.map((beat) => beat.cursor)).toEqual([6]);
  expect(debugState.recentRenderedEventBeats[0]).toMatchObject({
    cursor: 6,
    eventType: 'speak',
    group: 'speech',
    hasBubble: true,
    hasPulse: true,
  });
  expect(debugState.recentRenderedEventBeats[0].effectCountDelta).toBeGreaterThan(0);
  expect(debugState.recentRenderedEventBeats[0].summaryCount).toBeGreaterThan(0);
  expect(debugState.activeEffects.length).toBeGreaterThan(0);

  const serializedBeats = JSON.stringify(debugState.recentRenderedEventBeats);
  expect(serializedBeats).not.toContain('fresh private provider prose');
  expect(serializedBeats).not.toContain('stale private provider prose');
  expect(serializedBeats).not.toContain('/Users/example');
  expect(serializedBeats).not.toContain('payload');
  expect(serializedBeats).not.toContain('message');
});

test('rendered cursor memory only records effect-backed event beats', async ({ page }) => {
  const quietEnvelope = {
    ...envelope,
    next_cursor: envelope.cursor,
    events: [],
  };
  const anchorlessEntry = {
    cursor: 6,
    event: {
      type: 'weather_shifted',
      source: null,
      payload: {
        message: 'anchorless private provider prose /Users/example/runs/private/events.jsonl',
      },
      scope: 'global',
      region: null,
      target: null,
      timestamp: 20.1,
    },
    resolved: {},
    snapshot_after: null,
  };

  await bootApp(page, { width: 1440, height: 900 }, quietEnvelope, {
    ...world,
    event_cursor: 4,
  });
  await page.waitForTimeout(250);

  const debugState = await page.evaluate((entry) => {
    const debug = window.__vivariumWorld;
    debug.applyEventBeat(entry);
    debug.applyEventBeat(entry);
    return {
      eventEffectCount: debug.eventEffectCount(),
      appliedEventCursors: debug.appliedEventCursors(),
      renderedEventCursors: debug.renderedEventCursors(),
      recentRenderedEventBeats: debug.recentRenderedEventBeats(),
    };
  }, anchorlessEntry);

  expect(debugState.eventEffectCount).toBe(0);
  expect(debugState.appliedEventCursors).toContain(6);
  expect(debugState.appliedEventCursors.filter((cursor) => cursor === 6)).toHaveLength(1);
  expect(debugState.renderedEventCursors).not.toContain(6);
  expect(debugState.recentRenderedEventBeats.map((beat) => beat.cursor)).not.toContain(6);

  const serializedState = JSON.stringify(debugState);
  expect(serializedState).not.toContain('anchorless private provider prose');
  expect(serializedState).not.toContain('/Users/example');
});
