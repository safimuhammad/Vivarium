import { describe, expect, it, vi } from "vitest";

import type { AssetLease } from "../assets/atlasStore";
import { DEMO_SHELTER_MANIFEST } from "../assets/shelterManifest";
import {
  createShelterActor,
  type ShelterActorOptions,
  type ShelterActorPort,
  type ShelterCommand,
  type ShelterComponentId,
} from "./ShelterActor";

function createAtlasLease(): AssetLease<ImageBitmap> {
  return { value: {} as ImageBitmap, release: vi.fn() };
}

function createTestShelter(overrides: Partial<ShelterActorOptions> = {}): ShelterActorPort {
  return createShelterActor({
    id: "shelter-east",
    plot: { x: 368, y: 112 },
    ...overrides,
  });
}

function component(shelter: ShelterActorPort, id: ShelterComponentId) {
  return shelter.snapshot().components.find((candidate) => candidate.id === id)!;
}

describe("ShelterActor", () => {
  it("captures caller-owned identity, plot, manifest, and original atlas lease at construction", () => {
    const originalLease = createAtlasLease();
    const replacementLease = createAtlasLease();
    const manifest: any = structuredClone(DEMO_SHELTER_MANIFEST);
    const options = {
      id: "stable-shelter",
      plot: { x: 3, y: 4 },
      atlasLease: originalLease,
      manifest,
    };
    const shelter = createShelterActor(options);

    options.id = "mutated-shelter";
    options.plot.x = 99;
    options.atlasLease = replacementLease;
    manifest.id = "mutated-manifest";
    manifest.components.roof.standing = "wall-intact";

    shelter.apply({ type: "build", durationMs: 100 }, 0);
    shelter.advanceTo(100);
    expect(shelter.snapshot()).toMatchObject({
      id: "stable-shelter",
      plot: { x: 3, y: 4 },
      visual: { manifestId: "vivarium-shelter-slice-v1" },
    });
    expect(component(shelter, "roof").frameId).toBe("roof-intact");

    shelter.dispose();
    expect(originalLease.release).toHaveBeenCalledTimes(1);
    expect(replacementLease.release).not.toHaveBeenCalled();
  });

  it("builds components in order from the absolute start epoch and commits one persistent standing shelter", () => {
    const shelter = createTestShelter();
    shelter.apply({ type: "build", durationMs: 3200 }, 6500);

    const applied = shelter.snapshot();
    expect(applied).toMatchObject({ phase: "building", elapsedMs: 0, emittedMarkers: [], buildCommitCount: 0 });
    expect(applied.components.every(({ visibility }) => visibility === 0)).toBe(true);
    expect(() => shelter.advanceTo(0)).toThrow(/non-monotonic/i);
    expect(shelter.snapshot()).toEqual(applied);

    const signals = [6500, 7076, 7716, 8484, 9060, 9444, 9700]
      .flatMap((time) => shelter.advanceTo(time));

    expect(signals).toEqual([
      { name: "foundation", atMs: 6500 },
      { name: "posts", atMs: 7076 },
      { name: "walls", atMs: 7716 },
      { name: "roof", atMs: 8484 },
      { name: "door", atMs: 9060 },
      { name: "hearth", atMs: 9444 },
      { name: "build-commit", atMs: 9700 },
    ]);
    expect(shelter.snapshot()).toMatchObject({
      phase: "standing",
      elapsedMs: 3200,
      buildCommitCount: 1,
      collapseCommitCount: 0,
    });
    expect(shelter.snapshot().components.every(({ visibility, damaged }) => visibility === 1 && !damaged)).toBe(true);
    expect(shelter.advanceTo(20000)).toEqual([]);
    expect(shelter.snapshot().buildCommitCount).toBe(1);
  });

  it("crosses every build marker in canonical order during one large delta and never emits one twice", () => {
    const shelter = createTestShelter();
    shelter.apply({ type: "build", durationMs: 3200 }, 6500);

    const signals = shelter.advanceTo(9700);

    expect(signals.map(({ name }) => name)).toEqual([
      "foundation",
      "posts",
      "walls",
      "roof",
      "door",
      "hearth",
      "build-commit",
    ]);
    expect(signals.map(({ atMs }) => atMs)).toEqual([6500, 7076, 7716, 8484, 9060, 9444, 9700]);
    expect(shelter.advanceTo(9700)).toEqual([]);
    expect(shelter.advanceTo(15000)).toEqual([]);
  });

  it("emits fractional build markers and commit at their exact absolute scheduled times", () => {
    const markerShelter = createTestShelter();
    const markerStart = 1 / 7;
    const markerDuration = 2 / 13;
    markerShelter.apply({ type: "build", durationMs: markerDuration }, markerStart);
    expect(markerShelter.advanceTo(markerStart)).toEqual([{ name: "foundation", atMs: markerStart }]);
    const postsAt = markerStart + 0.18 * markerDuration;
    expect(markerShelter.advanceTo(postsAt)).toEqual([{ name: "posts", atMs: postsAt }]);

    const exactEndShelter = createTestShelter();
    const exactStart = 2 / 7;
    const exactDuration = 3 / 13;
    exactEndShelter.apply({ type: "build", durationMs: exactDuration }, exactStart);
    const signals = exactEndShelter.advanceTo(exactStart + exactDuration);
    expect(signals.map(({ name }) => name)).toEqual([
      "foundation", "posts", "walls", "roof", "door", "hearth", "build-commit",
    ]);
    expect(signals.at(-1)).toEqual({ name: "build-commit", atMs: exactStart + exactDuration });
    expect(exactEndShelter.snapshot().phase).toBe("standing");
  });

  it("fails invalid commands and non-monotonic time atomically", () => {
    const shelter = createTestShelter();
    const pristine = shelter.snapshot();

    for (const [command, nowMs] of [
      [{ type: "collapse", durationMs: 2400 }, 0],
      [{ type: "build", durationMs: 0 }, 0],
      [{ type: "build", durationMs: Number.NaN }, 0],
      [{ type: "build", durationMs: 3200 }, Number.POSITIVE_INFINITY],
      [{ type: "unknown" }, 0],
    ] as const) {
      expect(() => shelter.apply(command as ShelterCommand, nowMs)).toThrow();
      expect(shelter.snapshot()).toEqual(pristine);
    }

    shelter.apply({ type: "settle", phase: "standing" }, 100);
    const standing = shelter.snapshot();
    expect(() => shelter.apply({ type: "build", durationMs: 3200 }, 100)).toThrow(/standing/i);
    expect(() => shelter.apply({ type: "collapse", durationMs: 2400 }, 99)).toThrow(/non-monotonic/i);
    expect(shelter.snapshot()).toEqual(standing);

    shelter.apply({ type: "collapse", durationMs: 2400 }, 12000);
    const collapsing = shelter.snapshot();
    expect(() => shelter.advanceTo(11999)).toThrow(/non-monotonic/i);
    expect(shelter.snapshot()).toEqual(collapsing);
  });

  it("drops separate components before one collapse commit and keeps the resulting ruin persistent", () => {
    const shelter = createTestShelter();
    shelter.apply({ type: "settle", phase: "standing" }, 0);
    shelter.apply({ type: "collapse", durationMs: 2400 }, 12000);

    expect(shelter.advanceTo(12000)).toEqual([{ name: "hearth", atMs: 12000 }]);
    expect(component(shelter, "hearth")).toMatchObject({ visibility: 0, damaged: true });

    expect(shelter.advanceTo(12432)).toEqual([{ name: "roof", atMs: 12432 }]);
    const fallenRoof = component(shelter, "roof");
    expect(fallenRoof.offset).not.toEqual({ x: 0, y: 0 });
    expect(fallenRoof.rotation).not.toBe(0);

    expect(shelter.advanceTo(12960)).toEqual([{ name: "walls", atMs: 12960 }]);
    expect(shelter.advanceTo(13488)).toEqual([{ name: "door", atMs: 13488 }]);
    const beforeCommit = shelter.snapshot();
    const roof = beforeCommit.components.find(({ id }) => id === "roof")!;
    const walls = beforeCommit.components.find(({ id }) => id === "walls")!;
    const door = beforeCommit.components.find(({ id }) => id === "door")!;
    expect(new Set([JSON.stringify(roof.offset), JSON.stringify(walls.offset), JSON.stringify(door.offset)]).size).toBe(3);
    expect(new Set([roof.rotation, walls.rotation, door.rotation]).size).toBe(3);
    expect([roof, walls, door].every(({ damaged }) => damaged)).toBe(true);

    shelter.advanceTo(14000);
    expect(shelter.snapshot().phase).toBe("collapsing");
    expect(shelter.snapshot().visual.dust).toEqual({ frameId: "dust", intensity: 1 });
    expect(shelter.snapshot().components.every(({ visibility }) => visibility === 0 || visibility === 1)).toBe(true);

    shelter.advanceTo(14352);
    expect(shelter.snapshot().phase).toBe("collapsing");
    expect(shelter.snapshot().visual.dust.intensity).toBe(0);
    expect(shelter.snapshot().components.map(({ id, visibility }) => [id, visibility])).toEqual([
      ["foundation", 1],
      ["posts", 1],
      ["walls", 1],
      ["roof", 1],
      ["door", 1],
      ["hearth", 0],
    ]);

    expect(shelter.advanceTo(14400)).toEqual([{ name: "collapse-commit", atMs: 14400 }]);
    const ruin = shelter.snapshot();
    expect(ruin).toMatchObject({ phase: "ruin", collapseCommitCount: 1, elapsedMs: 2400 });
    expect(ruin.components.every(({ damaged }) => damaged)).toBe(true);
    expect(ruin.components.every(({ visibility }) => visibility === 0)).toBe(true);
    expect(ruin.visual).toEqual({
      manifestId: "vivarium-shelter-slice-v1",
      dust: { frameId: "dust", intensity: 0 },
      ruin: { tier: "full", composition: ["rubble-full"] },
    });

    expect(shelter.advanceTo(30000)).toEqual([]);
    expect(shelter.snapshot()).toEqual(ruin);
  });

  it("emits one large fractional collapse in canonical exact-boundary order", () => {
    const shelter = createTestShelter();
    const start = 2 / 7;
    const duration = 3 / 13;
    shelter.apply({ type: "settle", phase: "standing" }, start);
    shelter.apply({ type: "collapse", durationMs: duration }, start);

    const signals = shelter.advanceTo(start + duration);

    expect(signals.map(({ name }) => name)).toEqual(["hearth", "roof", "walls", "door", "collapse-commit"]);
    expect(signals.map(({ atMs }) => atMs)).toEqual([
      start,
      start + 0.18 * duration,
      start + 0.4 * duration,
      start + 0.62 * duration,
      start + duration,
    ]);
    expect(shelter.snapshot()).toMatchObject({
      phase: "ruin",
      collapseCommitCount: 1,
      visual: { dust: { intensity: 0 }, ruin: { tier: "full", composition: ["rubble-full"] } },
    });
  });

  it("uses absolute fractional collapse marker and dust-window boundaries", () => {
    const shelter = createTestShelter();
    const start = 1 / 7;
    const duration = 2 / 13;
    shelter.apply({ type: "settle", phase: "standing" }, start);
    shelter.apply({ type: "collapse", durationMs: duration }, start);
    expect(shelter.advanceTo(start)).toEqual([{ name: "hearth", atMs: start }]);

    const roofAt = start + 0.18 * duration;
    expect(shelter.advanceTo(roofAt)).toEqual([{ name: "roof", atMs: roofAt }]);
    expect(component(shelter, "roof")).toMatchObject({ frameId: "roof-falling", visibility: 1, damaged: true });

    const dustStartAt = start + 0.7 * duration;
    shelter.advanceTo(dustStartAt);
    expect(shelter.snapshot().visual.dust).toEqual({ frameId: "dust", intensity: 1 });
    expect(shelter.snapshot().components.every(({ visibility }) => visibility === 0 || visibility === 1)).toBe(true);

    const dustEndAt = start + 0.96 * duration;
    shelter.advanceTo(dustEndAt);
    expect(shelter.snapshot().visual.dust.intensity).toBe(0);
    expect(shelter.snapshot().visual.ruin).toEqual({ tier: null, composition: [] });
  });

  it("resets to a pristine epoch and can restart the complete lifecycle", () => {
    const shelter = createTestShelter();
    const instanceId = shelter.snapshot().instanceId;
    shelter.apply({ type: "build", durationMs: 3200 }, 6500);
    shelter.advanceTo(9060);

    shelter.reset();

    expect(shelter.snapshot()).toMatchObject({
      id: "shelter-east",
      instanceId,
      plot: { x: 368, y: 112 },
      phase: "absent",
      elapsedMs: 0,
      emittedMarkers: [],
      buildCommitCount: 0,
      collapseCommitCount: 0,
    });
    expect(shelter.snapshot().components.every(({ visibility, damaged }) => visibility === 0 && !damaged)).toBe(true);

    shelter.apply({ type: "build", durationMs: 3200 }, 0);
    expect(shelter.advanceTo(3200).map(({ name }) => name)).toEqual([
      "foundation", "posts", "walls", "roof", "door", "hearth", "build-commit",
    ]);
    expect(shelter.snapshot()).toMatchObject({ phase: "standing", buildCommitCount: 1 });
  });

  it("settles directly into persistent standing and ruin snapshots without inventing signals", () => {
    const shelter = createTestShelter();

    shelter.apply({ type: "settle", phase: "standing" }, 500);
    expect(shelter.advanceTo(500)).toEqual([]);
    expect(shelter.snapshot().phase).toBe("standing");
    expect(shelter.snapshot().components.every(({ visibility, damaged }) => visibility === 1 && !damaged)).toBe(true);

    shelter.apply({ type: "settle", phase: "ruin" }, 600);
    expect(shelter.advanceTo(10000)).toEqual([]);
    expect(shelter.snapshot().phase).toBe("ruin");
    expect(shelter.snapshot().components.every(({ damaged }) => damaged)).toBe(true);
    expect(shelter.snapshot().visual.ruin).toEqual({ tier: "full", composition: ["rubble-full"] });
  });

  it("settles atomically during transitions and rejects malformed or backwards settlement", () => {
    const shelter = createTestShelter();
    shelter.apply({ type: "build", durationMs: 3200 }, 100);
    shelter.advanceTo(900);
    const building = shelter.snapshot();
    expect(() => shelter.apply({ type: "settle", phase: "broken" } as unknown as ShelterCommand, 900)).toThrow(/invalid/i);
    expect(() => shelter.apply({ type: "settle", phase: "standing" }, 899)).toThrow(/non-monotonic/i);
    expect(shelter.snapshot()).toEqual(building);

    shelter.apply({ type: "settle", phase: "standing" }, 900);
    expect(shelter.advanceTo(10_000)).toEqual([]);
    expect(shelter.snapshot()).toMatchObject({ phase: "standing", buildCommitCount: 0, collapseCommitCount: 0 });

    shelter.apply({ type: "collapse", durationMs: 2400 }, 12_000);
    shelter.advanceTo(13_000);
    shelter.apply({ type: "settle", phase: "ruin" }, 13_000);
    expect(shelter.advanceTo(20_000)).toEqual([]);
    expect(shelter.snapshot()).toMatchObject({
      phase: "ruin",
      buildCommitCount: 0,
      collapseCommitCount: 0,
      visual: { dust: { intensity: 0 }, ruin: { tier: "full", composition: ["rubble-full"] } },
    });
  });

  it("returns detached component, plot, marker, dust, and ruin snapshot state", () => {
    const shelter = createTestShelter();
    shelter.apply({ type: "settle", phase: "ruin" }, 0);
    const snapshot = shelter.snapshot();
    const mutableSnapshot: any = snapshot;
    mutableSnapshot.plot.x = 999;
    mutableSnapshot.components[0].offset.x = 999;
    mutableSnapshot.components.pop();
    mutableSnapshot.emittedMarkers.push("invented");
    mutableSnapshot.visual.ruin.composition.push("dust");
    mutableSnapshot.visual.dust.intensity = 1;

    expect(shelter.snapshot()).toMatchObject({
      plot: { x: 368, y: 112 },
      components: expect.arrayContaining([expect.objectContaining({ id: "foundation", offset: { x: 0, y: 0 } })]),
      emittedMarkers: [],
      visual: { dust: { intensity: 0 }, ruin: { tier: "full", composition: ["rubble-full"] } },
    });
    expect(shelter.snapshot().components).toHaveLength(6);
  });

  it("resets pristine state from both terminal phases and disposes from standing or ruin exactly once", () => {
    for (const terminalPhase of ["standing", "ruin"] as const) {
      const atlasLease = createAtlasLease();
      const shelter = createTestShelter({ atlasLease });
      shelter.apply({ type: "settle", phase: terminalPhase }, 500);
      shelter.reset();
      expect(shelter.snapshot()).toMatchObject({
        phase: "absent",
        elapsedMs: 0,
        emittedMarkers: [],
        buildCommitCount: 0,
        collapseCommitCount: 0,
        visual: { dust: { intensity: 0 }, ruin: { tier: null, composition: [] } },
      });
      expect(shelter.snapshot().components.every(({ visibility, damaged }) => visibility === 0 && !damaged)).toBe(true);

      shelter.apply({ type: "settle", phase: terminalPhase }, 0);
      const terminal = shelter.snapshot();
      shelter.dispose();
      shelter.dispose();
      shelter.reset();
      expect(atlasLease.release).toHaveBeenCalledTimes(1);
      expect(shelter.snapshot()).toEqual(terminal);
    }
  });

  it("disposes its shelter atlas lease exactly once and remains inert", () => {
    const atlasLease = createAtlasLease();
    const shelter = createTestShelter({ atlasLease });
    shelter.apply({ type: "build", durationMs: 3200 }, 6500);
    const beforeDispose = shelter.snapshot();

    shelter.dispose();
    shelter.dispose();
    shelter.apply({ type: "settle", phase: "standing" }, 9700);

    expect(atlasLease.release).toHaveBeenCalledTimes(1);
    expect(shelter.advanceTo(9700)).toEqual([]);
    expect(shelter.snapshot()).toEqual(beforeDispose);
  });
});
