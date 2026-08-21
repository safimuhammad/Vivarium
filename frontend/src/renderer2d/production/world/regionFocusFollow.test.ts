import { describe, expect, it } from "vitest";

import {
  FOCUS_FOLLOW_DWELL_MS,
  createFocusFollowState,
  resolveFocusFollow,
  type FocusFollowState,
} from "./regionFocusFollow";

const LOD_SNAPSHOT_ZOOM = 2;

describe("resolveFocusFollow", () => {
  it("never switches while below the LOD/snapshot promotion zoom, and clears any candidate", () => {
    const state = createFocusFollowState();
    const result = resolveFocusFollow(state, {
      geometricFocusRegionId: "warm_springs",
      zoom: LOD_SNAPSHOT_ZOOM - 0.5,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "nirvana",
      nowMs: 1_000,
    });
    expect(result.switchToRegionId).toBeNull();
    expect(result.next.candidateRegionId).toBeNull();
  });

  it("never switches when the camera centre is over a gutter (null geometric focus)", () => {
    const state = createFocusFollowState();
    const result = resolveFocusFollow(state, {
      geometricFocusRegionId: null,
      zoom: LOD_SNAPSHOT_ZOOM + 1,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "nirvana",
      nowMs: 1_000,
    });
    expect(result.switchToRegionId).toBeNull();
    expect(result.next.candidateRegionId).toBeNull();
  });

  it("never switches when the geometric focus already matches the visible region", () => {
    const state = createFocusFollowState();
    const result = resolveFocusFollow(state, {
      geometricFocusRegionId: "nirvana",
      zoom: LOD_SNAPSHOT_ZOOM + 1,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "nirvana",
      nowMs: 1_000,
    });
    expect(result.switchToRegionId).toBeNull();
    expect(result.next.candidateRegionId).toBeNull();
  });

  it("does not switch immediately on a new candidate -- starts the dwell timer instead", () => {
    const state = createFocusFollowState();
    const result = resolveFocusFollow(state, {
      geometricFocusRegionId: "warm_springs",
      zoom: LOD_SNAPSHOT_ZOOM + 1,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "nirvana",
      nowMs: 1_000,
    });
    expect(result.switchToRegionId).toBeNull();
    expect(result.next.candidateRegionId).toBe("warm_springs");
    expect(result.next.candidateSinceMs).toBe(1_000);
  });

  it("switches once the same candidate has dwelt for FOCUS_FOLLOW_DWELL_MS", () => {
    let state: FocusFollowState = createFocusFollowState();
    const first = resolveFocusFollow(state, {
      geometricFocusRegionId: "warm_springs",
      zoom: LOD_SNAPSHOT_ZOOM + 1,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "nirvana",
      nowMs: 1_000,
    });
    state = first.next;
    expect(first.switchToRegionId).toBeNull();

    const stillWaiting = resolveFocusFollow(state, {
      geometricFocusRegionId: "warm_springs",
      zoom: LOD_SNAPSHOT_ZOOM + 1,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "nirvana",
      nowMs: 1_000 + FOCUS_FOLLOW_DWELL_MS - 1,
    });
    expect(stillWaiting.switchToRegionId).toBeNull();

    const switched = resolveFocusFollow(stillWaiting.next, {
      geometricFocusRegionId: "warm_springs",
      zoom: LOD_SNAPSHOT_ZOOM + 1,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "nirvana",
      nowMs: 1_000 + FOCUS_FOLLOW_DWELL_MS,
    });
    expect(switched.switchToRegionId).toBe("warm_springs");
  });

  it("hovering near a gutter (flickering candidates) never accumulates dwell time -- no thrash", () => {
    let state: FocusFollowState = createFocusFollowState();
    const sequence: ReadonlyArray<{ regionId: string | null; atMs: number }> = [
      { regionId: "warm_springs", atMs: 0 },
      { regionId: null, atMs: 50 },
      { regionId: "warm_springs", atMs: 100 },
      { regionId: null, atMs: 150 },
      { regionId: "warm_springs", atMs: 200 },
    ];
    for (const step of sequence) {
      const result = resolveFocusFollow(state, {
        geometricFocusRegionId: step.regionId,
        zoom: LOD_SNAPSHOT_ZOOM + 1,
        lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
        currentVisibleRegionId: "nirvana",
        nowMs: step.atMs,
      });
      expect(result.switchToRegionId).toBeNull();
      state = result.next;
    }
  });

  it("switching candidate mid-dwell resets the timer for the new candidate", () => {
    let state: FocusFollowState = createFocusFollowState();
    state = resolveFocusFollow(state, {
      geometricFocusRegionId: "warm_springs",
      zoom: LOD_SNAPSHOT_ZOOM + 1,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "nirvana",
      nowMs: 0,
    }).next;
    // Switch candidate just before the first would have fired.
    const switched = resolveFocusFollow(state, {
      geometricFocusRegionId: "nirvana_east",
      zoom: LOD_SNAPSHOT_ZOOM + 1,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "nirvana",
      nowMs: FOCUS_FOLLOW_DWELL_MS - 1,
    });
    expect(switched.switchToRegionId).toBeNull();
    expect(switched.next.candidateRegionId).toBe("nirvana_east");
    expect(switched.next.candidateSinceMs).toBe(FOCUS_FOLLOW_DWELL_MS - 1);
    // Confirm the new candidate needs its own full dwell from here.
    const tooSoon = resolveFocusFollow(switched.next, {
      geometricFocusRegionId: "nirvana_east",
      zoom: LOD_SNAPSHOT_ZOOM + 1,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "nirvana",
      nowMs: FOCUS_FOLLOW_DWELL_MS - 1 + FOCUS_FOLLOW_DWELL_MS - 1,
    });
    expect(tooSoon.switchToRegionId).toBeNull();
  });

  it("after a switch, resolving again with the (now-current) visible region clears the candidate", () => {
    let state: FocusFollowState = createFocusFollowState();
    state = resolveFocusFollow(state, {
      geometricFocusRegionId: "warm_springs",
      zoom: LOD_SNAPSHOT_ZOOM + 1,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "nirvana",
      nowMs: 0,
    }).next;
    const switched = resolveFocusFollow(state, {
      geometricFocusRegionId: "warm_springs",
      zoom: LOD_SNAPSHOT_ZOOM + 1,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "nirvana",
      nowMs: FOCUS_FOLLOW_DWELL_MS,
    });
    expect(switched.switchToRegionId).toBe("warm_springs");
    // The caller adopts the switch (currentVisibleRegionId becomes "warm_springs") and resolves
    // again on the next frame.
    const settled = resolveFocusFollow(switched.next, {
      geometricFocusRegionId: "warm_springs",
      zoom: LOD_SNAPSHOT_ZOOM + 1,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "warm_springs",
      nowMs: FOCUS_FOLLOW_DWELL_MS + 16,
    });
    expect(settled.switchToRegionId).toBeNull();
    expect(settled.next.candidateRegionId).toBeNull();
  });

  it("zooming below the LOD/snapshot promotion zoom while a candidate is dwelling cancels it, not just pauses it", () => {
    let state: FocusFollowState = createFocusFollowState();
    state = resolveFocusFollow(state, {
      geometricFocusRegionId: "warm_springs",
      zoom: LOD_SNAPSHOT_ZOOM + 1,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "nirvana",
      nowMs: 0,
    }).next;
    state = resolveFocusFollow(state, {
      geometricFocusRegionId: "warm_springs",
      zoom: LOD_SNAPSHOT_ZOOM - 1,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "nirvana",
      nowMs: 10,
    }).next;
    const reentered = resolveFocusFollow(state, {
      geometricFocusRegionId: "warm_springs",
      zoom: LOD_SNAPSHOT_ZOOM + 1,
      lodSnapshotZoom: LOD_SNAPSHOT_ZOOM,
      currentVisibleRegionId: "nirvana",
      nowMs: FOCUS_FOLLOW_DWELL_MS - 1,
    });
    // If the earlier dwell had merely paused rather than reset, this would already have
    // accumulated enough elapsed time (from nowMs: 0) to fire here. It must not have.
    expect(reentered.switchToRegionId).toBeNull();
  });
});
