import { parseAgentSnapshot, type EventEnvelopeEntry } from "../app/schemas";
import type { ChronicleManifest } from "../presentation/fixtures/chronicleCatalog";
import { BeatDirector, type StoryMoment } from "../presentation/BeatDirector";
import type { PresentedObserverFrame } from "../presentation/contracts";
import { parsePresentedEvent, type PresentedEventType } from "../presentation/eventPayloads";
import { PresentedWorldModel } from "../presentation/PresentedWorldModel";
import { createChoreographyProgramResolver } from "../presentation/choreography/registry";
import { createRegionMapIdentity } from "../renderer2d/production/maps/RegionMapIdentity";
import type { RegionMapRecipeV1 } from "../renderer2d/production/maps/RegionMapRecipe";
import { createProductionRegionMapRecipe } from "../renderer2d/production/maps/ProductionRegionMapRecipe";
import { PlacementLedger } from "../renderer2d/production/placement/PlacementLedger";

const DEFAULT_CAPTURE_FPS = 30;
const ALLOWED_TRAVEL_DIAGNOSTICS = new Set([
  "legal-directed-path",
  "arrival-placement-deferred",
]);

export interface ChronicleProgramBudgetWitness {
  readonly cursor: number;
  readonly firstCursor: number;
  readonly lastCursor: number;
  readonly eventType: PresentedEventType;
  readonly chainKind: StoryMoment["chainKind"];
  readonly durationMs: number;
  readonly maxRouteWaypoints: number;
  readonly maxRouteLengthPixels: number;
  readonly fallbackDiagnostics: readonly string[];
}

export interface ChronicleProgramBudget {
  readonly durationMs: number;
  readonly frameCount: number;
  readonly fps: number;
  readonly programCount: number;
  readonly transactionCount: number;
  readonly programs: readonly ChronicleProgramBudgetWitness[];
}

export interface ChronicleProgramBudgetOptions {
  readonly fps?: number;
  readonly deliveryBatches?: readonly (readonly EventEnvelopeEntry[])[];
}

/**
 * Derive the exact serial presentation budget for a travel Chronicle.
 *
 * The planner uses the same seeded recipes, append-stable placement ledger, event
 * projector, envelope grouping, and production choreography resolver as the mounted
 * observer. Arrival consequences are committed before resolving the next departure.
 */
export function planChronicleProgramBudget(
  manifest: ChronicleManifest,
  options: ChronicleProgramBudgetOptions = {},
): ChronicleProgramBudget {
  const fps = options.fps ?? DEFAULT_CAPTURE_FPS;
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError("capture fps must be finite and positive");
  const transactions = validateTravelTransactions(manifest.entries);
  const batches = options.deliveryBatches ?? manifest.entries.map((entry) => [entry]);
  validateDeliveryPartition(manifest.entries, batches);

  const recipes = regionRecipes(manifest);
  const ledger = PlacementLedger.reconstruct([...recipes.values()], {
    agents: manifest.initialSnapshot.agents,
    homes: manifest.initialSnapshot.homes,
  });
  const model = new PresentedWorldModel(manifest.initialSnapshot, {
    runId: manifest.runId,
    sourceKey: `fixture:${manifest.runId}`,
    revision: 1,
    firstCursor: manifest.initialSnapshot.event_cursor,
    lastCursor: manifest.initialSnapshot.event_cursor,
  });
  let revision = 1;
  let presentedCursor = manifest.initialSnapshot.event_cursor;
  const frame = (): PresentedObserverFrame => ({
    runId: manifest.runId,
    sourceKey: `fixture:${manifest.runId}`,
    revision,
    firstCursor: presentedCursor,
    lastCursor: presentedCursor,
    source: "fixture",
    ingestedCursor: presentedCursor,
    presentedCursor,
    world: model.getView(),
    scene: null,
    selection: null,
    backlog: {
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Caught up",
    },
    transport: { connection: "live", ingestedCursor: presentedCursor, retryable: true },
  });
  const resolver = createChoreographyProgramResolver({
    getFrame: frame,
    getPlacement: () => ledger.snapshot(),
    getRecipes: () => recipes,
    reducedMotion: () => false,
    // Wired for the same reason `PresentationSession`'s live path is: a real `PlacementLedger`
    // already exists right here. Has no effect on the checked-in C01/C02 goldens today -- neither
    // fixture contains a home-contest event, so `homeContestSystem.ts`'s predicted-spread-hop
    // predicate (the only consumer of this accessor) is never reached -- but keeps this capture
    // tool honest for any future chronicle that does contest a home.
    getNavigationGrid: (regionId) => ledger.navigationGridFor(regionId),
  });
  const director = new BeatDirector();
  const programs: ChronicleProgramBudgetWitness[] = [];

  for (const batch of batches) {
    const moments = director.group(batch);
    for (const moment of moments) {
      const program = resolver.resolve(moment);
      const fallbackDiagnostics = program.diagnostics
        .map(({ code }) => code)
        .filter((code) => !ALLOWED_TRAVEL_DIAGNOSTICS.has(code));
      if (fallbackDiagnostics.length > 0) {
        throw new Error(`travel choreography fallback at cursor ${moment.representative.cursor}: ${fallbackDiagnostics.join(",")}`);
      }
      programs.push(Object.freeze({
        cursor: moment.representative.cursor,
        firstCursor: moment.firstCursor,
        lastCursor: moment.lastCursor,
        eventType: program.eventType,
        chainKind: moment.chainKind,
        durationMs: program.durationMs,
        ...routeMetrics(program.phases),
        fallbackDiagnostics: Object.freeze(fallbackDiagnostics),
      }));

      model.applyEvidence(moment.evidence);
      commitArrivalPlacement(moment, model, ledger);
      presentedCursor = moment.lastCursor;
      revision += 1;
    }
  }

  const durationMs = programs.reduce((total, program) => total + program.durationMs, 0);
  const frameCount = Math.ceil(durationMs * fps / 1_000) + 1;
  if (!Number.isSafeInteger(frameCount) || frameCount < 2) {
    throw new RangeError("capture frame count must be a finite safe integer of at least two");
  }
  return Object.freeze({
    durationMs,
    frameCount,
    fps,
    programCount: programs.length,
    transactionCount: transactions,
    programs: Object.freeze(programs),
  });
}

function routeMetrics(
  phases: readonly PresentedObserverFrame["scene"][],
): Readonly<{ maxRouteWaypoints: number; maxRouteLengthPixels: number }> {
  let maxRouteWaypoints = 0;
  let maxRouteLengthPixels = 0;
  for (const phase of phases) {
    if (phase === null) continue;
    for (const intent of phase.actorIntents) {
      const route = intent.waypoints ?? [];
      maxRouteWaypoints = Math.max(maxRouteWaypoints, route.length);
      let length = 0;
      for (let index = 1; index < route.length; index += 1) {
        length += Math.hypot(
          route[index]!.x - route[index - 1]!.x,
          route[index]!.y - route[index - 1]!.y,
        );
      }
      maxRouteLengthPixels = Math.max(maxRouteLengthPixels, Math.round(length));
    }
  }
  return { maxRouteWaypoints, maxRouteLengthPixels };
}

function validateTravelTransactions(entries: readonly EventEnvelopeEntry[]): number {
  if (entries.length === 0 || entries.length % 2 !== 0) {
    throw new Error("travel Chronicle requires paired travel transaction evidence");
  }
  for (let index = 0; index < entries.length; index += 2) {
    const left = parsePresentedEvent(entries[index]!);
    const entered = parsePresentedEvent(entries[index + 1]!);
    if (!left.known || left.evidence.type !== "agent_left_region"
      || !entered.known || entered.evidence.type !== "agent_entered_region") {
      throw new Error("travel Chronicle requires paired travel transaction order");
    }
    const from = left.evidence.payload;
    const to = entered.evidence.payload;
    if (from.agent_id !== to.agent_id
      || from.from_region !== to.from_region
      || from.to_region !== to.to_region
      || entries[index + 1]!.cursor !== entries[index]!.cursor + 1) {
      throw new Error("travel Chronicle requires one matching paired travel transaction");
    }
  }
  return entries.length / 2;
}

function validateDeliveryPartition(
  entries: readonly EventEnvelopeEntry[],
  batches: readonly (readonly EventEnvelopeEntry[])[],
): void {
  if (batches.some((batch) => batch.length === 0)) throw new Error("delivery batches must not be empty");
  const flattened = batches.flat();
  if (flattened.length !== entries.length) throw new Error("delivery partition must cover every Chronicle entry");
  for (let index = 0; index < entries.length; index += 1) {
    if (JSON.stringify(flattened[index]) !== JSON.stringify(entries[index])) {
      throw new Error("delivery partition must retain exact Chronicle evidence order");
    }
  }
}

function regionRecipes(manifest: ChronicleManifest): ReadonlyMap<string, RegionMapRecipeV1> {
  const recipes = manifest.initialSnapshot.regions.map((region) => {
    const recipe = createProductionRegionMapRecipe(createRegionMapIdentity(
      manifest.seed,
      region,
      manifest.initialSnapshot.regions,
    ));
    return [region.name, recipe] as const;
  });
  return new Map(recipes);
}

function commitArrivalPlacement(
  moment: StoryMoment,
  model: PresentedWorldModel,
  ledger: PlacementLedger,
): void {
  const arrival = moment.evidence
    .map(parsePresentedEvent)
    .find((event) => event.known && event.evidence.type === "agent_entered_region");
  if (arrival === undefined || !arrival.known || arrival.evidence.type !== "agent_entered_region") return;
  const payload = arrival.evidence.payload;
  const record = model.getView().agents.find(({ value }) => value.id === payload.agent_id);
  if (record?.completeness !== "exact") {
    throw new Error(`arrival actor ${payload.agent_id} is not exact after projection`);
  }
  const agent = parseAgentSnapshot(record.value);
  const committed = ledger.placeAgent(agent, { kind: "arrival", fromRegion: payload.from_region });
  if (committed.regionId !== payload.to_region) {
    throw new Error(`arrival actor ${payload.agent_id} did not commit to ${payload.to_region}`);
  }
}
