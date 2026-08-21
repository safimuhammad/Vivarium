import { describe, expect, it, vi } from "vitest";

import type { ActorCommand } from "./actors/HumanActor";
import type { CameraIntent } from "./camera/Camera2D";
import type { DialogueState } from "./contracts";
import { createDemoTimelineController, type DemoSceneBindings, type DemoTimelineController } from "./demoScene";
import type { ShelterCommand } from "./homes/ShelterActor";

function harness(onDialogue?: (next: DialogueState | null, notify: boolean) => void) {
  let value = 0;
  let dialogue: DialogueState | null = null;
  const resets: string[] = [];
  const actorCommands: ActorCommand[] = [];
  const shelterCommands: ShelterCommand[] = [];
  const cameraIntents: CameraIntent[] = [];
  let currentActorCommands: ActorCommand[] = [];
  let currentShelterCommands: ShelterCommand[] = [];
  let currentCameraIntents: CameraIntent[] = [];
  const outwardDialogue = vi.fn();
  const draws = vi.fn();
  const bindings: DemoSceneBindings = {
    reset(scene) {
      resets.push(scene); value = 0; dialogue = null;
      currentActorCommands = []; currentShelterCommands = []; currentCameraIntents = [];
    },
    applyActor(_id, command) { actorCommands.push(command); currentActorCommands.push(command); },
    applyShelter(_id, command, _nowMs) { shelterCommands.push(command); currentShelterCommands.push(command); },
    applyCamera(intent) { cameraIntents.push(intent); currentCameraIntents.push(intent); },
    setDialogue(next, notify) { dialogue = next; if (notify) outwardDialogue(next); onDialogue?.(next, notify); },
    update(deltaMs) { value += deltaMs; },
    draw: draws,
    nextDynamicDeadlineMs: () => null,
  };
  return {
    bindings, resets, actorCommands, shelterCommands, cameraIntents, outwardDialogue, draws,
    value: () => value,
    dialogue: () => dialogue,
    state: () => ({
      value,
      dialogue,
      actorCommands: structuredClone(currentActorCommands),
      shelterCommands: structuredClone(currentShelterCommands),
      cameraIntents: structuredClone(currentCameraIntents),
    }),
  };
}

describe("DemoTimelineController", () => {
  it("defines the non-looping full-loop cue epochs", () => {
    const test = harness();
    const timeline = createDemoTimelineController({ scene: "full-loop", bindings: test.bindings });
    expect(timeline.durationMs).toBe(16_000);
    expect(timeline.nextDeadlineMs()).toBe(800);
    timeline.advanceTo(12_000);
    expect(test.actorCommands.some((command) => command.type === "moveTo")).toBe(true);
    expect(test.actorCommands.some((command) => command.type === "action" && command.payload.action === "none")).toBe(true);
    expect(test.shelterCommands.map((command) => command.type)).toEqual(["build", "collapse"]);
    expect(test.outwardDialogue).toHaveBeenCalledTimes(2);
    expect(timeline.nextDeadlineMs()).toBe(16_000);
    timeline.advanceTo(16_000);
    expect(timeline.nextDeadlineMs()).toBeNull();
  });

  it.each([
    { scene: "shelter-build" as const, workAtMs: 5_900, buildAtMs: 6_000 },
    { scene: "full-loop" as const, workAtMs: 6_300, buildAtMs: 6_500 },
  ])("arrives and faces the shelter before work and build cues in $scene", ({ scene, workAtMs, buildAtMs }) => {
    const test = harness();
    const timeline = createDemoTimelineController({ scene, bindings: test.bindings });

    timeline.advanceTo(workAtMs - 1);
    expect(test.actorCommands.some((command) => command.type === "moveTo")).toBe(true);
    expect(test.actorCommands.some((command) => command.type === "action" && command.payload.action === "work")).toBe(false);
    expect(test.shelterCommands).toEqual([]);

    timeline.advanceTo(workAtMs);
    expect(test.actorCommands.at(-1)).toMatchObject({ type: "action", payload: { action: "work" } });
    expect(test.actorCommands.some((command) => command.type === "face" && command.payload.direction === "north")).toBe(true);
    expect(test.shelterCommands).toEqual([]);

    timeline.advanceTo(buildAtMs);
    expect(test.shelterCommands).toEqual([{ type: "build", durationMs: 3_200 }]);
  });

  it("reconstructs deterministic seek state at fixed 60 Hz without outward callbacks", () => {
    const test = harness();
    const timeline = createDemoTimelineController({ scene: "full-loop", bindings: test.bindings });
    timeline.advanceTo(8_750);
    const first = { value: test.value(), dialogue: test.dialogue(), actors: [...test.actorCommands], shelters: [...test.shelterCommands] };
    test.outwardDialogue.mockClear();
    test.draws.mockClear();
    timeline.seek(8_750);
    expect({ value: test.value(), dialogue: test.dialogue(), actors: test.actorCommands.slice(first.actors.length), shelters: test.shelterCommands.slice(first.shelters.length) })
      .toEqual({ value: first.value, dialogue: first.dialogue, actors: first.actors, shelters: first.shelters });
    expect(test.outwardDialogue).not.toHaveBeenCalled();
    expect(test.draws).toHaveBeenCalledTimes(1);
  });

  it("uses one pristine reset path for restart and setScene", () => {
    const test = harness();
    const timeline = createDemoTimelineController({ scene: "full-loop", bindings: test.bindings });
    timeline.advanceTo(9_000);
    timeline.restart();
    expect(test.resets.at(-1)).toBe("full-loop");
    expect(timeline.currentTimeMs()).toBe(0);
    timeline.setScene("shelter-collapse");
    expect(test.resets.at(-1)).toBe("shelter-collapse");
    expect(timeline.currentTimeMs()).toBe(0);
    expect(timeline.durationMs).toBe(4_000);
  });

  it("has no deadline after the final cue when dynamic state is static", () => {
    const test = harness();
    const timeline = createDemoTimelineController({ scene: "walk", bindings: test.bindings });
    timeline.seek(timeline.durationMs);
    expect(timeline.nextDeadlineMs()).toBeNull();
  });

  it.each(["restart", "seek", "setScene"] as const)("commits a dialogue cue before a re-entrant %s", (operation) => {
    let timeline!: DemoTimelineController;
    let reentered = false;
    const test = harness((_next, notify) => {
      if (!notify || reentered) return;
      reentered = true;
      if (operation === "restart") timeline.restart();
      else if (operation === "seek") timeline.seek(1_000);
      else timeline.setScene("walk");
    });
    timeline = createDemoTimelineController({ scene: "full-loop", bindings: test.bindings });

    timeline.advanceTo(3_200);

    expect(reentered).toBe(true);
    expect(timeline.sceneName()).toBe(operation === "setScene" ? "walk" : "full-loop");
    expect(timeline.currentTimeMs()).toBe(operation === "seek" ? 1_000 : 0);
    expect(test.outwardDialogue).toHaveBeenCalledTimes(1);
  });

  it("matches pristine replay across large jumps and every cue boundary plus or minus epsilon", () => {
    const epsilon = 1e-5;
    const boundaries = [0, 800, 3_200, 6_500, 9_700, 10_500, 12_000, 14_400, 16_000];
    const targets = boundaries.flatMap((boundary) => [boundary + epsilon, boundary, boundary - epsilon])
      .map((value) => Math.max(0, Math.min(16_000, value)));
    const test = harness();
    const timeline = createDemoTimelineController({ scene: "full-loop", bindings: test.bindings });

    for (const target of [...targets].reverse()) {
      timeline.seek(target);
      const expected = harness();
      const pristine = createDemoTimelineController({ scene: "full-loop", bindings: expected.bindings });
      pristine.seek(target);
      expect(test.state(), `target ${target}`).toEqual(expected.state());
      expect(timeline.currentTimeMs()).toBe(target);
    }
  });
});
