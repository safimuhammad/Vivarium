import type {
  ActorVisualIntent,
  ActorVisualIntentKind,
  EffectVisualIntent,
  FrameIdentity,
  HomeVisualIntent,
  PresentedObserverFrame,
  PresentedSceneView,
  PresentedStagingBeat,
  Vec2,
} from "../../presentation/contracts";
import type { PresentedEventType } from "../../presentation/eventPayloads";
import { frameEntityIdDenylist, safePublicCopy } from "../../app/observer2d/publicCopy";
import {
  EVENT_LEGIBILITY_MAP,
  type OverlayAnchor,
  type OverlayMappingEntry,
} from "../../presentation/eventLegibilityMap";
import type { Direction4 } from "../contracts";
import type { HumanPrimitiveCommand } from "./actors/LayeredHumanActor";
import {
  identityHue,
  MAX_TAIL_LEAN,
  OVERLAY_FAMILY_ACCENT,
} from "./environment/bubbleGrammar";
import type {
  EnvironmentEffectRequest,
  OverlayThread,
} from "./environment/EnvironmentSystem";
import type { HomePrimitiveCommand } from "./homes/HomeActor";
import { groundTerrainPointIsOpen } from "./navigation/groundTerrain";
import type { NavigationGrid } from "./navigation/navigation";
import type {
  ProductionSceneCommand,
  ProductionSceneCommandBatch,
} from "./ProductionSceneBridge";
import type { PlacementLedgerSnapshot } from "./placement/PlacementLedger";
import { spreadCoincidentTargets } from "./placement/SpatialDirector";

export interface ProductionSceneCommandResolverOptions {
  readonly getPlacement: () => PlacementLedgerSnapshot;
  /**
   * The named region's live navigation grid, or `null` when the region has
   * no registered recipe.
   *
   * Feeds the legality predicate for `spreadCoincidentTargets`'s coincident-
   * target ring search (see the call site below): a candidate spread point
   * is only chosen when its destination tile is open ground, exactly the
   * seam `navigation/groundTerrain.ts` established for the scene graph's own
   * move/reposition gate. Wired to `PlacementLedger.navigationGridFor` in
   * production (`CanvasPresentationRenderer.ts` /
   * `ProductionCanvasSceneFactory.ts`).
   *
   * Optional and defaults to "no grid known" (the spread stays permissive,
   * matching this resolver's prior behaviour) so fixture-only tests that
   * stub `getPlacement` alone are unaffected.
   */
  readonly getNavigationGrid?: (regionId: string) => NavigationGrid | null;
}

export type ProductionSceneCommandResolver = (
  frame: PresentedObserverFrame,
) => ProductionSceneCommandBatch | null;

/**
 * Participant and evidence facts harvested for the legibility overlay across a
 * scene's phases.
 *
 * The overlay is driven by {@link EVENT_LEGIBILITY_MAP}, not by per-event
 * choreography wiring: four home events emit no effect intent at all on their
 * normal (physically routed) path, and `resource_changed` emits none in any
 * phase, so a per-intent overlay could never reach 28/28 coverage. Instead this
 * accumulates who-did-what-to-whom from everything a scene publishes — actor
 * intents, home intents, focus, and any effect intents that happen to exist —
 * and the map decides what to draw at the consequence beat.
 *
 * Every field stays `null` until something real fills it. Nothing is inferred:
 * an unresolvable anchor draws nothing rather than guessing a being.
 */
interface OverlayFacts {
  /** The acting being — speaker, giver, striker, builder. */
  actorId: string | null;
  /** The being it happened *to* — victim, newborn, recipient. */
  subjectId: string | null;
  /** The structure the event is about. */
  homeId: string | null;
  /** An exact number from the payload, surfaced by an existing effect intent. */
  micro: string | null;
  /** Per-recipient aim targets carried by labelled `arc` intents (home_thieved). */
  recipients: Array<Readonly<{ id: string; micro: string }>>;
  /** True once the mapped mark/burst has been emitted for this execution. */
  resolved: boolean;
  /** True once the opening gather has been emitted for this execution. */
  gathered: boolean;
}

interface ActiveExecution {
  readonly runId: string;
  readonly sourceKey: string;
  readonly sceneToken: number;
  readonly programId: string;
  birthAcceptorId: string | null;
  traveler: Readonly<{
    actorId: string;
    fromRegion: string;
    toRegion: string | null;
  }> | null;
  readonly overlay: OverlayFacts;
}

type WithoutCommandId<T> = T extends unknown ? Omit<T, "commandId"> : never;
type SceneCommandWithoutId = WithoutCommandId<ProductionSceneCommand>;

/**
 * How many utterance ids the resolver remembers before it forgets the oldest.
 *
 * The frame carries a rolling window of overlay beats rather than a one-shot
 * delivery, so the resolver must recognise ones it has already raised. The
 * memory only has to outlive that window.
 */
const MAX_REMEMBERED_UTTERANCES = 128;

/**
 * How many staging beat ids the resolver remembers before it forgets the oldest.
 *
 * Same contract and same reason as {@link MAX_REMEMBERED_UTTERANCES}: the frame
 * carries a rolling window rather than a one-shot delivery, so the resolver must
 * recognise beats it has already raised. Smaller because the staging window is.
 */
const MAX_REMEMBERED_STAGING = 64;

/**
 * The gait a conversational approach is walked at, in pixels per second.
 *
 * Identical to the scene-authored walk below, and to the number
 * `conversationStaging.ts` timed the words' wait against. A being that came
 * over to be spoken to must not walk at a different speed from one that came
 * over to be struck.
 */
const STAGING_WALK_PX_PER_SECOND = 48;

/** Translate one typed retained scene view into renderer-native idempotent commands. */
export function createProductionSceneCommandResolver(
  options: ProductionSceneCommandResolverOptions,
): ProductionSceneCommandResolver {
  let activeExecution: ActiveExecution | null = null;
  /**
   * The highest scene token this resolver has ever emitted.
   *
   * The overlay lane publishes beats that belong to no scene, and the scene
   * graph will only accept a batch whose token is at or above the active one.
   * Re-using the newest token is exactly right: it accepts, and it does NOT
   * clear the graph's applied-command memory the way a higher token would, so
   * an utterance raised beside a running scene cannot disturb it.
   */
  let lastSceneToken = 0;
  /**
   * Public display names for every being in the newest accepted frame.
   *
   * Rebuilt once per frame and read by both bubble paths. Names are scrubbed
   * through the same `publicCopy` guard every other observer surface uses, so a
   * backend that ships an opaque id in the `name` field can never leak it into
   * a bubble's address line — an unsafe name simply produces no tag.
   */
  let beingNames: ReadonlyMap<string, string> = new Map();
  const refreshBeingNames = (frame: PresentedObserverFrame): void => {
    const denied = frameEntityIdDenylist(frame);
    const names = new Map<string, string>();
    for (const record of frame.world.agents) {
      const id = record.value.id;
      if (typeof id !== "string" || typeof record.value.name !== "string") continue;
      const safe = safePublicCopy(record.value.name, "", denied);
      if (safe.length > 0) names.set(id, safe);
    }
    beingNames = names;
  };
  const raisedUtterances = new Set<string>();
  const rememberUtterance = (key: string): void => {
    raisedUtterances.add(key);
    if (raisedUtterances.size > MAX_REMEMBERED_UTTERANCES) {
      const oldest = raisedUtterances.values().next();
      if (!oldest.done) raisedUtterances.delete(oldest.value);
    }
  };
  /**
   * The overlay lane's commands for this frame.
   *
   * A bubble is a fire-and-forget environment request with its own wall-clock
   * lifetime, anchored live to the being rather than to the point it was
   * emitted at (`EnvironmentSystem.setAnchorPositions`). That is why an
   * utterance can hang over a being who is walking, mid-scene, or doing
   * nothing at all — and why `clear-scene` does not take it away.
   */
  const utteranceCommands = (
    frame: PresentedObserverFrame,
    knownPlacement: PlacementLedgerSnapshot | null,
  ): readonly ProductionSceneCommand[] => {
    const pending = (frame.utterances ?? [])
      .map((utterance) => Object.freeze({
        utterance,
        key: `${frame.runId}|${frame.sourceKey}|${utterance.momentId}:${utterance.cursor}`,
      }))
      .filter(({ key }) => !raisedUtterances.has(key));
    // Placement is only read when there is actually a bubble to place: the
    // no-scene path had never touched it, and a seam that stubs the renderer
    // without a placement ledger must keep working when nobody is speaking.
    if (pending.length === 0) return [];
    const placement = knownPlacement ?? options.getPlacement();
    const commands: ProductionSceneCommand[] = [];
    for (const { utterance, key } of pending) {
      const emitted = effectCommands(
        {
          kind: "speech-bubble",
          sourceId: utterance.beingId,
          targetId: utterance.targetId,
          text: utterance.text,
          variant: utterance.variant,
        },
        placement,
        false,
        null,
        beingNames,
      );
      // A being with no placement yet has nowhere to put the words; leaving the
      // beat unremembered lets a later frame raise it once they are on stage.
      if (emitted.length === 0) continue;
      rememberUtterance(key);
      emitted.forEach((command, index) => commands.push({
        ...command,
        commandId: `utterance:${utterance.momentId}:${utterance.cursor}:${index}`,
      }));
    }
    return commands;
  };

  const raisedStaging = new Set<string>();
  const rememberStaging = (key: string): void => {
    raisedStaging.add(key);
    if (raisedStaging.size > MAX_REMEMBERED_STAGING) {
      const oldest = raisedStaging.values().next();
      if (!oldest.done) raisedStaging.delete(oldest.value);
    }
  };
  /**
   * The staging lane's commands for this frame.
   *
   * Conversational proximity (`presentation/conversationStaging.ts`): a being
   * addressed by someone standing across the region walks over first, and both
   * turn to face each other as the words land. Published exactly the way the
   * overlay lane is — at `lastSceneToken`, so the scene graph accepts the batch
   * without clearing its applied-command memory and a running scene is never
   * disturbed — and it survives `clear-scene`, which cancels fallback
   * repositions and offsets but never a route.
   *
   * The `reposition`-before-`move` ordering for a truncated approach is the same
   * load-bearing order the scene lane uses and for the same reason: the graph
   * applies each command as it validates it, so the reposition must land before
   * the move's route-clearance gate reads the actor's position.
   */
  const stagingCommands = (
    frame: PresentedObserverFrame,
  ): readonly ProductionSceneCommand[] => {
    const pending = (frame.staging ?? [])
      .map((beat) => Object.freeze({
        beat,
        key: `${frame.runId}|${frame.sourceKey}|${beat.id}`,
      }))
      .filter(({ key }) => !raisedStaging.has(key));
    if (pending.length === 0) return [];
    const commands: ProductionSceneCommand[] = [];
    for (const { beat, key } of pending) {
      rememberStaging(key);
      for (const [index, command] of stagingPrimitives(beat).entries()) {
        commands.push({
          kind: "actor",
          commandId: `staging:${beat.id}:${index}`,
          actorId: beat.beingId,
          command,
        });
      }
    }
    return commands;
  };

  return (frame) => {
    refreshBeingNames(frame);
    const scene = frame.scene;
    const execution = scene?.execution;
    if (
      activeExecution !== null
      && (activeExecution.runId !== frame.runId || activeExecution.sourceKey !== frame.sourceKey)
    ) activeExecution = null;
    if (scene === null) {
      const overlay = [...utteranceCommands(frame, null), ...stagingCommands(frame)];
      if (activeExecution === null) {
        return overlay.length === 0 ? null : deepFreeze({
          identity: identityOf(frame),
          sceneToken: lastSceneToken,
          commands: overlay,
        });
      }
      const completed = activeExecution;
      activeExecution = null;
      return deepFreeze({
        identity: identityOf(frame),
        sceneToken: completed.sceneToken,
        commands: [
          {
            kind: "clear-scene",
            commandId: `${completed.programId}:clear-scene`,
          },
          ...overlay,
        ],
      });
    }
    if (
      execution === undefined
      || !Number.isSafeInteger(execution.sceneToken)
      || execution.sceneToken < 0
      || execution.programId.trim().length === 0
    ) return null;
    const sameExecution = activeExecution !== null
      && activeExecution.runId === frame.runId
      && activeExecution.sourceKey === frame.sourceKey
      && activeExecution.sceneToken === execution.sceneToken
      && activeExecution.programId === execution.programId;
    if (!sameExecution) {
      activeExecution = {
        runId: frame.runId,
        sourceKey: frame.sourceKey,
        sceneToken: execution.sceneToken,
        programId: execution.programId,
        birthAcceptorId: null,
        traveler: null,
        overlay: {
          actorId: null,
          subjectId: null,
          homeId: null,
          micro: null,
          recipients: [],
          resolved: false,
          gathered: false,
        },
      };
    }
    const executionState = activeExecution!;
    lastSceneToken = Math.max(lastSceneToken, execution.sceneToken);
    const placement = options.getPlacement();
    if (hasMoveStationaryPoseConflict(scene.actorIntents)) {
      // The scene is unusable, but the overlay lane is independent of it: words
      // over a being's head are not part of the pose this batch could not
      // resolve, and dropping them would make the two lanes share a failure.
      const overlay = [...utteranceCommands(frame, placement), ...stagingCommands(frame)];
      return overlay.length === 0 ? null : deepFreeze({
        identity: identityOf(frame),
        sceneToken: execution.sceneToken,
        commands: overlay,
      });
    }
    const commands: ProductionSceneCommand[] = [
      ...utteranceCommands(frame, placement),
      ...stagingCommands(frame),
    ];
    updateExecutionFacts(executionState, frame, scene, placement);
    lifecycleCommands(executionState, frame, scene).forEach((command) => commands.push(command));
    presenceFadeModes(scene).forEach((mode, actorId) => {
      commands.push({
        kind: "presence-fade",
        commandId: commandId(execution.programId, scene, `presence-fade:${actorId}:${mode}`),
        actorId,
        mode,
      });
    });
    // The candidate ring point spreadCoincidentTargets nudges a coincident
    // participant onto must itself be legal ground -- otherwise a river or
    // cliff tile beside a shared anchor (a home's door, a contest's rally
    // point) can be handed back as a being's target
    // (`.superpowers/sdd/terrain-seam-report.md` Concerns §1). When this
    // scene's region grid is known, gate every candidate through the same
    // destination-tile ground predicate the scene graph's own move/
    // reposition legality gate uses; `spreadCoincidentTargets` already
    // falls back to each participant's original point when no ring slot is
    // legal, so no fallback logic is needed here. Grid unknown (no region,
    // or the resolver wasn't wired with `getNavigationGrid`) keeps this
    // resolver's prior, permissive behaviour.
    const spreadGrid = scene.regionId === null ? null : options.getNavigationGrid?.(scene.regionId) ?? null;
    const spreadTargets = spreadCoincidentTargets(
      relocationTargets(scene.actorIntents),
      spreadGrid === null ? () => true : (point) => groundTerrainPointIsOpen(spreadGrid, point),
    );
    scene.actorIntents.forEach((intent, index) => {
      actorCommands(intent, placement, scene, spreadTargets.get(intent.actorId) ?? null).forEach((command, commandIndex) => {
        commands.push({
          kind: "actor",
          commandId: commandId(
            execution.programId,
            scene,
            `actor:${index}:${commandIndex}:${intent.actorId}:${intent.kind}:${command.kind}`,
          ),
          actorId: intent.actorId,
          command,
        });
      });
    });
    scene.homeIntents.forEach((intent) => {
      if (intent.kind === "create-provisional") {
        commands.push({
          kind: "create-provisional-home",
          commandId: `${execution.programId}:provisional-home:${intent.homeId}`,
          homeId: intent.homeId,
          regionId: intent.regionId,
          plotId: intent.plotId,
          plot: { ...intent.plot },
          door: { ...intent.door },
          kit: intent.kit,
        });
        return;
      }
      const command = homeCommand(intent);
      if (command === null) return;
      commands.push({
        kind: "home",
        commandId: `${execution.programId}:home:${intent.homeId}:${intent.kind}:${homeCommandVariant(command)}`,
        homeId: intent.homeId,
        command,
      });
    });
    harvestOverlayFacts(executionState.overlay, scene, placement);
    scene.effectIntents.forEach((intent, index) => {
      effectCommands(intent, placement, scene.reducedMotion, executionState, beingNames).forEach((command, commandIndex) => {
        commands.push({
          ...command,
          commandId: commandId(
            execution.programId,
            scene,
            `effect:${index}:${commandIndex}:${intent.kind}`,
          ),
        });
      });
    });
    overlayCommands(executionState, scene, placement).forEach((command, index) => {
      commands.push({
        ...command,
        commandId: commandId(execution.programId, scene, `overlay:${index}`),
      });
    });
    return deepFreeze({
      identity: identityOf(frame),
      sceneToken: execution.sceneToken,
      commands,
    });
  };
}

/**
 * Event types whose choreography (`presentation/choreography/
 * homeContestSystem.ts`) deliberately routes an actor to stand at a home's
 * door for a self-contained, symmetric duck-in-then-out interaction: warm
 * at the hearth, join/leave the household, stash materials. Deliberately
 * NOT every home-target event -- `home_built`'s builder should stay
 * visible raising the walls, and `home_breached`/`home_thieved`/
 * `home_colonized`'s aggressors should stay visible acting on the door,
 * not vanish inside it (the owner's spatial-truth mandate: "a raider ...
 * stands AT the house he is acting on", not disappears into it).
 *
 * Backs the door-anchored motion contract (Bug 3): the being walks to the
 * door on its own ordinary `"move"` intent (unchanged), then vanishes for
 * the hold/consequence window and reveals again as recover's return walk
 * begins -- driven purely by this already-published phase/event-type
 * signal, never by invented occupancy state (`SpatialDirector.ts`'s file
 * header; `home_started_hoarding` is the "withdraw" counterpart named in
 * the brief -- there is no separate `home_started_hoarding`/withdraw event
 * pair in the current vocabulary, see `eventPayloads.ts`, so one event
 * covers both directions of the same door visit).
 */
const HOME_PRESENCE_FADE_EVENT_TYPES: ReadonlySet<PresentedEventType> = new Set([
  "hearth_used",
  "home_joined",
  "home_left",
  "home_started_hoarding",
]);

/** Actor-intent kinds that hold a stationary contact pose AT the door -- the entrant, never a bystander who only orients toward it. */
const HOME_PRESENCE_FADE_POSE_KINDS: ReadonlySet<ActorVisualIntentKind> = new Set(["kneel", "reach"]);

/**
 * Resolve which actors should vanish (duck inside, invisibly holding the
 * interaction) or reveal (become visible again as the return walk begins)
 * this scene, per the door-anchored home-interaction motion contract. See
 * {@link HOME_PRESENCE_FADE_EVENT_TYPES}/{@link HOME_PRESENCE_FADE_POSE_KINDS}
 * for exactly which events/roles qualify.
 */
function presenceFadeModes(scene: PresentedSceneView): ReadonlyMap<string, "vanish" | "reveal"> {
  const eventType = scene.execution?.eventType;
  const modes = new Map<string, "vanish" | "reveal">();
  if (eventType === undefined || !HOME_PRESENCE_FADE_EVENT_TYPES.has(eventType)) return modes;
  if (scene.phase === "hold" || scene.phase === "consequence") {
    for (const intent of scene.actorIntents) {
      if (HOME_PRESENCE_FADE_POSE_KINDS.has(intent.kind)) modes.set(intent.actorId, "vanish");
    }
  } else if (scene.phase === "recover") {
    for (const intent of scene.actorIntents) {
      if (intent.kind === "move") modes.set(intent.actorId, "reveal");
    }
  }
  return modes;
}

/**
 * Every actor intent in this scene whose kind actually determines a final
 * standing point (a `"move"`'s route endpoint, or a `"fade-reposition"`'s
 * teleport target) -- the only two kinds `actorCommands` ever uses to
 * physically relocate an actor. Stationary contact-pose kinds ("reach",
 * "work", "kneel", "gather") also carry a `target`, but only as an
 * `isLocal`-style presence gate; they never move the actor there
 * themselves (the being is already standing wherever its own prior
 * `"move"` intent walked it), so they are deliberately excluded here.
 *
 * Feeds `spreadCoincidentTargets` (`SpatialDirector.ts`): a home-contest
 * event's whole supporting cast, or two independently-routed movers, can
 * legally compute the exact same relocation target -- see that function's
 * own doc comment for why a shared owner is needed to notice and spread
 * them apart.
 */
function relocationTargets(intents: readonly ActorVisualIntent[]): ReadonlyMap<string, Vec2> {
  const targets = new Map<string, Vec2>();
  for (const intent of intents) {
    if (intent.kind === "move" && intent.target !== null) {
      const waypoints = intent.waypoints;
      targets.set(intent.actorId, waypoints !== undefined && waypoints.length > 0
        ? waypoints[waypoints.length - 1]!
        : intent.target);
    } else if (intent.kind === "fade-reposition" && intent.target !== null) {
      targets.set(intent.actorId, intent.target);
    }
  }
  return targets;
}

function samePoint(left: Vec2, right: Vec2): boolean {
  return left.x === right.x && left.y === right.y;
}

function actorCommands(
  intent: ActorVisualIntent,
  placement: PlacementLedgerSnapshot,
  scene: PresentedSceneView,
  /**
   * This actor's spatial-truth-resolved relocation point for this scene
   * (see {@link relocationTargets}/`spreadCoincidentTargets`), or `null`
   * when this actor's intent doesn't relocate it, or its raw target didn't
   * collide with any other actor's this scene. Only consulted by the
   * `"move"`/`"fade-reposition"` branches below.
   */
  spreadPoint: Vec2 | null,
): readonly HumanPrimitiveCommand[] {
  const actorPlacement = placement.agents.get(intent.actorId) ?? null;
  const retained = actorPlacement?.point ?? null;
  const isLocal = actorPlacement !== null
    && scene.regionId !== null
    && actorPlacement.regionId === scene.regionId;
  switch (intent.kind) {
    case "orient":
      return retained === null || intent.target === null
        ? []
        : [{ kind: "orient", facing: intent.facing ?? directionFor(retained, intent.target) }];
    case "move": {
      if (intent.target === null) return [];
      const waypoints = intent.waypoints === undefined || intent.waypoints.length === 0
        ? [{ ...intent.target }]
        : intent.waypoints.map((waypoint) => ({ ...waypoint }));
      const finalWaypoint = waypoints[waypoints.length - 1]!;
      if (spreadPoint !== null && !samePoint(finalWaypoint, spreadPoint)) {
        waypoints.push({ ...spreadPoint });
      }
      const walk: HumanPrimitiveCommand = {
        kind: "move",
        waypoints,
        speedPixelsPerSecond: 48,
        gait: "walk",
      };
      // TRUNCATE-THEN-WALK (`presentation/choreography/locomotionGate.ts`).
      //
      // A walk that may not be cut away — today only the departure half of a
      // region transition — declares the point its middle was elided to. The
      // being is repositioned there and then walks the remaining route in, so
      // it is still SEEN leaving through its own gate.
      //
      // The order is load-bearing and not merely cosmetic: `ProductionSceneGraph`
      // applies each command as it validates it, so the reposition lands before
      // the move's `presentationRouteIsClear(actorPosition, …)` reads the actor's
      // position. Emitted the other way round the reposition would arrive after
      // the walk had already been armed and would cancel it into a teleport.
      //
      // `cutFrom` is deliberately NOT spread-adjusted: `relocationTargets` keys
      // spatial truth by a walk's ENDPOINT, so the nudge belongs to the
      // destination. Applying it here would drop the being at a point it was
      // never routed through.
      if (intent.cutFrom === undefined) return [walk];
      return [
        {
          kind: "reposition",
          position: { ...intent.cutFrom },
          reason: "distance-cut",
        },
        walk,
      ];
    }
    case "idle":
      return [{ kind: "set-face", expression: "neutral" }];
    case "speak":
      return [{ kind: "set-face", expression: "talk-1" }];
    case "reach":
      return !isLocal || intent.target === null
        ? []
        : [{ kind: "play-body", action: "reach-give" }];
    case "work":
      return !isLocal || intent.target === null
        ? []
        : [{ kind: "play-body", action: "work" }];
    case "kneel":
      return !isLocal || intent.target === null
        ? []
        : [{ kind: "play-body", action: "kneel" }];
    case "gather":
      return !isLocal || intent.target === null
        ? []
        : [{ kind: "play-body", action: "gather" }];
    case "hurt": {
      const commands: HumanPrimitiveCommand[] = [{ kind: "play-body", action: "hurt-fall" }];
      if (retained !== null && intent.target !== null) {
        const offset = { x: intent.target.x - retained.x, y: intent.target.y - retained.y };
        const distance = Math.hypot(offset.x, offset.y);
        if (Number.isFinite(distance) && distance >= 4 && distance <= 8) {
          commands.push({ kind: "set-offset", offset });
        }
      }
      return commands;
    }
    case "prone":
      return [{ kind: "set-status", status: "paralyzed" }];
    case "recover":
      return [{ kind: "set-offset", offset: { x: 0, y: 0 } }, { kind: "recover" }];
    case "dead":
      return [{ kind: "set-status", status: "dead" }];
    case "fade-reposition":
      return intent.target === null
        ? []
        : [
            {
              kind: "reposition",
              position: spreadPoint !== null ? { ...spreadPoint } : { ...intent.target },
              reason: intent.repositionReason
            ?? (scene.reducedMotion ? "reduced-motion" : "fallback"),
            },
            ...(intent.facing === undefined
              ? []
              : [{ kind: "orient", facing: intent.facing } satisfies HumanPrimitiveCommand]),
          ];
    default:
      return invalidNever(intent.kind);
  }
}

/** Actor-visual-intent kinds that hold a stationary contact pose in place — conflicts with `move` on the same actor. */
const STATIONARY_POSE_KINDS = new Set<ActorVisualIntent["kind"]>(["work", "kneel", "gather"]);

/** True when the same actor is asked to both relocate and hold a stationary contact pose within one phase. */
function hasMoveStationaryPoseConflict(intents: readonly ActorVisualIntent[]): boolean {
  const moving = new Set<string>();
  const stationary = new Set<string>();
  for (const intent of intents) {
    if (intent.kind === "move") moving.add(intent.actorId);
    if (STATIONARY_POSE_KINDS.has(intent.kind)) stationary.add(intent.actorId);
  }
  return [...moving].some((actorId) => stationary.has(actorId));
}

/** Exhaustiveness guard: a compile error here means a new `ActorVisualIntentKind` member is unmapped in `actorCommands`. */
function invalidNever(_value: never): never {
  throw new Error(`Unhandled actor visual intent kind: ${JSON.stringify(_value)}`);
}

function homeCommand(
  intent: Exclude<HomeVisualIntent, { readonly kind: "create-provisional" }>,
): HomePrimitiveCommand | null {
  switch (intent.kind) {
    case "build": return { kind: "build", durationMs: 900 };
    case "damage": return { kind: "damage", durationMs: 900 };
    case "loot": return { kind: "loot", durationMs: 900 };
    case "claim": return { kind: "claim", durationMs: 900 };
    case "collapse": return { kind: "collapse", durationMs: 900 };
    case "scavenge": return {
      kind: "scavenge",
      durationMs: 900,
      remnantMaterialsAfter: intent.remnantMaterialsAfter,
    };
    case "door":
      return { kind: "door", state: intent.marker?.includes("close") ? "closed" : "open" };
    case "hearth":
      return { kind: "hearth", state: intent.marker?.includes("quiet") ? "quiet" : "warm" };
  }
}

function effectCommands(
  intent: EffectVisualIntent,
  placement: PlacementLedgerSnapshot,
  reducedMotion: boolean,
  /**
   * The scene this effect belongs to, or `null` for an overlay-lane beat that
   * belongs to no scene. Only the harvest overlay reads it, and the overlay lane
   * emits speech bubbles alone.
   */
  execution: ActiveExecution | null,
  /**
   * Public display names for the beings on stage, keyed by id.
   *
   * The single choke point for the bubble's `to <name>` tag: BOTH ingestion
   * paths (the non-blocking utterance lane and a `speak` chained into a
   * physical moment) reach the bubble through this function, so resolving the
   * name here is the only way a mixed moment keeps its tag. A being missing
   * from the map gets NO tag rather than a raw `wanderer_003`.
   */
  beingNames: ReadonlyMap<string, string>,
): readonly SceneCommandWithoutId[] {
  // DECISION (Safi, 2026-07-25) -- "SELF_TALK RENDERS OPENLY", recorded in
  // .superpowers/sdd/progress.md and in docs/frontend/BUBBLE_UI.md §11.1:
  // a private thought now renders for ALL beings, with NO selection gating.
  // `PRIVATE` scope means other BEINGS do not perceive it (self_talk is never
  // routed to another agent's inbox); the viewer is not a being. Simulation
  // privacy is untouched; viewer visibility is granted, and the thought
  // silhouette (dashed cloud, 88% opacity, narrowest budget) is what keeps it
  // quiet rather than hidden.
  //
  // This DELIBERATELY REVERSES the draw-time `frame.selection` re-check the
  // bubble-fix task added here. Do not "restore" it as a regression fix: the
  // mechanism it proved (gate live at resolve time, never inside the
  // choreography plan's one-shot resolve()) remains correct and is still
  // available for any future kind that genuinely must stay hidden -- it is the
  // POLICY, not the mechanism, that the owner reversed.
  if (intent.kind === "camera-impulse") {
    if (reducedMotion) return [];
    const actorIds = [intent.sourceId, intent.targetId].filter(
      (id): id is string => id !== null && placement.agents.has(id),
    );
    return actorIds.length === 0
      ? []
      : [
          { kind: "hit-stop", actorIds, durationMs: 80 },
          { kind: "camera-impulse", offset: { x: 1, y: 0 }, durationMs: 80 },
        ];
  }
  if (intent.kind === "portrait" || intent.kind === "atlas-transition" || intent.kind === "vignette") {
    return [{
      kind: "remote-transient",
      motif: intent.kind === "portrait" ? "portrait" : intent.kind === "vignette" ? "vignette" : "atlas",
      sourceId: intent.sourceId,
      targetId: intent.targetId,
      at: intent.kind === "portrait" || intent.kind === "vignette"
        ? effectPoint(intent, placement, "source-first")
        : null,
    }];
  }
  if (intent.kind === "speech-bubble") {
    if (intent.sourceId === null || intent.text === undefined || intent.variant === undefined) return [];
    const at = effectPoint(intent, placement, "source-first");
    if (at === null) return [];
    const mapping = EVENT_LEGIBILITY_MAP.speak;
    const listener = intent.targetId === null ? null : placement.agents.get(intent.targetId) ?? null;
    const speaker = placement.agents.get(intent.sourceId) ?? null;
    const coLocated = listener !== null && speaker !== null && listener.regionId === speaker.regionId;
    // The tag is derived from the PAYLOAD's target, never from the variant: a
    // line aimed at a being in another region resolves to the "spoken" silhouette
    // (there is nobody on screen to whisper at) and is still directed speech.
    const targetName = intent.targetId === null
      ? undefined
      : beingNames.get(intent.targetId);
    const request: EnvironmentEffectRequest = {
      kind: "speech-bubble",
      at,
      speakerId: intent.sourceId,
      variant: textBubbleKindFor(intent.variant),
      text: intent.text,
      tailLean: speechBubbleTailLean(intent, placement),
      hue: identityHue(intent.sourceId),
      accent: OVERLAY_FAMILY_ACCENT[mapping.family],
      tier: "murmur",
      ...(intent.targetId === null ? {} : { targetId: intent.targetId }),
      ...(targetName === undefined || targetName.length === 0 ? {} : { targetName }),
      // A whisper is a dashed balloon WITH a thread; a broadcast is a solid
      // balloon WITHOUT one -- the direct answer to the performance matrix's
      // "whisper and broadcast are visually identical" gap.
      ...(intent.variant === "whisper" && coLocated && intent.targetId !== null
        ? {
            thread: {
              to: { ...listener!.point },
              toId: intent.targetId,
              mode: "aim" as const,
              accent: OVERLAY_FAMILY_ACCENT[mapping.family],
              hue: identityHue(intent.targetId),
            },
          }
        : {}),
    };
    return [{ kind: "environment", request }];
  }
  // Superseded by the mapping-driven overlay: an offer token, a floating damage
  // number, a structure icon and a carried badge are all now one grammar --
  // a family-accented banner on a rigid post, plus a burst on whatever it
  // happened to. Their intents are still published by the choreography layer
  // (and still carry the exact evidence this resolver harvests in
  // `harvestOverlayFacts`), but they no longer draw a second, competing mark.
  if (
    intent.kind === "bond-token"
    || intent.kind === "impact"
    || intent.kind === "structure-beat"
    || intent.kind === "carried-badge"
  ) return [];
  if (intent.kind === "flying-item") {
    if (intent.icon === undefined) return [];
    const flight = effectFlightPoints(intent, placement);
    if (flight === null) return [];
    const request: EnvironmentEffectRequest = {
      kind: "flying-item",
      from: flight.from,
      to: flight.to,
      icon: intent.icon,
      ...(intent.label === undefined ? {} : { label: intent.label }),
    };
    return [{ kind: "environment", request }];
  }
  const at = effectPoint(intent, placement, intent.label === undefined ? "source-first" : "target-first");
  if (at === null) return [];
  // `arc`'s per-recipient share label is no longer drawn as floating system
  // type; the exact number is harvested into the overlay's own micro chip and
  // the ember remains as pure motion.
  const request: EnvironmentEffectRequest | null = intent.kind === "particle"
    ? { kind: "dust", at, tint: "#d6c09b" }
    : intent.kind === "arc"
      ? { kind: "ember", at, tint: "#e9b96e" }
      : null;
  return request === null ? [] : [{ kind: "environment", request }];
}

/** Map the presentation contract's variant vocabulary onto the grammar's three text silhouettes. */
function textBubbleKindFor(variant: NonNullable<EffectVisualIntent["variant"]>): "speech" | "whisper" | "thought" {
  return variant === "spoken" ? "speech" : variant;
}

// ---------------------------------------------------------------------------
// the legibility overlay
// ---------------------------------------------------------------------------

/**
 * Accumulate who-did-what-to-whom from everything the scene publishes.
 *
 * Facts are written **once**, in priority order, and never overwritten: a
 * victim named by an actor intent (the strongest signal available — only the
 * being an event happened *to* plays `hurt`/`prone`/`dead`) outranks a guess
 * from an effect intent's source id. Ids are accepted only when they resolve
 * against the live placement ledger, which is what rejects `attack`'s literal
 * `"attack:1px"` camera-impulse sentinel without special-casing it.
 */
function harvestOverlayFacts(
  facts: OverlayFacts,
  scene: PresentedSceneView,
  placement: PlacementLedgerSnapshot,
): void {
  const agent = (id: string | null | undefined): string | null => (
    typeof id === "string" && placement.agents.has(id) ? id : null
  );
  // A structure id named by a home intent or the scene's own focus is
  // authoritative: the scene IS about that home. It is deliberately NOT
  // ledger-gated the way an agent id is, because `PlacementLedger` only learns
  // a home's door from an *exact checkpoint*, which a live run may not have
  // published yet — leaving `placement.homes` empty for most of a session and
  // silently blanking every home-anchored beat. Resolving the id here and the
  // point later (see `overlayAnchorPoint`) keeps those beats visible.
  const structure = (id: string | null | undefined): string | null => (
    typeof id === "string" && id.trim().length > 0 ? id : null
  );
  const setActor = (id: string | null): void => {
    if (facts.actorId === null && id !== null) facts.actorId = id;
  };
  const setSubject = (id: string | null): void => {
    if (facts.subjectId === null && id !== null && id !== facts.actorId) facts.subjectId = id;
  };
  const setHome = (id: string | null): void => {
    if (facts.homeId === null && id !== null) facts.homeId = id;
  };

  // 1. The being an event happened to always plays a receiving pose.
  for (const intent of scene.actorIntents) {
    if (VICTIM_POSE_KINDS.has(intent.kind)) setSubject(agent(intent.actorId));
  }
  // 2. Effect intents carry the truest source/target pairing when they exist.
  for (const intent of scene.effectIntents) {
    switch (intent.kind) {
      case "camera-impulse":
        setActor(agent(intent.sourceId));
        setSubject(agent(intent.targetId));
        break;
      case "impact":
        if (intent.polarity === "cost") setActor(agent(intent.sourceId));
        else setSubject(agent(intent.sourceId));
        if (intent.polarity === "cost" && intent.label !== undefined) facts.micro ??= intent.label;
        break;
      case "bond-token":
        setActor(agent(intent.sourceId));
        setSubject(agent(intent.targetId));
        break;
      case "speech-bubble":
        setActor(agent(intent.sourceId));
        break;
      case "particle":
      case "vignette":
        setActor(agent(intent.sourceId));
        setHome(structure(intent.targetId));
        break;
      case "flying-item":
        setActor(agent(intent.sourceId));
        setSubject(agent(intent.targetId));
        if (intent.label !== undefined) facts.micro ??= intent.label;
        break;
      case "arc": {
        const recipient = agent(intent.targetId);
        if (recipient !== null && intent.label !== undefined
          && !facts.recipients.some(({ id }) => id === recipient)) {
          facts.recipients.push({ id: recipient, micro: intent.label });
        }
        setActor(agent(intent.sourceId));
        break;
      }
      default:
        break;
    }
  }
  // 3. Home intents and focus name the structure a scene is about.
  for (const intent of scene.homeIntents) setHome(structure(intent.homeId));
  if (scene.focus.kind === "home" || scene.focus.kind === "ruin") setHome(structure(scene.focus.id));
  if (scene.focus.kind === "agent") setActor(agent(scene.focus.id));
  // 4. Last resort: the first being actually performing the act. A being playing
  //    a receiving pose is explicitly skipped -- it is the SUBJECT, and letting
  //    it fall through here silently swapped the roles of `agent_died` (the
  //    victim's own `dead` pose appears at the enter phase, well before the
  //    consequence beat names the killer), planting the `fell` mark on the corpse
  //    and the ink knell on the survivor.
  for (const intent of scene.actorIntents) {
    if (ACTING_POSE_KINDS.has(intent.kind)) setActor(agent(intent.actorId));
  }
  for (const intent of scene.actorIntents) {
    if (VICTIM_POSE_KINDS.has(intent.kind)) continue;
    setActor(agent(intent.actorId));
  }
}

/** Poses only the being an event happened *to* ever plays. */
const VICTIM_POSE_KINDS: ReadonlySet<ActorVisualIntentKind> = new Set([
  "hurt", "prone", "dead", "recover",
]);

/** Poses that mean "this being is performing the act", as distinct from watching it. */
const ACTING_POSE_KINDS: ReadonlySet<ActorVisualIntentKind> = new Set([
  "reach", "work", "gather", "kneel", "speak",
]);

/**
 * Emit this scene's overlay chrome from {@link EVENT_LEGIBILITY_MAP}.
 *
 * Two beats, matching the design's two-phase bubble:
 * - **enter** opens a gather cloud above the actor, so a viewer watches a being
 *   *produce* something instead of finding a box over its head;
 * - **consequence** resolves it into the mapped silhouette.
 *
 * The three text kinds (`speak`, `self_talk`) are excluded here: their words
 * only exist on the choreography's own `speech-bubble` intent, which carries
 * the verbatim payload, and they resolve at the hold beat where that intent
 * lives. Everything else — all 22 action events, including the ten home/contest
 * events that had no overlay wiring at all — comes from the map.
 */
function overlayCommands(
  execution: ActiveExecution,
  scene: PresentedSceneView,
  placement: PlacementLedgerSnapshot,
): readonly SceneCommandWithoutId[] {
  const eventType = scene.execution?.eventType;
  if (eventType === undefined) return [];
  const mapping = EVENT_LEGIBILITY_MAP[eventType];
  if (mapping === undefined) return [];
  const facts = execution.overlay;
  const commands: SceneCommandWithoutId[] = [];

  if (scene.phase === "enter" && !facts.gathered) {
    const anchorId = facts.actorId ?? facts.subjectId;
    const at = anchorId === null ? null : placement.agents.get(anchorId)?.point ?? null;
    if (at !== null) {
      facts.gathered = true;
      commands.push({
        kind: "environment",
        request: { kind: "event-gather", at: { ...at }, ownerId: anchorId! },
      });
    }
    return commands;
  }

  if (scene.phase !== "consequence" || facts.resolved) return commands;


  const burst = mapping.burst;
  if (burst !== undefined) {
    const at = overlayAnchorPoint(burst.anchor, facts, placement);
    if (at !== null) {
      facts.resolved = true;
      commands.push({
        kind: "environment",
        request: {
          kind: "event-burst",
          at,
          glyph: burst.glyph,
          family: mapping.family,
          ...(burst.invert === true ? { invert: true } : {}),
          ...(burst.light === true ? { light: true } : {}),
        },
      });
    }
  }
  if (mapping.kind === "speech" || mapping.kind === "whisper" || mapping.kind === "thought") {
    return commands;
  }
  if (mapping.kind === "burst") return commands;

  const anchorId = overlayAnchorId(mapping.anchor, facts);
  const at = overlayAnchorPoint(mapping.anchor, facts, placement);
  if (anchorId === null || at === null || mapping.glyph === null) return commands;
  facts.resolved = true;
  const threads = overlayThreads(mapping, facts, placement);
  commands.push({
    kind: "environment",
    request: {
      kind: "event-mark",
      at,
      ownerId: anchorId,
      glyph: mapping.glyph,
      family: mapping.family,
      tier: mapping.tier,
      ...(mapping.micro === true && overlayMicro(facts) !== null
        ? { micro: overlayMicro(facts)! }
        : {}),
      ...(threads.length === 0 ? {} : { threads }),
    },
  });
  return commands;
}

/** Which id an anchor role resolves to, or `null` when the scene never named one. */
function overlayAnchorId(anchor: OverlayAnchor, facts: OverlayFacts): string | null {
  switch (anchor) {
    case "actor": return facts.actorId ?? facts.subjectId;
    case "subject": return facts.subjectId ?? facts.actorId;
    case "home": return facts.homeId;
  }
}

/**
 * The world point an anchor role hangs on. Homes anchor at their door.
 *
 * When the ledger has no door for a structure (it only learns one from an exact
 * checkpoint), the beat falls back to the **acting being's own live point**:
 * every home-subject event routes its actor to that structure's door, so the
 * actor is standing on the doorstep. That is a real position from real data,
 * not an invented one — and it is the difference between a home beat being
 * visible and being silently dropped.
 */
function overlayAnchorPoint(
  anchor: OverlayAnchor,
  facts: OverlayFacts,
  placement: PlacementLedgerSnapshot,
): Vec2 | null {
  const id = overlayAnchorId(anchor, facts);
  if (id === null) return null;
  const agent = placement.agents.get(id);
  if (agent !== undefined) return { ...agent.point };
  const home = placement.homes.get(id);
  if (home !== undefined) return { ...home.door };
  if (anchor !== "home") return null;
  const doorstep = facts.actorId === null ? null : placement.agents.get(facts.actorId) ?? null;
  return doorstep === null ? null : { ...doorstep.point };
}

/**
 * The aim-threads leaving one mark. `home_thieved` is the only event that fans
 * out — one thread per recipient, each carrying that recipient's exact share.
 */
function overlayThreads(
  mapping: OverlayMappingEntry,
  facts: OverlayFacts,
  placement: PlacementLedgerSnapshot,
): readonly OverlayThread[] {
  if (mapping.thread === undefined) return [];
  const accent = OVERLAY_FAMILY_ACCENT[mapping.family];
  const mode = mapping.thread;
  if (facts.recipients.length > 0) {
    return facts.recipients.flatMap(({ id }) => {
      const point = placement.agents.get(id)?.point;
      return point === undefined
        ? []
        : [{ to: { ...point }, toId: id, mode, accent, hue: identityHue(id) } satisfies OverlayThread];
    });
  }
  // The thread always runs to the *other* party: from the actor's mark to the
  // being it was aimed at, or from a mark planted on the subject back to whoever
  // caused it.
  const targetId = mapping.anchor === "actor"
    ? facts.subjectId ?? facts.homeId
    : facts.actorId ?? facts.homeId;
  if (targetId === null) return [];
  const point = placement.agents.get(targetId)?.point ?? placement.homes.get(targetId)?.door;
  if (point === undefined) return [];
  return [{ to: { ...point }, toId: targetId, mode, accent, hue: identityHue(targetId) }];
}

/**
 * The exact number a mark prints beside its glyph, or `null`.
 *
 * Never invented: it is either a label an effect intent already carried, or —
 * for a multi-recipient theft — the sum of the payload's own per-recipient
 * shares, which is the amount actually taken.
 */
function overlayMicro(facts: OverlayFacts): string | null {
  if (facts.recipients.length === 1) return facts.recipients[0]!.micro;
  if (facts.recipients.length > 1) {
    let total = 0;
    for (const { micro } of facts.recipients) {
      const value = Number.parseFloat(micro);
      if (!Number.isFinite(value)) return facts.micro;
      total += value;
    }
    return String(total);
  }
  return facts.micro;
}

/** Both endpoints of a `flying-item`'s flight -- `null` (no invention) unless both sides resolve to a real point. */
function effectFlightPoints(
  intent: EffectVisualIntent,
  placement: PlacementLedgerSnapshot,
): Readonly<{ from: Vec2; to: Vec2 }> | null {
  const from = pointFor(intent.sourceId, placement);
  const to = pointFor(intent.targetId, placement);
  return from === null || to === null ? null : { from, to };
}

function pointFor(id: string | null, placement: PlacementLedgerSnapshot): Vec2 | null {
  if (id === null) return null;
  const agent = placement.agents.get(id);
  if (agent !== undefined) return { ...agent.point };
  const home = placement.homes.get(id);
  return home === undefined ? null : { ...home.door };
}

/**
 * Lean a whisper's bubble tail toward its co-located listener, in world px,
 * clamped to the grammar's ±14 ceiling.
 *
 * Zero for public speech, self_talk, or a listener who isn't presented or
 * co-located -- there is no one on screen to lean toward. Only the "whisper"
 * variant ever leans: a spoken or thought bubble is never aimed at anyone, even
 * when a payload carries a target id (a cross-region whisper keeps the "spoken"
 * silhouette, with no physical listener on screen).
 */
function speechBubbleTailLean(
  intent: EffectVisualIntent,
  placement: PlacementLedgerSnapshot,
): number {
  if (intent.variant !== "whisper" || intent.sourceId === null || intent.targetId === null) return 0;
  const speaker = placement.agents.get(intent.sourceId);
  const listener = placement.agents.get(intent.targetId);
  if (speaker === undefined || listener === undefined || speaker.regionId !== listener.regionId) return 0;
  const dx = listener.point.x - speaker.point.x;
  if (Math.abs(dx) < 4) return 0;
  const leaned = Math.round(dx * 0.25);
  return Math.max(-MAX_TAIL_LEAN, Math.min(MAX_TAIL_LEAN, leaned));
}

function updateExecutionFacts(
  execution: ActiveExecution,
  frame: PresentedObserverFrame,
  scene: PresentedSceneView,
  placement: PlacementLedgerSnapshot,
): void {
  if (execution.programId.includes("agent_born")) {
    const acceptor = scene.actorIntents.find((intent) =>
      intent.marker?.includes("birth") === true && !intent.marker.includes("commit"));
    if (acceptor !== undefined) execution.birthAcceptorId = acceptor.actorId;
  }

  const movementProgram = execution.programId.includes("agent_left_region")
    || execution.programId.includes("agent_entered_region");
  if (!movementProgram) return;
  const atlas = scene.effectIntents.find((intent) => intent.kind === "atlas-transition");
  const departure = scene.actorIntents.find((intent) =>
    intent.kind === "move" && intent.marker?.includes("departure") === true);
  const arrival = scene.actorIntents.find((intent) =>
    (intent.kind === "move" || intent.kind === "fade-reposition")
    && intent.marker?.includes("arrival") === true);
  const focusedActorId = scene.focus?.kind === "agent" ? scene.focus.id : null;
  const actorId = departure?.actorId ?? arrival?.actorId
    ?? execution.traveler?.actorId ?? focusedActorId;
  const atlasFrom = typeof atlas?.sourceId === "string" && atlas.sourceId.trim().length > 0
    ? atlas.sourceId
    : null;
  const atlasTo = typeof atlas?.targetId === "string" && atlas.targetId.trim().length > 0
    ? atlas.targetId
    : null;
  const placedRegion = actorId === null ? null : placement.agents.get(actorId)?.regionId ?? null;
  const inferredFrom = atlasFrom
    ?? execution.traveler?.fromRegion
    ?? placedRegion
    ?? (execution.programId.includes("agent_left_region") ? scene.regionId : null);
  if (actorId !== null && inferredFrom !== null) {
    const durableDestination = frame.world.agents.find(({ value }) => value.id === actorId)
      ?.value.position;
    const enteredDestination = execution.programId.includes("agent_entered_region")
      && scene.regionId !== null && scene.regionId !== inferredFrom
      ? scene.regionId
      : null;
    execution.traveler = {
      actorId,
      fromRegion: inferredFrom,
      toRegion: atlasTo
        ?? execution.traveler?.toRegion
        ?? enteredDestination
        ?? (typeof durableDestination === "string" && durableDestination !== inferredFrom
        ? durableDestination
        : null),
    };
  }
}

function lifecycleCommands(
  execution: ActiveExecution,
  frame: PresentedObserverFrame,
  scene: PresentedSceneView,
): readonly ProductionSceneCommand[] {
  const commands: ProductionSceneCommand[] = [];
  if (scene.phase === "consequence" && execution.birthAcceptorId !== null) {
    const child = scene.actorIntents.find((intent) => intent.marker?.includes("birth-commit") === true);
    if (child !== undefined && frame.world.agents.some(({ value }) => value.id === child.actorId)) {
      commands.push({
        kind: "placement-hint",
        commandId: `${execution.programId}:placement:birth:${child.actorId}`,
        agentId: child.actorId,
        context: {
          kind: "birth",
          acceptorId: execution.birthAcceptorId,
          authoritativeColocation: true,
        },
      });
    }
  }

  const traveler = execution.traveler;
  if (traveler === null || traveler.toRegion === null) return commands;
  if (scene.phase === "enter" || scene.effectIntents.some(({ kind }) => kind === "atlas-transition")) {
    commands.push({
      kind: "retain-traveler",
      commandId: `${execution.programId}:retain-traveler:${traveler.actorId}`,
      actorId: traveler.actorId,
      fromRegion: traveler.fromRegion,
      toRegion: traveler.toRegion,
    });
  }
  const executionIdentity = scene.execution;
  const atlas = scene.effectIntents.find((intent) => (
    intent.kind === "atlas-transition"
    && intent.sourceId === traveler.fromRegion
    && intent.targetId === traveler.toRegion
  ));
  const enteredProgramId = `choreography:${scene.momentId}:agent_entered_region`;
  if (scene.phase === "hold"
    && scene.regionId === traveler.toRegion
    && executionIdentity?.eventType === "agent_entered_region"
    && executionIdentity.programId === enteredProgramId
    && atlas !== undefined) {
    commands.push({
      kind: "stage-arrival",
      commandId: `${execution.programId}:stage-arrival:${traveler.actorId}`,
      actorId: traveler.actorId,
      fromRegion: traveler.fromRegion,
      toRegion: traveler.toRegion,
      eventType: "agent_entered_region",
      phase: "hold",
      momentId: scene.momentId,
      programId: execution.programId,
    });
  }
  if (scene.phase === "consequence") {
    const arrival = scene.actorIntents.find((intent) =>
      intent.actorId === traveler.actorId
      && (intent.kind === "move" || intent.kind === "fade-reposition")
      && intent.marker?.includes("arrival") === true
      && intent.target !== null);
    if (arrival !== undefined && arrival.target !== null) {
      commands.push({
        kind: "placement-hint",
        commandId: `${execution.programId}:placement:arrival:${traveler.actorId}`,
        agentId: traveler.actorId,
        context: { kind: "arrival", fromRegion: traveler.fromRegion },
        arrivalGate: arrival.waypoints?.[0] === undefined ? undefined : { ...arrival.waypoints[0] },
        requestedFinal: { ...arrival.target },
      });
    }
  }
  return commands;
}

function effectPoint(
  intent: EffectVisualIntent,
  placement: PlacementLedgerSnapshot,
  order: "source-first" | "target-first",
): Vec2 | null {
  const ids = order === "target-first"
    ? [intent.targetId, intent.sourceId]
    : [intent.sourceId, intent.targetId];
  for (const id of ids) {
    if (id === null) continue;
    const agent = placement.agents.get(id);
    if (agent !== undefined) return { ...agent.point };
    const home = placement.homes.get(id);
    if (home !== undefined) return { ...home.door };
  }
  return null;
}

/**
 * The renderer primitives one conversational staging beat performs.
 *
 * An `approach` is the ordinary production walk — same gait, same route shape,
 * same truncate-then-walk contract — and a `face` is a bare turn. Neither
 * consults the placement ledger: unlike a scene intent, a staging beat already
 * carries a route resolved against the region's real ground and structures, and
 * re-deriving anything here would be a second opinion about spatial truth.
 */
function stagingPrimitives(beat: PresentedStagingBeat): readonly HumanPrimitiveCommand[] {
  if (beat.kind === "face") return [{ kind: "orient", facing: beat.facing }];
  if (beat.waypoints.length < 2) return [];
  const walk: HumanPrimitiveCommand = {
    kind: "move",
    waypoints: beat.waypoints.map((waypoint) => ({ ...waypoint })),
    speedPixelsPerSecond: STAGING_WALK_PX_PER_SECOND,
    gait: "walk",
  };
  if (beat.cutFrom === undefined) return [walk];
  return [
    { kind: "reposition", position: { ...beat.cutFrom }, reason: "distance-cut" },
    walk,
  ];
}

function directionFor(from: Vec2, to: Vec2): Direction4 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

function commandId(programId: string, scene: PresentedSceneView, suffix: string): string {
  return `${programId}:${scene.momentId}:${scene.phase}:${suffix}`;
}

function homeCommandVariant(command: HomePrimitiveCommand): string {
  if (command.kind === "door" || command.kind === "hearth") return command.state;
  return "timed";
}

function identityOf(frame: PresentedObserverFrame): FrameIdentity {
  return {
    runId: frame.runId,
    sourceKey: frame.sourceKey,
    revision: frame.revision,
    firstCursor: frame.firstCursor,
    lastCursor: frame.lastCursor,
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
