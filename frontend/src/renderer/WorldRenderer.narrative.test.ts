import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import type {
  EventEnvelopeEntry,
  ResolvedEventHints,
} from "../app/schemas";
import { makeEventEnvelope } from "../test/fixtures";
import {
  WorldRenderer,
  type RendererSelection,
  type SafeFrameInsets,
} from "./WorldRenderer";

interface FocusFlightHarness {
  t: number;
  duration: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromCamera: THREE.Vector3;
  toCamera: THREE.Vector3;
}

interface FocusRendererHarness {
  camera: THREE.PerspectiveCamera;
  controls: {
    target: THREE.Vector3;
    update(): void;
  };
  entityObjects: Map<string, THREE.Object3D>;
  enforceStateOwnedPointLightBudget(): void;
  focus: FocusFlightHarness;
  focusCameraOn(point: THREE.Vector3): void;
  focusHome(homeId: string): boolean;
  focusRegion(regionName: string): boolean;
  invalidateFrame(): void;
  motionSettings: { focusDuration: number };
  publishDebugHandle(): void;
  renderer: {
    domElement: { getBoundingClientRect(): DOMRect };
    setSize(): void;
  };
  safeFrame: SafeFrameInsets;
  terrainHeight(x: number, z: number): number;
}

interface BubbleRendererHarness {
  addBubbleEffect(input: unknown): void;
  addSpecialEventEffects(): void;
  anchorForAgent(id: string | undefined): THREE.Vector3 | null;
  anchorForHome(id: string | undefined): THREE.Vector3 | null;
  anchorForRegion(id: string | undefined): THREE.Vector3 | null;
  appliedEventCursors: Set<number>;
  bubbleEventDebugSummary(): undefined;
  bubbleLayoutSignature: string;
  container: HTMLElement;
  effectRoot: THREE.Group;
  effects: Array<{
    id?: string;
    bubble?: unknown;
    label?: { element: HTMLElement };
  }>;
  eventPresentationContext: Record<string, never>;
  enforceActiveBubbleLimit(): void;
  focusSelection(selection: RendererSelection): boolean;
  initialBubbleLane(): {
    lane: number;
    offsetX: number;
    offsetY: number;
    screen: null;
  };
  motionSettings: { mode: "reduced" };
  options: { onBeatSelect?(cursor: number): void };
  registerEffect(effect: { label?: { element: HTMLElement } }): void;
  rememberEventCursor(cursor: number): void;
  rememberRenderedEventBeat(): void;
  renderedEventCursors: Set<number>;
  shouldRenderDefaultArc(): boolean;
  shouldRenderDefaultPulse(): boolean;
  shouldRenderSpecialEffects(): boolean;
  snapshotCursorFloor: number;
  systemEventAnchor(): THREE.Vector3;
  time: number;
}

interface BubbleCapEffect {
  eventType: string;
  root: THREE.Group;
  materials: THREE.Material[];
  age: number;
  duration: number;
  bubble: {
    cursor: number;
    priority: "ambient" | "featured" | "drama";
  };
}

interface BubbleCapHarness {
  bubbleLayoutSignature: string;
  effects: BubbleCapEffect[];
  invalidateFrame(): void;
  lifecycleCounters: { culledEffectCount: number };
  renderer: { domElement: { getBoundingClientRect(): DOMRect } };
  disposeEffect(effect: BubbleCapEffect): void;
}

type AddBubbleEffect = (
  this: BubbleRendererHarness,
  input: unknown,
) => void;

type ApplyEventBeat = (
  this: BubbleRendererHarness,
  entry: EventEnvelopeEntry,
) => void;

const focusCameraOn = Reflect.get(
  WorldRenderer.prototype,
  "focusCameraOn",
) as FocusRendererHarness["focusCameraOn"];

const addBubbleEffect = Reflect.get(
  WorldRenderer.prototype,
  "addBubbleEffect",
) as AddBubbleEffect;

const applyEventBeat = WorldRenderer.prototype.applyEventBeat as ApplyEventBeat;

const enforceActiveBubbleLimit = Reflect.get(
  WorldRenderer.prototype,
  "enforceActiveBubbleLimit",
) as (this: BubbleCapHarness) => void;

describe("WorldRenderer narrative focus", () => {
  it("normalizes finite safe-frame insets and invalidates without resizing canvas", () => {
    const invalidateFrame = vi.fn();
    const setSize = vi.fn();
    const harness = {
      safeFrame: { top: 0, right: 0, bottom: 0, left: 0 },
      bubbleLayoutSignature: "laid-out",
      invalidateFrame,
      renderer: { setSize },
    };

    WorldRenderer.prototype.setSafeFrame.call(harness, {
      top: Number.NaN,
      right: -20,
      bottom: Number.POSITIVE_INFINITY,
      left: 144,
    });

    expect(harness.safeFrame).toEqual({ top: 0, right: 0, bottom: 0, left: 144 });
    expect(harness.bubbleLayoutSignature).toBe("");
    expect(invalidateFrame).toHaveBeenCalledTimes(1);
    expect(setSize).not.toHaveBeenCalled();

    WorldRenderer.prototype.setSafeFrame.call(harness, {
      top: -1,
      right: Number.NaN,
      bottom: Number.NEGATIVE_INFINITY,
      left: 144,
    });
    expect(invalidateFrame).toHaveBeenCalledTimes(1);
  });

  it("focuses agent, home, and region selections and rejects missing agents", () => {
    const agent = new THREE.Object3D();
    agent.position.set(3, 2, -4);
    agent.updateMatrixWorld(true);
    const focusAgent = vi.fn();
    const focusHome = vi.fn(() => true);
    const focusRegion = vi.fn(() => true);
    const harness = {
      entityObjects: new Map([["agent:agent_1", agent]]),
      focusCameraOn: focusAgent,
      focusHome,
      focusRegion,
    };

    expect(WorldRenderer.prototype.focusSelection.call(harness, {
      kind: "agent",
      id: "agent_1",
    })).toBe(true);
    expect(focusAgent).toHaveBeenCalledWith(new THREE.Vector3(3, 2, -4), 9);

    expect(WorldRenderer.prototype.focusSelection.call(harness, {
      kind: "home",
      id: "home_1",
    })).toBe(true);
    expect(focusHome).toHaveBeenCalledWith("home_1");

    expect(WorldRenderer.prototype.focusSelection.call(harness, {
      kind: "region",
      id: "meadow",
    })).toBe(true);
    expect(focusRegion).toHaveBeenCalledWith("meadow");

    expect(WorldRenderer.prototype.focusSelection.call(harness, {
      kind: "agent",
      id: "missing",
    })).toBe(false);
    expect(focusAgent).toHaveBeenCalledTimes(1);
  });

  it("places the focused subject inside the safe visual center", () => {
    const fullFrame = focusHarness(0);
    const rightDrawer = focusHarness(400);

    expect(WorldRenderer.prototype.focusSelection.call(fullFrame, {
      kind: "agent",
      id: "agent_1",
    })).toBe(true);
    expect(WorldRenderer.prototype.focusSelection.call(rightDrawer, {
      kind: "agent",
      id: "agent_1",
    })).toBe(true);

    expect(fullFrame.controls.target.x).toBeCloseTo(4);
    expect(rightDrawer.controls.target.x).toBeGreaterThan(fullFrame.controls.target.x);
    expect(rightDrawer.renderer.setSize).not.toHaveBeenCalled();
  });
});

describe("WorldRenderer actionable event bubbles", () => {
  it("makes a structured focus bubble a button that focuses and reports its cursor", () => {
    const onBeatSelect = vi.fn();
    const focusSelection = vi.fn(() => true);
    const harness = bubbleHarness({ onBeatSelect, focusSelection });

    applyEventBeat.call(harness, eventEntry("home_thieved", {
      actor_id: "agent_001",
      home_id: "home_001",
      region: "meadow",
    }));

    const element = firstBubbleElement(harness);
    expect(element.tagName).toBe("BUTTON");
    expect((element as HTMLButtonElement).type).toBe("button");
    expect(element.style.pointerEvents).toBe("auto");
    expect(element.dataset.eventFocusKind).toBe("home");
    expect(element.dataset.eventFocusId).toBe("home_001");

    element.click();
    expect(focusSelection).toHaveBeenCalledWith({ kind: "home", id: "home_001" });
    expect(onBeatSelect).toHaveBeenCalledWith(5);
  });

  it("keeps a system bubble noninteractive when it has no focus target", () => {
    const onBeatSelect = vi.fn();
    const focusSelection = vi.fn(() => true);
    const harness = bubbleHarness({ onBeatSelect, focusSelection });

    applyEventBeat.call(harness, eventEntry("simulation_started", {}, "system"));

    const element = firstBubbleElement(harness);
    expect(element.tagName).toBe("DIV");
    expect(element.style.pointerEvents).not.toBe("auto");
    expect(element.hasAttribute("role")).toBe(false);
    expect(focusSelection).not.toHaveBeenCalled();
    expect(onBeatSelect).not.toHaveBeenCalled();
  });

  it("accounts for a new same-type same-time bubble when its generated id is reused", () => {
    const harness = bubbleHarness({
      onBeatSelect: vi.fn(),
      focusSelection: vi.fn(() => true),
    });
    const rememberRenderedEventBeat = vi.fn();
    harness.rememberRenderedEventBeat = rememberRenderedEventBeat;
    harness.effects.push({ id: "speak:0:1", bubble: {} });

    applyEventBeat.call(harness, eventEntry("speak", {
      actor_id: "agent_001",
      region: "meadow",
    }));

    expect(rememberRenderedEventBeat).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 5 }),
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ id: "speak:0:1" })]),
      expect.objectContaining({ hasBubble: true }),
    );
  });

  it("caps desktop bubbles at three and lets drama then newer cursors preempt", () => {
    const disposeEffect = vi.fn();
    const harness: BubbleCapHarness = {
      bubbleLayoutSignature: "laid-out",
      effects: [
        capEffect("ambient_new", 99, "ambient"),
        capEffect("drama_old", 5, "drama"),
        capEffect("featured_new", 100, "featured"),
        capEffect("drama_mid", 6, "drama"),
        capEffect("drama_new", 8, "drama"),
        capEffect("drama_next", 7, "drama"),
      ],
      lifecycleCounters: { culledEffectCount: 0 },
      invalidateFrame: vi.fn(),
      renderer: {
        domElement: { getBoundingClientRect: () => new DOMRect(0, 0, 1_000, 600) },
      },
      disposeEffect,
    };

    enforceActiveBubbleLimit.call(harness);

    expect(harness.effects.map((effect) => effect.bubble.cursor)).toEqual([6, 8, 7]);
    expect(disposeEffect).toHaveBeenCalledTimes(3);
    expect(harness.lifecycleCounters.culledEffectCount).toBe(3);
  });

  it("caps mobile and very-short bubbles at one newest drama", () => {
    for (const rect of [
      new DOMRect(0, 0, 390, 844),
      new DOMRect(0, 0, 1_498, 265),
    ]) {
      const harness: BubbleCapHarness = {
        bubbleLayoutSignature: "laid-out",
        effects: [
          capEffect("ambient_new", 99, "ambient"),
          capEffect("drama_old", 5, "drama"),
          capEffect("drama_new", 8, "drama"),
        ],
        lifecycleCounters: { culledEffectCount: 0 },
        invalidateFrame: vi.fn(),
        renderer: { domElement: { getBoundingClientRect: () => rect } },
        disposeEffect: vi.fn(),
      };

      enforceActiveBubbleLimit.call(harness);

      expect(harness.effects.map((effect) => effect.bubble.cursor)).toEqual([8]);
      expect(harness.lifecycleCounters.culledEffectCount).toBe(2);
    }
  });
});

function capEffect(
  eventType: string,
  cursor: number,
  priority: "ambient" | "featured" | "drama",
): BubbleCapEffect {
  return {
    eventType,
    root: new THREE.Group(),
    materials: [],
    age: 0,
    duration: 4,
    bubble: { cursor, priority },
  };
}

function focusHarness(safeRight: number): FocusRendererHarness {
  const agent = new THREE.Object3D();
  agent.position.set(4, 0, 2);
  agent.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(45, 1_000 / 600, 0.1, 700);
  camera.position.set(0, 10, 10);
  camera.updateMatrixWorld(true);
  return {
    camera,
    controls: {
      target: new THREE.Vector3(),
      update: vi.fn(),
    },
    entityObjects: new Map([["agent:agent_1", agent]]),
    enforceStateOwnedPointLightBudget: vi.fn(),
    focus: {
      t: 1,
      duration: 0.72,
      fromTarget: new THREE.Vector3(),
      toTarget: new THREE.Vector3(),
      fromCamera: new THREE.Vector3(),
      toCamera: new THREE.Vector3(),
    },
    focusCameraOn,
    focusHome: vi.fn(() => true),
    focusRegion: vi.fn(() => true),
    invalidateFrame: vi.fn(),
    motionSettings: { focusDuration: 0 },
    publishDebugHandle: vi.fn(),
    renderer: {
      domElement: {
        getBoundingClientRect: () => new DOMRect(0, 0, 1_000, 600),
      },
      setSize: vi.fn(),
    },
    safeFrame: { top: 0, right: safeRight, bottom: 0, left: 0 },
    terrainHeight: () => 0,
  };
}

function bubbleHarness({
  onBeatSelect,
  focusSelection,
}: {
  onBeatSelect(cursor: number): void;
  focusSelection(selection: RendererSelection): boolean;
}): BubbleRendererHarness {
  const effects: BubbleRendererHarness["effects"] = [];
  return {
    addBubbleEffect,
    addSpecialEventEffects: vi.fn(),
    anchorForAgent: (id) => id ? new THREE.Vector3(1, 0, 1) : null,
    anchorForHome: (id) => id ? new THREE.Vector3(2, 0, 2) : null,
    anchorForRegion: (id) => id ? new THREE.Vector3(3, 0, 3) : null,
    appliedEventCursors: new Set(),
    bubbleEventDebugSummary: () => undefined,
    bubbleLayoutSignature: "",
    container: document.createElement("div"),
    effectRoot: new THREE.Group(),
    effects,
    enforceActiveBubbleLimit: vi.fn(),
    eventPresentationContext: {},
    focusSelection,
    initialBubbleLane: () => ({ lane: 0, offsetX: 0, offsetY: 0, screen: null }),
    motionSettings: { mode: "reduced" },
    options: { onBeatSelect },
    registerEffect: (effect) => effects.push(effect),
    rememberEventCursor(cursor) {
      this.appliedEventCursors.add(cursor);
    },
    rememberRenderedEventBeat: vi.fn(),
    renderedEventCursors: new Set(),
    shouldRenderDefaultArc: () => false,
    shouldRenderDefaultPulse: () => false,
    shouldRenderSpecialEffects: () => false,
    snapshotCursorFloor: 0,
    systemEventAnchor: () => new THREE.Vector3(),
    time: 0,
  };
}

function eventEntry(
  type: string,
  resolved: ResolvedEventHints,
  source = "agent_001",
): EventEnvelopeEntry {
  const base = makeEventEnvelope().events[0];
  if (!base) {
    throw new Error("The event fixture must include one event.");
  }
  return {
    ...base,
    event: {
      ...base.event,
      type,
      source,
      region: resolved.region ?? null,
      payload: {},
    },
    resolved,
  };
}

function firstBubbleElement(harness: BubbleRendererHarness): HTMLElement {
  const element = harness.effects[0]?.label?.element.querySelector<HTMLElement>(
    ".viv-event-bubble",
  );
  if (!element) {
    throw new Error("Expected a rendered event bubble.");
  }
  return element;
}
