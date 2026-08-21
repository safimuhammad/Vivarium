import { describe, expect, it } from "vitest";

import { getChronicleManifest } from "../presentation/fixtures/chronicleCatalog";
import { planChronicleProgramBudget } from "./chronicleProgramBudget";

// Goldens below were re-derived twice from live current truth, both traced and
// explained (not papered over):
//   1. The R3 Task 5 actor-envelope change (BEING_CHIBI_GEOMETRY, 22x48 feet
//      (11,46), replacing the old wider LayeredHumanActor envelope) shifted
//      staging-point/gate placement geometry region recipes derive at
//      generation time, which shifted route waypoints/lengths and therefore
//      routeAwareTiming-derived durations for several programs.
//   2. C-fix-2 (.superpowers/sdd/c18-fix2-report.md) then changed
//      resolveMovementRoute's deferred single-chain arrival goal from an
//      unbounded region-wide hash pick to the nearest handful of staging
//      points to the gate -- shrinking exactly the arrival ("agent_entered_
//      region", chainKind "single") programs' route length/duration again,
//      on top of #1. Departure ("agent_left_region") programs are untouched
//      by C-fix-2 (see C02 cursor 11 below, unchanged) since that fix only
//      touches the arrival-goal fallback.
describe("chronicle program capture budget", () => {
  it("budgets C01 from its two split-envelope programs", () => {
    const manifest = getChronicleManifest("C01");
    const budget = planChronicleProgramBudget(manifest);

    // program[0] (agent_left_region, departure): was 42_278, unaffected by
    // C-fix-2 and unchanged across both goldens updates above. **Moved
    // 42_278 -> 9_633 by truncate-then-walk (2026-08-01)**, the third and last
    // re-derivation from live current truth. The departure walk is the one walk
    // that may neither be cut away (it carries the region transition's
    // transactional contract) nor left unbounded (measured on the real
    // recording it was ~31 s, 42% of all remaining stage demand), so its MIDDLE
    // is elided: the being is repositioned to a waypoint of its own certified
    // route, `WALK_MAX_DISTANCE_PX` back from the gate, and walks in from there.
    // The route metrics asserted below are the proof and the reason: this
    // program's route went 60 waypoints / 1_872 px -> 11 / **exactly 320 px**,
    // the threshold itself. The duration follows the route because
    // `routeAwareTiming` stretches a phase to cover the walk it contains.
    // program[1] (agent_entered_region, deferred single-chain arrival): R3
    // Task 5's envelope change first moved this 48_658 -> 37_195 (traced via
    // this same route-data mechanism); C-fix-2's nearest-staging-point fix
    // then moved it 37_195 -> 7_366 by replacing a region-wide hash-picked
    // arrival goal with one of the handful nearest the arrival gate. **It is
    // deliberately UNCHANGED at 7_366 by truncate-then-walk**: an arrival is
    // never truncated, because its first waypoint IS the gate the placement
    // hint publishes, so cutting it would move the gate. It is bounded at its
    // GOAL instead (`selectDeferredArrivalStagingPoint`) -- the only place that
    // can bound it without breaking the contract.
    expect(budget.programs.map(({ durationMs }) => durationMs)).toEqual([9_633, 7_366]);
    expect(budget).toMatchObject({
      // 49_644 -> 16_999 and 1_491 -> 511: the departure program's share only.
      durationMs: 16_999,
      frameCount: 511,
      programCount: 2,
      transactionCount: 1,
    });
    expect(budget.programs.map(({ firstCursor, lastCursor, eventType }) => (
      { firstCursor, lastCursor, eventType }
    ))).toEqual(manifest.entries.map((entry) => ({
      firstCursor: entry.cursor,
      lastCursor: entry.cursor,
      eventType: entry.event.type,
    })));
    expect(budget.programs.every(({ fallbackDiagnostics }) => fallbackDiagnostics.length === 0)).toBe(true);
    expect(budget.programs.map(({ maxRouteWaypoints, maxRouteLengthPixels }) => ({
      maxRouteWaypoints,
      maxRouteLengthPixels,
    }))).toEqual([
      // THE BOUND ITSELF, pinned as data: the departure's visible walk is now
      // exactly `WALK_MAX_DISTANCE_PX` (320 px, 10 tiles) instead of 1_872 px,
      // and its waypoint count fell 60 -> 11 with it. This assertion is what
      // makes the duration re-baseline above verifiable rather than asserted:
      // a departure that started walking the whole region again would show up
      // here first.
      { maxRouteWaypoints: 11, maxRouteLengthPixels: 320 },
      // The arrival is untouched, as it must be.
      { maxRouteWaypoints: 6, maxRouteLengthPixels: 138 },
    ]);
  });

  it("sums all twenty causally resolved C02 programs", () => {
    const budget = planChronicleProgramBudget(getChronicleManifest("C02"));

    // durationMs/frameCount reflect both re-derivations (see file header); the
    // per-program/per-metric spot checks below (cursor 11 departure, max
    // waypoints/length across all 20 programs) are unchanged by either --
    // C02's real route-length/waypoint maxima and its one directly-checked
    // departure program are not on the arrival-goal path C-fix-2 touched.
    //
    // KNOWN RED, DELIBERATELY NOT RE-BASELINED (2026-08-01). This pin protects
    // the exact serial presentation budget AS AN EQUALITY, so that any change to
    // how long the world takes to watch fails loudly. It did exactly that. The
    // gap now decomposes EXACTLY into two independent terms, measured by A/B on
    // the single `LocomotionPolicy` line at
    // `lifecycleMovementCommunicationResource.ts`'s departure call site:
    //   570_327 (pinned)
    //   - 364_625  truncate-then-walk, ATTRIBUTABLE and deliberate (see C01 above)
    //   -   2_394  the PRE-EXISTING, still-unattributed step this pin already
    //              carried before this work (it measured 567_933 against 570_327
    //              on the unchanged tree, byte-identical to the ledger's record)
    //   = 203_308 (measured now; frameCount 17_111 -> 6_101)
    // The 2_394 is not this work's to absorb: re-baselining to 203_308 would
    // silently swallow an unexplained drift that has been deliberately left
    // visible. So the number stays, and the red keeps meaning what it meant.
    // Whoever attributes the 2_394 can re-baseline both terms in one step; the
    // measured values are recorded here and in
    // `.superpowers/sdd/transition-bounding-report.md` so no re-measurement is
    // needed. The sibling test below carries the identical -364_625 / -2_394
    // split (551_057 -> 184_038, frameCount 16_533 -> 5_523), and the fact that
    // the attributable term is bit-identical across two differently-partitioned
    // budgets is itself evidence the change is the surgical one it claims to be.
    expect(budget).toMatchObject({
      durationMs: 570_327,
      frameCount: 17_111,
      programCount: 20,
      transactionCount: 10,
    });
    expect(budget.programs.find(({ cursor }) => cursor === 11)).toMatchObject({
      eventType: "agent_left_region",
      durationMs: 8_300,
      fallbackDiagnostics: [],
    });
    expect(budget.programs.every(({ fallbackDiagnostics }) => (
      fallbackDiagnostics.length === 0
    ))).toBe(true);
    expect(Math.max(...budget.programs.map(({ maxRouteWaypoints }) => maxRouteWaypoints))).toBe(113);
    expect(Math.max(...budget.programs.map(({ maxRouteLengthPixels }) => maxRouteLengthPixels))).toBe(3_584);
  });

  it("binds its semantics to the real split delivery partition", () => {
    const manifest = getChronicleManifest("C02");
    const paired = Array.from({ length: manifest.entries.length / 2 }, (_, index) => (
      manifest.entries.slice(index * 2, index * 2 + 2)
    ));

    const budget = planChronicleProgramBudget(manifest, { deliveryBatches: paired });
    expect(budget).toMatchObject({
      durationMs: 551_057,
      frameCount: 16_533,
      programCount: 10,
      transactionCount: 10,
    });
    expect(budget.programs.map(({ firstCursor, lastCursor }) => ({ firstCursor, lastCursor })))
      .toEqual(paired.map((batch) => ({
        firstCursor: batch[0]!.cursor,
        lastCursor: batch.at(-1)!.cursor,
      })));
    expect(budget.programs.every(({ fallbackDiagnostics }) => fallbackDiagnostics.length === 0)).toBe(true);
    expect(Math.max(...budget.programs.map(({ maxRouteWaypoints }) => maxRouteWaypoints))).toBe(113);
    expect(Math.max(...budget.programs.map(({ maxRouteLengthPixels }) => maxRouteLengthPixels))).toBe(3_584);
    expect(planChronicleProgramBudget(manifest).durationMs).not.toBe(budget.durationMs);
  });

  it("returns the minimal terminal frame after the exact serial duration", () => {
    const budget = planChronicleProgramBudget(getChronicleManifest("C02"));
    const frameMs = 1_000 / budget.fps;

    expect((budget.frameCount - 2) * frameMs).toBeLessThan(budget.durationMs);
    expect((budget.frameCount - 1) * frameMs).toBeGreaterThanOrEqual(budget.durationMs);
  });

  it("rejects malformed travel transaction order instead of estimating", () => {
    const manifest = getChronicleManifest("C02");
    const malformed = {
      ...manifest,
      entries: manifest.entries.slice(0, -1),
    };

    expect(() => planChronicleProgramBudget(malformed)).toThrow(/paired travel transaction/i);
  });

  it("rejects non-travel chronicles and invalid delivery partitions", () => {
    const manifest = getChronicleManifest("C02");

    expect(() => planChronicleProgramBudget(getChronicleManifest("C03")))
      .toThrow(/paired travel transaction/i);
    expect(() => planChronicleProgramBudget(manifest, { deliveryBatches: [] }))
      .toThrow(/cover every Chronicle entry/i);
    expect(() => planChronicleProgramBudget(manifest, {
      deliveryBatches: [[], ...manifest.entries.map((entry) => [entry])],
    })).toThrow(/must not be empty/i);
    expect(() => planChronicleProgramBudget(manifest, {
      deliveryBatches: [[manifest.entries[1]!], [manifest.entries[0]!]],
    })).toThrow(/cover every Chronicle entry|exact Chronicle evidence order/i);
  });

  it("rejects a travel route that has no authored directed edge", () => {
    const manifest = getChronicleManifest("C01");
    const agentId = manifest.entries[0]!.event.payload.agent_id;
    const unauthorized = {
      ...manifest,
      initialSnapshot: {
        ...manifest.initialSnapshot,
        agents: manifest.initialSnapshot.agents.map((agent) => (
          agent.id === agentId ? { ...agent, position: "nirvana_east" } : agent
        )),
      },
      entries: manifest.entries.map((entry) => ({
        ...entry,
        event: {
          ...entry.event,
          payload: {
            ...entry.event.payload,
            from_region: "nirvana_east",
            to_region: "nirvana_west",
          },
        },
      })),
    };

    expect(() => planChronicleProgramBudget(unauthorized))
      .toThrow(/fallback|authorized|directed/i);
  });

  it("rejects frame rates that cannot produce a finite safe frame count", () => {
    const manifest = getChronicleManifest("C01");

    expect(() => planChronicleProgramBudget(manifest, { fps: 0 })).toThrow(/fps/i);
    expect(() => planChronicleProgramBudget(manifest, { fps: Number.MAX_VALUE }))
      .toThrow(/frame count/i);
  });

  it("returns deeply frozen budget witnesses", () => {
    const budget = planChronicleProgramBudget(getChronicleManifest("C01"));

    expect(Object.isFrozen(budget)).toBe(true);
    expect(Object.isFrozen(budget.programs)).toBe(true);
    expect(budget.programs.every((program) => (
      Object.isFrozen(program) && Object.isFrozen(program.fallbackDiagnostics)
    ))).toBe(true);
  });
});
