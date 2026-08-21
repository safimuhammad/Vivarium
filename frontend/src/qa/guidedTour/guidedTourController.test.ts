import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createGuidedTourController,
  type GuidedTourCameraPort,
  type GuidedTourController,
  type GuidedTourMotionPort,
  type GuidedTourPlaybackPort,
  type GuidedTourScheduler,
  type GuidedTourZoomDriver,
} from "./guidedTourController";
import type { GuidedTourBeat } from "./guidedTourBeats";

function beat(overrides: Partial<GuidedTourBeat> & Pick<GuidedTourBeat, "index" | "cursor">): GuidedTourBeat {
  return {
    total: 3,
    presentedTime: 0,
    type: "resource_changed",
    region: "warm_springs",
    focus: { kind: "agent", id: `agent-${overrides.cursor}` },
    participants: "Someone",
    participantNames: ["Someone"],
    watchLine: "watch this",
    holdMs: 100,
    isDeadTravel: false,
    caption: `beat ${overrides.index}/3`,
    ...overrides,
  };
}

const BEATS: readonly GuidedTourBeat[] = [
  beat({ index: 1, cursor: 1, region: "warm_springs", holdMs: 100 }),
  beat({ index: 2, cursor: 2, region: "warm_springs", holdMs: 50, focus: { kind: "agent", id: "agent-2" } }),
  beat({
    index: 3,
    cursor: 3,
    region: "nirvana",
    holdMs: 200,
    focus: { kind: "ruin", id: "ruin-3" },
  }),
];

const DEAD_TRAVEL_BEATS: readonly GuidedTourBeat[] = [
  beat({ index: 1, cursor: 1, region: "warm_springs", holdMs: 100, type: "agent_left_region", isDeadTravel: true }),
  beat({ index: 2, cursor: 2, region: "nirvana", holdMs: 100, type: "agent_entered_region", isDeadTravel: true }),
];

interface FakeScheduled {
  readonly id: number;
  readonly delayMs: number;
  callback: () => void;
  cancelled: boolean;
}

function createFakeScheduler(): {
  readonly scheduler: GuidedTourScheduler;
  readonly pending: readonly FakeScheduled[];
  flushNext(): void;
} {
  const pending: FakeScheduled[] = [];
  let nextId = 0;
  const scheduler: GuidedTourScheduler = {
    schedule(delayMs, callback): () => void {
      const entry: FakeScheduled = { id: nextId, delayMs, callback, cancelled: false };
      nextId += 1;
      pending.push(entry);
      return () => {
        entry.cancelled = true;
        const index = pending.indexOf(entry);
        if (index >= 0) pending.splice(index, 1);
      };
    },
  };
  return {
    scheduler,
    pending,
    flushNext(): void {
      const entry = pending.shift();
      if (entry !== undefined && !entry.cancelled) entry.callback();
    },
  };
}

interface FakePlayback {
  readonly port: GuidedTourPlaybackPort;
  readonly deliveredCursors: number[];
  presentCursor(cursor: number): void;
  resumeCalls(): number;
  pauseCalls(): number;
}

function createFakePlayback(): FakePlayback {
  let presented = 0;
  let resumeCount = 0;
  let pauseCount = 0;
  const listeners = new Set<() => void>();
  const deliveredCursors: number[] = [];
  return {
    port: {
      deliverThroughCursor: (cursor) => deliveredCursors.push(cursor),
      resume: () => { resumeCount += 1; },
      pause: () => { pauseCount += 1; },
      getPresentedCursor: () => presented,
      subscribe: (listener): () => void => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    deliveredCursors,
    presentCursor(cursor): void {
      presented = cursor;
      for (const listener of [...listeners]) listener();
    },
    resumeCalls: () => resumeCount,
    pauseCalls: () => pauseCount,
  };
}

describe("createGuidedTourController", () => {
  let camera: GuidedTourCameraPort;
  let fakePlayback: FakePlayback;
  let zoom: GuidedTourZoomDriver;
  let motion: GuidedTourMotionPort;
  let fake: ReturnType<typeof createFakeScheduler>;
  let controller: GuidedTourController;

  beforeEach(() => {
    camera = {
      setCameraMode: vi.fn(),
      requestFocus: vi.fn(),
      observeRegion: vi.fn(),
    };
    fakePlayback = createFakePlayback();
    zoom = { zoomToTarget: vi.fn().mockReturnValue({ fits: true }) };
    motion = { setReducedMotionOverride: vi.fn() };
    fake = createFakeScheduler();
    controller = createGuidedTourController({
      beats: BEATS,
      camera,
      playback: fakePlayback.port,
      scheduler: fake.scheduler,
      zoom,
      motion,
      regionSettleMs: 10,
    });
  });

  it("is inert until start() — no camera/playback side effects", () => {
    expect(camera.observeRegion).not.toHaveBeenCalled();
    expect(fakePlayback.deliveredCursors).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({ active: false, playing: false, beatIndex: 0 });
  });

  it("observes the region, waits the settle delay, delivers, and only frames the camera once presented", () => {
    controller.start();
    expect(camera.observeRegion).toHaveBeenCalledExactlyOnceWith("warm_springs");
    expect(fakePlayback.deliveredCursors).toEqual([]);
    expect(fake.pending).toHaveLength(1);
    expect(fake.pending[0]!.delayMs).toBe(10);

    fake.flushNext(); // settle -> deliver + resume + start waiting on presentedCursor
    expect(fakePlayback.deliveredCursors).toEqual([1]);
    expect(fakePlayback.resumeCalls()).toBe(1);
    expect(camera.setCameraMode).not.toHaveBeenCalled(); // not presented yet
    expect(fake.pending).toHaveLength(0); // no hold timer until presented

    fakePlayback.presentCursor(1);
    expect(camera.setCameraMode).toHaveBeenCalledWith("story");
    expect(camera.requestFocus).toHaveBeenCalledWith({ kind: "agent", id: "agent-1" });
    expect(zoom.zoomToTarget).not.toHaveBeenCalled(); // zoom waits for the camera-settle delay
    expect(fake.pending).toHaveLength(1); // camera-settle timer scheduled, not the hold yet

    fake.flushNext(); // camera-settle -> zoom + schedule the hold
    expect(zoom.zoomToTarget).toHaveBeenCalledExactlyOnceWith(BEATS[0]);
    expect(fake.pending).toHaveLength(1); // hold timer now scheduled
  });

  it("pays the longer region-camera-settle delay for a region-crossing beat, and the short one otherwise", () => {
    // Regression: a beat whose region differs from the previous one (e.g. C18's
    // agent_born at cursor 14, crossing nirvana -> warm_springs) must get
    // materially more real time before zoom is applied than an ordinary
    // same-region beat — see pacing note #4. Confirmed live: the short delay froze
    // the camera on empty ground with no participant on screen for such a beat.
    const settleController = createGuidedTourController({
      beats: BEATS,
      camera,
      playback: fakePlayback.port,
      scheduler: fake.scheduler,
      zoom,
      motion,
      regionSettleMs: 10,
      cameraSettleMs: 111,
      regionCameraSettleMs: 9_999,
    });

    settleController.start(); // beat 1 (warm_springs): first beat is a "region change" from null
    fake.flushNext(); // region-settle -> deliver
    fakePlayback.presentCursor(1);
    expect(fake.pending[0]!.delayMs).toBe(9_999); // region-crossing beat: the long delay
    fake.flushNext(); // camera-settle -> zoom + schedule hold
    fake.flushNext(); // beat 1's hold -> advance -> beat 2 (same region: no settle)
    fakePlayback.presentCursor(2);
    expect(fake.pending[0]!.delayMs).toBe(111); // same-region beat: the short delay
  });

  it("proceeds immediately when the cursor is already presented (no wasted wait)", () => {
    controller.start();
    fake.flushNext(); // settle -> deliver
    fakePlayback.presentCursor(5); // already past cursor 1
    expect(camera.setCameraMode).toHaveBeenCalledWith("story");
  });

  it("does not re-observe the region when the next beat stays in the same region", () => {
    controller.start();
    fake.flushNext(); // region-settle beat 1 -> deliver
    fakePlayback.presentCursor(1); // frame beat 1; schedules camera-settle
    fake.flushNext(); // camera-settle beat 1 -> zoom + schedule its hold

    fake.flushNext(); // beat 1's hold -> advance -> beat 2 (same region: immediate deliver, no settle)
    expect(camera.observeRegion).toHaveBeenCalledOnce();
    expect(fakePlayback.deliveredCursors).toEqual([1, 2]);
    fakePlayback.presentCursor(2);
    expect(camera.requestFocus).toHaveBeenLastCalledWith({ kind: "agent", id: "agent-2" });
  });

  it("re-observes and pays the settle delay when the region changes", () => {
    controller.start();
    fake.flushNext(); // region-settle beat 1 -> deliver
    fakePlayback.presentCursor(1);
    fake.flushNext(); // camera-settle beat 1 -> zoom + schedule its hold
    fake.flushNext(); // advance -> beat 2 (same region)
    fakePlayback.presentCursor(2);
    fake.flushNext(); // camera-settle beat 2 -> zoom + schedule its hold

    fake.flushNext(); // advance -> beat 3 (region changes to nirvana)
    expect(camera.observeRegion).toHaveBeenCalledTimes(2);
    expect(camera.observeRegion).toHaveBeenLastCalledWith("nirvana");
    expect(fakePlayback.deliveredCursors).toEqual([1, 2]); // still waiting on settle
    expect(fake.pending).toHaveLength(1);
    expect(fake.pending[0]!.delayMs).toBe(10);

    fake.flushNext(); // settle beat 3 -> deliver
    expect(fakePlayback.deliveredCursors).toEqual([1, 2, 3]);
    fakePlayback.presentCursor(3);
    expect(camera.requestFocus).toHaveBeenLastCalledWith({ kind: "ruin", id: "ruin-3" });
  });

  it("finishes at the last beat: pauses playback, marks done, and stops advancing", () => {
    controller.start();
    fake.flushNext(); // settle beat 1 -> deliver
    fakePlayback.presentCursor(1); // frame beat 1
    fake.flushNext(); // camera-settle beat 1 -> zoom + schedule its hold
    fake.flushNext(); // beat 1's hold -> advance -> beat 2 (same region) -> deliver
    fakePlayback.presentCursor(2); // frame beat 2
    fake.flushNext(); // camera-settle beat 2 -> zoom + schedule its hold
    fake.flushNext(); // beat 2's hold -> advance -> beat 3 (region changes) -> settle
    fake.flushNext(); // settle beat 3 -> deliver
    fakePlayback.presentCursor(3); // frame beat 3 (final)
    fake.flushNext(); // camera-settle beat 3 -> zoom + schedule its hold
    expect(controller.getSnapshot().done).toBe(false);
    expect(fake.pending).toHaveLength(1); // final beat's hold timer

    fake.flushNext(); // advance past the final beat
    const snapshot = controller.getSnapshot();
    expect(snapshot.done).toBe(true);
    expect(snapshot.playing).toBe(false);
    expect(fakePlayback.pauseCalls()).toBe(1);
    expect(fake.pending).toHaveLength(0);
  });

  it("pause() cancels the pending advance and stops auto-play; resume() reschedules it", () => {
    controller.start();
    fake.flushNext(); // region-settle -> deliver
    fakePlayback.presentCursor(1); // frame beat 1; schedules camera-settle
    fake.flushNext(); // camera-settle -> zoom + schedule the hold
    expect(fake.pending).toHaveLength(1);

    controller.pause();
    expect(controller.getSnapshot().playing).toBe(false);
    expect(fake.pending).toHaveLength(0);

    controller.resume();
    expect(controller.getSnapshot().playing).toBe(true);
    expect(fake.pending).toHaveLength(1);
    expect(fake.pending[0]!.delayMs).toBe(100);
  });

  it("next() jumps beats immediately, bypassing hold timers, and clamps at the last beat", () => {
    controller.start();
    fake.flushNext();
    fakePlayback.presentCursor(1);
    fakePlayback.deliveredCursors.length = 0;

    controller.next();
    expect(fakePlayback.deliveredCursors).toEqual([2]); // same region: immediate deliver
    fakePlayback.presentCursor(2);
    expect(controller.getSnapshot().beatIndex).toBe(1);

    controller.next();
    fakePlayback.presentCursor(3);
    expect(controller.getSnapshot().beatIndex).toBe(2); // last beat

    controller.next(); // already at the last beat
    expect(controller.getSnapshot().beatIndex).toBe(2);
  });

  it("prev() is a no-op — cursor delivery is forward-only and cannot rewind the world", () => {
    controller.start();
    fake.flushNext();
    fakePlayback.presentCursor(1);
    fakePlayback.deliveredCursors.length = 0;

    controller.next();
    fakePlayback.presentCursor(2);
    expect(controller.getSnapshot().beatIndex).toBe(1);
    vi.mocked(camera.requestFocus).mockClear();
    fakePlayback.deliveredCursors.length = 0;

    controller.prev();

    expect(controller.getSnapshot().beatIndex).toBe(1); // unchanged
    expect(fakePlayback.deliveredCursors).toEqual([]); // no delivery call at all
    expect(camera.requestFocus).not.toHaveBeenCalled();
  });

  it("re-observes a region jump()-cancelled mid-settle rather than silently skipping it", () => {
    // Regression: rapid manual stepping (e.g. holding an arrow key) can jump to a new
    // beat before a region-change's settle delay elapses. The cancelled jump must not
    // leave the controller believing the region switch already happened, or a later
    // beat in that same (never-actually-observed) region would wrongly skip
    // re-observing it and the camera could stay parked on stale geometry.
    const fourBeats: readonly GuidedTourBeat[] = [
      beat({ index: 1, cursor: 1, region: "warm_springs" }),
      beat({ index: 2, cursor: 2, region: "nirvana", focus: { kind: "agent", id: "agent-2" } }),
      beat({ index: 3, cursor: 3, region: "warm_springs", focus: { kind: "agent", id: "agent-3" } }),
      beat({ index: 4, cursor: 4, region: "nirvana", focus: { kind: "agent", id: "agent-4" } }),
    ];
    const raceController = createGuidedTourController({
      beats: fourBeats,
      camera,
      playback: fakePlayback.port,
      scheduler: fake.scheduler,
      zoom,
      motion,
      regionSettleMs: 500,
    });

    raceController.start(); // beat 1 (warm_springs): observeRegion + settle(500) scheduled
    expect(camera.observeRegion).toHaveBeenCalledExactlyOnceWith("warm_springs");

    raceController.next(); // jump to beat 2 (nirvana) BEFORE beat 1's settle ever fires
    expect(camera.observeRegion).toHaveBeenLastCalledWith("nirvana");
    expect(camera.observeRegion).toHaveBeenCalledTimes(2);

    raceController.next(); // jump to beat 3 (warm_springs) BEFORE beat 2's settle ever fires
    // Must re-observe warm_springs: beat 1's settle for warm_springs was cancelled, so
    // the controller must not believe warm_springs is already the observed region.
    expect(camera.observeRegion).toHaveBeenLastCalledWith("warm_springs");
    expect(camera.observeRegion).toHaveBeenCalledTimes(3);

    // Let beat 3's settle actually elapse this time, and confirm it frames correctly.
    fake.flushNext();
    fakePlayback.presentCursor(3);
    expect(camera.requestFocus).toHaveBeenLastCalledWith({ kind: "agent", id: "agent-3" });
  });

  it("dispose() stops timers, releases any reduced-motion override, and pauses playback", () => {
    controller.start();
    fake.flushNext();
    fakePlayback.presentCursor(1);
    controller.dispose();
    expect(fakePlayback.pauseCalls()).toBe(1);
    expect(motion.setReducedMotionOverride).toHaveBeenLastCalledWith(false);
    expect(fake.pending).toHaveLength(0);

    vi.mocked(camera.observeRegion).mockClear();
    controller.next();
    controller.resume();
    expect(camera.observeRegion).not.toHaveBeenCalled();
  });

  it("surfaces the zoom driver's fits result on the snapshot, defaulting to true", () => {
    expect(controller.getSnapshot().framingFits).toBe(true); // before start()

    vi.mocked(zoom.zoomToTarget).mockReturnValueOnce({ fits: false });
    controller.start();
    fake.flushNext();
    fakePlayback.presentCursor(1); // frame beat 1; schedules camera-settle
    fake.flushNext(); // camera-settle -> zoom (fits:false) + schedule the hold
    expect(controller.getSnapshot().framingFits).toBe(false);

    vi.mocked(zoom.zoomToTarget).mockReturnValueOnce({ fits: true });
    fake.flushNext(); // beat 1's hold -> advance -> beat 2
    fakePlayback.presentCursor(2); // frame beat 2; schedules camera-settle
    fake.flushNext(); // camera-settle -> zoom (fits:true) + schedule the hold
    expect(controller.getSnapshot().framingFits).toBe(true);
  });

  it("defaults framingFits to true when no zoom driver is configured", () => {
    const controllerWithoutZoom = createGuidedTourController({
      beats: BEATS,
      camera,
      playback: fakePlayback.port,
      scheduler: fake.scheduler,
      motion,
      regionSettleMs: 10,
    });
    controllerWithoutZoom.start();
    fake.flushNext(); // region-settle -> deliver
    fakePlayback.presentCursor(1); // frame beat 1; schedules camera-settle
    fake.flushNext(); // camera-settle -> (no zoom driver) + schedule the hold
    expect(controllerWithoutZoom.getSnapshot().framingFits).toBe(true);
  });

  it("waiting for a not-yet-presented cursor does not resolve on an unrelated notification", () => {
    controller.start();
    fake.flushNext();
    fakePlayback.presentCursor(0); // notifies, but still behind
    expect(camera.setCameraMode).not.toHaveBeenCalled();
    fakePlayback.presentCursor(1);
    expect(camera.setCameraMode).toHaveBeenCalledWith("story");
  });
});

describe("createGuidedTourController — dead-travel reduced-motion override", () => {
  it("forces reduced motion only while delivering/waiting on a dead-travel beat, then releases it", () => {
    const camera: GuidedTourCameraPort = {
      setCameraMode: vi.fn(),
      requestFocus: vi.fn(),
      observeRegion: vi.fn(),
    };
    const fakePlayback = createFakePlayback();
    const motion: GuidedTourMotionPort = { setReducedMotionOverride: vi.fn() };
    const fake = createFakeScheduler();
    const controller = createGuidedTourController({
      beats: DEAD_TRAVEL_BEATS,
      camera,
      playback: fakePlayback.port,
      scheduler: fake.scheduler,
      motion,
      regionSettleMs: 10,
    });

    controller.start();
    fake.flushNext(); // settle -> deliver beat 1 (agent_left_region)
    expect(motion.setReducedMotionOverride).toHaveBeenLastCalledWith(true);
    expect(fakePlayback.deliveredCursors).toEqual([1]);

    fakePlayback.presentCursor(1);
    expect(motion.setReducedMotionOverride).toHaveBeenLastCalledWith(false);

    fake.flushNext(); // camera-settle beat 1 -> zoom + schedule its hold
    fake.flushNext(); // beat 1's hold -> advance -> beat 2 (agent_entered_region, region changes -> settle)
    fake.flushNext(); // settle -> deliver beat 2
    expect(motion.setReducedMotionOverride).toHaveBeenLastCalledWith(true);
    fakePlayback.presentCursor(2);
    expect(motion.setReducedMotionOverride).toHaveBeenLastCalledWith(false);
  });

  it("never forces reduced motion for a normal (non-dead-travel) beat", () => {
    const camera: GuidedTourCameraPort = {
      setCameraMode: vi.fn(),
      requestFocus: vi.fn(),
      observeRegion: vi.fn(),
    };
    const fakePlayback = createFakePlayback();
    const motion: GuidedTourMotionPort = { setReducedMotionOverride: vi.fn() };
    const fake = createFakeScheduler();
    const controller = createGuidedTourController({
      beats: [beat({ index: 1, cursor: 1 })],
      camera,
      playback: fakePlayback.port,
      scheduler: fake.scheduler,
      motion,
      regionSettleMs: 10,
    });

    controller.start();
    fake.flushNext();
    expect(motion.setReducedMotionOverride).toHaveBeenCalledExactlyOnceWith(false);
  });
});
