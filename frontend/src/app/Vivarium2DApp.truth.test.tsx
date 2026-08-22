import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoryMoment } from "../presentation/BeatDirector";
import type {
  ObserverSelection,
  PresentedObserverFrame,
  PresentationSource,
} from "../presentation/contracts";
import type { PresentedChronicleWindow } from "../presentation/selectors";
import type { PresentationWorldStageProps } from "../renderer2d/production/PresentationWorldStage";
import type {
  ObserverShellRuntime,
  ObserverShellSnapshot,
} from "./observer2d/observerShellRuntime";
import { Vivarium2DApp } from "./Vivarium2DApp";

vi.mock("../renderer2d/production/PresentationWorldStage", () => ({
  PresentationWorldStage: (props: PresentationWorldStageProps) => {
    const frame = props.frameSource.getSnapshot();
    const names = frame.world.agents.map((record) => record.value.name).filter(Boolean).join(", ");
    return <section aria-label="Production world truth"
      data-stage-run={frame.runId}
      data-stage-source={frame.sourceKey}
      data-stage-revision={frame.revision}
      data-stage-range={`${frame.firstCursor}:${frame.lastCursor}`}
      data-stage-cursor={frame.presentedCursor}>
      <span>Stage World Time {frame.world.worldTime}</span>
      <span>{names}</span>
    </section>;
  },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("Vivarium2DApp composed truth boundary", () => {
  it("keeps a hostile canonical-ahead object out of Stage and every public surface", async () => {
    const frame = makeFrame("live", { kind: "agent", id: "agent_001" }, {
      dialogueText: "Old truth stays visible.",
      ingestedCursor: 99,
    });
    const fixture = runtimeFixture(frame, publicChronicle());
    const hostileCanonicalAhead = Object.freeze({
      runId: "future-run-secret",
      sourceKey: "future-source-secret",
      revision: 999,
      worldTime: 999,
      presentedCursor: 98,
      agents: [{ id: "future_agent_999", name: "Future Disclosure" }],
      regions: [{ name: "future_waste", description: "Forbidden future wasteland" }],
      event: { type: "agent_died", message: "Aster dies in the future" },
    });
    Object.assign(fixture.runtime, { canonicalAhead: hostileCanonicalAhead });

    await renderApp(fixture.runtime);

    const stage = required<HTMLElement>('[aria-label="Production world truth"]');
    expect(stage.getAttribute("data-stage-run")).toBe("shown-run");
    expect(stage.getAttribute("data-stage-source")).toBe("live:shown-run");
    expect(stage.getAttribute("data-stage-revision")).toBe("3");
    expect(stage.getAttribute("data-stage-range")).toBe("0:7");
    expect(stage.getAttribute("data-stage-cursor")).toBe("7");
    expect(stage.textContent).toContain("Stage World Time 42");
    expect(container.textContent).toContain("Old truth stays visible.");
    expect(container.textContent).not.toContain("Shown 7 · Received 99");

    await click("World");
    expect(container.textContent).toMatch(/Shown\s*7/);
    expect(container.textContent).toMatch(/Received\s*99/);
    const surfaceCopies = [publicSurface(container)];
    await click("Chronicle");
    surfaceCopies.push(publicSurface(container));
    await click("Selection");
    surfaceCopies.push(publicSurface(container));
    await click("Archive");
    surfaceCopies.push(publicSurface(container));
    const allPublicCopy = surfaceCopies.join("\n");

    expect(allPublicCopy).not.toMatch(
      /future-run-secret|future-source-secret|Future Disclosure|future_waste|Forbidden future wasteland|Aster dies in the future|future_agent_999/,
    );
    expect(JSON.stringify(hostileCanonicalAhead)).toContain("Future Disclosure");
  });

  // OWNER DECISION (Safi, 2026-07-25) "SELF_TALK RENDERS OPENLY" —
  // .superpowers/sdd/progress.md. PRIVATE self-talk (self_talk /
  // ScopeType.PRIVATE) was previously hidden from every public surface
  // unless the source agent was selected. That gate was reversed
  // deliberately: PRIVATE only means other BEINGS never perceive the
  // thought (it is never routed to another agent's inbox); the viewer is
  // not a being, so self-talk now renders on every surface regardless of
  // selection. Do not restore this gate as a regression fix.
  //
  // The fourth column (`upcomingQueued`) below is unrelated to this
  // decision: it only controls whether the fixture supplies a queued
  // `upcoming` placeholder, exercising the separate (untouched) atlas
  // queued-importance rendering path alongside the self-talk assertions.
  it.each([
    ["no selection", "live", null, false],
    ["different being", "live", { kind: "agent", id: "agent_002" }, false],
    ["home selection", "live", { kind: "home", id: "home_001" }, false],
    ["region selection", "live", { kind: "region", id: "warm_springs" }, false],
    ["moment selection", "live", { kind: "moment", id: "7:7:single", firstCursor: 7, lastCursor: 7 }, false],
    ["Archive alone", "archive", null, false],
    ["matching source being", "live", { kind: "agent", id: "agent_001" }, true],
    ["matching source being in Archive", "archive", { kind: "agent", id: "agent_001" }, true],
  ] satisfies readonly [string, PresentationSource, ObserverSelection, boolean][])(
    "shows C17 private self-talk for %s regardless of selection",
    async (_label, source, selection, upcomingQueued) => {
      const frame = makeFrame(source, selection, { privateDialogue: true });
      const privateMoment = selfTalkMoment();
      const chronicle: PresentedChronicleWindow = Object.freeze({
        now: privateMoment,
        previous: Object.freeze([privateMoment]),
        upcoming: upcomingQueued
          ? Object.freeze([{ sequence: 1, regionId: "warm_springs", urgency: "featured" as const }])
          : Object.freeze([]),
        gaps: Object.freeze([]),
      });
      const fixture = runtimeFixture(frame, chronicle);
      await renderApp(fixture.runtime);

      await click("World");
      const surfaces = [publicSurface(container)];
      const atlasPipsBefore = container.querySelectorAll(
        '.living-atlas-2d__importance [data-filled="true"]',
      ).length;
      await click("Chronicle");
      surfaces.push(publicSurface(container));
      await click("Selection");
      surfaces.push(publicSurface(container));
      await click("Archive");
      surfaces.push(publicSurface(container));
      const fullPublicSurface = surfaces.join("\n");

      expect(fullPublicSurface).toContain("I will keep this thought within.");
      // The Chronicle surface is now the event-level killfeed, so it narrates the
      // private self-talk in its own sentence rather than reprinting the moment's
      // projected title/summary. The decision this case guards -- PRIVATE scope
      // hides a thought from other BEINGS, never from the viewer -- is unchanged:
      // the utterance above and this sentence must both survive on public copy.
      expect(fullPublicSurface).toContain("Aster turned something over alone.");
      expect(atlasPipsBefore).toBe(upcomingQueued ? 1 : 0);
    },
  );
});

async function renderApp(runtime: ObserverShellRuntime): Promise<void> {
  await act(async () => root.render(<Vivarium2DApp createRuntime={() => runtime} />));
  await act(async () => runtime.ready);
}

async function click(name: string): Promise<void> {
  const target = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => (
    candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name
  ));
  if (target === undefined) throw new Error(`button ${name} was not rendered`);
  await act(async () => target.click());
}

function required<T extends Element>(selector: string): T {
  const value = container.querySelector<T>(selector);
  if (value === null) throw new Error(`required selector ${selector} was not rendered`);
  return value;
}

function publicSurface(node: Element): string {
  const attributes = [...node.querySelectorAll("*")].flatMap((element) => (
    [...element.attributes].map((attribute) => `${attribute.name}=${attribute.value}`)
  ));
  return `${node.textContent ?? ""}\n${attributes.join("\n")}`;
}

function runtimeFixture(
  frame: PresentedObserverFrame,
  chronicle: PresentedChronicleWindow,
): { readonly runtime: ObserverShellRuntime } {
  const snapshot: ObserverShellSnapshot = Object.freeze({
    status: "ready",
    frame,
    chronicle,
    controls: null,
    diagnostics: Object.freeze({ paused: false, speed: 1, held: false }) as ObserverShellSnapshot["diagnostics"],
    placement: {} as NonNullable<ObserverShellSnapshot["placement"]>,
    recipes: new Map(),
    placementOwnerId: Symbol("truth-placement"),
    placementGeneration: 1,
    cameraMode: "story",
    observedRegionId: null,
    focusRequest: null,
    archive: frame.source === "archive"
      ? Object.freeze({
        status: "active",
        sourceKey: frame.sourceKey,
        checkpoints: Object.freeze([Object.freeze({
          key: Object.freeze({ lineNumber: 4 }), eventCursor: 4, worldTime: 20,
          reason: "World checkpoint",
        })]),
        hasMore: false,
        selectedKey: Object.freeze({ lineNumber: 4 }),
      })
      : Object.freeze({
        status: "ready",
        checkpoints: Object.freeze([Object.freeze({
          key: Object.freeze({ lineNumber: 4 }), eventCursor: 4, worldTime: 20,
          reason: "World checkpoint",
        })]),
        hasMore: false,
      }),
    error: null,
  });
  const runtime = {
    ready: Promise.resolve(),
    frameSource: Object.freeze({ getSnapshot: () => frame, subscribe: () => vi.fn() }),
    frameAcceptance: Object.freeze({ markAccepted: vi.fn() }),
    subscribe: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => snapshot),
    diagnostics: vi.fn(() => snapshot.diagnostics),
    select: vi.fn(), pause: vi.fn(), resume: vi.fn(), setSpeed: vi.fn(),
    holdCurrentMoment: vi.fn(), viewMoment: vi.fn(), viewCursor: vi.fn(), retryRecovery: vi.fn(async () => undefined),
    reconnectStream: vi.fn(), setCameraMode: vi.fn(), requestFocus: vi.fn(),
    observeRegion: vi.fn(), openArchiveCatalogue: vi.fn(async () => undefined),
    loadOlderArchive: vi.fn(async () => undefined),
    enterArchiveCheckpoint: vi.fn(async () => undefined), enterArchive: vi.fn(async () => undefined),
    returnToLive: vi.fn(), dispose: vi.fn(),
  } satisfies ObserverShellRuntime;
  return { runtime };
}

function makeFrame(
  source: PresentationSource,
  selection: ObserverSelection,
  options: {
    readonly privateDialogue?: boolean;
    readonly dialogueText?: string;
    readonly ingestedCursor?: number;
  } = {},
): PresentedObserverFrame {
  const moment = options.privateDialogue ? selfTalkMoment() : publicMoment();
  const dialogueText = options.privateDialogue
    ? "I will keep this thought within."
    : options.dialogueText ?? "The springs are quiet.";
  return Object.freeze({
    runId: "shown-run",
    sourceKey: `${source}:shown-run`,
    revision: 3,
    firstCursor: 0,
    lastCursor: 7,
    source,
    ingestedCursor: options.ingestedCursor ?? 7,
    presentedCursor: 7,
    world: Object.freeze({
      exactBaseCursor: 7,
      projectedThroughCursor: 7,
      worldTime: 42,
      agents: Object.freeze([
        Object.freeze({ completeness: "exact" as const, value: Object.freeze({
          id: "agent_001", name: "Aster", persona: "A patient wanderer.",
          status: "alive" as const, position: "warm_springs", energy: 12, materials: 3,
        }) }),
        Object.freeze({ completeness: "exact" as const, value: Object.freeze({
          id: "agent_002", name: "Bramble", status: "alive" as const,
          position: "nirvana", energy: 9, materials: 1,
        }) }),
      ]),
      regions: Object.freeze([
        Object.freeze({ completeness: "exact" as const, value: Object.freeze({
          name: "warm_springs", description: "A gentle basin.", connections: ["nirvana"],
        }) }),
        Object.freeze({ completeness: "exact" as const, value: Object.freeze({
          name: "nirvana", description: "A high quiet field.", connections: [],
        }) }),
      ]),
      homes: Object.freeze([Object.freeze({ completeness: "exact" as const, value: Object.freeze({
        home_id: "home_001", owner_id: "agent_001", region: "warm_springs",
        integrity: 8, max_integrity: 10, status: "standing" as const,
      }) })]),
      ruins: Object.freeze([]),
      pendingProposals: Object.freeze([]),
    }),
    scene: Object.freeze({
      momentId: moment.id,
      regionId: "warm_springs",
      phase: "hold" as const,
      focus: Object.freeze({ kind: "agent" as const, id: "agent_001" }),
      dialogue: Object.freeze({
        speakerId: "agent_001", speakerName: "Aster", text: dialogueText,
        visibleCharacters: dialogueText.length, cursor: 7, hold: true,
      }),
      actorIntents: Object.freeze([]), homeIntents: Object.freeze([]),
      effectIntents: Object.freeze([]), safeCancelMarkers: Object.freeze([]), reducedMotion: false,
    }),
    selection,
    backlog: Object.freeze({
      pendingMoments: 0, firstPendingCursor: null, lastPendingCursor: null,
      state: "caught-up" as const, label: "Caught up",
    }),
    transport: Object.freeze({
      connection: "live" as const, ingestedCursor: options.ingestedCursor ?? 7, retryable: false,
    }),
  });
}

function publicChronicle(): PresentedChronicleWindow {
  const moment = publicMoment();
  return Object.freeze({
    now: moment,
    previous: Object.freeze([moment]),
    upcoming: Object.freeze([]),
    gaps: Object.freeze([]),
  });
}

function publicMoment(): StoryMoment {
  return moment("speak", "local", "Old truth stays visible.");
}

function selfTalkMoment(): StoryMoment {
  return moment("self_talk", "private", "I will keep this thought within.");
}

function moment(
  type: string,
  scope: "local" | "private",
  text: string,
): StoryMoment {
  const entry = Object.freeze({
    cursor: 7,
    event: Object.freeze({
      type,
      source: "agent_001",
      payload: Object.freeze({ agent_id: "agent_001", text }),
      scope,
      region: "warm_springs",
      target: null,
      timestamp: 42,
    }),
    resolved: Object.freeze({ actor_id: "agent_001", region: "warm_springs" }),
    snapshot_after: null,
  });
  return Object.freeze({
    id: "7:7:single",
    firstCursor: 7,
    lastCursor: 7,
    evidenceCursors: Object.freeze([7]),
    evidence: Object.freeze([entry]),
    representative: entry,
    chainKind: "single" as const,
    priority: "featured" as const,
    focus: Object.freeze({ kind: "agent" as const, id: "agent_001" }),
  });
}
