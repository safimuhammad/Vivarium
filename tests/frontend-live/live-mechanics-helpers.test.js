const assert = require('node:assert/strict');
const test = require('node:test');

const {
  _test,
  expectMechanicsTheftReplayProof,
  expectThievedJoeHomeAftermath,
} = require('./live-mechanics-helpers');

test('mechanics theft proof tolerates repaired aftermath while replay proves zero-integrity theft', () => {
  const repairedAfterWorld = {
    agents: [
      {
        id: 'wanderer_001',
        home_id: 'home_joe',
      },
    ],
    homes: [
      {
        home_id: 'home_joe',
        owner_id: 'wanderer_001',
        region: 'warm_springs',
        status: 'standing',
        stakeholders: ['wanderer_001'],
        vault_materials: 0,
        integrity: 27.53,
        max_integrity: 100,
        breachers: ['wanderer_003'],
      },
    ],
  };
  const mechanicsEventRows = [
    {
      cursor: 16,
      type: 'home_breached',
      region: 'warm_springs',
      payload: {
        home_id: 'home_joe',
        target_home: 'home_joe',
        breacher_id: 'wanderer_003',
        intent: 'thieve',
        region: 'warm_springs',
        integrity: 0,
        breachers: ['wanderer_003'],
      },
    },
    {
      cursor: 17,
      type: 'home_thieved',
      region: 'warm_springs',
      payload: {
        home_id: 'home_joe',
        target_home: 'home_joe',
        breacher_id: 'wanderer_003',
        intent: 'thieve',
        region: 'warm_springs',
        recipients: ['wanderer_003'],
        loot: { materials: 60 },
        vault_materials: 0,
        integrity: 0,
      },
    },
  ];
  const mechanicsSnapshotRows = [
    {
      reason: 'event:home_thieved',
      event_cursor: 17,
      snapshot: {
        agents: [
          {
            id: 'wanderer_001',
            home_id: 'home_joe',
          },
        ],
        homes: [
          {
            home_id: 'home_joe',
            owner_id: 'wanderer_001',
            region: 'warm_springs',
            status: 'standing',
            stakeholders: ['wanderer_001'],
            vault_materials: 0,
            integrity: 0,
            max_integrity: 100,
            breachers: ['wanderer_003'],
          },
        ],
      },
    },
  ];

  assert(repairedAfterWorld.homes[0].integrity > 25);
  assert.doesNotThrow(() => expectThievedJoeHomeAftermath(repairedAfterWorld));
  assert.doesNotThrow(() => (
    expectMechanicsTheftReplayProof(mechanicsEventRows, mechanicsSnapshotRows)
  ));
});

test('mechanics theft proof rejects theft rows recorded before their breach', () => {
  const mechanicsEventRows = [
    {
      cursor: 18,
      type: 'home_breached',
      region: 'warm_springs',
      payload: {
        home_id: 'home_joe',
        breacher_id: 'wanderer_003',
        intent: 'thieve',
        region: 'warm_springs',
        integrity: 0,
        breachers: ['wanderer_003'],
      },
    },
    {
      cursor: 17,
      type: 'home_thieved',
      region: 'warm_springs',
      payload: {
        home_id: 'home_joe',
        breacher_id: 'wanderer_003',
        intent: 'thieve',
        region: 'warm_springs',
        recipients: ['wanderer_003'],
        loot: { materials: 60 },
        vault_materials: 0,
        integrity: 0,
      },
    },
  ];
  const mechanicsSnapshotRows = [
    {
      reason: 'event:home_thieved',
      event_cursor: 17,
      snapshot: {
        agents: [{ id: 'wanderer_001', home_id: 'home_joe' }],
        homes: [
          {
            home_id: 'home_joe',
            owner_id: 'wanderer_001',
            region: 'warm_springs',
            status: 'standing',
            stakeholders: ['wanderer_001'],
            vault_materials: 0,
            integrity: 0,
            max_integrity: 100,
            breachers: ['wanderer_003'],
          },
        ],
      },
    },
  ];

  assert.throws(
    () => expectMechanicsTheftReplayProof(mechanicsEventRows, mechanicsSnapshotRows),
    /deterministic home theft should be recorded after the thieve breach/,
  );
});

test('mechanics retained-density validator accepts post-expiry retained surfaces', () => {
  assert.deepEqual(
    _test.validateMechanicsRetainedDensityState(retainedDensityState()),
    [],
  );
});

test('mechanics selected-inspector validator accepts mechanics detail and grouped chain', () => {
  assert.deepEqual(
    _test.validateMechanicsSelectedInspectorState(retainedDensityState()),
    [],
  );
});

test('mechanics selected-inspector parser derives Mae paralysis chain window', () => {
  assert.deepEqual(
    _test.findMechanicsParalysisChain([
      mechanicsEvent(11, 'attack', {
        source: 'wanderer_001',
        target: 'wanderer_002',
        payload: { attacker_id: 'wanderer_001', victim_id: 'wanderer_002' },
      }),
      mechanicsEvent(12, 'agent_paralyzed', {
        source: 'wanderer_002',
        target: 'wanderer_002',
        payload: { agent_id: 'wanderer_002', victim_id: 'wanderer_002' },
      }),
      mechanicsEvent(13, 'attack', {
        source: 'wanderer_001',
        target: 'wanderer_003',
        payload: { attacker_id: 'wanderer_001', victim_id: 'wanderer_003' },
      }),
    ], {
      start_cursor: 10,
      end_cursor: 20,
    }),
    {
      attackCursor: 11,
      paralyzedCursor: 12,
      chainWindow: '11-12',
    },
  );
});

test('mechanics selected-inspector parser rejects missing pre-paralysis attack', () => {
  assert.throws(
    () => _test.findMechanicsParalysisChain([
      mechanicsEvent(11, 'agent_paralyzed', {
        source: 'wanderer_002',
        target: 'wanderer_002',
        payload: { agent_id: 'wanderer_002', victim_id: 'wanderer_002' },
      }),
      mechanicsEvent(12, 'attack', {
        source: 'wanderer_001',
        target: 'wanderer_002',
        payload: { attacker_id: 'wanderer_001', victim_id: 'wanderer_002' },
      }),
    ], {
      start_cursor: 10,
      end_cursor: 20,
    }),
    /mechanics events should include Joe attacking Mae before the paralysis event/,
  );
});

test('mechanics selected-inspector parser rejects reversed attack direction', () => {
  assert.throws(
    () => _test.findMechanicsParalysisChain([
      mechanicsEvent(11, 'attack', {
        source: 'wanderer_002',
        target: 'wanderer_001',
        payload: { attacker_id: 'wanderer_002', victim_id: 'wanderer_001' },
      }),
      mechanicsEvent(12, 'agent_paralyzed', {
        source: 'system',
        target: 'wanderer_002',
        payload: {
          agent_id: 'wanderer_002',
          victim_id: 'wanderer_002',
          attacker_id: 'wanderer_001',
        },
      }),
    ], {
      start_cursor: 10,
      end_cursor: 20,
    }),
    /mechanics events should include Joe attacking Mae before the paralysis event/,
  );
});

test('mechanics selected-structure parser derives home shelter raid and ruin chains', () => {
  assert.deepEqual(
    _test.findMechanicsStructureChains(mechanicsStructureEvents(), {
      start_cursor: 10,
      end_cursor: 40,
    }),
    {
      joeHomeId: 'home_joe',
      buildCursor: 11,
      joinedCursor: 12,
      leftCursor: 13,
      hearthCursor: 14,
      thieveBreachCursor: 15,
      thievedCursor: 16,
      theftMaterials: 60,
      theftChainWindow: '15-16',
      colonizeHomeId: 'test_colonize_home',
      colonizeBreachCursor: 17,
      colonizedCursor: 18,
      colonizeChainWindow: '17-18',
      hoardCursor: 19,
      ruinHomeId: 'test_ruin_home',
      scavengeCursor: 20,
      scavengeMaterials: 12,
    },
  );
});

test('mechanics selected-structure parser rejects theft before thieve breach', () => {
  assert.throws(
    () => _test.findMechanicsStructureChains([
      ...mechanicsStructureEvents().filter((entry) => ![15, 16].includes(entry.cursor)),
      mechanicsEvent(15, 'home_thieved', {
        payload: {
          home_id: 'home_joe',
          target_home: 'home_joe',
          intent: 'thieve',
          breacher_id: 'wanderer_003',
          recipients: ['wanderer_003'],
          loot: { materials: 60 },
        },
      }),
      mechanicsEvent(16, 'home_breached', {
        payload: {
          home_id: 'home_joe',
          target_home: 'home_joe',
          intent: 'thieve',
          breacher_id: 'wanderer_003',
        },
      }),
    ], {
      start_cursor: 10,
      end_cursor: 40,
    }),
    /mechanics events should include Joe home theft after the thieve breach/,
  );
});

test('mechanics selected-structure parser rejects colonize terminal with wrong new owner', () => {
  assert.throws(
    () => _test.findMechanicsStructureChains(
      mechanicsStructureEvents().map((entry) => (
        entry.cursor === 18
          ? mechanicsEvent(18, 'home_colonized', {
            payload: {
              home_id: 'test_colonize_home',
              target_home: 'test_colonize_home',
              intent: 'colonize',
              breacher_id: 'wanderer_003',
              new_owner_id: 'wanderer_002',
            },
          })
          : entry
      )),
      {
        start_cursor: 10,
        end_cursor: 40,
      },
    ),
    /mechanics events should include test home colonization after the colonize breach/,
  );
});

test('mechanics selected-structure parser rejects missing ruin scavenge payload', () => {
  assert.throws(
    () => _test.findMechanicsStructureChains(
      mechanicsStructureEvents().map((entry) => (
        entry.cursor === 20
          ? mechanicsEvent(20, 'ruins_scavenged', {
            payload: {
              home_id: 'test_ruin_home',
              target_home: 'test_ruin_home',
              agent_id: 'wanderer_003',
              resource_type: 'energy',
              amount: 12,
            },
          })
          : entry
      )),
      {
        start_cursor: 10,
        end_cursor: 40,
      },
    ),
    /mechanics events should include Dick scavenging the test ruin/,
  );
});

test('mechanics selected-region parser derives mixed warm-springs story', () => {
  assert.deepEqual(
    _test.findMechanicsRegionTrail(mechanicsRegionEvents(), {
      start_cursor: 9,
      end_cursor: 40,
    }),
    {
      joeHomeId: 'home_joe',
      buildCursor: 11,
      joinedCursor: 12,
      leftCursor: 13,
      hearthCursor: 14,
      thieveBreachCursor: 15,
      thievedCursor: 16,
      theftMaterials: 60,
      theftChainWindow: '15-16',
      colonizeHomeId: 'test_colonize_home',
      colonizeBreachCursor: 17,
      colonizedCursor: 18,
      colonizeChainWindow: '17-18',
      hoardCursor: 19,
      ruinHomeId: 'test_ruin_home',
      scavengeCursor: 20,
      scavengeMaterials: 12,
      speechCursor: 10,
      movementLeftCursor: 21,
      movementEnteredCursor: 22,
      movementChainWindow: '21-22',
      rejectedOfferCursor: 23,
      rejectedCursor: 24,
      invalidatedOfferCursor: 25,
      invalidatedCursor: 28,
      acceptedOfferCursor: 29,
      timeoutOfferCursor: 31,
      timeoutCursor: 32,
      birthCursor: 30,
      decayedCursor: 33,
      collapsedCursor: 34,
      attackCursor: 35,
      paralyzedCursor: 36,
      paralysisChainWindow: '35-36',
      deathCursor: 37,
    },
  );
});

test('mechanics selected-region parser requires targeted bond rows to be regionless', () => {
  assert.throws(
    () => _test.findMechanicsRegionTrail(
      mechanicsRegionEvents().map((entry) => (
        entry.cursor === 23
          ? mechanicsEvent(23, 'mating_initiated', {
            source: 'wanderer_001',
            target: 'wanderer_002',
            payload: {
              message: 'A deterministic test proposal.',
              initiator_id: 'wanderer_001',
              target_id: 'wanderer_002',
              resources: { energy: 50, materials: 30 },
            },
            resolved: { region: 'warm_springs' },
          })
          : entry
      )),
      {
        start_cursor: 9,
        end_cursor: 40,
      },
    ),
    /Joe-to-Mae rejected offer should rely on participant snapshot positions/,
  );
});

test('mechanics selected-region parser rejects birth outside Joe and Mae pair', () => {
  assert.throws(
    () => _test.findMechanicsRegionTrail(
      mechanicsRegionEvents().map((entry) => (
        entry.cursor === 30
          ? mechanicsEvent(30, 'agent_born', {
            payload: {
              child_id: 'child_wrong',
              child_name: 'Wrong',
              parent_ids: ['wanderer_001', 'wanderer_004'],
              region: 'warm_springs',
            },
          })
          : entry
      )),
      {
        start_cursor: 9,
        end_cursor: 40,
      },
    ),
    /mechanics events should include Joe and Mae birth in warm_springs/,
  );
});

test('mechanics selected-region parser rejects death before Mae paralysis', () => {
  assert.throws(
    () => _test.findMechanicsRegionTrail(
      mechanicsRegionEvents().map((entry) => (
        entry.cursor === 37
          ? mechanicsEvent(35.5, 'agent_died', {
            payload: {
              victim_id: 'wanderer_003',
              killer_id: 'wanderer_001',
              region: 'warm_springs',
            },
          })
          : entry
      )),
      {
        start_cursor: 9,
        end_cursor: 40,
      },
    ),
    /mechanics death should be recorded after Mae paralysis/,
  );
});

test('mechanics selected-region parser rejects missing movement arrival after departure', () => {
  assert.throws(
    () => _test.findMechanicsRegionTrail(
      mechanicsRegionEvents().map((entry) => (
        entry.cursor === 22
          ? mechanicsEvent(22, 'agent_entered_region', {
            source: 'wanderer_003',
            payload: {
              agent_id: 'wanderer_003',
              from_region: 'nirvana',
              to_region: 'nirvana_east',
            },
          })
          : entry
      )),
      {
        start_cursor: 9,
        end_cursor: 40,
      },
    ),
    /mechanics events should include Dick arriving in warm_springs after departure/,
  );
});

test('mechanics retained-density validator rejects bubbles leaks metadata drift and controls', () => {
  const state = retainedDensityState({
    activeBubbleCount: 1,
    activeBubbleEffectCount: 1,
    livePulse: {
      ...retainedSurface({ cursor: 19, type: 'agent_decayed' }),
      latestCursor: 18,
    },
    liveNow: {
      state: 'retained',
      cursor: 20,
      type: 'home_built',
      visible: true,
      cues: [{ cursor: 19, type: 'agent_decayed', visible: true }],
    },
    focusPulse: {
      ...retainedSurface({ cursor: 17, type: 'home_built' }),
      state: 'quiet',
    },
    controls: {
      chronicle: 1,
      livePulse: 0,
      liveNow: 0,
      focusPulse: 0,
      seekCopy: true,
    },
    retainedCopyLeaks: ['agent_001 raw label'],
    archive: {
      before: { 'data-archive-status': 'ready' },
      after: { 'data-archive-status': 'loading' },
    },
  });

  assert.deepEqual(
    _test.validateMechanicsRetainedDensityState(state),
    [
      'active world bubbles should expire before retained-density proof',
      'World pulse parent retained metadata should match latest row metadata',
      'Now retained metadata should match a visible cue',
      'Focus pulse should expose retained state',
      'chronicle should not introduce controls or dialogs',
      'retained live smoke should not expose seek/scrub/playback copy',
      'retained live surface attributes should not expose backend/raw vocabulary',
      'archive chronicle metadata should not mutate during retained-density expiry wait',
    ],
  );
});

test('mechanics retained-density validator rejects cursors before the burst end', () => {
  assert.deepEqual(
    _test.validateMechanicsRetainedDensityState(retainedDensityState({
      diagnostics: {
        connection: 'live',
        eventCursor: 19,
        stream: { active: true },
      },
    })),
    ['live event cursor should reach the mechanics burst end cursor'],
  );
});

test('mechanics retained-density validator rejects stale out-of-window renderer cursor proof', () => {
  assert.deepEqual(
    _test.validateMechanicsRetainedDensityState(retainedDensityState({
      chronicleRows: [
        eventRow({ cursor: 8, type: 'speak' }),
        eventRow({ cursor: 19, type: 'agent_decayed' }),
      ],
      mechanicsRows: [
        eventRow({ cursor: 19, type: 'agent_decayed' }),
      ],
      recentRenderedEventBeats: [
        { cursor: 8, eventType: 'speak', hasBubble: true },
      ],
      renderedEventCursors: [8],
    })),
    ['renderer rendered cursor memory should retain a mechanics burst event row'],
  );
});

test('mechanics retained-density validator rejects selected inspector summary drift', () => {
  assert.deepEqual(
    _test.validateMechanicsSelectedInspectorState(retainedDensityState({
      selectedInspector: {
        visible: true,
        eventRows: [
          selectedInspectorEventRow({
            cursor: 8,
            detailVisible: false,
            detailDomCount: 0,
            chainVisible: false,
            chainDomCount: 0,
          }),
        ],
        gapRows: [
          {
            visible: true,
            textLength: 18,
            eventAttributeCount: 1,
            detailDomCount: 1,
            chainDomCount: 1,
            medallionCount: 1,
          },
        ],
      },
    })),
    [
      'selected inspector recent trail should retain at least one mechanics event summary',
      'selected inspector mechanics summaries should stay visible and well-formed',
      'selected inspector should expose compact detail on a retained mechanics summary',
      'selected inspector should expose grouped-chain copy on a retained mechanics summary',
      'selected inspector gap rows should stay passive and metadata-free',
    ],
  );
});

function retainedDensityState(overrides = {}) {
  return {
    startCursor: 10,
    endCursor: 20,
    diagnostics: {
      connection: 'live',
      eventCursor: 21,
      stream: { active: true },
    },
    activeBubbleCount: 0,
    activeBubbleEffectCount: 0,
    chronicleRows: [
      eventRow({ cursor: 19, type: 'agent_decayed' }),
    ],
    mechanicsRows: [
      eventRow({ cursor: 19, type: 'agent_decayed' }),
    ],
    renderedEventCursors: [19],
    recentRenderedEventBeats: [
      { cursor: 19, eventType: 'agent_decayed', hasBubble: true },
    ],
    livePulse: retainedSurface({ cursor: 19, type: 'agent_decayed' }),
    liveNow: {
      state: 'retained',
      cursor: 19,
      type: 'agent_decayed',
      visible: true,
      cues: [{ cursor: 19, type: 'agent_decayed', visible: true }],
    },
    focusPulse: retainedSurface({ cursor: 17, type: 'home_built' }),
    selectedInspector: {
      visible: true,
      eventRows: [
        selectedInspectorEventRow(),
      ],
      gapRows: [
        {
          visible: true,
          textLength: 18,
          eventAttributeCount: 0,
          detailDomCount: 0,
          chainDomCount: 0,
          medallionCount: 0,
        },
      ],
    },
    controls: {
      chronicle: 0,
      livePulse: 0,
      liveNow: 0,
      focusPulse: 0,
      inspectorRecent: 0,
      seekCopy: false,
    },
    clipIssues: [],
    retainedCopyLeaks: [],
    archive: {
      before: { 'data-archive-status': 'ready', 'data-archive-event-count': '10' },
      after: { 'data-archive-status': 'ready', 'data-archive-event-count': '10' },
    },
    ...overrides,
  };
}

function eventRow(overrides = {}) {
  return {
    cursor: 19,
    type: 'agent_decayed',
    group: 'life',
    tone: 'grave',
    visible: true,
    textLength: 24,
    ...overrides,
  };
}

function retainedSurface({ cursor, type }) {
  return {
    state: 'retained',
    cursor,
    type,
    visible: true,
    latestVisible: true,
    latestCursor: cursor,
    latestType: type,
  };
}

function selectedInspectorEventRow(overrides = {}) {
  return {
    ...eventRow({ cursor: 18, type: 'home_thieved', group: 'raid', tone: 'danger' }),
    detailKind: 'theft',
    detailText: '14 materials taken',
    detailVisible: true,
    detailDomCount: 1,
    chainKind: 'breach-theft',
    chainCount: 2,
    chainWindow: '17-18',
    chainText: 'after breach',
    chainVisible: true,
    chainDomCount: 1,
    medallionCount: 1,
    ...overrides,
  };
}

function mechanicsStructureEvents() {
  return [
    mechanicsEvent(11, 'home_built', {
      payload: {
        home_id: 'home_joe',
        target_home: 'home_joe',
        builder_id: 'wanderer_001',
        owner_id: 'wanderer_001',
        region: 'warm_springs',
      },
    }),
    mechanicsEvent(12, 'home_joined', {
      payload: {
        home_id: 'home_joe',
        target_home: 'home_joe',
        agent_id: 'wanderer_002',
      },
    }),
    mechanicsEvent(13, 'home_left', {
      payload: {
        home_id: 'home_joe',
        target_home: 'home_joe',
        agent_id: 'wanderer_002',
      },
    }),
    mechanicsEvent(14, 'hearth_used', {
      payload: {
        home_id: 'home_joe',
        target_home: 'home_joe',
        agent_id: 'wanderer_001',
      },
    }),
    mechanicsEvent(15, 'home_breached', {
      payload: {
        home_id: 'home_joe',
        target_home: 'home_joe',
        intent: 'thieve',
        breacher_id: 'wanderer_003',
      },
    }),
    mechanicsEvent(16, 'home_thieved', {
      payload: {
        home_id: 'home_joe',
        target_home: 'home_joe',
        intent: 'thieve',
        breacher_id: 'wanderer_003',
        recipients: ['wanderer_003'],
        loot: { materials: 60 },
      },
    }),
    mechanicsEvent(17, 'home_breached', {
      payload: {
        home_id: 'test_colonize_home',
        target_home: 'test_colonize_home',
        intent: 'colonize',
        breacher_id: 'wanderer_003',
      },
    }),
    mechanicsEvent(18, 'home_colonized', {
      payload: {
        home_id: 'test_colonize_home',
        target_home: 'test_colonize_home',
        intent: 'colonize',
        breacher_id: 'wanderer_003',
        new_owner_id: 'wanderer_003',
      },
    }),
    mechanicsEvent(19, 'home_started_hoarding', {
      payload: {
        home_id: 'test_colonize_home',
        target_home: 'test_colonize_home',
        agent_id: 'wanderer_003',
        vault_materials: 340,
      },
    }),
    mechanicsEvent(20, 'ruins_scavenged', {
      payload: {
        home_id: 'test_ruin_home',
        target_home: 'test_ruin_home',
        agent_id: 'wanderer_003',
        resource_type: 'materials',
        amount: 12,
      },
    }),
  ];
}

function mechanicsRegionEvents() {
  return [
    mechanicsEvent(10, 'speak', {
      source: 'wanderer_001',
      payload: {
        speaker_id: 'wanderer_001',
        region: 'warm_springs',
        message: 'The deterministic springs are awake.',
      },
    }),
    ...mechanicsStructureEvents(),
    mechanicsEvent(21, 'agent_left_region', {
      source: 'wanderer_003',
      payload: {
        agent_id: 'wanderer_003',
        from_region: 'nirvana',
        to_region: 'warm_springs',
      },
    }),
    mechanicsEvent(22, 'agent_entered_region', {
      source: 'wanderer_003',
      payload: {
        agent_id: 'wanderer_003',
        from_region: 'nirvana',
        to_region: 'warm_springs',
      },
      resolved: {
        region: 'warm_springs',
      },
    }),
    mechanicsEvent(23, 'mating_initiated', {
      source: 'wanderer_001',
      target: 'wanderer_002',
      payload: {
        message: 'A deterministic test proposal.',
        initiator_id: 'wanderer_001',
        target_id: 'wanderer_002',
        resources: { energy: 50, materials: 30 },
      },
    }),
    mechanicsEvent(24, 'mating_rejected', {
      source: 'wanderer_002',
      target: 'wanderer_001',
      payload: {
        message: 'A deterministic test rejection.',
        rejecter_id: 'wanderer_002',
        initiator_id: 'wanderer_001',
        target_id: 'wanderer_002',
        resources_refunded: { energy: 50, materials: 30 },
      },
    }),
    mechanicsEvent(25, 'mating_initiated', {
      source: 'wanderer_001',
      target: 'wanderer_002',
      payload: {
        message: 'A deterministic proposal that will fall through.',
        initiator_id: 'wanderer_001',
        target_id: 'wanderer_002',
        resources: { energy: 50, materials: 30 },
      },
    }),
    mechanicsEvent(26, 'mating_initiated', {
      source: 'wanderer_001',
      target: 'wanderer_004',
      payload: {
        message: 'A deterministic proposal that changes eligibility.',
        initiator_id: 'wanderer_001',
        target_id: 'wanderer_004',
        resources: { energy: 50, materials: 30 },
      },
    }),
    mechanicsEvent(27, 'agent_born', {
      payload: {
        child_id: 'child_joe_allen',
        child_name: 'Side',
        parent_ids: ['wanderer_001', 'wanderer_004'],
        region: 'warm_springs',
      },
    }),
    mechanicsEvent(28, 'mating_proposal_invalidated', {
      source: 'wanderer_001',
      target: 'wanderer_001',
      payload: {
        initiator_id: 'wanderer_001',
        target_id: 'wanderer_002',
        reason: 'initiator_ineligible',
        resources_refunded: { energy: 50, materials: 30 },
      },
    }),
    mechanicsEvent(29, 'mating_initiated', {
      source: 'wanderer_001',
      target: 'wanderer_002',
      payload: {
        message: 'A deterministic accepted proposal.',
        initiator_id: 'wanderer_001',
        target_id: 'wanderer_002',
        resources: { energy: 50, materials: 30 },
      },
    }),
    mechanicsEvent(30, 'agent_born', {
      payload: {
        child_id: 'child_joe_mae',
        child_name: 'Kelsey',
        parent_ids: ['wanderer_001', 'wanderer_002'],
        region: 'warm_springs',
      },
    }),
    mechanicsEvent(31, 'mating_initiated', {
      source: 'wanderer_003',
      target: 'wanderer_004',
      payload: {
        message: 'A deterministic proposal that will lapse.',
        initiator_id: 'wanderer_003',
        target_id: 'wanderer_004',
        resources: { energy: 50, materials: 30 },
      },
    }),
    mechanicsEvent(32, 'mating_proposal_timeout', {
      source: 'wanderer_003',
      target: 'wanderer_003',
      payload: {
        initiator_id: 'wanderer_003',
        target_id: 'wanderer_004',
        reason: 'timeout',
        resources_refunded: { energy: 50, materials: 30 },
      },
    }),
    mechanicsEvent(33, 'agent_decayed', {
      payload: {
        agent_id: 'test_decayed_agent',
        agent_name: 'Faded Witness',
        region: 'warm_springs',
      },
    }),
    mechanicsEvent(34, 'home_collapsed', {
      payload: {
        home_id: 'test_collapse_home',
        target_home: 'test_collapse_home',
        region: 'warm_springs',
      },
    }),
    mechanicsEvent(35, 'attack', {
      source: 'wanderer_001',
      target: 'wanderer_002',
      payload: {
        attacker_id: 'wanderer_001',
        victim_id: 'wanderer_002',
        region: 'warm_springs',
      },
    }),
    mechanicsEvent(36, 'agent_paralyzed', {
      target: 'wanderer_002',
      payload: {
        agent_id: 'wanderer_002',
        victim_id: 'wanderer_002',
        attacker_id: 'wanderer_001',
        region: 'warm_springs',
      },
    }),
    mechanicsEvent(37, 'agent_died', {
      payload: {
        victim_id: 'wanderer_003',
        killer_id: 'wanderer_001',
        region: 'warm_springs',
      },
    }),
  ];
}

function mechanicsEvent(cursor, type, overrides = {}) {
  return {
    cursor,
    event: {
      type,
      source: overrides.source ?? '',
      target: overrides.target ?? '',
      payload: overrides.payload ?? {},
    },
    resolved: overrides.resolved ?? {},
  };
}
