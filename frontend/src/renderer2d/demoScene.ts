import type { ActorCommand } from "./actors/HumanActor";
import type { CameraIntent } from "./camera/Camera2D";
import type { DialogueState } from "./contracts";
import type { ShelterCommand } from "./homes/ShelterActor";
import { deriveDemoRegionMap, tileCenter } from "./map/regionMap";
import { findPath } from "./map/navigation";

export type DemoSceneName = "walk" | "dialogue" | "shelter-build" | "shelter-collapse" | "full-loop";

export type DemoCue =
  | { readonly atMs: number; readonly type: "actor-command"; readonly actorId: string; readonly command: ActorCommand }
  | { readonly atMs: number; readonly type: "shelter-command"; readonly shelterId: string; readonly command: ShelterCommand }
  | { readonly atMs: number; readonly type: "dialogue"; readonly value: DialogueState | null }
  | { readonly atMs: number; readonly type: "camera"; readonly intent: CameraIntent };

export interface DemoTimelineController {
  readonly durationMs: number;
  advanceTo(milliseconds: number): void;
  seek(milliseconds: number): void;
  restart(): void;
  setScene(scene: DemoSceneName): void;
  nextDeadlineMs(): number | null;
  currentTimeMs(): number;
  sceneName(): DemoSceneName;
}

export interface DemoSceneBindings {
  reset(scene: DemoSceneName): void;
  applyActor(actorId: string, command: ActorCommand): void;
  applyShelter(shelterId: string, command: ShelterCommand, nowMs: number): void;
  applyCamera(intent: CameraIntent): void;
  setDialogue(dialogue: DialogueState | null, notify: boolean): void;
  update(deltaMs: number, nowMs: number): void;
  draw(): void;
  nextDynamicDeadlineMs(): number | null;
  operationToken?(): number;
}

const FIXED_STEP_MS = 1000 / 60;
const ACTOR_ID = "agent_aster";
const SHELTER_ID = "shelter-east";
const STORY_TARGET = { x: 96, y: 56, width: 320, height: 176 } as const;
const DIALOGUE: DialogueState = {
  speakerId: ACTOR_ID,
  speakerName: "Aster",
  text: "The path remembers every footstep.",
  visibleCharacters: 34,
  cursor: 34,
  hold: true,
};

interface SceneDefinition {
  readonly durationMs: number;
  readonly cues: readonly DemoCue[];
}

const map = deriveDemoRegionMap(7_113);
const firstEastStep = { column: map.anchors.spawn.column + 1, row: map.anchors.spawn.row };
const route = [
  tileCenter(map.anchors.spawn),
  ...findPath(map, { start: firstEastStep, goal: map.anchors.shelterDoor }).waypoints,
];
const idle = (atMs: number): DemoCue => ({
  atMs,
  type: "actor-command",
  actorId: ACTOR_ID,
  command: { type: "status", payload: { locomotion: "idle", face: "neutral" } },
});
const story = (atMs: number): DemoCue => ({ atMs, type: "camera", intent: { type: "story-target", target: STORY_TARGET } });
const walk = (atMs: number, speedPixelsPerSecond = 80): DemoCue => ({
  atMs,
  type: "actor-command",
  actorId: ACTOR_ID,
  command: { type: "moveTo", payload: { waypoints: route, speedPixelsPerSecond } },
});
const faceShelter = (atMs: number): DemoCue => ({
  atMs,
  type: "actor-command",
  actorId: ACTOR_ID,
  command: { type: "face", payload: { direction: "north" } },
});
const work = (atMs: number): DemoCue => ({
  atMs,
  type: "actor-command",
  actorId: ACTOR_ID,
  command: { type: "action", payload: { action: "work", clipId: "work" } },
});

const SCENES: Readonly<Record<DemoSceneName, SceneDefinition>> = {
  walk: { durationMs: 4_000, cues: [idle(0), story(0), walk(800)] },
  dialogue: {
    durationMs: 4_500,
    cues: [idle(0), story(0), { atMs: 800, type: "dialogue", value: DIALOGUE }, {
      atMs: 800, type: "actor-command", actorId: ACTOR_ID,
      command: { type: "action", payload: { action: "speak", clipId: "talk" } },
    }, { atMs: 3_200, type: "dialogue", value: null }, idle(3_200)],
  },
  "shelter-build": {
    durationMs: 10_000,
    cues: [
      idle(0), story(0), walk(400), faceShelter(5_800), work(5_900),
      { atMs: 6_000, type: "shelter-command", shelterId: SHELTER_ID, command: { type: "build", durationMs: 3_200 } },
      idle(9_400),
    ],
  },
  "shelter-collapse": {
    durationMs: 4_000,
    cues: [idle(0), story(0), {
      atMs: 0, type: "shelter-command", shelterId: SHELTER_ID, command: { type: "settle", phase: "standing" },
    }, { atMs: 800, type: "shelter-command", shelterId: SHELTER_ID, command: { type: "collapse", durationMs: 2_400 } }],
  },
  "full-loop": {
    durationMs: 16_000,
    cues: [
      idle(0), story(0), walk(800),
      { atMs: 3_200, type: "dialogue", value: DIALOGUE },
      { atMs: 3_200, type: "actor-command", actorId: ACTOR_ID, command: { type: "action", payload: { action: "speak", clipId: "talk" } } },
      { atMs: 6_200, type: "dialogue", value: null },
      faceShelter(6_200),
      work(6_300),
      { atMs: 6_500, type: "shelter-command", shelterId: SHELTER_ID, command: { type: "build", durationMs: 3_200 } },
      { atMs: 10_500, type: "actor-command", actorId: ACTOR_ID, command: { type: "action", payload: { action: "none", clipId: "empty" } } },
      idle(10_500),
      { atMs: 12_000, type: "shelter-command", shelterId: SHELTER_ID, command: { type: "collapse", durationMs: 2_400 } },
    ],
  },
};

function finiteTime(value: number, durationMs: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(durationMs, Math.max(0, value));
}

/** Creates the deterministic, explicitly non-looping slice demonstration clock. */
export function createDemoTimelineController(options: {
  readonly scene: DemoSceneName;
  readonly bindings: DemoSceneBindings;
}): DemoTimelineController {
  let scene = options.scene;
  let definition = SCENES[scene];
  let nowMs = 0;
  let cueIndex = 0;
  let muted = false;
  let revision = 0;

  const applyCue = (cue: DemoCue): void => {
    switch (cue.type) {
      case "actor-command": options.bindings.applyActor(cue.actorId, cue.command); break;
      case "shelter-command": options.bindings.applyShelter(cue.shelterId, cue.command, cue.atMs); break;
      case "camera": options.bindings.applyCamera(cue.intent); break;
      case "dialogue": options.bindings.setDialogue(cue.value, !muted); break;
    }
  };

  const operationIsCurrent = (operationRevision: number, bindingToken: number): boolean => (
    revision === operationRevision && (options.bindings.operationToken?.() ?? bindingToken) === bindingToken
  );

  const applyCuesThrough = (timeMs: number, operationRevision: number, bindingToken: number): boolean => {
    while (cueIndex < definition.cues.length && definition.cues[cueIndex]!.atMs <= timeMs + 1e-7) {
      const cue = definition.cues[cueIndex]!;
      cueIndex += 1;
      applyCue(cue);
      if (!operationIsCurrent(operationRevision, bindingToken)) return false;
    }
    return true;
  };

  const advanceState = (targetMs: number, operationRevision: number, bindingToken: number): boolean => {
    const target = finiteTime(targetMs, definition.durationMs);
    while (nowMs < target - 1e-7) {
      if (!applyCuesThrough(nowMs, operationRevision, bindingToken)) return false;
      const stepEnd = Math.min(target, nowMs + FIXED_STEP_MS);
      const cueAt = definition.cues[cueIndex]?.atMs;
      const segmentEnd = cueAt !== undefined && cueAt > nowMs + 1e-7 && cueAt <= stepEnd + 1e-7 ? cueAt : stepEnd;
      options.bindings.update(segmentEnd - nowMs, segmentEnd);
      if (!operationIsCurrent(operationRevision, bindingToken)) return false;
      nowMs = segmentEnd;
      if (!applyCuesThrough(nowMs, operationRevision, bindingToken)) return false;
    }
    nowMs = target;
    return operationIsCurrent(operationRevision, bindingToken);
  };

  const resetAndReplay = (targetMs: number): void => {
    const operationRevision = ++revision;
    options.bindings.reset(scene);
    const bindingToken = options.bindings.operationToken?.() ?? 0;
    nowMs = 0;
    cueIndex = 0;
    muted = true;
    try {
      if (!applyCuesThrough(0, operationRevision, bindingToken)) return;
      if (!advanceState(targetMs, operationRevision, bindingToken)) return;
    } finally {
      muted = false;
    }
    if (operationIsCurrent(operationRevision, bindingToken)) options.bindings.draw();
  };

  resetAndReplay(0);

  return {
    get durationMs() { return definition.durationMs; },
    advanceTo(milliseconds) {
      const target = finiteTime(milliseconds, definition.durationMs);
      if (target < nowMs) { resetAndReplay(target); return; }
      const operationRevision = ++revision;
      const bindingToken = options.bindings.operationToken?.() ?? 0;
      if (advanceState(target, operationRevision, bindingToken) && operationIsCurrent(operationRevision, bindingToken)) {
        options.bindings.draw();
      }
    },
    seek(milliseconds) { resetAndReplay(finiteTime(milliseconds, definition.durationMs)); },
    restart() { resetAndReplay(0); },
    setScene(nextScene) {
      scene = nextScene;
      definition = SCENES[scene];
      resetAndReplay(0);
    },
    nextDeadlineMs() {
      if (nowMs >= definition.durationMs - 1e-7) return null;
      const cue = definition.cues.slice(cueIndex).find((candidate) => candidate.atMs > nowMs + 1e-7)?.atMs ?? null;
      const dynamic = options.bindings.nextDynamicDeadlineMs();
      const candidates = [cue, dynamic, definition.durationMs].filter((value): value is number => value !== null
        && value > nowMs + 1e-7 && value <= definition.durationMs);
      return candidates.length === 0 ? null : Math.min(...candidates);
    },
    currentTimeMs: () => nowMs,
    sceneName: () => scene,
  };
}

export const DEMO_ACTOR_ID = ACTOR_ID;
export const DEMO_SHELTER_ID = SHELTER_ID;
export const DEMO_SPAWN_POSITION = tileCenter(map.anchors.spawn);
export const DEMO_SHELTER_POSITION = tileCenter(map.shelterPlots[0]!.tile);
