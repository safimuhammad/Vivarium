import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoryMoment } from "../presentation/BeatDirector";
import type { PresentedObserverFrame } from "../presentation/contracts";
import type { PresentedChronicleWindow } from "../presentation/selectors";
import type { PresentationWorldStageProps } from "../renderer2d/production/PresentationWorldStage";
import type { RendererSemanticSnapshot } from "../renderer2d/production/semantics";
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
      data-safe-frame={JSON.stringify(props.safeFrame)}>
      <button type="button" onClick={() => props.callbacks?.onSelectionChange?.({ kind: "region", id: "meadow" })}>
        Select world region
      </button>
      <button type="button" onClick={() => props.callbacks?.onSelectionChange?.({ kind: "agent", id: "aster" })}>
        Select world being
      </button>
      <button type="button" onClick={() => props.callbacks?.onCameraModeChange?.(props.cameraMode ?? "story")}>
        Accept camera request
      </button>
      <button type="button" onClick={() => props.onCameraModeRequestRejected?.(props.cameraMode ?? "story")}>
        Reject camera request
      </button>
      <button type="button" onClick={() => props.onObserveRegion?.("meadow")}>
        Announce observed region
      </button>
      <button type="button" onClick={() => props.callbacks?.onSemanticSnapshot?.(semanticSnapshot(frame))}>
        Publish world subjects
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
    expect(drawer).toEqual({ top: 72, right: 434, bottom: 148, left: 20 });

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

  it("keeps only game status persistent and moves controls, Atlas, and diagnostics into World", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    expect(required<HTMLElement>(".observer-hud").textContent?.replace(/\s+/g, " ").trim())
      .toBe("Meadow · Day 1, 12:00 AM · World totals: 1 living · 0 dead · 0 homes · 0 ruins");
    expect(button("Pause story")).toBeNull();
    expect(button("Free")).toBeNull();
    expect(container.querySelector(".living-atlas-2d")).toBeNull();
    expect(container.textContent).not.toContain("Shown 5 · Received 9");
    expect([...required(".observer-edge-triggers").querySelectorAll("button")]
      .map((candidate) => candidate.textContent?.trim())).toEqual([
        "World", "Chronicle", "Selection", "Archive",
      ]);

    await click("World");
    expect(button("Pause story")).not.toBeNull();
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
      const select = required<HTMLSelectElement>("select[aria-label='Story speed']");
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

    expect(heading("Chronicle")).toBeNull();
    const story = required<HTMLElement>("[data-story-now]");
    expect(story.getAttribute("data-story-state")).toBe("active");
    expect(story.textContent).toContain("NowShelter raisedAster completed a shelter.Meadow");
    expect(container.querySelectorAll("button")).toSatisfy((buttons: NodeListOf<HTMLButtonElement>) => (
      [...buttons].filter((candidate) => candidate.textContent?.trim() === "View moment").length === 1
    ));

    await click("View shown moment Shelter raised");
    expect(fixture.runtime.viewMoment).toHaveBeenCalledWith(now.id);
    expect(container.innerHTML).not.toContain(now.id);
  });

  it("keeps the latest settled moment visible after its scene completes", async () => {
    const latest = storyMoment("5:5:single", "self_talk", { agent_id: "aster" });
    const fixture = runtimeFixture({
      frame: { ...presentedFrame(), checkpointFocus: null, scene: null },
      chronicle: chronicleWindow({ previous: [latest] }),
    });
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    expect(required("[data-story-state='latest']").textContent)
      .toContain("LatestA private reflectionAster reflected quietly.Meadow");
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

    const story = required<HTMLElement>("[data-story-kind='checkpoint']");
    expect(story.textContent).toContain(
      "Between momentsA structure is goneA structure no longer remains in Meadow.Meadow",
    );
    expect(story.querySelector("button")).toBeNull();
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

    expect(container.querySelector(".dialogue-now")?.textContent).toContain("The meadow is quiet.");
    expect(container.querySelector("[data-story-now]")).toBeNull();
    expect(container.querySelectorAll("[role='status'][aria-live='polite']")).toHaveLength(1);
  });

  it("routes only observer controls, atlas requests, Canvas selection, and bounded Archive keys", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    await click("World");
    await click("Pause story");
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

  it("shows only the accepted camera mode and permits Follow to retry after a valid selection", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    await click("World");
    await click("Follow");
    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-requested-camera")).toBe("follow");
    expect(required<HTMLElement>(".vivarium-2d-app").getAttribute("data-camera-mode")).toBe("story");
    expect(button("Story")?.getAttribute("aria-pressed")).toBe("true");

    await click("Reject camera request");
    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-requested-camera")).toBe("story");
    expect(fixture.runtime.setCameraMode).not.toHaveBeenCalledWith("follow");

    await click("Select world being");
    await click("World");
    await click("Follow");
    await click("Accept camera request");
    expect(required<HTMLElement>(".vivarium-2d-app").getAttribute("data-camera-mode")).toBe("follow");
    expect(button("Follow")?.getAttribute("aria-pressed")).toBe("true");
    expect(fixture.runtime.setCameraMode).toHaveBeenCalledWith("follow");
  });

  it("drops a pending camera request before presenting the first frame of a replacement run", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);
    await click("World");
    await click("Follow");
    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-requested-camera")).toBe("follow");

    const prior = fixture.runtime.frameSource.getSnapshot();
    await act(async () => fixture.replaceFrame({
      ...prior,
      runId: "replacement-run",
      sourceKey: "live:replacement-run",
      revision: 1,
    }));

    expect(required<HTMLElement>('[aria-label="Production world"]')
      .getAttribute("data-requested-camera")).toBe("story");
    expect(required<HTMLElement>(".vivarium-2d-app").getAttribute("data-camera-mode")).toBe("story");
  });

  it("owns one controlled drawer trigger per surface and restores focus on close and Escape", async () => {
    const fixture = runtimeFixture();
    await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
    await act(async () => fixture.runtime.ready);

    const worldTriggers = [...container.querySelectorAll("button")]
      .filter((candidate) => candidate.textContent?.trim() === "World");
    expect(worldTriggers).toHaveLength(1);
    expect(container.querySelector(".observer-edge-triggers button")?.textContent).toBe("World");
    for (const name of ["World", "Chronicle", "Selection", "Archive"]) {
      const trigger = button(name);
      expect(trigger?.id).toBe(`observer-${name.toLowerCase()}-trigger`);
      expect(trigger?.getAttribute("aria-controls")).toBe("observer-primary-surface");
    }

    await click("Chronicle");
    expect(required("#observer-primary-surface")).not.toBeNull();
    expect(required("#observer-primary-surface").getAttribute("role")).toBe("complementary");
    expect(document.activeElement).toBe(heading("Chronicle"));
    await click("Selection");
    await click("Close Selection");
    expect(document.activeElement).toBe(button("Selection"));

    await click("Chronicle");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(heading("Chronicle")).toBeNull();
    expect(document.activeElement).toBe(button("Chronicle"));
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

    expect(safeFrame()).toEqual({ top: 64, right: 56, bottom: 176, left: 20 });
    await click("Chronicle");
    expect(safeFrame()).toEqual({ top: 64, right: 436, bottom: 176, left: 20 });

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

    expect(safeFrame()).toEqual({ top: 72, right: 52, bottom: 176, left: 20 });
    await click("Chronicle");
    expect(safeFrame()).toEqual({ top: 72, right: 434, bottom: 176, left: 20 });
  });

  it("measures Story Now as the desktop narrative slot when dialogue is absent", async () => {
    setViewport(1_440, 900);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("vivarium-2d-app")) return testRect(0, 0, 1_440, 900);
      if (this.classList.contains("observer-hud")) return testRect(12, 12, 674, 52);
      if (this.classList.contains("living-atlas-2d")) return testRect(1_076, 12, 352, 266);
      if (this.classList.contains("story-now")) return testRect(128, 760, 1_184, 126);
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

    expect(required(".story-now")).not.toBeNull();
    expect(container.querySelector(".dialogue-now")).toBeNull();
    expect(safeFrame()).toEqual({ top: 72, right: 52, bottom: 148, left: 20 });
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
      if (this.classList.contains("story-now")) return testRect(128, 664, 1_184, 126);
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

    expect(required(".story-now")).not.toBeNull();
    // Correct: bottom is bound by the 700px-tall app box (bottom 144), not the 900px
    // window (which the bug would have produced as bottom 344, shrinking the frame to a
    // 30%-ish sliver of the app's own box instead of its true ~80%).
    expect(safeFrame()).toEqual({ top: 72, right: 52, bottom: 144, left: 20 });
  });

  it.each([
    { initial: "story", replacement: "dialogue", expectedBottom: 232 },
    { initial: "dialogue", replacement: "story", expectedBottom: 152 },
  ] as const)(
    "rebinds mobile narrative measurement from $initial to $replacement without a viewport resize",
    async ({ initial, replacement, expectedBottom }) => {
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
        if (this.classList.contains("story-now")) return testRect(8, 700, 374, 136);
        if (this.classList.contains("dialogue-now")) return testRect(8, 620, 374, 216);
        if (this.classList.contains("semantic-world-mirror")) return testRect(8, 760, 210, 76);
        if (this.classList.contains("observer-edge-triggers")) return testRect(8, 104, 374, 44);
        return testRect(0, 0, 0, 0);
      });
      const now = storyMoment("5:5:single", "speak", {
        speaker_id: "aster",
        text: "The meadow is quiet.",
      });
      const storyFrame = frameWithScene(now, null);
      const dialogueFrame = frameWithScene(now, {
        speakerId: "aster",
        speakerName: "Aster",
        text: "The meadow is quiet.",
        visibleCharacters: 20,
        cursor: 20,
        hold: false,
      });
      const fixture = runtimeFixture({
        frame: initial === "story" ? storyFrame : dialogueFrame,
        chronicle: chronicleWindow({ now }),
      });

      await act(async () => root.render(<Vivarium2DApp createRuntime={() => fixture.runtime} />));
      await act(async () => fixture.runtime.ready);
      const firstObserver = observers.at(-1)!;
      expect(firstObserver.observed.some((element) => (
        element.classList.contains(initial === "story" ? "story-now" : "dialogue-now")
      ))).toBe(true);

      await act(async () => fixture.replaceFrame(
        replacement === "story" ? storyFrame : dialogueFrame,
      ));

      expect(firstObserver.disconnect).toHaveBeenCalledOnce();
      const rebound = observers.at(-1)!;
      expect(rebound).not.toBe(firstObserver);
      expect(rebound.observed.some((element) => (
        element.classList.contains(replacement === "story" ? "story-now" : "dialogue-now")
      ))).toBe(true);
      expect(safeFrame().bottom).toBe(expectedBottom);
      expect(844 - safeFrame().top - safeFrame().bottom).toBeGreaterThanOrEqual(844 * 0.52);
    },
  );

  it("keeps arbitrary entity IDs out of Story Now and its polite announcement", async () => {
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
    expect(required<HTMLElement>("[data-story-now]").textContent)
      .toContain("Unknown being completed a shelter.");
    expect(required<HTMLElement>("[data-story-now]").textContent)
      .not.toMatch(/mystic_007|raider_12/);

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

function runtimeFixture(options: Readonly<{
  frame?: PresentedObserverFrame;
  chronicle?: PresentedChronicleWindow;
}> = {}): {
  readonly runtime: ObserverShellRuntime & Record<string, ReturnType<typeof vi.fn> | unknown>;
  readonly unsubscribe: ReturnType<typeof vi.fn>;
  readonly publish: () => void;
  readonly replaceFrame: (frame: PresentedObserverFrame) => void;
  readonly advancePreviewBy: (deltaMs: number) => void;
} {
  let frame = options.frame ?? presentedFrame();
  const chronicle: PresentedChronicleWindow = options.chronicle ?? Object.freeze({
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
    recipes: new Map(),
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
    select: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    setSpeed: vi.fn(),
    holdCurrentMoment: vi.fn(),
    viewMoment: vi.fn(),
    retryRecovery: vi.fn(async () => undefined),
    reconnectStream: vi.fn(),
    setCameraMode: vi.fn(),
    requestFocus: vi.fn(),
    observeRegion: vi.fn(),
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
