import {
  LayeredHumanActor,
  type HumanPrimitiveCommand,
  type LayeredHumanSnapshot,
  type ProductionActorSignal,
} from "../../renderer2d/production/actors/LayeredHumanActor";

export type PilotBeat =
  | "idle"
  | "walk"
  | "talk"
  | "reach"
  | "work"
  | "fall"
  | "prone"
  | "recover"
  | "settled";

export type PilotPhase =
  | "idle-hold"
  | "walk-route"
  | "walk-stop"
  | "walk-orient"
  | "talk-neutral-open"
  | "talk-one"
  | "talk-two"
  | "talk-neutral-close"
  | "reach-action"
  | "reach-gap"
  | "work-action"
  | "work-gap"
  | "fall-action"
  | "prone-hold"
  | "recover-action"
  | "settled-hold";

export interface PilotFrame {
  readonly beat: PilotBeat;
  readonly phase: PilotPhase;
  readonly elapsedMs: number;
  readonly actor: LayeredHumanSnapshot;
  readonly signals: readonly ProductionActorSignal[];
  readonly lastMarker: string | null;
}

export type PilotMilestone =
  | "front-idle"
  | "east-mid-walk"
  | "reach-contact"
  | "prone";

export interface CharacterPilotTimeline {
  advance(deltaSeconds: number, nowMs: number): PilotFrame;
  restart(nowMs: number): PilotFrame;
  seek(milestone: PilotMilestone): PilotFrame;
  dispose(): void;
}

type RequiredMarker =
  | "hand-contact"
  | "work-contact"
  | "fall-contact"
  | "recovery-contact";

interface MarkerExpectation {
  readonly phase: PilotPhase;
  readonly action: "reach-give" | "work" | "hurt-fall";
  readonly frameIndex: number;
}

const FIXED_STEP_MS = 20;
const FIXED_STEP_SECONDS = FIXED_STEP_MS / 1_000;
const MAX_PRESENTATION_DELTA_MS = 120;
const MAX_PRIVATE_STEPS_PER_ADVANCE = MAX_PRESENTATION_DELTA_MS / FIXED_STEP_MS;
const WALK_SPEED_PX_PER_SECOND = 50;
const IDLE_HOLD_MS = 6_500;
const TALK_FACE_HOLD_MS = 300;
const ACTION_GAP_MS = 360;
const PRONE_HOLD_MS = 1_200;
const SETTLED_HOLD_MS = 1_200;
const SEEK_STEP_LIMIT = 2_000;
const NUMERIC_EPSILON = 1e-7;
const WALK_PHASE_LIMIT_MS = 8_000;
const ACTION_PHASE_LIMIT_MS = 1_000;

const START = Object.freeze({ x: 226, y: 102 });
const ROUTE = Object.freeze([
  Object.freeze({ x: 226, y: 150 }),
  Object.freeze({ x: 286, y: 150 }),
  Object.freeze({ x: 286, y: 102 }),
  Object.freeze({ x: 226, y: 102 }),
]);
const MILESTONES = new Set<PilotMilestone>([
  "front-idle",
  "east-mid-walk",
  "reach-contact",
  "prone",
]);
const REQUIRED_MARKERS: Readonly<Record<RequiredMarker, MarkerExpectation>> =
  Object.freeze({
    "hand-contact": Object.freeze({
      phase: "reach-action",
      action: "reach-give",
      frameIndex: 3,
    }),
    "work-contact": Object.freeze({
      phase: "work-action",
      action: "work",
      frameIndex: 3,
    }),
    "fall-contact": Object.freeze({
      phase: "fall-action",
      action: "hurt-fall",
      frameIndex: 4,
    }),
    "recovery-contact": Object.freeze({
      phase: "recover-action",
      action: "hurt-fall",
      frameIndex: 4,
    }),
  });

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function samePoint(
  point: Readonly<{ readonly x: number; readonly y: number }>,
  expected: Readonly<{ readonly x: number; readonly y: number }>,
): boolean {
  return Math.abs(point.x - expected.x) <= NUMERIC_EPSILON
    && Math.abs(point.y - expected.y) <= NUMERIC_EPSILON;
}

function isIdle(snapshot: LayeredHumanSnapshot): boolean {
  return snapshot.layers.body.clipId
    === `${snapshot.appearance.rig}:idle:${snapshot.facing}`;
}

function allLayersFace(snapshot: LayeredHumanSnapshot, facing: string): boolean {
  return Object.values(snapshot.layers).every((layer) => layer.facing === facing);
}

class DeterministicCharacterPilotTimeline implements CharacterPilotTimeline {
  readonly #actor: LayeredHumanActor;
  readonly #instanceId: number;

  #restoreInitialActor: () => void;
  #phase: PilotPhase = "idle-hold";
  #beat: PilotBeat = "idle";
  #actorClockMs = 0;
  #loopElapsedMs = 0;
  #phaseElapsedMs = 0;
  #fixedStepRemainderMs = 0;
  #lastCallerNowMs: number | null = null;
  #lastMarker: string | null = null;
  #arrivalCount = 0;
  #settledCount = 0;
  #facingSwitchCount = 0;
  #finalOrientFacingSwitchBaseline = 0;
  #requiredMarkerCounts: Record<RequiredMarker, number> = {
    "hand-contact": 0,
    "work-contact": 0,
    "fall-contact": 0,
    "recovery-contact": 0,
  };
  #movingFacings = new Set<string>();
  #disposed = false;

  constructor(actor: LayeredHumanActor) {
    this.#actor = actor;
    const initial = actor.snapshot();
    this.#instanceId = initial.instanceId;
    this.#assertInitialActor(initial);
    this.#restoreInitialActor = actor.stageCommands([], 0);
  }

  advance(deltaSeconds: number, nowMs: number): PilotFrame {
    this.#assertUsable();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Character pilot advance requires a non-negative finite delta.");
    }
    const admittedDeltaMs = Math.min(
      deltaSeconds,
      MAX_PRESENTATION_DELTA_MS / 1_000,
    ) * 1_000;
    this.#acceptCallerTime(nowMs);

    this.#fixedStepRemainderMs += admittedDeltaMs;
    const signals: ProductionActorSignal[] = [];
    let consumedSteps = 0;
    while (this.#fixedStepRemainderMs + NUMERIC_EPSILON >= FIXED_STEP_MS) {
      if (consumedSteps >= MAX_PRIVATE_STEPS_PER_ADVANCE) {
        throw new Error("Character pilot presentation step ceiling was exceeded.");
      }
      this.#fixedStepRemainderMs -= FIXED_STEP_MS;
      if (Math.abs(this.#fixedStepRemainderMs) <= NUMERIC_EPSILON) {
        this.#fixedStepRemainderMs = 0;
      }
      signals.push(...this.#privateStep());
      consumedSteps += 1;
    }
    return this.#frame(signals);
  }

  restart(nowMs: number): PilotFrame {
    this.#assertUsable();
    this.#acceptCallerTime(nowMs);
    this.#restartLoop();
    return this.#frame([]);
  }

  seek(milestone: PilotMilestone): PilotFrame {
    this.#assertUsable();
    if (!MILESTONES.has(milestone)) {
      throw new TypeError(`Unknown milestone for character pilot: ${String(milestone)}.`);
    }
    this.#restartLoop();
    let frame = this.#frame([]);
    if (this.#matchesMilestone(frame, milestone)) return frame;
    for (let step = 0; step < SEEK_STEP_LIMIT; step += 1) {
      frame = this.#frame(this.#privateStep());
      if (this.#matchesMilestone(frame, milestone)) return frame;
    }
    throw new Error(
      `Character pilot milestone ${milestone} was unreachable after `
      + `${SEEK_STEP_LIMIT} private steps.`,
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#actor.dispose();
  }

  #privateStep(): readonly ProductionActorSignal[] {
    this.#actorClockMs += FIXED_STEP_MS;
    this.#loopElapsedMs += FIXED_STEP_MS;
    this.#phaseElapsedMs += FIXED_STEP_MS;
    const signals = this.#actor.advance(FIXED_STEP_SECONDS, this.#actorClockMs);
    this.#consumeSignals(signals);
    const snapshot = this.#actor.snapshot();
    this.#assertInstance(snapshot);
    this.#advancePhase(snapshot);
    return signals;
  }

  #advancePhase(snapshot: LayeredHumanSnapshot): void {
    switch (this.#phase) {
      case "idle-hold":
        if (this.#phaseElapsedMs === IDLE_HOLD_MS) {
          this.#retainCommands([{
            kind: "move",
            waypoints: ROUTE,
            speedPixelsPerSecond: WALK_SPEED_PX_PER_SECOND,
            gait: "walk",
          }]);
          this.#transition("walk-route", "walk");
        } else {
          this.#failOnOverrun(IDLE_HOLD_MS, "initial idle");
        }
        return;

      case "walk-route":
        if (snapshot.activeAction === "moving") {
          this.#movingFacings.add(snapshot.facing);
        }
        if (this.#arrivalCount === 1) {
          if (!samePoint(snapshot.position, START)) {
            throw new Error("Character pilot route arrived away from its start root.");
          }
          this.#transition("walk-stop", "walk");
          return;
        }
        if (!snapshot.routeActive && snapshot.activeAction !== "moving") {
          throw new Error("Character pilot route became inactive before its one arrival.");
        }
        this.#failOnOverrun(WALK_PHASE_LIMIT_MS, "rectangular route");
        return;

      case "walk-stop":
        if (isIdle(snapshot)) {
          if (this.#arrivalCount !== 1) {
            throw new Error("Character pilot stop completed without exactly one arrival.");
          }
          if (this.#settledCount !== 1) {
            throw new Error("Character pilot stop returned to idle without exactly one settled marker.");
          }
          if (!samePoint(snapshot.position, START)) {
            throw new Error("Character pilot native stop displaced the actor from its root.");
          }
          this.#finalOrientFacingSwitchBaseline = this.#facingSwitchCount;
          this.#retainCommands([{ kind: "orient", facing: "south" }]);
          this.#transition("walk-orient", "walk");
          return;
        }
        this.#failOnOverrun(ACTION_PHASE_LIMIT_MS, "native stop");
        return;

      case "walk-orient":
        if (isIdle(snapshot)) {
          const expectedSwitches = this.#finalOrientFacingSwitchBaseline + 1;
          if (snapshot.facing !== "south"
            || this.#facingSwitchCount !== expectedSwitches) {
            throw new Error(
              "Character pilot final orientation returned idle without its south facing-switch.",
            );
          }
          if (!["south", "east", "north", "west"].every(
            (facing) => this.#movingFacings.has(facing),
          )) {
            throw new Error("Character pilot route did not expose all four moving facings.");
          }
          this.#retainCommands([{ kind: "set-face", expression: "neutral" }]);
          this.#transition("talk-neutral-open", "talk");
          return;
        }
        this.#failOnOverrun(ACTION_PHASE_LIMIT_MS, "final south orientation");
        return;

      case "talk-neutral-open":
        this.#assertTalkStillness(snapshot);
        if (this.#phaseElapsedMs === TALK_FACE_HOLD_MS) {
          this.#retainCommands([{ kind: "set-face", expression: "talk-1" }]);
          this.#transition("talk-one", "talk");
        } else {
          this.#failOnOverrun(TALK_FACE_HOLD_MS, "opening neutral face hold");
        }
        return;

      case "talk-one":
        this.#assertTalkStillness(snapshot);
        if (this.#phaseElapsedMs === TALK_FACE_HOLD_MS) {
          this.#retainCommands([{ kind: "set-face", expression: "talk-2" }]);
          this.#transition("talk-two", "talk");
        } else {
          this.#failOnOverrun(TALK_FACE_HOLD_MS, "talk-1 face hold");
        }
        return;

      case "talk-two":
        this.#assertTalkStillness(snapshot);
        if (this.#phaseElapsedMs === TALK_FACE_HOLD_MS) {
          this.#retainCommands([{ kind: "set-face", expression: "neutral" }]);
          this.#transition("talk-neutral-close", "talk");
        } else {
          this.#failOnOverrun(TALK_FACE_HOLD_MS, "talk-2 face hold");
        }
        return;

      case "talk-neutral-close":
        this.#assertTalkStillness(snapshot);
        if (this.#phaseElapsedMs === TALK_FACE_HOLD_MS) {
          this.#retainCommands([
            { kind: "set-held", heldId: "resource-handful" },
            { kind: "play-body", action: "reach-give" },
          ]);
          this.#transition("reach-action", "reach");
        } else {
          this.#failOnOverrun(TALK_FACE_HOLD_MS, "closing neutral face hold");
        }
        return;

      case "reach-action":
        this.#assertHeld(snapshot, "resource-handful:south", "reach-give");
        if (isIdle(snapshot)) {
          this.#requireOneMarker("hand-contact", "reach-give");
          this.#retainCommands([{ kind: "set-held", heldId: null }]);
          this.#transition("reach-gap", "reach");
          return;
        }
        this.#failOnOverrun(ACTION_PHASE_LIMIT_MS, "reach-give action");
        return;

      case "reach-gap":
        if (snapshot.layers.held.clipId !== "none:south" || !isIdle(snapshot)) {
          throw new Error("Character pilot reach gap lost its clear south-idle contract.");
        }
        if (this.#phaseElapsedMs === ACTION_GAP_MS) {
          this.#retainCommands([
            { kind: "set-held", heldId: "hammer" },
            { kind: "play-body", action: "work" },
          ]);
          this.#transition("work-action", "work");
        } else {
          this.#failOnOverrun(ACTION_GAP_MS, "post-reach action gap");
        }
        return;

      case "work-action":
        this.#assertHeld(snapshot, "hammer:south", "work");
        if (isIdle(snapshot)) {
          this.#requireOneMarker("work-contact", "work");
          this.#retainCommands([{ kind: "set-held", heldId: null }]);
          this.#transition("work-gap", "work");
          return;
        }
        this.#failOnOverrun(ACTION_PHASE_LIMIT_MS, "work action");
        return;

      case "work-gap":
        if (snapshot.layers.held.clipId !== "none:south" || !isIdle(snapshot)) {
          throw new Error("Character pilot work gap lost its clear south-idle contract.");
        }
        if (this.#phaseElapsedMs === ACTION_GAP_MS) {
          this.#retainCommands([
            { kind: "set-face", expression: "hurt" },
            { kind: "play-body", action: "hurt-fall" },
          ]);
          this.#transition("fall-action", "fall");
        } else {
          this.#failOnOverrun(ACTION_GAP_MS, "post-work action gap");
        }
        return;

      case "fall-action":
        if (isIdle(snapshot)) {
          this.#requireOneMarker("fall-contact", "hurt-fall");
          this.#retainCommands([{ kind: "set-status", status: "paralyzed" }]);
          this.#transition("prone-hold", "prone");
          return;
        }
        this.#failOnOverrun(ACTION_PHASE_LIMIT_MS, "hurt-fall action");
        return;

      case "prone-hold":
        if (snapshot.activeAction !== "prone"
          || snapshot.layers.body.clipId !== `${snapshot.appearance.rig}:prone:south`) {
          throw new Error("Character pilot prone hold lost its paralyzed body contract.");
        }
        if (this.#phaseElapsedMs === PRONE_HOLD_MS) {
          this.#retainCommands([{ kind: "recover" }]);
          this.#transition("recover-action", "recover");
        } else {
          this.#failOnOverrun(PRONE_HOLD_MS, "prone hold");
        }
        return;

      case "recover-action":
        if (isIdle(snapshot)) {
          this.#requireOneMarker("recovery-contact", "recovery");
          this.#retainCommands([
            { kind: "set-face", expression: "neutral" },
            { kind: "set-held", heldId: null },
            { kind: "orient", facing: "south" },
          ]);
          const settled = this.#actor.snapshot();
          this.#assertSettled(settled);
          this.#transition("settled-hold", "settled");
          return;
        }
        this.#failOnOverrun(ACTION_PHASE_LIMIT_MS, "reverse recovery");
        return;

      case "settled-hold":
        this.#assertSettled(snapshot);
        if (this.#phaseElapsedMs === SETTLED_HOLD_MS) {
          this.#restartLoop(false);
        } else {
          this.#failOnOverrun(SETTLED_HOLD_MS, "settled hold");
        }
    }
  }

  #consumeSignals(signals: readonly ProductionActorSignal[]): void {
    for (const signal of signals) {
      if (signal.kind === "arrived") {
        this.#arrivalCount += 1;
        if (this.#arrivalCount > 1) {
          throw new Error("Character pilot route emitted duplicate arrival signals.");
        }
        continue;
      }
      if (signal.kind !== "marker") continue;
      this.#lastMarker = signal.marker;
      if (signal.marker === "settled") {
        if (signal.action !== "stop" || signal.frameIndex !== 1) {
          throw new Error("Character pilot settled marker must belong to stop frame 1.");
        }
        this.#settledCount += 1;
        if (this.#settledCount > 1) {
          throw new Error("Character pilot stop emitted duplicate settled markers.");
        }
        continue;
      }
      if (signal.marker === "facing-switch") {
        if (signal.action !== "turn" || signal.frameIndex !== 1) {
          throw new Error("Character pilot facing-switch must belong to turn frame 1.");
        }
        this.#facingSwitchCount += 1;
        continue;
      }
      if (signal.marker in REQUIRED_MARKERS) {
        const marker = signal.marker as RequiredMarker;
        const expectation = REQUIRED_MARKERS[marker];
        if (signal.action !== expectation.action || signal.frameIndex !== expectation.frameIndex) {
          throw new Error(
            `Character pilot ${marker} must belong to ${expectation.action} `
            + `at frame ${expectation.frameIndex}; received ${signal.action} `
            + `frame ${signal.frameIndex}.`,
          );
        }
        if (this.#phase !== expectation.phase) {
          throw new Error(
            `Character pilot ${marker} arrived during ${this.#phase}, `
            + `expected ${expectation.phase}.`,
          );
        }
        this.#requiredMarkerCounts[marker] += 1;
        if (this.#requiredMarkerCounts[marker] > 1) {
          throw new Error(`Character pilot emitted duplicate ${marker} markers.`);
        }
      }
    }
  }

  #retainCommands(commands: readonly HumanPrimitiveCommand[]): void {
    void this.#actor.stageCommands(commands, this.#actorClockMs);
  }

  #transition(phase: PilotPhase, beat: PilotBeat): void {
    this.#phase = phase;
    this.#beat = beat;
    this.#phaseElapsedMs = 0;
  }

  #failOnOverrun(maximumMs: number, label: string): void {
    if (this.#phaseElapsedMs > maximumMs) {
      throw new Error(
        `Character pilot ${label} exceeded its ${maximumMs} ms phase contract.`,
      );
    }
  }

  #requireOneMarker(marker: RequiredMarker, actionLabel: string): void {
    if (this.#requiredMarkerCounts[marker] !== 1) {
      throw new Error(
        `Character pilot ${actionLabel} returned to idle without exactly one ${marker}.`,
      );
    }
  }

  #assertHeld(
    snapshot: LayeredHumanSnapshot,
    expectedClipId: string,
    actionLabel: string,
  ): void {
    if (!isIdle(snapshot) && snapshot.layers.held.clipId !== expectedClipId) {
      throw new Error(`Character pilot ${actionLabel} lost its held form before idle completion.`);
    }
  }

  #assertTalkStillness(snapshot: LayeredHumanSnapshot): void {
    if (!isIdle(snapshot)
      || !samePoint(snapshot.position, START)
      || snapshot.facing !== "south"
      || snapshot.routeActive
      || snapshot.layers.held.clipId !== "none:south") {
      throw new Error("Character pilot face-only talk mutated the body, route, or held channel.");
    }
  }

  #assertSettled(snapshot: LayeredHumanSnapshot): void {
    const visibleFace = snapshot.layers.face.clipId;
    const faceIsNeutralMicrocycle = [
      `${snapshot.appearance.rig}:south:neutral`,
      `${snapshot.appearance.rig}:south:blink-1`,
      `${snapshot.appearance.rig}:south:blink-2`,
    ].includes(visibleFace);
    if (!isIdle(snapshot)
      || !samePoint(snapshot.position, START)
      || snapshot.facing !== "south"
      || snapshot.routeActive
      || snapshot.activeAction !== null
      || !faceIsNeutralMicrocycle
      || snapshot.layers.held.clipId !== "none:south"
      || snapshot.layers.status.clipId !== "alive:south") {
      throw new Error("Character pilot failed to settle at its exact south-neutral root.");
    }
  }

  #assertInitialActor(snapshot: LayeredHumanSnapshot): void {
    if (!samePoint(snapshot.position, START)
      || snapshot.facing !== "south"
      || snapshot.distanceTravelled !== 0
      || snapshot.stridePhase !== 0
      || snapshot.routeActive
      || snapshot.activeAction !== null
      || snapshot.layers.body.clipId !== `${snapshot.appearance.rig}:idle:south`
      || snapshot.layers.body.frameIndex !== 0
      || snapshot.layers.face.clipId !== `${snapshot.appearance.rig}:south:neutral`
      || snapshot.layers.held.clipId !== "none:south"
      || snapshot.layers.status.clipId !== "alive:south") {
      throw new TypeError(
        "Character pilot timeline requires a fresh south-facing actor at its start root.",
      );
    }
  }

  #assertInstance(snapshot: LayeredHumanSnapshot): void {
    if (snapshot.instanceId !== this.#instanceId) {
      throw new Error("Character pilot replaced its persistent actor instance.");
    }
  }

  #acceptCallerTime(nowMs: number): void {
    if (!Number.isFinite(nowMs)) {
      throw new RangeError("Character pilot requires finite caller time.");
    }
    if (this.#lastCallerNowMs !== null && nowMs < this.#lastCallerNowMs) {
      throw new RangeError("Character pilot caller time must be monotonic.");
    }
    this.#lastCallerNowMs = nowMs;
  }

  #assertUsable(): void {
    if (this.#disposed) {
      throw new Error("Character pilot timeline has been disposed.");
    }
  }

  #restartLoop(clearFixedStepRemainder = true): void {
    this.#restoreInitialActor();
    this.#restoreInitialActor = this.#actor.stageCommands([], 0);
    this.#phase = "idle-hold";
    this.#beat = "idle";
    this.#actorClockMs = 0;
    this.#loopElapsedMs = 0;
    this.#phaseElapsedMs = 0;
    if (clearFixedStepRemainder) this.#fixedStepRemainderMs = 0;
    this.#lastMarker = null;
    this.#arrivalCount = 0;
    this.#settledCount = 0;
    this.#facingSwitchCount = 0;
    this.#finalOrientFacingSwitchBaseline = 0;
    this.#requiredMarkerCounts = {
      "hand-contact": 0,
      "work-contact": 0,
      "fall-contact": 0,
      "recovery-contact": 0,
    };
    this.#movingFacings = new Set();
    const restarted = this.#actor.snapshot();
    this.#assertInstance(restarted);
    this.#assertInitialActor(restarted);
  }

  #frame(signals: readonly ProductionActorSignal[]): PilotFrame {
    const actor = this.#actor.snapshot();
    this.#assertInstance(actor);
    return deepFreeze({
      beat: this.#beat,
      phase: this.#phase,
      elapsedMs: this.#loopElapsedMs,
      actor,
      signals: [...signals],
      lastMarker: this.#lastMarker,
    });
  }

  #matchesMilestone(frame: PilotFrame, milestone: PilotMilestone): boolean {
    switch (milestone) {
      case "front-idle":
        return frame.elapsedMs === 0
          && frame.beat === "idle"
          && samePoint(frame.actor.position, START)
          && frame.actor.facing === "south"
          && frame.actor.layers.body.clipId === `${frame.actor.appearance.rig}:idle:south`
          && frame.actor.layers.body.frameIndex === 0
          && frame.actor.layers.face.clipId === `${frame.actor.appearance.rig}:south:neutral`
          && frame.actor.layers.held.clipId === "none:south";
      case "east-mid-walk":
        return frame.beat === "walk"
          && samePoint(frame.actor.position, { x: 256, y: 150 })
          && frame.actor.facing === "east"
          && frame.actor.activeAction === "moving"
          && frame.actor.distanceTravelled === 78
          && frame.actor.stridePhase === 6.5
          && frame.actor.layers.body.frameIndex === 3
          && allLayersFace(frame.actor, "east");
      case "reach-contact":
        return frame.beat === "reach"
          && frame.actor.facing === "south"
          && frame.actor.layers.body.clipId
            === `${frame.actor.appearance.rig}:reach-give:south`
          && frame.actor.layers.body.frameIndex === 3
          && frame.actor.layers.held.clipId === "resource-handful:south"
          && frame.signals.some((signal) =>
            signal.kind === "marker"
            && signal.marker === "hand-contact"
            && signal.action === "reach-give"
            && signal.frameIndex === 3);
      case "prone":
        return frame.beat === "prone"
          && frame.actor.activeAction === "prone"
          && frame.actor.layers.body.clipId === `${frame.actor.appearance.rig}:prone:south`
          && frame.actor.layers.body.frameIndex === 0
          && frame.actor.layers.face.clipId === `${frame.actor.appearance.rig}:south:hurt`
          && frame.actor.layers.status.clipId === "paralyzed:south"
          && frame.lastMarker === "fall-contact";
    }
  }
}

/**
 * Create one deterministic six-beat pilot timeline around an injected production actor.
 *
 * The timeline owns actor advancement and disposal, but it never replaces the actor
 * or acquires atlas leases itself.
 */
export function createCharacterPilotTimeline(
  actor: LayeredHumanActor,
): CharacterPilotTimeline {
  return new DeterministicCharacterPilotTimeline(actor);
}
