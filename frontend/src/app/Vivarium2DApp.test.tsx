import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoryMoment } from "../presentation/BeatDirector";
import type { PresentedObserverFrame } from "../presentation/contracts";
import type { PresentedChronicleWindow } from "../presentation/selectors";
import type { PresentationWorldStageProps } from "../renderer2d/production/PresentationWorldStage";
import type { RendererSemanticSnapshot } from "../renderer2d/production/semantics";
import type { AgentStatus } from "./schemas";
import type { ObserverShellRuntime, ObserverShellSnapshot } from "./observer2d/observerShellRuntime";
import { observerSafeFrameFromRects, Vivarium2DApp } from "./Vivarium2DApp";
import { getProductionStageDebugProbe } from "../renderer2d/production/debug";
import type { SharedAtlasPool } from "../renderer2d/production/assets/SharedAtlasPool";

vi.mock("../renderer2d/production/PresentationWorldStage", () => ({
  PresentationWorldStage: (props: PresentationWorldStageProps) => {
    const frame = props.frameSource.getSnapshot();
    latestStageSemanticCallback = props.callbacks?.onSemanticSnapshot ?? null;
    stageSafeFrames.push(props.safeFrame);
    stageAtlasPools.push(props.atlasPool);
    return <section className="presentation-world-stage" aria-label="Production world" tabIndex={0} data-presented-cursor={frame.presentedCursor}
      data-requested-camera={props.cameraMode}
      data-resume-serial={props.resumeStorySerial}
      data-follow-serial={props.followRequest?.serial ?? 0}
      data-follow-subject={props.followRequest === null || props.followRequest === undefined
        ? "" : props.followRequest.selection.id}
      data-safe-frame={JSON.stringify(props.safeFrame)}>
      <button type="button" onClick={() => props.callbacks?.onCameraAuthorityChange?.(true)}>
        Viewer takes the camera
      </button>
      <button type="button" onClick={() => props.callbacks?.onCameraAuthorityChange?.(false)}>
        Director takes the camera
      </button>
      <button type="button" onClick={() => props.onManualCameraGesture?.()}>
        Manual zoom
      </button>
      <button type="button" onClick={() => props.callbacks?.onSelectionChange?.({ kind: "region", id: "meadow" })}>
        Select world region
      </button>
      <button type="button" onClick={() => props.callbacks?.onSelectionChange?.({ kind: "agent", id: "aster" })}>
        Select world being
      </button>
      <button type="button" onClick={() => props.callbacks?.onSelectionChange?.({ kind: "agent", id: "rhea" })}>
        Select another world being
      </button>
      <button type="button" onClick={() => props.callbacks?.onCameraModeChange?.(props.cameraMode ?? "story")}>
        Accept camera request
      </button>
      <button type="button" onClick={() => props.onCameraModeRequestRejected?.(props.cameraMode ?? "story")}>
        Reject camera request
      </button>
      <button type="button" onClick={() => props.onCameraModeRequestRejected?.("follow")}>
        Reject follow latch
      </button>
      {/* What the renderer does when a resume-story SERIAL arrives: it releases
          viewer authority and reports `story`, whatever mode was requested. */}
      <button type="button" onClick={() => props.callbacks?.onCameraModeChange?.("story")}>
        Report story framing
      </button>
      {/* What the renderer does with a follow LATCH: `setSelection` announces the
          new selection, and the accepted camera mode comes back as `follow`. */}
      <button type="button" onClick={() => {
        const request = props.followRequest;
        if (request === null || request === undefined) return;
        props.callbacks?.onSelectionChange?.(request.selection);
        props.callbacks?.onCameraModeChange?.("follow");
      }}>Report follow latched</button>
      <button type="button" onClick={() => props.onObserveRegion?.("meadow")}>
        Announce observed region
      </button>
      <button type="button" onClick={() => props.callbacks?.onSemanticSnapshot?.(semanticSnapshot(frame))}>
        Publish world subjects
      </button>
      <button type="button" onClick={() => props.callbacks?.onSemanticSnapshot?.(semanticSnapshotWithRhea(frame))}>
        Publish target after mount
      </button>
      <button type="button" onClick={() => props.callbacks?.onSemanticSnapshot?.({
        ...semanticSnapshot(frame),
        frameIdentity: { ...semanticSnapshot(frame).frameIdentity, revision: frame.revision - 1 },
      })}>Publish stale subjects</button>
      <button type="button" onClick={() => props.callbacks?.onSemanticSnapshot?.({
        ...semanticSnapshot(frame),
        frameIdentity: { ...semanticSnapshot(frame).frameIdentity, sourceKey: "archive:foreign" },
      })}>Publish foreign subjects</button>
      <button type="button" onClick={() => props.callbacks?.onSemanticSnapshot?.({
        ...semanticSnapshot(frame),
        subjects: semanticSnapshot(frame).subjects.filter((subject) => subject.kind === "region"),
      })}>Remove world subject</button>
    </section>;
  },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
const stageSafeFrames: PresentationWorldStageProps["safeFrame"][] = [];
const stageAtlasPools: PresentationWorldStageProps["atlasPool"][] = [];
let latestStageSemanticCallback: ((snapshot: RendererSemanticSnapshot) => void) | null = null;

beforeEach(() => {
  // The Chronicle killfeed remembers whether the viewer left it open (see
  // `chronicleSurfacePreference.ts`). That is a real, deliberate behaviour, so
  // each case has to start from a viewer who has never touched it -- otherwise
  // an earlier case's click silently opens the drawer for every case after it.
  localStorage.clear();
  stageSafeFrames.length = 0;
  stageAtlasPools.length = 0;
  latestStageSemanticCallback = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Vivarium2DApp", () => {
  it("shows the scene dock only while every drawer is closed", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    expect(container.querySelector(".observer-dock")).toBeNull();
    expect(container.querySelector(".chronicle-killfeed .observer-camera-controls")).not.toBeNull();
    await click("Close Chronicle");
    expect(container.querySelector(".observer-dock")).not.toBeNull();
    expect(container.querySelector(".observer-hud select")).toBeNull();
    for (const name of ["World", "Selection", "Archive", "Chronicle"]) {
      await click(name);
      expect(container.querySelector(".observer-dock")).toBeNull();
      expect(container.querySelector(".dialogue-now")).toBeNull();
      await click(`Close ${name}`);
      expect(container.querySelector(".observer-dock")).not.toBeNull();
    }
  });

  it("reclaims the bottom of the scene when the drawer replaces the dock", () => {
    const insets = observerSafeFrameFromRects(1440, 900, "chronicle", {
      hud: { x: 16, y: 16, width: 330, height: 68 },
      dialogue: null,
      triggers: { x: 1010, y: 16, width: 410, height: 44 },
      drawer: { x: 1014, y: 76, width: 410, height: 808 },
    });
    expect(insets.bottom).toBeLessThanOrEqual(20);
    expect(insets.right).toBe(434);
  });

  it("keeps a selected standing home as the Follow target in a populated world", async () => {
    const frame = twoRegionFrame();
    const fixture = runtimeFixture({
      frame: { ...frame, selection: { kind: "home", id: "test-home" }, world: {
        ...frame.world, homes: [{ completeness: "exact", value: {
          home_id: "test-home", owner_id: "aster", region: "meadow", status: "standing",
        } }],
      } },
      recipes: new Map([["meadow", {} as never], ["willow", {} as never]]),
    });
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");
    await click("Follow");
    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-follow-subject")).toBe("");
    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-requested-camera")).toBe("follow");
  });

  it("follows from a dock shortcut and hands back to Auto from Chronicle", async () => {
    const fixture = followRuntimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");
    await click("Close Chronicle");
    const shortcut = required<HTMLButtonElement>("[data-follow-shortcut]");
    await act(async () => shortcut.click());
    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-follow-subject")).toBe("aster");
    const firstFollowSerial = Number(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-follow-serial"));
    expect(container.querySelector(".observer-dock")).not.toBeNull();
    await click("Report follow latched");
    await click("Chronicle");
    expect(button("Follow")?.getAttribute("aria-pressed")).toBe("true");
    const resumeSerial = Number(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-resume-serial"));
    await click("Stop following");
    expect(Number(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-resume-serial"))).toBe(resumeSerial + 1);
    await click("Report story framing");
    expect(button("Auto")?.getAttribute("aria-pressed")).toBe("true");
    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-follow-subject")).toBe("");
    await click("Follow");
    expect(Number(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-follow-serial"))).toBeGreaterThan(firstFollowSerial);
    await click("Reject follow latch");
    await click("Select world being");
    expect(heading("Selection")).not.toBeNull();
  });

  it("threads an optional atlas pool while leaving ordinary renderer ownership omitted", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    expect(stageAtlasPools.at(-1)).toBeUndefined();

    const atlasPool = {} as SharedAtlasPool;
    await act(async () => root.render(
      <Vivarium2DApp
        createRuntime={() => fixture.runtime}
        renderer={{ atlasPool }}
      />,
    ));
    expect(stageAtlasPools.at(-1)).toBe(atlasPool);
  });

  it("derives one unobscured camera rectangle from the measured persistent chrome", () => {
    const closed = observerSafeFrameFromRects(1_440, 900, "closed", {
      hud: { x: 12, y: 12, width: 674, height: 52 },
      dialogue: { x: 128, y: 760, width: 1_184, height: 126 },
      triggers: { x: 1_396, y: 314, width: 44, height: 272 },
      drawer: null,
    });
    expect(closed).toEqual({ top: 72, right: 52, bottom: 148, left: 20 });

    const drawer = observerSafeFrameFromRects(1_440, 900, "chronicle", {
      hud: { x: 12, y: 12, width: 674, height: 52 },
      dialogue: { x: 128, y: 760, width: 1_184, height: 126 },
      triggers: { x: 1_396, y: 314, width: 44, height: 272 },
      drawer: { x: 1_014, y: 10, width: 416, height: 880 },
    });
    expect(drawer).toEqual({ top: 72, right: 434, bottom: 16, left: 20 });

    const mobile = observerSafeFrameFromRects(390, 844, "chronicle", {
      hud: { x: 8, y: 8, width: 374, height: 104 },
      dialogue: { x: 8, y: 732, width: 374, height: 104 },
      triggers: { x: 346, y: 280, width: 44, height: 284 },
      drawer: { x: 8, y: 576, width: 374, height: 260 },
    });
    expect(mobile).toEqual({ top: 120, right: 52, bottom: 276, left: 8 });
    expect(844 - mobile.top - mobile.bottom).toBeGreaterThanOrEqual(844 * 0.52);
  });

  it("treats a horizontal mobile trigger strip as top chrome without consuming camera width", () => {
    const mobile = observerSafeFrameFromRects(390, 844, "chronicle", {
      hud: { x: 8, y: 8, width: 374, height: 104 },
      dialogue: { x: 8, y: 732, width: 374, height: 104 },
      triggers: { x: 8, y: 122, width: 374, height: 44 },
      drawer: { x: 8, y: 576, width: 374, height: 260 },
    });

    expect(mobile).toEqual({ top: 174, right: 8, bottom: 276, left: 8 });
    expect(390 - mobile.left - mobile.right).toBeGreaterThanOrEqual(390 * 0.75);
    expect(844 - mobile.top - mobile.bottom).toBeGreaterThan(0);
  });

  it("mounts the ordinary route without publishing capture mutation globals", async () => {
    delete window.__vivariumEnableProductionCaptureClockForTest;
    delete window.__vivariumProductionCaptureClockForTest;
    delete window.__vivariumProductionCaptureTerminalForTest;
    delete window.__vivariumProductionMountedRunForTest;
    const fixture = runtimeFixture();

    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    expect(window.__vivariumProductionCaptureClockForTest).toBeUndefined();
    expect(window.__vivariumProductionCaptureTerminalForTest).toBeUndefined();
    expect(window.__vivariumProductionMountedRunForTest).toBeUndefined();
  });

  it("installs detached shell/session ownership diagnostics on the exact app surface", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    const surface = required<HTMLElement>(".vivarium-2d-app");
    expect(getProductionStageDebugProbe(surface)?.snapshot()).toMatchObject({
      reactCommitCount: expect.any(Number),
      stageCount: 1,
      liveSessions: 1,
      archiveSessions: 0,
      source: "live",
      runId: "public-test-run",
      archiveStatus: "ready",
      session: expect.objectContaining({ paused: false }),
    });

    const probe = getProductionStageDebugProbe(surface)!;
    const before = probe.snapshot() as Readonly<{
      reactCommitCount: number;
      frameIdentity: unknown;
      session: ObserverShellSnapshot["diagnostics"];
    }>;
    const retainedFrame = fixture.runtime.getSnapshot().frame;
    fixture.advancePreviewBy(33);
    const preview = probe.snapshot() as typeof before;

    expect(preview.session?.director.checkpointHold?.elapsedMs).toBe(33);
    expect(preview.session?.director.framePublicationSerial)
      .toBe(before.session?.director.framePublicationSerial);
    expect(preview.reactCommitCount).toBe(before.reactCommitCount);
    expect(preview.frameIdentity).toEqual(before.frameIdentity);
    expect(fixture.runtime.getSnapshot().frame).toBe(retainedFrame);
    expect(fixture.runtime.getSnapshot().diagnostics?.director.checkpointHold?.elapsedMs).toBe(0);
    await act(async () => root.unmount());
    expect(getProductionStageDebugProbe(surface)).toBeNull();
    root = createRoot(container);
  });

  it("feeds Stage, HUD, Atlas, Chronicle, and selection from one selected frame", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));

    await act(async () => fixture.runtime.ready);
    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-presented-cursor")).toBe("5");

    expect(container.textContent).not.toContain("Shown 5 · Received 9");
    expect(button("Observe Meadow")).toBeNull();

    await click("World");
    expect(container.textContent).toMatch(/Shown\s*5/);
    expect(container.textContent).toMatch(/Received\s*9/);
    expect(button("Observe Meadow")).not.toBeNull();

    await click("Chronicle");
    expect(heading("Chronicle")).not.toBeNull();
    expect(heading("Selection")).toBeNull();

    await click("Selection");
    expect(heading("Selection")).not.toBeNull();
    expect(heading("Chronicle")).toBeNull();
  });

  it("keeps identity compact and relocates controls between the dock and drawers", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    expect(required<HTMLElement>(".observer-hud").textContent?.replace(/\s+/g, " ").trim())
      .toContain("VivariumMeadow");
    expect(required<HTMLElement>(".observer-hud").querySelector("select")).toBeNull();
    // Framing is a PERSISTENT control on the status line, not a badge that
    // materialises over the art once the viewer has already been stranded. It is
    // present and inert while the story owns the camera.
    expect(required<HTMLButtonElement>(".observer-hud__framing").disabled).toBe(true);
    // WHO the camera is on is the other half of that sentence, and equally
    // persistent: a viewer learns where the control lives before they need it.
    expect(required<HTMLSelectElement>(".observer-hud__follow-select").value).toBe("");
    // No run-lifecycle capability was granted to this fixture, so no way to end
    // a run is offered. The observer cannot reach a server by itself.
    expect(container.querySelector(".observer-hud__stop")).toBeNull();

    // Transport lives in a drawer, never in the persistent chrome. The Chronicle
    // now opens by default and carries its own copy, so this is asserted of the
    // state a viewer reaches by closing it.
    await click("Close Chronicle");
    expect(button("Pause view")).not.toBeNull();
    expect(button("Free")).not.toBeNull();
    expect(container.querySelector(".living-atlas-2d")).toBeNull();
    expect(container.textContent).not.toContain("Shown 5 · Received 9");
    expect([...required(".observer-edge-triggers").querySelectorAll("button")]
      .map((candidate) => candidate.textContent?.trim())).toEqual([
        "World", "Chronicle", "Selection", "Archive",
      ]);

    await click("World");
    expect(button("Pause view")).not.toBeNull();
    expect(button("Free")).not.toBeNull();
    expect(button("Hold Now")).not.toBeNull();
    expect(container.querySelector(".world-drawer .living-atlas-2d")).not.toBeNull();
    expect(required<HTMLElement>(".world-drawer").textContent)
      .toContain("1 living being in the presented world.");
    expect(required<HTMLElement>(".world-drawer").textContent)
      .not.toContain("beings are visible at this shown moment");
    expect(required<HTMLElement>(".world-drawer").textContent).toMatch(/Shown\s*5/);
    expect(required<HTMLElement>(".world-drawer").textContent).toMatch(/Received\s*9/);
    expect(required<HTMLElement>(".world-drawer").textContent).not.toContain("World Time 14");

    await act(async () => {
      const select = required<HTMLSelectElement>("select[aria-label='View speed']");
      select.value = "1.5";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("Hold Now");
    expect(fixture.runtime.setSpeed).toHaveBeenCalledWith(1.5);
    expect(fixture.runtime.holdCurrentMoment).toHaveBeenCalledWith(true);
  });

  it("announces a non-interactive region arrival plaque on the first ready frame", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    const plaque = required<HTMLElement>("[data-region-arrival]");
    expect(plaque.getAttribute("aria-live")).toBe("polite");
    expect(plaque.querySelector("strong")?.textContent).toBe("MEADOW");
    expect(plaque.querySelector("button, [tabindex]")).toBeNull();
  });

  it("keeps explicit recovery action inside World instead of the persistent header", async () => {
    const base = presentedFrame();
    const fixture = runtimeFixture({
      frame: Object.freeze({
        ...base,
        transport: Object.freeze({
          connection: "recovery-paused" as const,
          ingestedCursor: base.ingestedCursor,
          retryable: true,
        }),
      }),
    });
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    expect(button("Retry world recovery")).toBeNull();
    await click("World");
    await click("Retry world recovery");
    expect(fixture.runtime.retryRecovery).toHaveBeenCalledOnce();
  });

  it("keeps an active non-dialogue moment understandable with every drawer closed", async () => {
    const now = storyMoment("5:5:single", "home_built", {
      builder_id: "aster",
      region: "meadow",
    });
    const fixture = runtimeFixture({
      frame: frameWithScene(now),
      chronicle: chronicleWindow({ now }),
    });
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    // ONE surface, not two. The bottom-right "NOW / View moment" card is gone;
    // the Chronicle marks its own leading entry as the moment happening now and
    // carries the same action (owner direction, Safi, 2026-08-22).
    expect(container.querySelector("[data-story-now]")).toBeNull();
    expect(container.querySelectorAll("[data-chronicle-now]")).toHaveLength(1);
    const leading = required<HTMLElement>("[data-chronicle-now]");
    expect(leading.getAttribute("data-chronicle-now")).toBe("Now");
    expect(leading.getAttribute("aria-current")).toBe("true");
    expect(leading.textContent).toContain("Now");

    const view = leading.querySelector<HTMLButtonElement>(".chronicle-killfeed__replay")!;
    expect(view.getAttribute("aria-label")).toContain("View shown moment");
    await act(async () => view.click());
    // Exactly what the retired button did, through exactly the same path.
    expect(fixture.runtime.viewMoment).toHaveBeenCalledOnce();
    expect(fixture.runtime.viewMoment).toHaveBeenCalledWith(now.id);
    expect(container.innerHTML).not.toContain(now.id);
  });

  it("hands a card whose moment the shell no longer holds to the presentation, instead of dropping it", async () => {
    // The second dead-click path: the Chronicle keeps a bounded window of moments while the feed's
    // own event buffer outlives it, so a rewound feed can offer a card the shell cannot resolve.
    // That used to be a bare `return` -- click, nothing, no reason given.
    const forgotten = storyMoment("5:5:single", "home_built", { builder_id: "aster", region: "meadow" });
    const kept = storyMoment("9:9:single", "self_talk", { agent_id: "aster" });
    const fixture = runtimeFixture({ chronicle: chronicleWindow({ previous: [forgotten] }) });
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    // The feed's own buffer retains 90s of events while the Chronicle keeps a bounded number of
    // MOMENTS, so a busy world drops the moment out from under a card that is still on screen.
    await act(async () => fixture.replaceChronicle(chronicleWindow({ previous: [kept] })));
    const card = required<HTMLElement>("[data-event-cursor='5']");
    await act(async () => card.click());
    const cursor = 5;

    expect(fixture.runtime.viewMoment).not.toHaveBeenCalled();
    expect(fixture.runtime.viewCursor).toHaveBeenCalledWith(cursor);

    // ...and what the presentation answers with is SHOWN. A navigation that cannot be satisfied
    // has to say so; silence is the defect.
    await act(async () => fixture.replaceFrame(Object.freeze({
      ...presentedFrame(),
      notices: Object.freeze([Object.freeze({
        kind: "unreachable-moment" as const,
        detail: "That moment has left the Chronicle. The Archive still holds it.",
        firstCursor: cursor,
        lastCursor: cursor,
        count: 1,
      })]),
    })));
    expect(required<HTMLElement>(".chronicle-killfeed__notices").textContent)
      .toContain("That moment has left the Chronicle.");
  });

  it("keeps the latest settled moment visible after its scene completes", async () => {
    const latest = storyMoment("5:5:single", "self_talk", { agent_id: "aster" });
    const fixture = runtimeFixture({
      frame: { ...presentedFrame(), checkpointFocus: null, scene: null },
      chronicle: chronicleWindow({ previous: [latest] }),
    });
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    // Nothing is playing, so the newest entry is the last thing that FINISHED --
    // the distinction the retired card drew between "Now" and "Latest", kept.
    const leading = required<HTMLElement>("[data-chronicle-now]");
    expect(leading.getAttribute("data-chronicle-now")).toBe("Latest");
    expect(leading.textContent).toContain("Latest");
    expect(container.querySelector("[data-story-now]")).toBeNull();
  });

  it("explains a silent checkpoint from already-present structural state", async () => {
    const fixture = runtimeFixture({
      frame: {
        ...presentedFrame(),
        checkpointFocus: {
          regionId: "meadow",
          kind: "region",
          entityId: null,
          segmentIndex: 0,
          segmentCount: 1,
          removed: true,
        },
        scene: null,
      },
    });
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    // The checkpoint no longer has a card of its own -- that card was the NOW
    // panel, and it is gone. It survives where it was always most useful, in the
    // polite announcement (proved segment by segment in the case below), and the
    // world itself still shows the corrected structure.
    expect(container.querySelector("[data-story-kind='checkpoint']")).toBeNull();
    expect(container.querySelector("[data-story-now]")).toBeNull();
    expect(required<HTMLElement>("[role='status'][aria-live='polite']")).not.toBeNull();
  });

  it("announces each silent checkpoint segment once through the existing polite owner", async () => {
    vi.useFakeTimers();
    const initial = {
      ...presentedFrame(),
      checkpointFocus: {
        regionId: "meadow",
        kind: "home" as const,
        entityId: "private_home",
        segmentIndex: 0,
        segmentCount: 2,
        removed: false,
      },
      scene: null,
    };
    const fixture = runtimeFixture({ frame: initial });
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    const live = required<HTMLElement>("[role='status'][aria-live='polite']");

    await act(async () => vi.advanceTimersByTime(750));
    expect(live.textContent).toBe("A shelter has changed. Meadow now holds a changed shelter.");
    expect(live.getAttribute("aria-busy")).toBe("false");

    await act(async () => fixture.publish());
    expect(live.getAttribute("aria-busy")).toBe("false");

    await act(async () => fixture.replaceFrame({
      ...initial,
      revision: initial.revision + 1,
      checkpointFocus: {
        regionId: "meadow",
        kind: "region",
        entityId: null,
        segmentIndex: 1,
        segmentCount: 2,
        removed: true,
      },
    }));
    expect(live.getAttribute("aria-busy")).toBe("true");
    await act(async () => vi.advanceTimersByTime(750));
    expect(live.textContent).toBe("A structure is gone. A structure no longer remains in Meadow.");
  });

  it("does not announce a settled latest row as a new active moment", async () => {
    vi.useFakeTimers();
    const latest = storyMoment("5:5:single", "home_built", { builder_id: "aster" });
    const fixture = runtimeFixture({
      frame: { ...presentedFrame(), checkpointFocus: null, scene: null },
      chronicle: chronicleWindow({ previous: [latest] }),
    });
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await act(async () => vi.advanceTimersByTime(750));

    expect(required<HTMLElement>("[role='status']").textContent).toBe("The world moved ahead.");
    expect(required<HTMLElement>("[role='status']").textContent).not.toContain("Shelter raised");
  });

  it("yields the one visible narrative slot to active dialogue", async () => {
    const now = storyMoment("5:5:single", "speak", {
      speaker_id: "aster",
      target_id: null,
      text: "The meadow is quiet.",
    });
    const fixture = runtimeFixture({
      frame: frameWithScene(now, {
        speakerId: "aster",
        speakerName: "Aster",
        text: "The meadow is quiet.",
        visibleCharacters: 20,
        cursor: 20,
        hold: false,
      }),
      chronicle: chronicleWindow({ now }),
    });
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Close Chronicle");

    expect(container.querySelector(".dialogue-now")?.textContent).toContain("The meadow is quiet.");
    expect(container.querySelector("[data-story-now]")).toBeNull();
    expect(container.querySelectorAll("[role='status'][aria-live='polite']")).toHaveLength(1);
  });

  it("routes only observer controls, atlas requests, Canvas selection, and bounded Archive keys", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    await click("World");
    await click("Pause view");
    await click("Free");
    await click("Accept camera request");
    await click("Observe Meadow");
    await click("Inspect Meadow");
    await click("Select world region");

    expect(fixture.runtime.pause).toHaveBeenCalledOnce();
    expect(fixture.runtime.setCameraMode).toHaveBeenCalledWith("free");
    expect(fixture.runtime.observeRegion).toHaveBeenCalledWith("meadow");
    expect(fixture.runtime.select).toHaveBeenCalledWith({ kind: "region", id: "meadow" });

    await click("Archive");
    expect(fixture.runtime.openArchiveCatalogue).not.toHaveBeenCalled();
    await click("Enter Shown moment 4");
    expect(fixture.runtime.enterArchiveCheckpoint).toHaveBeenCalledWith({ lineNumber: 7 });

    for (const method of ["post", "put", "patch", "delete", "invokeTool", "commandBeing"]) {
      expect(method in fixture.runtime).toBe(false);
    }
  });

  it("hands Atlas observation to the observer camera instead of letting Story immediately reclaim it", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-requested-camera")).toBe("story");
    await click("World");
    await click("Observe Meadow");

    expect(fixture.runtime.observeRegion).toHaveBeenCalledWith("meadow");
    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-requested-camera")).toBe("free");
  });

  // BUBBLES-FIX 2026-08-21 — a run "that opens inside a region opens LATCHED inside it"
  // (`CanvasPresentationRenderer`'s first-sheet adoption), which publishes a navigation state
  // with scope "region" before the viewer has touched anything. Routing that ANNOUNCEMENT into
  // `observeRegion` -- which also means "the viewer chose this place" and requests Free -- took
  // the camera away from the director at boot, so `frameBeat` skipped with
  // `viewer-controls-camera` for the whole run and no beat was ever framed. The viewer's own
  // Atlas click (the test above) still requests Free; an announcement must not.
  it("keeps the story camera when the STAGE only announces which region is on screen", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-requested-camera")).toBe("story");

    await click("Announce observed region");

    expect(fixture.runtime.observeRegion).toHaveBeenCalledWith("meadow");
    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-requested-camera")).toBe("story");
  });

  it("disposes the one runtime and its subscription exactly once", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await act(async () => root.unmount());
    root = createRoot(container);

    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
    expect(fixture.runtime.dispose).toHaveBeenCalledOnce();
  });

  it("acknowledges a Follow latch and permits retry after the renderer refuses it", async () => {
    const fixture = followRuntimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");

    await click("World");
    await click("Follow");
    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-follow-subject")).toBe("aster");
    expect(required<HTMLElement>(".vivarium-2d-app").getAttribute("data-camera-mode")).toBe("story");
    expect(button("Auto")?.getAttribute("aria-pressed")).toBe("true");

    await click("Reject follow latch");
    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-requested-camera")).toBe("story");
    expect(fixture.runtime.setCameraMode).not.toHaveBeenCalledWith("follow");

    await click("Select world being");
    await click("World");
    await click("Follow");
    await click("Report follow latched");
    expect(required<HTMLElement>(".vivarium-2d-app").getAttribute("data-camera-mode")).toBe("follow");
    expect(button("Follow")?.getAttribute("aria-pressed")).toBe("true");
    expect(fixture.runtime.setCameraMode).toHaveBeenCalledWith("follow");
  });

  it("names the being the viewer chose, after steering the view to where they are", async () => {
    // The complaint this control exists for: `follow` worked, and told nobody
    // who it was on. Choosing from the HUD must (1) bring that being's region up,
    // (2) select them, and only THEN (3) ask the camera to follow -- the renderer
    // resolves `follow` against the region it currently has mounted.
    const fixture = followRuntimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");

    expect([...followSelect().options].map((option) => option.textContent))
      .toEqual(["Auto", "Aster", "Rhea"]);

    await chooseFollowSubject("aster");
    expect(fixture.runtime.observeRegion).toHaveBeenCalledWith("meadow");
    const stage = required<HTMLElement>('[aria-label="Production world"]');
    expect(stage.getAttribute("data-follow-subject")).toBe("aster");
    expect(Number(stage.getAttribute("data-follow-serial"))).toBe(1);

    await click("Report follow latched");
    expect(fixture.runtime.select).toHaveBeenCalledWith({ kind: "agent", id: "aster" });
    expect(followSelect().value).toBe("aster");
    expect(followSelect().selectedOptions[0]?.textContent).toBe("Aster");
    expect(required<HTMLElement>(".observer-hud__follow").getAttribute("data-follow"))
      .toBe("following");
  });

  it("engages a Free-origin pursuit once its target mounts when the viewer makes no later gesture", async () => {
    const fixture = followRuntimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");

    await click("World");
    await click("Free");
    await click("Accept camera request");
    await chooseFollowSubject("rhea");

    const stage = required<HTMLElement>('[aria-label="Production world"]');
    expect(fixture.runtime.observeRegion).toHaveBeenCalledWith("willow");
    expect(stage.getAttribute("data-follow-serial")).toBe("0");

    await click("Publish target after mount");

    expect(stage.getAttribute("data-follow-serial")).toBe("1");
    expect(stage.getAttribute("data-follow-subject")).toBe("rhea");
  });

  it("does not engage a Free-origin pursuit after a later manual zoom", async () => {
    const fixture = followRuntimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");

    await click("World");
    await click("Free");
    await click("Accept camera request");
    await chooseFollowSubject("rhea");
    await click("Manual zoom");
    await click("Publish target after mount");

    const stage = required<HTMLElement>('[aria-label="Production world"]');
    expect(stage.getAttribute("data-follow-serial")).toBe("0");
    expect(stage.getAttribute("data-follow-subject")).toBe("");
    expect(followSelect().value).toBe("");
  });

  it("keeps a settled follow after a manual zoom", async () => {
    const fixture = followRuntimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");
    await chooseFollowSubject("aster");
    await click("Report follow latched");

    const stage = required<HTMLElement>('[aria-label="Production world"]');
    const serial = stage.getAttribute("data-follow-serial");
    await click("Manual zoom");

    expect(stage.getAttribute("data-follow-serial")).toBe(serial);
    expect(followSelect().value).toBe("aster");
  });

  it("keeps following a being across a border by re-observing the region they entered", async () => {
    const fixture = followRuntimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");
    await chooseFollowSubject("aster");
    await click("Report follow latched");
    vi.mocked(fixture.runtime.observeRegion).mockClear();

    await act(async () => fixture.replaceWorld(twoRegionFrame({ asterRegion: "willow" })));

    expect(fixture.runtime.observeRegion).toHaveBeenCalledWith("willow");
    // Still theirs: a border crossing steers the view, it does not end a pursuit
    // and it never silently swaps the subject for somebody else.
    expect(followSelect().value).toBe("aster");
    expect(followSelect().selectedOptions[0]?.textContent).toBe("Aster");
    expect(container.querySelector(".observer-hud__follow-notice")).toBeNull();
  });

  it("keeps the first Atlas region choice after it releases an active follow", async () => {
    const fixture = followRuntimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");
    await chooseFollowSubject("aster");
    await click("Report follow latched");
    vi.mocked(fixture.runtime.observeRegion).mockClear();

    await click("World");
    await click("Observe Willow");

    // Choosing a place is manual camera takeover. It must release the old
    // pursuit before the synchronous observed-region publication can tick it
    // and steer the view straight back to Aster in Meadow.
    expect(fixture.runtime.observeRegion).toHaveBeenCalledOnce();
    expect(fixture.runtime.observeRegion).toHaveBeenCalledWith("willow");
    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-requested-camera")).toBe("free");

    await click("Accept camera request");
    expect(followSelect().value).toBe("");
  });

  it("says the followed being died and returns framing — it never re-aims in silence", async () => {
    const fixture = followRuntimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");
    await chooseFollowSubject("aster");
    await click("Report follow latched");
    const serialBefore = Number(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-resume-serial"));

    await act(async () => fixture.replaceWorld(twoRegionFrame({ asterStatus: "dead" })));

    expect(required<HTMLElement>(".observer-hud__follow-notice").textContent)
      .toBe("Aster has died. Auto framing resumed.");
    expect(followSelect().value).toBe("");
    expect(Number(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-resume-serial"))).toBe(serialBefore + 1);
  });

  it("offers the way back out of following as the first option, so it is never a trap", async () => {
    const fixture = followRuntimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");
    await chooseFollowSubject("aster");
    await click("Report follow latched");
    const serialBefore = Number(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-resume-serial"));

    await chooseFollowSubject("");

    // A serial, not a mode: the one request the renderer cannot deduplicate away.
    expect(Number(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-resume-serial"))).toBe(serialBefore + 1);
    // Until the renderer answers, the camera IS still latched to Aster, and the
    // control says so rather than claiming an Automatic that has not happened.
    expect(required<HTMLElement>(".observer-hud__follow").getAttribute("data-follow"))
      .toBe("held");

    await click("Report story framing");
    expect(followSelect().value).toBe("");
    expect(required<HTMLElement>(".observer-hud__follow").getAttribute("data-follow"))
      .toBe("automatic");
  });

  it("adopts a being followed by hand, so the HUD's reading is true either way", async () => {
    // Click a being on the canvas, then Follow in the World drawer: the path that
    // existed before this control, and the one Safi could not read.
    const fixture = followRuntimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");
    await click("Select world being");
    await click("World");
    await click("Follow");
    await click("Accept camera request");

    expect(followSelect().selectedOptions[0]?.textContent).toBe("Aster");
  });

  it("re-names the subject when the viewer clicks somebody else mid-follow", async () => {
    // The renderer re-latches a live follow on the spot; a HUD that kept naming
    // the being the camera walked away from would be the original complaint back.
    const fixture = followRuntimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");
    await chooseFollowSubject("aster");
    await click("Report follow latched");
    expect(followSelect().selectedOptions[0]?.textContent).toBe("Aster");

    await click("Select another world being");

    expect(followSelect().value).toBe("rhea");
    expect(followSelect().selectedOptions[0]?.textContent).toBe("Rhea");
  });

  it("drops a pending camera request before presenting the first frame of a replacement run", async () => {
    const fixture = followRuntimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");
    await click("World");
    await click("Follow");
    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-follow-subject")).toBe("aster");

    const prior = fixture.runtime.frameSource.getSnapshot();
    await act(async () => fixture.replaceFrame({
      ...prior,
      runId: "replacement-run",
      sourceKey: "live:replacement-run",
      revision: 1,
    }));

    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-requested-camera")).toBe("story");
    expect(required<HTMLElement>(".presentation-world-stage").getAttribute("data-follow-subject")).toBe("");
    expect(required<HTMLElement>(".vivarium-2d-app").getAttribute("data-camera-mode")).toBe("story");
  });

  it("owns one controlled drawer trigger per surface and restores focus on close and Escape", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    const worldTriggers = [...container.querySelectorAll(".observer-edge-triggers button")]
      .filter((candidate) => candidate.textContent?.trim() === "World");
    expect(worldTriggers).toHaveLength(1);
    expect(container.querySelector(".observer-edge-triggers button")?.textContent).toBe("World");
    for (const name of ["World", "Chronicle", "Selection", "Archive"]) {
      const trigger = button(name);
      expect(trigger?.id).toBe(`observer-${name.toLowerCase()}-trigger`);
      expect(trigger?.getAttribute("aria-controls")).toBe("observer-primary-surface");
    }

    // The Chronicle opens by default now, and opening on load must NOT steal
    // focus from the page a viewer just arrived on.
    expect(required("#observer-primary-surface")).not.toBeNull();
    expect(required("#observer-primary-surface").getAttribute("role")).toBe("complementary");
    expect(document.activeElement).not.toBe(heading("Chronicle"));
    await click("Selection");
    expect(document.activeElement).toBe(heading("Selection"));
    await click("Close Selection");
    expect(document.activeElement).toBe(button("Selection"));

    // Opening it BY HAND still moves focus into it, which is the case that matters.
    await click("Chronicle");
    expect(document.activeElement).toBe(heading("Chronicle"));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(heading("Chronicle")).toBeNull();
    expect(document.activeElement).toBe(button("Chronicle"));
  });

  it("hands the camera back from the HUD through a serial, not a mode", async () => {
    // A viewer ZOOM takes framing authority without changing the camera mode, so
    // the shell's own state still reads `story` and a `story` mode request is
    // deduplicated to nothing before it reaches the renderer. That is what left
    // the retired stage badge inert, and it is why the way back is a serial.
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    const stage = (): HTMLElement => required(".presentation-world-stage");
    const framing = (): HTMLButtonElement => required<HTMLButtonElement>(".observer-hud__framing");

    expect(framing().getAttribute("data-framing")).toBe("story");
    expect(framing().disabled).toBe(true);
    const before = stage().getAttribute("data-resume-serial");

    await click("Viewer takes the camera");
    expect(framing().getAttribute("data-framing")).toBe("yours");
    expect(framing().disabled).toBe(false);
    // The camera MODE is untouched -- exactly the state a zoom leaves behind.
    expect(stage().getAttribute("data-requested-camera")).toBe("story");

    await act(async () => framing().click());
    expect(stage().getAttribute("data-resume-serial")).not.toBe(before);
    await click("Director takes the camera");
    expect(framing().getAttribute("data-framing")).toBe("story");
    expect(framing().disabled).toBe(true);
  });

  it("offers no way to end a run it was granted no permission to end", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    expect(container.querySelector(".observer-hud__stop")).toBeNull();
  });

  it("ends a run through the granted capability and then stops reading as live", async () => {
    const runLifecycle = {
      stop: vi.fn(async () => ({ run_id: "public-test-run", status: "stopping", warnings: [] })),
      getLifecycle: vi.fn(async () => ({ status: "stopped" as const })),
    };
    const fixture = runtimeFixture();
    vi.useFakeTimers();
    await act(async () => root.render(
      <Vivarium2DApp createRuntime={() => fixture.runtime} runLifecycle={runLifecycle} />,
    ));
    await act(async () => fixture.runtime.ready);

    const stop = (): HTMLButtonElement => required<HTMLButtonElement>(".observer-hud__stop");
    expect(stop().textContent).toBe("End run");
    // Still a running world until told otherwise, and never ended by one press.
    expect(container.querySelector(".chronicle-killfeed__live")?.textContent)
      .not.toContain("Ended");
    await act(async () => stop().click());
    expect(runLifecycle.stop).not.toHaveBeenCalled();
    expect(required(".observer-run-confirm").getAttribute("aria-modal")).toBe("true");

    await act(async () => required<HTMLButtonElement>(".observer-run-confirm__go").click());
    expect(runLifecycle.stop).toHaveBeenCalledOnce();
    expect(stop().textContent).toBe("Ending…");

    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(runLifecycle.getLifecycle).toHaveBeenCalled();
    expect(stop().textContent).toBe("Ended");
    // The whole view has to agree: a stopped run must not go on saying Live.
    expect(container.querySelector(".chronicle-killfeed__live")?.textContent).toContain("Ended");
  });

  it("hands the ending back to whoever mounted it, only once the server confirms it", async () => {
    // The observer has no idea whether it was reached from the gateway or from a
    // deep link, so it does not decide where a viewer goes when the world ends --
    // it reports the ending and the surface that mounted it owns the rest.
    const onRunEnded = vi.fn();
    const runLifecycle = {
      stop: vi.fn(async () => ({ run_id: "public-test-run", status: "stopping", warnings: [] })),
      getLifecycle: vi.fn(async () => ({ status: "stopped" as const })),
    };
    const fixture = runtimeFixture();
    vi.useFakeTimers();
    await act(async () => root.render(
      <Vivarium2DApp
        createRuntime={() => fixture.runtime}
        runLifecycle={runLifecycle}
        onRunEnded={onRunEnded}
      />,
    ));
    await act(async () => fixture.runtime.ready);

    // Nothing was asked, so nothing is polled and nobody is taken anywhere.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(runLifecycle.getLifecycle).not.toHaveBeenCalled();
    expect(onRunEnded).not.toHaveBeenCalled();

    await act(async () => required<HTMLButtonElement>(".observer-hud__stop").click());
    await act(async () => required<HTMLButtonElement>(".observer-run-confirm__go").click());
    // Asked for, not yet confirmed: the viewer stays with the world.
    expect(onRunEnded).not.toHaveBeenCalled();
    expect(required<HTMLButtonElement>(".observer-hud__stop").textContent).toBe("Ending…");

    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(onRunEnded).toHaveBeenCalledOnce();
  });

  it("keeps the viewer with the world when the stop could not be sent", async () => {
    // Losing the world WITHOUT having stopped it is the worst outcome here: the
    // run is still breathing and the viewer has been taken away from it.
    const onRunEnded = vi.fn();
    const runLifecycle = {
      stop: vi.fn(async () => { throw new Error("/api/run/stop returned HTTP 500"); }),
      getLifecycle: vi.fn(async () => ({ status: "stopped" as const })),
    };
    const fixture = runtimeFixture();
    vi.useFakeTimers();
    await act(async () => root.render(
      <Vivarium2DApp
        createRuntime={() => fixture.runtime}
        runLifecycle={runLifecycle}
        onRunEnded={onRunEnded}
      />,
    ));
    await act(async () => fixture.runtime.ready);

    await act(async () => required<HTMLButtonElement>(".observer-hud__stop").click());
    await act(async () => required<HTMLButtonElement>(".observer-run-confirm__go").click());
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(onRunEnded).not.toHaveBeenCalled();
    expect(required(".observer-hud__run-error").textContent)
      .toBe("/api/run/stop returned HTTP 500");
    // And the control is back, because the run is still there to end.
    expect(required<HTMLButtonElement>(".observer-hud__stop").textContent).toBe("End run");
  });

  it("returns focus to the stable Selection trigger after inspecting from World", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    await click("World");
    await click("Inspect Meadow");
    expect(document.activeElement).toBe(heading("Selection"));
    await click("Close Selection");
    expect(document.activeElement).toBe(button("Selection"));
  });

  it("reserves only chrome while closed and tracks desktop drawers and mobile sheets", async () => {
    setViewport(1200, 800);
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    // The Chronicle opens by default, so "closed" is now a state the viewer
    // chooses -- and it must still hand the whole width back when they do.
    await click("Close Chronicle");
    expect(safeFrame()).toEqual({ top: 64, right: 56, bottom: 176, left: 20 });
    await click("Chronicle");
    expect(safeFrame()).toEqual({ top: 64, right: 436, bottom: 16, left: 20 });

    setViewport(600, 800);
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(safeFrame()).toEqual({ top: 112, right: 8, bottom: 272, left: 8 });
    expect(required("#observer-primary-surface").getAttribute("role")).toBe("dialog");
    expect(required("#observer-primary-surface").getAttribute("aria-modal")).toBe("true");
    await click("Close Chronicle");
    expect(safeFrame()).toEqual({ top: 112, right: 8, bottom: 128, left: 8 });
  });

  it("publishes measured chrome geometry to the Stage without waiting for a window resize", async () => {
    setViewport(1_440, 900);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("vivarium-2d-app")) return testRect(0, 0, 1_440, 900);
      if (this.classList.contains("observer-hud")) return testRect(12, 12, 674, 52);
      if (this.classList.contains("living-atlas-2d")) return testRect(1_076, 12, 352, 266);
      if (this.classList.contains("dialogue-now")) return testRect(128, 760, 1_184, 126);
      if (this.classList.contains("semantic-world-mirror")) return testRect(12, 300, 240, 306);
      if (this.classList.contains("observer-edge-triggers")) return testRect(1_396, 314, 44, 272);
      if (this.classList.contains("observer-drawer")) return testRect(1_014, 10, 416, 880);
      return testRect(0, 0, 0, 0);
    });
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    await click("Close Chronicle");
    expect(safeFrame()).toEqual({ top: 72, right: 52, bottom: 176, left: 20 });
    await click("Chronicle");
    expect(safeFrame()).toEqual({ top: 72, right: 434, bottom: 16, left: 20 });
  });

  it("falls back to the reserved narrative band when nothing occupies the slot", async () => {
    // The NOW card used to sit here whenever a checkpoint or a moment was
    // showing. With it retired, a frame with no dialogue leaves the slot EMPTY,
    // and the measurement has to fall back to the reserved band rather than
    // handing the camera a strip the chrome will later take back.
    setViewport(1_440, 900);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("vivarium-2d-app")) return testRect(0, 0, 1_440, 900);
      if (this.classList.contains("observer-hud")) return testRect(12, 12, 674, 52);
      if (this.classList.contains("living-atlas-2d")) return testRect(1_076, 12, 352, 266);
      if (this.classList.contains("semantic-world-mirror")) return testRect(12, 300, 240, 306);
      if (this.classList.contains("observer-edge-triggers")) return testRect(1_396, 314, 44, 272);
      return testRect(0, 0, 0, 0);
    });
    const fixture = runtimeFixture({
      frame: {
        ...presentedFrame(),
        checkpointFocus: {
          regionId: "meadow",
          kind: "region",
          entityId: null,
          segmentIndex: 0,
          segmentCount: 1,
          removed: false,
        },
      },
    });
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Close Chronicle");

    expect(container.querySelector(".story-now")).toBeNull();
    expect(container.querySelector(".dialogue-now")).toBeNull();
    expect(safeFrame()).toEqual({ top: 72, right: 52, bottom: 176, left: 20 });
  });

  it("bounds the measured safe frame by the app's own (QA-inset-shrunk) box, not the full window", async () => {
    // Regression for a real bug: the QA chronicle route insets `.vivarium-2d-app` by its
    // own chrome (see `chromeInsets.ts`), so the app element's box can be smaller than
    // `window.innerWidth`/`innerHeight`. The measured chrome rects below are (correctly)
    // local to that smaller box -- `getBoundingClientRect()` offsets are always relative
    // to the viewport, and the hook subtracts the app's own top/left to localize them.
    // The bug was passing the raw (larger) window height into the boundary math instead
    // of the app's own (smaller) box height, which double-counted the QA reservation and
    // over-measured the bottom inset by roughly the size of the QA chrome outside the app
    // box (measured live: an inset of 267-366px out of a stage only 647-742px tall, i.e.
    // a "safe" band of ~30% of the stage instead of the true ~75-80%).
    setViewport(1_440, 900);
    // Simulates a 100px QA top inset and a 100px QA bottom inset: the app box is only
    // 700px tall, vertically centred in the 900px window, instead of filling it.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("vivarium-2d-app")) return testRect(0, 100, 1_440, 700);
      if (this.classList.contains("observer-hud")) return testRect(12, 112, 674, 52);
      if (this.classList.contains("dialogue-now")) return testRect(128, 664, 1_184, 126);
      return testRect(0, 0, 0, 0);
    });
    const speaking = storyMoment("5:5:single", "speak", {
      speaker_id: "aster",
      target_id: null,
      text: "The meadow is quiet.",
    });
    const fixture = runtimeFixture({
      frame: frameWithScene(speaking, {
        speakerId: "aster",
        speakerName: "Aster",
        text: "The meadow is quiet.",
        visibleCharacters: 20,
        cursor: 20,
        hold: false,
      }),
      chronicle: chronicleWindow({ now: speaking }),
    });
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Close Chronicle");

    expect(required(".dialogue-now")).not.toBeNull();
    // Correct: bottom is bound by the 700px-tall app box (bottom 144), not the 900px
    // window (which the bug would have produced as bottom 344, shrinking the frame to a
    // 30%-ish sliver of the app's own box instead of its true ~80%).
    expect(safeFrame()).toEqual({ top: 72, right: 52, bottom: 144, left: 20 });
  });

  it("rebinds mobile narrative measurement as the dialogue caption comes and goes", async () => {
    // The bottom slot used to have two possible owners: the NOW card and the
    // dialogue caption. The card is retired, so the slot is now either the
    // caption or EMPTY -- and the measurement still has to be re-bound at every
    // transition, without waiting for a viewport resize.
    setViewport(390, 844);
    const observers: Array<{
      readonly observed: Element[];
      readonly disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    class ResizeObserverFake {
      readonly observed: Element[] = [];
      readonly disconnect = vi.fn();
      constructor(_callback: ResizeObserverCallback) {
        observers.push(this);
      }
      observe(element: Element): void { this.observed.push(element); }
      unobserve(): void {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverFake);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("vivarium-2d-app")) return testRect(0, 0, 390, 844);
      if (this.classList.contains("observer-hud")) return testRect(8, 8, 374, 88);
      if (this.classList.contains("living-atlas-2d")) return testRect(102, 760, 280, 76);
      if (this.classList.contains("dialogue-now")) return testRect(8, 620, 374, 216);
      if (this.classList.contains("semantic-world-mirror")) return testRect(8, 760, 210, 76);
      if (this.classList.contains("observer-edge-triggers")) return testRect(8, 104, 374, 44);
      return testRect(0, 0, 0, 0);
    });
    const now = storyMoment("5:5:single", "speak", {
      speaker_id: "aster",
      text: "The meadow is quiet.",
    });
    const silentFrame = frameWithScene(now, null);
    const dialogueFrame = frameWithScene(now, {
      speakerId: "aster",
      speakerName: "Aster",
      text: "The meadow is quiet.",
      visibleCharacters: 20,
      cursor: 20,
      hold: false,
    });
    const observesCaption = (observer: { readonly observed: Element[] }): boolean => (
      observer.observed.some((element) => element.classList.contains("dialogue-now"))
    );
    const fixture = runtimeFixture({
      frame: silentFrame,
      chronicle: chronicleWindow({ now }),
    });

    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Close Chronicle");
    const empty = observers.at(-1)!;
    expect(observesCaption(empty)).toBe(false);
    expect(safeFrame().bottom).toBe(8);

    await act(async () => fixture.replaceFrame(dialogueFrame));
    expect(empty.disconnect).toHaveBeenCalledOnce();
    const speaking = observers.at(-1)!;
    expect(speaking).not.toBe(empty);
    expect(observesCaption(speaking)).toBe(true);
    expect(safeFrame().bottom).toBe(232);

    await act(async () => fixture.replaceFrame(silentFrame));
    expect(speaking.disconnect).toHaveBeenCalledOnce();
    const quiet = observers.at(-1)!;
    expect(quiet).not.toBe(speaking);
    expect(observesCaption(quiet)).toBe(false);
    expect(safeFrame().bottom).toBe(8);
    expect(844 - safeFrame().top - safeFrame().bottom).toBeGreaterThanOrEqual(844 * 0.52);
  });

  it("keeps arbitrary entity IDs out of the whole shell and its polite announcement", async () => {
    vi.useFakeTimers();
    const now = storyMoment("5:5:single", "home_built", { builder_id: "aster" });
    const base = frameWithScene(now);
    const fixture = runtimeFixture({
      frame: {
        ...base,
        world: {
          ...base.world,
          agents: [
            { completeness: "exact", value: {
              id: "aster",
              name: "Keeper mystic_007",
              status: "alive",
              position: "meadow",
            } },
            { completeness: "exact", value: {
              id: "mystic_007",
              name: "mystic_007",
              status: "alive",
              position: "meadow",
            } },
            { completeness: "exact", value: {
              id: "raider_12",
              name: "raider_12 among us",
              status: "alive",
              position: "meadow",
            } },
          ],
        },
      },
      chronicle: chronicleWindow({ now }),
    });

    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    // The card that used to carry this copy is gone, so the denylist is proved
    // where the copy went: the Chronicle's own sentences, and the announcement.
    // (A being CHIP prints the display name the world published -- here the
    // deliberately adversarial "Keeper mystic_007" -- which is the world's data,
    // not narration inventing an opaque id.)
    for (const line of container.querySelectorAll(".chronicle-killfeed__line")) {
      expect(line.textContent).not.toMatch(/mystic_007|raider_12/);
    }
    expect(container.querySelector(".chronicle-killfeed__line")?.textContent)
      .toContain("Unknown being");

    await act(async () => vi.advanceTimersByTime(750));
    expect(required<HTMLElement>("[role='status'][aria-live='polite']").textContent)
      .toBe("Shelter raised. Unknown being completed a shelter.");
  });

  it("accepts only exact-frame renderer semantics and routes opaque subject tokens privately", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    expect(heading("World subjects")?.closest("section")?.classList)
      .toContain("observer-visually-hidden");
    expect(heading("World subjects")?.closest("section")?.classList)
      .not.toContain("observer-panel");
    expect(container.textContent).toContain("Subjects are coming into view.");
    await click("Publish stale subjects");
    expect(container.querySelector("[data-subject-token]")).toBeNull();
    await click("Publish world subjects");
    const subject = container.querySelector<HTMLButtonElement>("[data-subject-token='subject-2']");
    expect(subject?.textContent).toContain("AsterStatus: Alive");
    expect(subject?.textContent).toContain("Position: Meadow, column 2, row 3");
    expect(subject?.textContent).toContain("Current action: Moving");
    expect(container.innerHTML).not.toMatch(/stable-agent|data-agent|agent-id/i);
    await act(async () => subject?.click());
    expect(fixture.runtime.select).toHaveBeenCalledWith({ kind: "agent", id: "aster" });
    expect(fixture.runtime.requestFocus).toHaveBeenCalledWith({ kind: "agent", id: "aster" });
    expect(container.querySelectorAll("[role='status'][aria-live='polite']")).toHaveLength(1);

    await click("Selection");
    const visibleSubjects = container.querySelector(
      ".selection-inspector .semantic-world-mirror--selection",
    );
    expect(visibleSubjects).not.toBeNull();
    expect(visibleSubjects?.classList).not.toContain("observer-visually-hidden");
    expect(container.querySelectorAll("[data-subject-token='subject-2']")).toHaveLength(1);
  });

  it("publishes unchanged semantic rows without committing the Vivarium2DApp root", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");
    const surface = required<HTMLElement>(".vivarium-2d-app");
    const probe = getProductionStageDebugProbe(surface)!;
    const before = probe.snapshot() as Readonly<{ reactCommitCount: number }>;
    const subject = required<HTMLButtonElement>("[data-subject-token='subject-2']");

    await click("Publish world subjects");

    const after = probe.snapshot() as typeof before;
    expect(after.reactCommitCount).toBe(before.reactCommitCount);
    expect(required("[data-subject-token='subject-2']")).toBe(subject);
  });

  it("keeps a surviving semantic subject mounted and focused while exact same-lineage semantics catch up", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");
    const subject = required<HTMLButtonElement>("[data-subject-token='subject-2']");
    subject.focus();
    expect(document.activeElement).toBe(subject);

    const current = fixture.runtime.frameSource.getSnapshot();
    await act(async () => fixture.replaceFrame(Object.freeze({
      ...current,
      revision: current.revision + 1,
      lastCursor: current.lastCursor + 1,
      presentedCursor: current.presentedCursor + 1,
    })));

    expect(container.querySelector("[data-subject-token='subject-2']")).toBe(subject);
    expect(document.activeElement).toBe(subject);
    expect(container.textContent).not.toContain("World subjects are updating");

    const probe = getProductionStageDebugProbe(required(".vivarium-2d-app"))!;
    const beforeSemantic = probe.snapshot() as Readonly<{ reactCommitCount: number }>;
    await click("Publish world subjects");
    const afterSemantic = probe.snapshot() as typeof beforeSemantic;
    expect(afterSemantic.reactCommitCount).toBe(beforeSemantic.reactCommitCount);
    expect(container.querySelector("[data-subject-token='subject-2']")).toBe(subject);
    expect(document.activeElement).toBe(subject);
  });

  it("atomically replaces controls when retained old-stage callbacks race a source swap", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");
    const staleSubject = required<HTMLButtonElement>("[data-subject-token='subject-2']");
    staleSubject.focus();
    const current = fixture.runtime.frameSource.getSnapshot();
    const retainedOldSemanticCallback = latestStageSemanticCallback;
    if (retainedOldSemanticCallback === null) throw new Error("semantic callback was not retained");
    const nextFrame = Object.freeze({
      ...current,
      source: "archive" as const,
      sourceKey: "archive:public-test-run:checkpoint-4",
      revision: 1,
    });

    await act(async () => {
      fixture.replaceFrame(nextFrame);
      retainedOldSemanticCallback(semanticSnapshot(current));
      retainedOldSemanticCallback(semanticSnapshot(nextFrame));
      retainedOldSemanticCallback(semanticSnapshot(current));
    });

    expect(staleSubject.isConnected).toBe(false);
    const replacement = required<HTMLButtonElement>("[data-subject-token]");
    expect(replacement).not.toBe(staleSubject);
    expect(replacement.dataset.subjectToken).not.toBe(staleSubject.dataset.subjectToken);
    expect(container.querySelectorAll("[data-subject-token]")).toHaveLength(2);
    expect(container.textContent).toContain("AsterStatus: Alive");
    expect(container.querySelector(
      `[data-subject-token='${staleSubject.dataset.subjectToken}']`,
    )).toBeNull();
    expect(container.textContent).not.toContain("Subjects are coming into view.");
    expect(container.innerHTML).not.toContain("archive:foreign");
    expect(document.activeElement).toBe(required("[aria-label='Production world']"));
    vi.mocked(fixture.runtime.select).mockClear();
    staleSubject.click();
    expect(fixture.runtime.select).not.toHaveBeenCalled();
    await act(async () => replacement.click());
    expect(fixture.runtime.select).toHaveBeenCalled();
  });

  it("moves focus to the world before a focused semantic subject is removed", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("Publish world subjects");
    const subject = container.querySelector<HTMLButtonElement>("[data-subject-token='subject-2']")!;
    subject.focus();
    expect(document.activeElement).toBe(subject);

    await click("Remove world subject");
    expect(document.activeElement).toBe(required("[aria-label='Production world']"));
    expect(container.querySelector("[data-subject-token='subject-2']")).toBeNull();
  });

  it("retains safe-frame identity across unrelated shell notifications", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    const before = stageSafeFrames.at(-1);

    await act(async () => fixture.publish());

    expect(stageSafeFrames.at(-1)).toBe(before);
  });
});

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function testRect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({ x, y, width, height }),
  } as DOMRect;
}

function safeFrame(): Record<string, number> {
  const value = required<HTMLElement>('[aria-label="Production world"]')
    .getAttribute("data-safe-frame");
  if (value === null) throw new Error("Stage safe frame was not supplied");
  return JSON.parse(value) as Record<string, number>;
}

async function click(name: string): Promise<void> {
  const target = button(name);
  if (target === null) throw new Error(`button ${name} was not rendered`);
  await act(async () => target.click());
}

function button(name: string): HTMLButtonElement | null {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => (
    candidate.getAttribute("aria-label") === name
      || candidate.textContent?.trim() === name
      || (name.startsWith("Observe ")
        && candidate.classList.contains("living-atlas-2d__observe")
        && candidate.querySelector("strong")?.textContent === name.slice("Observe ".length))
  )) ?? null;
}

function heading(name: string): HTMLHeadingElement | null {
  return [...container.querySelectorAll<HTMLHeadingElement>("h1,h2,h3")].find(
    (candidate) => candidate.textContent?.trim() === name,
  ) ?? null;
}

function required<T extends Element>(selector: string): T {
  const value = container.querySelector<T>(selector);
  if (value === null) throw new Error(`required selector ${selector} was not rendered`);
  return value;
}

function followSelect(): HTMLSelectElement {
  return required<HTMLSelectElement>(".observer-hud__follow-select");
}

async function chooseFollowSubject(value: string): Promise<void> {
  const select = followSelect();
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** A world with art for two regions and a being in each, so a pursuit can happen. */
function followRuntimeFixture(): ReturnType<typeof runtimeFixture> {
  return runtimeFixture({
    frame: twoRegionFrame(),
    recipes: new Map([
      ["meadow", {} as never],
      ["willow", {} as never],
    ]) as unknown as ObserverShellSnapshot["recipes"],
  });
}

function twoRegionFrame(options: Readonly<{
  asterRegion?: string;
  asterStatus?: AgentStatus;
}> = {}): PresentedObserverFrame {
  const base = presentedFrame();
  return Object.freeze({
    ...base,
    world: Object.freeze({
      ...base.world,
      agents: Object.freeze([
        Object.freeze({
          completeness: "exact" as const,
          value: Object.freeze({
            id: "aster",
            name: "Aster",
            status: options.asterStatus ?? "alive",
            position: options.asterRegion ?? "meadow",
          }),
        }),
        Object.freeze({
          completeness: "exact" as const,
          value: Object.freeze({
            id: "rhea", name: "Rhea", status: "alive", position: "willow",
          }),
        }),
      ]),
      regions: Object.freeze([
        Object.freeze({
          completeness: "exact" as const,
          value: Object.freeze({ name: "meadow", description: "A quiet green place", connections: [] }),
        }),
        Object.freeze({
          completeness: "exact" as const,
          value: Object.freeze({ name: "willow", description: "A shaded bend", connections: [] }),
        }),
      ]),
    }),
  });
}

function runtimeFixture(options: Readonly<{
  frame?: PresentedObserverFrame;
  chronicle?: PresentedChronicleWindow;
  /**
   * Region art this build can mount.
   *
   * Empty by default, which is what every case that predates the follow control
   * assumed: with no art mounted anywhere there is nowhere for a camera to be
   * sent, so the follow roster is empty and the HUD reads `Automatic`.
   */
  recipes?: ObserverShellSnapshot["recipes"];
}> = {}): {
  readonly runtime: ObserverShellRuntime & Record<string, ReturnType<typeof vi.fn> | unknown>;
  readonly unsubscribe: ReturnType<typeof vi.fn>;
  readonly publish: () => void;
  readonly replaceFrame: (frame: PresentedObserverFrame) => void;
  readonly replaceChronicle: (chronicle: PresentedChronicleWindow) => void;
  /** A new world state on the SAME camera: what a live run publishes every tick. */
  readonly replaceWorld: (frame: PresentedObserverFrame) => void;
  readonly advancePreviewBy: (deltaMs: number) => void;
} {
  let frame = options.frame ?? presentedFrame();
  let chronicle: PresentedChronicleWindow = options.chronicle ?? Object.freeze({
    now: null,
    previous: Object.freeze([]),
    upcoming: Object.freeze([{ sequence: 1, regionId: "meadow", urgency: "ambient" as const }]),
    gaps: Object.freeze([]),
  });
  const initialDiagnostics: NonNullable<ObserverShellSnapshot["diagnostics"]> = Object.freeze({
    disposed: false,
    paused: false,
    speed: 1,
    held: false,
    hidden: false,
    recovery: Object.freeze({ status: "idle" }),
    lastCompletedRecovery: null,
    settlement: null,
    ingress: Object.freeze({
      runId: "public-test-run",
      sourceKey: "live:public-test-run",
      ingestedCursor: 9,
      acceptedCount: 0,
      duplicateCount: 0,
      gaps: Object.freeze([]),
      lifetimeAcceptedCount: 0,
      lifetimeDuplicateCount: 0,
      refusedBatchCount: 0,
      lastRefusedBatch: null,
    }),
    director: Object.freeze({
      unpresentableMoments: 0,
        pendingMoments: 0,
      checkpointHold: Object.freeze({
        line: 7,
        eventCursor: 5,
        worldTime: 12,
        correctionEntityIds: Object.freeze(["home_001"]),
        elapsedMs: 0,
        durationMs: 800,
        remainingMs: 800,
        segmentElapsedMs: 0,
        segmentDurationMs: 800,
        segmentRemainingMs: 800,
        focusTarget: Object.freeze({
          regionId: "meadow",
          kind: "home",
          entityId: "home_001",
          segmentIndex: 0,
          segmentCount: 1,
          removed: false,
        }),
      }),
      framePublicationSerial: 17,
      retainedChapters: 0,
      retainedPressureSummaries: 0,
      activeSceneCount: 0,
      recoveryRequired: false,
      retryableIngressFaults: 0,
      lastRetryableIngressFault: null,
      deferredUtteranceEvidence: 0,
    }),
    chronicle: Object.freeze({ previous: 0, upcoming: 1, gaps: 0 }),
    checkpoint: Object.freeze({
      disposed: false,
      runId: "public-test-run",
      lastDeliveredLine: 7,
      polling: false,
      retainedSafeCheckpoints: 1,
      faultCount: 0,
    }),
  });
  let liveDiagnostics = initialDiagnostics;
  let snapshot: ObserverShellSnapshot = Object.freeze({
    status: "ready",
    frame,
    chronicle,
    controls: null,
    diagnostics: initialDiagnostics,
    placement: {} as NonNullable<ObserverShellSnapshot["placement"]>,
    recipes: options.recipes ?? new Map(),
    placementOwnerId: Symbol("test-placement"),
    placementGeneration: 1,
    cameraMode: "story",
    observedRegionId: null,
    focusRequest: null,
    archive: Object.freeze({
      status: "ready",
      checkpoints: Object.freeze([Object.freeze({
        key: Object.freeze({ lineNumber: 7 }),
        eventCursor: 4,
        worldTime: 12,
        reason: "World checkpoint",
      })]),
      hasMore: false,
    }),
    error: null,
  });
  const unsubscribe = vi.fn();
  let listener: (() => void) | null = null;
  const runtime = {
    ready: Promise.resolve(),
    frameSource: Object.freeze({ getSnapshot: () => frame, subscribe: () => vi.fn() }),
    frameAcceptance: Object.freeze({ markAccepted: vi.fn() }),
    subscribe: vi.fn((next: () => void) => {
      listener = next;
      return unsubscribe;
    }),
    getSnapshot: vi.fn(() => snapshot),
    diagnostics: vi.fn(() => liveDiagnostics),
    // The real session stores the selection ON the frame and republishes; the
    // renderer resolves `follow` from exactly that, so a fixture that dropped it
    // could not express a viewer following a being by hand.
    select: vi.fn((next: PresentedObserverFrame["selection"]) => {
      frame = Object.freeze({ ...frame, selection: next });
      snapshot = Object.freeze({ ...snapshot, frame });
      listener?.();
    }),
    pause: vi.fn(),
    resume: vi.fn(),
    setSpeed: vi.fn(),
    holdCurrentMoment: vi.fn(),
    viewMoment: vi.fn(),
    viewCursor: vi.fn(),
    retryRecovery: vi.fn(async () => undefined),
    reconnectStream: vi.fn(),
    setCameraMode: vi.fn(),
    requestFocus: vi.fn(),
    // The real runtime records the observed region and republishes; the follow
    // pursuit steers exactly this, so a fixture that dropped it could never show
    // a pursuit completing.
    observeRegion: vi.fn((regionId: string) => {
      if (snapshot.observedRegionId === regionId) return;
      snapshot = Object.freeze({ ...snapshot, observedRegionId: regionId });
      listener?.();
    }),
    openArchiveCatalogue: vi.fn(async () => undefined),
    loadOlderArchive: vi.fn(async () => undefined),
    enterArchiveCheckpoint: vi.fn(async () => undefined),
    enterArchive: vi.fn(async () => undefined),
    returnToLive: vi.fn(),
    dispose: vi.fn(),
  } satisfies ObserverShellRuntime;
  return {
    runtime,
    unsubscribe,
    publish: () => listener?.(),
    replaceFrame: (next) => {
      frame = next;
      snapshot = Object.freeze({ ...snapshot, frame: next, cameraMode: "story" });
      listener?.();
    },
    replaceChronicle: (next) => {
      chronicle = next;
      snapshot = Object.freeze({ ...snapshot, chronicle: next });
      listener?.();
    },
    replaceWorld: (next) => {
      frame = next;
      snapshot = Object.freeze({ ...snapshot, frame: next });
      listener?.();
    },
    advancePreviewBy: (deltaMs) => {
      const hold = liveDiagnostics.director.checkpointHold;
      if (hold === null) throw new Error("fixture checkpoint hold is missing");
      const elapsedMs = hold.elapsedMs + deltaMs;
      liveDiagnostics = Object.freeze({
        ...liveDiagnostics,
        director: Object.freeze({
          ...liveDiagnostics.director,
          checkpointHold: Object.freeze({
            ...hold,
            elapsedMs,
            remainingMs: hold.durationMs - elapsedMs,
            segmentElapsedMs: elapsedMs,
            segmentRemainingMs: hold.segmentDurationMs - elapsedMs,
          }),
        }),
      });
    },
  };
}

function chronicleWindow(
  overrides: Partial<PresentedChronicleWindow> = {},
): PresentedChronicleWindow {
  return Object.freeze({ now: null, previous: [], upcoming: [], gaps: [], ...overrides });
}

function storyMoment(
  id: string,
  type: string,
  payload: Readonly<Record<string, unknown>>,
): StoryMoment {
  const cursor = Number(id.split(":")[0]);
  const entry = Object.freeze({
    cursor,
    event: Object.freeze({
      type,
      source: "aster",
      payload,
      scope: "local" as const,
      region: "meadow",
      target: null,
      timestamp: 14,
    }),
    resolved: Object.freeze({ actor_id: "aster", region: "meadow" }),
    snapshot_after: null,
  });
  return Object.freeze({
    id,
    firstCursor: cursor,
    lastCursor: cursor,
    evidenceCursors: Object.freeze([cursor]),
    evidence: Object.freeze([entry]),
    representative: entry,
    chainKind: "single",
    priority: "featured",
    focus: Object.freeze({ kind: "agent", id: "aster" }),
  });
}

function frameWithScene(
  moment: StoryMoment,
  dialogue: NonNullable<PresentedObserverFrame["scene"]>["dialogue"] = null,
): PresentedObserverFrame {
  return Object.freeze({
    ...presentedFrame(),
    checkpointFocus: null,
    scene: Object.freeze({
      momentId: moment.id,
      regionId: "meadow",
      phase: "hold",
      focus: Object.freeze({ kind: "agent", id: "aster" }),
      dialogue,
      actorIntents: Object.freeze([]),
      homeIntents: Object.freeze([]),
      effectIntents: Object.freeze([]),
      safeCancelMarkers: Object.freeze([]),
      reducedMotion: false,
    }),
  });
}

function presentedFrame(): PresentedObserverFrame {
  return Object.freeze({
    runId: "public-test-run",
    sourceKey: "live:public-test-run",
    revision: 3,
    firstCursor: 0,
    lastCursor: 5,
    source: "live",
    ingestedCursor: 9,
    presentedCursor: 5,
    world: Object.freeze({
      exactBaseCursor: 0,
      projectedThroughCursor: 5,
      worldTime: 14,
      agents: Object.freeze([Object.freeze({
        completeness: "exact",
        value: Object.freeze({ id: "aster", name: "Aster", status: "alive", position: "meadow" }),
      })]),
      regions: Object.freeze([Object.freeze({
        completeness: "exact",
        value: Object.freeze({ name: "meadow", description: "A quiet green place", connections: [] }),
      })]),
      homes: Object.freeze([]),
      ruins: Object.freeze([]),
      pendingProposals: Object.freeze([]),
    }),
    scene: null,
    selection: null,
    backlog: Object.freeze({
      pendingMoments: 1,
      firstPendingCursor: 6,
      lastPendingCursor: 9,
      state: "behind",
      label: "One moment is gathering.",
    }),
    transport: Object.freeze({
      connection: "live",
      ingestedCursor: 9,
      retryable: false,
    }),
  });
}

function semanticSnapshot(frame: PresentedObserverFrame): RendererSemanticSnapshot {
  return {
    frameIdentity: {
      runId: frame.runId,
      sourceKey: frame.sourceKey,
      revision: frame.revision,
      firstCursor: frame.firstCursor,
      lastCursor: frame.lastCursor,
    },
    subjects: [
      { selection: { kind: "region", id: "meadow" }, stableSelectionKey: "stable-region", kind: "region", regionId: "meadow", position: null, status: "exact", action: null },
      { selection: { kind: "agent", id: "aster" }, stableSelectionKey: "stable-agent", kind: "agent", regionId: "meadow", position: { x: 64, y: 96 }, status: "alive", action: "moving" },
    ],
  };
}

function semanticSnapshotWithRhea(frame: PresentedObserverFrame): RendererSemanticSnapshot {
  return {
    ...semanticSnapshot(frame),
    subjects: [
      {
        selection: { kind: "region", id: "willow" },
        stableSelectionKey: "stable-region-willow",
        kind: "region",
        regionId: "willow",
        position: null,
        status: "exact",
        action: null,
      },
      {
        selection: { kind: "agent", id: "rhea" },
        stableSelectionKey: "stable-agent-rhea",
        kind: "agent",
        regionId: "willow",
        position: { x: 64, y: 96 },
        status: "alive",
        action: "moving",
      },
    ],
  };
}
