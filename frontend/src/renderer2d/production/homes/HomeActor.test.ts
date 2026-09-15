import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HomeSnapshot } from "../../../app/schemas";
import type { PresentedRecord } from "../../../presentation/contracts";
import {
  PRODUCTION_ASSET_MANIFEST,
  type ProductionAssetLease,
} from "../assets/productionManifest";
import { DEPTH_SCENERY_ATLAS_ID, DEPTH_SCENERY_FRAMES } from "../depth/DepthSceneryAssets";
import {
  HomeActor,
  type HomeActorSnapshot,
  type HomePrimitiveCommand,
  type PresentedHomeInput,
} from "./HomeActor";

const KITS = [
  "worn-heartland",
  "spring-terraces",
  "dry-scrub",
  "ash-waste",
  "neutral-temperate",
] as const;

interface FakeBitmap extends ImageBitmap {
  readonly atlasId: string;
}

interface DrawCall {
  readonly atlasId: string;
  readonly args: readonly number[];
}

interface StrokeCall {
  readonly kind: "rect" | "line";
  readonly args: readonly number[];
}

interface FillCall {
  readonly kind: "rect" | "circle";
  readonly args: readonly number[];
  readonly fillStyle: string | CanvasGradient | CanvasPattern;
}

class FakeContext {
  imageSmoothingEnabled = true;
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000";
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  readonly drawCalls: DrawCall[] = [];
  readonly strokeCalls: StrokeCall[] = [];
  readonly fillCalls: FillCall[] = [];
  fillStyle: string | CanvasGradient | CanvasPattern = "#000";
  #pathStart: readonly [number, number] | null = null;

  save(): void {}

  restore(): void {}

  drawImage(image: CanvasImageSource, ...args: number[]): void {
    this.drawCalls.push({ atlasId: (image as FakeBitmap).atlasId, args: [...args] });
  }

  strokeRect(...args: number[]): void {
    this.strokeCalls.push({ kind: "rect", args });
  }

  beginPath(): void {
    this.#pathStart = null;
  }

  moveTo(x: number, y: number): void {
    this.#pathStart = [x, y];
  }

  lineTo(x: number, y: number): void {
    if (this.#pathStart === null) throw new Error("Test path has no origin.");
    this.strokeCalls.push({ kind: "line", args: [...this.#pathStart, x, y] });
    this.#pathStart = [x, y];
  }

  stroke(): void {}

  fillRect(...args: number[]): void {
    this.fillCalls.push({ kind: "rect", args, fillStyle: this.fillStyle });
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void {
    this.fillCalls.push({ kind: "circle", args: [x, y, radius, startAngle, endAngle], fillStyle: this.fillStyle });
  }

  fill(): void {}
}

function exactHome(overrides: Partial<HomeSnapshot> = {}): HomeSnapshot {
  return {
    home_id: "home_001",
    owner_id: "agent_owner",
    region: "warm_springs",
    integrity: 75,
    max_integrity: 100,
    built_at: 10,
    last_upkeep_at: 11,
    last_integrity_at: 12,
    stakeholders: ["agent_owner", "agent_friend"],
    vault_materials: 42,
    status: "standing",
    ruined_at: null,
    remnant_materials: 0,
    breachers: ["agent_rival"],
    is_hoarding: true,
    ...overrides,
  };
}

function exactRecord(overrides: Partial<HomeSnapshot> = {}): PresentedRecord<HomeSnapshot> {
  return { completeness: "exact", value: exactHome(overrides) };
}

function partialRecord(value: Partial<HomeSnapshot>): PresentedRecord<HomeSnapshot> {
  return { completeness: "projected-partial", value };
}

function input(
  record: PresentedRecord<HomeSnapshot> = exactRecord(),
  overrides: Partial<Omit<PresentedHomeInput, "record">> = {},
): PresentedHomeInput {
  const exactBaseCursor = overrides.exactBaseCursor ?? 0;
  const projectedThroughCursor = overrides.projectedThroughCursor ?? exactBaseCursor;
  const remnant = record.value.remnant_materials;
  const usableRemnant = typeof remnant === "number" && Number.isFinite(remnant) && remnant >= 0
    ? remnant
    : null;
  const exactRemnantMaterials = Object.prototype.hasOwnProperty.call(overrides, "exactRemnantMaterials")
    ? overrides.exactRemnantMaterials ?? null
    : projectedThroughCursor === exactBaseCursor ? usableRemnant : null;
  return {
    record,
    exactBaseCursor,
    projectedThroughCursor,
    exactRemnantMaterials,
    ...(overrides.projectedRemnantMaterials !== undefined
      ? { projectedRemnantMaterials: overrides.projectedRemnantMaterials }
      : projectedThroughCursor > exactBaseCursor && usableRemnant !== null
        ? { projectedRemnantMaterials: { value: usableRemnant, evidenceCursor: projectedThroughCursor } }
        : {}),
    worldTime: 50,
    plot: { x: 96, y: 128 },
    door: { x: 153, y: 185 },
    kit: "worn-heartland",
    ...overrides,
  };
}

function leasesFor(kit = "worn-heartland", includeCottage = false) {
  const home = PRODUCTION_ASSET_MANIFEST.regions[kit as keyof typeof PRODUCTION_ASSET_MANIFEST.regions].homeManifest;
  const releases = new Map<string, ReturnType<typeof vi.fn>>();
  const leases = new Map<string, ProductionAssetLease>();
  for (const atlasId of [home.atlasId, home.detailAtlasId, home.ruinAtlasId, home.yard.atlasId]) {
    const release = vi.fn();
    releases.set(atlasId, release);
    leases.set(atlasId, { value: { atlasId } as FakeBitmap, release });
  }
  if (includeCottage) {
    const release = vi.fn();
    releases.set(DEPTH_SCENERY_ATLAS_ID, release);
    leases.set(DEPTH_SCENERY_ATLAS_ID, {
      value: { atlasId: DEPTH_SCENERY_ATLAS_ID } as FakeBitmap,
      release,
    });
  }
  return { leases, releases };
}

function actor(
  initial: PresentedHomeInput = input(),
  supplied?: ReturnType<typeof leasesFor>,
  id = "home_001",
): { actor: HomeActor; leases: ReturnType<typeof leasesFor> } {
  const ownedLeases = supplied ?? leasesFor(initial.kit);
  return {
    actor: new HomeActor({
      id,
      manifest: PRODUCTION_ASSET_MANIFEST,
      atlasLeases: ownedLeases.leases,
      initial,
    }),
    leases: ownedLeases,
  };
}

function durable(snapshot: HomeActorSnapshot) {
  return snapshot.durable;
}

function draw(actorValue: HomeActor, pass: "back" | "front"): FakeContext {
  const context = new FakeContext();
  actorValue.draw(context as unknown as CanvasRenderingContext2D, pass);
  return context;
}

function yardDraws(actorValue: HomeActor, pass: "back" | "front" = "back"): readonly DrawCall[] {
  const snapshot = actorValue.snapshot();
  const yardAtlasId = PRODUCTION_ASSET_MANIFEST.regions[snapshot.kit].homeManifest.yard.atlasId;
  return draw(actorValue, pass).drawCalls.filter(({ atlasId }) => atlasId === yardAtlasId);
}

function yardCells(actorValue: HomeActor, pass: "back" | "front" = "back"): readonly number[] {
  return yardDraws(actorValue, pass).map(({ args }) => args[0]! / 192);
}

describe("HomeActor", () => {
  it("derives exact standing durable truth without inventing occupancy", () => {
    const { actor: home } = actor();

    expect(durable(home.snapshot())).toEqual({
      status: "standing",
      integrityRatio: 0.75,
      ownerId: "agent_owner",
      stakeholderIds: ["agent_owner", "agent_friend"],
      vaultMaterials: 42,
      hoarding: true,
      breacherIds: ["agent_rival"],
      remnantMaterials: 0,
      ruinSweepAge: null,
    });
    expect(home.snapshot().occupantIds).toEqual([]);
    expect(home.snapshot().diagnostics).toMatchObject({ rawIntegrity: 75, rawMaxIntegrity: 100 });
    expect(home.snapshot().marks.map(({ kind }) => kind)).toEqual(expect.arrayContaining([
      "owner", "stakeholder", "vault", "hoarding", "breacher",
    ]));
  });

  it("derives ruin sweep age from presented world_time minus ruined_at", () => {
    const ruin = exactRecord({ status: "ruin", ruined_at: 18, integrity: 0, remnant_materials: 9 });
    const { actor: home } = actor(input(ruin, { worldTime: 50 }));
    expect(durable(home.snapshot())).toMatchObject({ status: "ruin", ruinSweepAge: 32 });

    home.reconcile(input(ruin, { worldTime: 12 }));
    expect(durable(home.snapshot()).ruinSweepAge).toBe(0);

    home.reconcile(input(partialRecord({ status: "ruin", ruined_at: 18 }), { worldTime: Number.NaN }));
    expect(durable(home.snapshot()).ruinSweepAge).toBeNull();
    expect(home.nextDeadlineMs()).toBeNull();
  });

  it("preserves missing projected fields as unknown instead of coercing them to zero", () => {
    const { actor: home } = actor(input(partialRecord({ home_id: "home_001", status: "standing" })));
    expect(durable(home.snapshot())).toEqual({
      status: "standing",
      integrityRatio: null,
      ownerId: null,
      stakeholderIds: null,
      vaultMaterials: null,
      hoarding: null,
      breacherIds: null,
      remnantMaterials: null,
      ruinSweepAge: null,
    });
    expect(home.snapshot().diagnostics).toMatchObject({ rawIntegrity: null, rawMaxIntegrity: null });
    expect(home.snapshot().cues).toContainEqual({ kind: "unknown-hatch", shape: "hatch", colorIndependent: true });
  });

  it("derives unknown status for a partial introduction with no authoritative status", () => {
    const { actor: home } = actor(input(partialRecord({ home_id: "home_001", owner_id: "agent_owner" })));
    expect(durable(home.snapshot())).toMatchObject({ status: "unknown", ownerId: "agent_owner" });
    expect(home.snapshot().visual.ruinFrameId).toBeNull();
    expect(home.snapshot().visual.backComponents.length).toBeGreaterThan(0);
    expect(home.snapshot().cues.some(({ kind }) => kind === "unknown-hatch")).toBe(true);
  });

  it("clamps integrity presentation while retaining raw diagnostic values", () => {
    const { actor: home } = actor(input(exactRecord({ integrity: 175, max_integrity: 100 })));
    expect(durable(home.snapshot()).integrityRatio).toBe(1);
    expect(home.snapshot().diagnostics).toMatchObject({ rawIntegrity: 175, rawMaxIntegrity: 100, integrityClamped: true });

    home.reconcile(input(exactRecord({ integrity: -20, max_integrity: 100 })));
    expect(durable(home.snapshot()).integrityRatio).toBe(0);
    expect(home.snapshot().diagnostics).toMatchObject({ rawIntegrity: -20, rawMaxIntegrity: 100, integrityClamped: true });

    home.reconcile(input(exactRecord({ integrity: 10, max_integrity: 0 })));
    expect(durable(home.snapshot()).integrityRatio).toBeNull();
    expect(home.snapshot().diagnostics).toMatchObject({ rawIntegrity: 10, rawMaxIntegrity: 0 });
  });

  it("bounds stakeholder marks without resizing, upgrading, or populating the home", () => {
    const { actor: home } = actor();
    const before = home.snapshot();
    const many = Array.from({ length: 20 }, (_unused, index) => `agent_${index}`);

    home.reconcile(input(exactRecord({ stakeholders: many })));
    const after = home.snapshot();

    expect(after.geometry).toEqual(before.geometry);
    expect(after.visual.backComponents).toEqual(before.visual.backComponents);
    expect(after.visual.frontComponents).toEqual(before.visual.frontComponents);
    expect(after.marks.filter(({ kind }) => kind === "stakeholder")).toHaveLength(4);
    expect(after.occupantIds).toEqual([]);
    expect(durable(after).stakeholderIds).toEqual(many);
  });

  it("keeps a zero-remnant ruin forever until outer authoritative reconciliation removes the actor", () => {
    const { actor: home } = actor(input(exactRecord({
      status: "ruin", integrity: 0, ruined_at: 5, remnant_materials: 0,
    }), { worldTime: 100 }));
    const initial = home.snapshot();

    expect(initial.durable).toMatchObject({ status: "ruin", remnantMaterials: 0, ruinSweepAge: 95 });
    expect(initial.visual.ruinFrameId).toBe("rubble-bare");
    expect(home.nextDeadlineMs()).toBeNull();
    expect(home.advanceTo(1_000_000_000)).toEqual([]);
    expect(home.snapshot()).toEqual(initial);
    expect(home.nextDeadlineMs()).toBeNull();
  });

  it("uses every regional home manifest at human-readable scale with valid door clearance", () => {
    for (const kit of KITS) {
      const supplied = leasesFor(kit);
      const { actor: home } = actor(input(exactRecord(), { kit }), supplied);
      const snapshot = home.snapshot();
      const manifest = PRODUCTION_ASSET_MANIFEST.regions[kit].homeManifest;
      expect(snapshot.kit).toBe(kit);
      expect(snapshot.geometry.logicalBounds).toEqual(manifest.logicalBounds);
      expect(snapshot.geometry.logicalBounds.width).toBeGreaterThan(48);
      expect(snapshot.geometry.logicalBounds.height).toBeGreaterThan(64);
      expect(snapshot.geometry.doorClearance).toEqual(manifest.doorClearance);
      expect(snapshot.geometry.doorClearance.width).toBeGreaterThanOrEqual(30);
      expect(snapshot.geometry.doorClearance.height).toBeGreaterThanOrEqual(42);
      expect(new Set([...snapshot.visual.backComponents, ...snapshot.visual.frontComponents]).size)
        .toBe(snapshot.visual.backComponents.length + snapshot.visual.frontComponents.length);
    }
  });

  it("requires the yard lease with the three existing regional leases before taking ownership", () => {
    const supplied = leasesFor();
    const yardAtlasId = PRODUCTION_ASSET_MANIFEST.regions["worn-heartland"].homeManifest.yard.atlasId;
    supplied.leases.delete(yardAtlasId);

    expect(() => actor(input(), supplied)).toThrow("requires four regional atlas leases");
    for (const release of supplied.releases.values()) expect(release).not.toHaveBeenCalled();
  });

  it("selects one stable standing-yard base from the complete home ID", () => {
    const first = actor(input(exactRecord({ is_hoarding: false })), undefined, "home_001").actor;
    const repeated = actor(input(exactRecord({ is_hoarding: false })), undefined, "home_001").actor;
    const second = actor(input(exactRecord({ home_id: "home_002", is_hoarding: false })), undefined, "home_002").actor;

    expect(yardCells(first)).toHaveLength(1);
    expect(yardCells(repeated)).toEqual(yardCells(first));
    expect(new Set([yardCells(first)[0], yardCells(second)[0]])).toEqual(new Set([0, 1]));

    first.reconcile(input(exactRecord({ is_hoarding: false, integrity: 40 })));
    expect(yardCells(first)).toEqual(yardCells(repeated));
  });

  it("draws exactly one native standing base at the authored plot offset in the back pass", () => {
    const { actor: home } = actor(input(exactRecord({ is_hoarding: false })));
    const calls = yardDraws(home);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual([
      expect.any(Number), 0, 192, 160,
      64, 112, 192, 160,
    ]);
    expect([0, 192]).toContain(calls[0]!.args[0]);
    expect(yardDraws(home, "front")).toEqual([]);
  });

  it("uses the optional cottage lease for an intact standing exterior at the door contact", () => {
    const supplied = leasesFor("worn-heartland", true);
    const { actor: home } = actor(input(exactRecord({ is_hoarding: false }), {
      plot: { x: 96, y: 128 },
      door: { x: 160, y: 224 },
    }), supplied);

    const front = draw(home, "front");
    const cottageCalls = front.drawCalls.filter(({ atlasId }) => atlasId === DEPTH_SCENERY_ATLAS_ID);

    expect(cottageCalls).toHaveLength(1);
    expect(cottageCalls[0]!.args).toEqual([
      DEPTH_SCENERY_FRAMES.cottage.x,
      DEPTH_SCENERY_FRAMES.cottage.y,
      DEPTH_SCENERY_FRAMES.cottage.width,
      DEPTH_SCENERY_FRAMES.cottage.height,
      88, 106, 128, 122,
    ]);
    expect(front.fillCalls).toEqual([
      { kind: "circle", args: [159, 171, 5, 0, Math.PI * 2], fillStyle: "rgba(20, 22, 20, 0.48)" },
    ]);
    expect(draw(home, "back").drawCalls.some(({ atlasId }) => atlasId === DEPTH_SCENERY_ATLAS_ID)).toBe(false);
  });

  it("keeps the cottage shell through persistent door and hearth state with source-aligned overlays", () => {
    const supplied = leasesFor("worn-heartland", true);
    const { actor: home } = actor(input(exactRecord({ is_hoarding: false }), {
      plot: { x: 96, y: 128 },
      door: { x: 160, y: 224 },
    }), supplied);
    home.apply({ kind: "door", state: "open" }, 0);
    home.apply({ kind: "hearth", state: "warm" }, 1);

    const context = draw(home, "front");

    expect(context.drawCalls.filter(({ atlasId }) => atlasId === DEPTH_SCENERY_ATLAS_ID)).toHaveLength(1);
    expect(context.drawCalls.filter(({ atlasId }) => atlasId.endsWith("home-components"))).toEqual([]);
    expect(context.fillCalls).toEqual([
      { kind: "circle", args: [159, 171, 5, 0, Math.PI * 2], fillStyle: "rgba(255, 181, 72, 0.42)" },
      { kind: "rect", args: [180, 165, 11, 24], fillStyle: "rgba(14, 17, 15, 0.82)" },
    ]);
  });

  it("keeps the native construction and damage transitions instead of painting a finished cottage", () => {
    const supplied = leasesFor("worn-heartland", true);
    const { actor: home } = actor(input(exactRecord({ is_hoarding: false })), supplied);

    home.apply({ kind: "build", durationMs: 1_000 }, 0);
    expect(draw(home, "front").drawCalls.some(({ atlasId }) => atlasId === DEPTH_SCENERY_ATLAS_ID)).toBe(false);
    home.advanceTo(1_000);
    expect(draw(home, "front").drawCalls.some(({ atlasId }) => atlasId === DEPTH_SCENERY_ATLAS_ID)).toBe(true);

    home.apply({ kind: "damage", durationMs: 1_000 }, 2_000);
    expect(draw(home, "front").drawCalls.some(({ atlasId }) => atlasId === DEPTH_SCENERY_ATLAS_ID)).toBe(false);
    expect(home.snapshot().visual.frontComponents).toContain("roof-damaged");
  });

  it("never uses the cottage lease for ruins and releases an optional lease exactly once", () => {
    const supplied = leasesFor("worn-heartland", true);
    const { actor: home } = actor(input(exactRecord({
      status: "ruin", integrity: 0, remnant_materials: 0, ruined_at: 5,
    })), supplied);

    expect(draw(home, "back").drawCalls.some(({ atlasId }) => atlasId === DEPTH_SCENERY_ATLAS_ID)).toBe(false);
    expect(draw(home, "front").drawCalls.some(({ atlasId }) => atlasId === DEPTH_SCENERY_ATLAS_ID)).toBe(false);
    home.dispose();
    home.dispose();
    expect(supplied.releases.get(DEPTH_SCENERY_ATLAS_ID)).toHaveBeenCalledTimes(1);
  });

  it("keeps provisional and unknown sites empty until a visible foundation exists", () => {
    const provisionalInput = {
      ...input(partialRecord({ home_id: "home_001", region: "warm_springs" })),
      provisional: true,
    } as PresentedHomeInput;
    const { actor: provisional } = actor(provisionalInput);
    expect(yardCells(provisional)).toEqual([]);

    provisional.apply({ kind: "build", durationMs: 1_000 }, 100);
    expect(yardCells(provisional)).toEqual([]);
    provisional.advanceTo(100);
    expect(yardCells(provisional)).toHaveLength(1);
    expect([0, 1]).toContain(yardCells(provisional)[0]);

    const { actor: unknown } = actor(input(partialRecord({
      home_id: "home_001",
      region: "warm_springs",
      is_hoarding: true,
    })));
    expect(yardCells(unknown)).toEqual([]);
    expect(unknown.snapshot().cues).toContainEqual({
      kind: "unknown-hatch",
      shape: "hatch",
      colorIndependent: true,
    });
  });

  it("projects standing, warm, hoard, collapse, and ruin yard semantics from visible lifecycle truth", () => {
    const { actor: cold } = actor(input(exactRecord({ is_hoarding: false })));
    const coldCells = yardCells(cold);
    expect(coldCells).toHaveLength(1);
    expect([0, 1]).toContain(coldCells[0]);

    const { actor: warm } = actor(input(exactRecord({ is_hoarding: false })));
    warm.apply({ kind: "hearth", state: "warm" }, 0);
    expect(yardCells(warm)).toEqual([yardCells(cold)[0], 2]);
    warm.apply({ kind: "hearth", state: "quiet" }, 1);
    expect(yardCells(warm)).toEqual([yardCells(cold)[0]]);

    const { actor: hoard } = actor(input(exactRecord({ is_hoarding: true })));
    expect(yardCells(hoard)).toEqual([yardCells(cold)[0], 3]);

    const { actor: collapsing } = actor(input(exactRecord({ is_hoarding: true })));
    collapsing.apply({ kind: "hearth", state: "warm" }, 0);
    collapsing.apply({ kind: "collapse", durationMs: 1_000 }, 1);
    expect(yardCells(collapsing)).toEqual([yardCells(cold)[0], 3]);
    collapsing.advanceTo(1_001);
    expect(yardCells(collapsing)).toEqual([yardCells(cold)[0], 2, 3]);

    const { actor: ruin } = actor(input(exactRecord({
      status: "ruin",
      integrity: 0,
      remnant_materials: 55,
      ruined_at: 1,
      is_hoarding: true,
    })));
    expect(yardCells(ruin)).toEqual([4]);
  });

  it("draws disjoint back and front native components with truthful door occlusion", () => {
    const { actor: home } = actor();
    home.apply({ kind: "door", state: "open" }, 100);
    const back = draw(home, "back");
    const front = draw(home, "front");
    const snapshot = home.snapshot();
    const manifest = PRODUCTION_ASSET_MANIFEST.regions[snapshot.kit].homeManifest;

    expect(back.imageSmoothingEnabled).toBe(false);
    expect(front.imageSmoothingEnabled).toBe(false);
    expect(back.drawCalls.every(({ atlasId }) => (
      atlasId === manifest.atlasId || atlasId === manifest.yard.atlasId
    ))).toBe(true);
    expect(back.drawCalls[0]?.atlasId).toBe(manifest.yard.atlasId);
    expect(front.drawCalls.some(({ atlasId }) => atlasId === manifest.atlasId)).toBe(true);
    expect(snapshot.visual.backComponents.every((id) => manifest.backComponents.includes(id))).toBe(true);
    expect(snapshot.visual.frontComponents.every((id) => manifest.frontComponents.includes(id))).toBe(true);
    expect(snapshot.visual.frontComponents).toContain("door-open");
    expect(snapshot.visual.backComponents).not.toContain("door-open");
    expect(new Set([...snapshot.visual.backComponents, ...snapshot.visual.frontComponents]).size)
      .toBe(snapshot.visual.backComponents.length + snapshot.visual.frontComponents.length);
    for (const call of [...back.drawCalls, ...front.drawCalls]) {
      expect(call.args.every(Number.isInteger)).toBe(true);
    }
  });

  it("renders closed door in the front pass and never duplicates a component across passes", () => {
    const { actor: home } = actor();
    home.apply({ kind: "door", state: "open" }, 10);
    home.apply({ kind: "door", state: "closed" }, 20);
    const snapshot = home.snapshot();
    expect(snapshot.visual.frontComponents).toContain("door-closed");
    expect(snapshot.visual.frontComponents).not.toContain("door-open");
    expect(snapshot.visual.backComponents.some((id) => id.startsWith("door-"))).toBe(false);
  });

  it("keeps every transient command separate from durable world truth", () => {
    const commands: readonly HomePrimitiveCommand[] = [
      { kind: "build", durationMs: 1000 },
      { kind: "door", state: "open" },
      { kind: "door", state: "closed" },
      { kind: "hearth", state: "warm" },
      { kind: "hearth", state: "quiet" },
      { kind: "damage", durationMs: 1000 },
      { kind: "loot", durationMs: 1000 },
      { kind: "claim", durationMs: 1000 },
      { kind: "collapse", durationMs: 1000 },
      { kind: "scavenge", durationMs: 1000, remnantMaterialsAfter: 0 },
    ];
    for (const [index, command] of commands.entries()) {
      const { actor: home } = actor();
      const before = structuredClone(home.snapshot().durable);
      home.apply(command, index * 2_000, command.kind === "scavenge" ? 1 : null);
      home.advanceTo(index * 2_000 + 1_500);
      expect(home.snapshot().durable, command.kind).toEqual(before);
    }
  });

  it("reveals build components only as their authored markers cross", () => {
    const { actor: home } = actor();
    home.apply({ kind: "build", durationMs: 1_000 }, 1_000);
    expect(home.snapshot().visual).toMatchObject({ backComponents: [], frontComponents: [] });

    expect(home.advanceTo(1_000)).toEqual([{ name: "foundation", atMs: 1_000 }]);
    expect(home.snapshot().visual.backComponents).toEqual(["foundation"]);
    expect(home.advanceTo(1_180)).toEqual([{ name: "post", atMs: 1_180 }]);
    expect(home.snapshot().visual.backComponents).toEqual(["foundation", "post"]);
    home.advanceTo(1_800);
    expect(home.snapshot().visual.frontComponents).toContain("roof-intact");
    expect(home.snapshot().visual.frontComponents).toContain("door-closed");
  });

  it("keeps one provisional instance through component build and durable same-ID adoption", () => {
    const provisional = {
      ...input(partialRecord({ home_id: "home_001", region: "warm_springs" })),
      provisional: true,
    } as PresentedHomeInput;
    const { actor: home } = actor(provisional);
    const instanceId = home.snapshot().instanceId;
    expect((home.snapshot().transient as { provisional?: boolean }).provisional).toBe(true);
    expect(home.snapshot().visual).toMatchObject({ backComponents: [], frontComponents: [] });

    home.apply({ kind: "build", durationMs: 1_000 }, 100);
    home.advanceTo(500);
    const midBuild = home.snapshot().visual;
    expect(midBuild.backComponents.length + midBuild.frontComponents.length).toBeGreaterThanOrEqual(3);

    home.reconcile(input(exactRecord(), { plot: provisional.plot, door: provisional.door }));
    expect(home.snapshot().instanceId).toBe(instanceId);
    expect((home.snapshot().transient as { provisional?: boolean }).provisional).toBe(false);
    expect(home.advanceTo(1_100).map(({ name }) => name)).toEqual([
      "roof", "door", "hearth", "build-commit",
    ]);
    expect(home.advanceTo(1_100)).toEqual([]);
    expect(home.nextDeadlineMs()).toBeNull();
  });

  it("gives every transient a visible native component, mark, or ruin cue", () => {
    const { actor: standing } = actor();
    standing.apply({ kind: "door", state: "open" }, 0);
    expect(standing.snapshot().visual.frontComponents).toContain("door-open");
    standing.apply({ kind: "hearth", state: "warm" }, 1);
    expect(standing.snapshot().visual.backComponents).toEqual(expect.arrayContaining(["window-lit", "hearth-lit-1"]));
    standing.apply({ kind: "damage", durationMs: 100 }, 2);
    expect(standing.snapshot().visual).toMatchObject({
      backComponents: expect.arrayContaining(["wall-cracked"]),
      frontComponents: expect.arrayContaining(["roof-damaged"]),
    });
    const { actor: collapsing } = actor();
    collapsing.apply({ kind: "collapse", durationMs: 1_000 }, 0);
    collapsing.advanceTo(180);
    expect(collapsing.snapshot().visual.frontComponents).toContain("roof-falling");

    const { actor: loot } = actor();
    loot.apply({ kind: "loot", durationMs: 100 }, 0);
    expect(loot.snapshot().marks.some(({ kind }) => kind === "loot")).toBe(true);
    const { actor: claim } = actor();
    claim.apply({ kind: "claim", durationMs: 100 }, 0);
    expect(claim.snapshot().marks.some(({ kind }) => kind === "claim")).toBe(true);

    const { actor: ruin } = actor(input(exactRecord({ status: "ruin", remnant_materials: 0, ruined_at: 1 })));
    ruin.apply({ kind: "scavenge", durationMs: 100, remnantMaterialsAfter: 0 }, 0, 1);
    expect(ruin.snapshot().visual.ruinFrameId).toBe("rubble-bare-scavenge");
  });

  it("projects the current scavenge result until exact checkpoint truth reconciles it", () => {
    const { actor: ruin } = actor(input(exactRecord({
      status: "ruin",
      remnant_materials: 55,
      ruined_at: 1,
    })));

    ruin.apply({ kind: "scavenge", durationMs: 100, remnantMaterialsAfter: 0 }, 0, 1);
    expect(ruin.snapshot().durable.remnantMaterials).toBe(55);
    expect(ruin.snapshot().visual.ruinFrameId).toBe("rubble-bare-scavenge");
    ruin.advanceTo(100);
    expect(ruin.snapshot().visual.ruinFrameId).toBe("rubble-bare");

    ruin.reconcile(input(
      exactRecord({ status: "ruin", remnant_materials: 0, ruined_at: 1 }),
      { exactBaseCursor: 1 },
    ));
    expect(ruin.snapshot().durable.remnantMaterials).toBe(0);
    expect(ruin.snapshot().visual.ruinFrameId).toBe("rubble-bare");

    ruin.reconcile(input(
      exactRecord({ status: "ruin", remnant_materials: 55, ruined_at: 1 }),
      { exactBaseCursor: 2 },
    ));
    expect(ruin.snapshot().visual.ruinFrameId).toBe("rubble-full");
  });

  it("does not mistake event-complete ruin fields for newer exact checkpoint truth", () => {
    const initial = {
      ...input(exactRecord({ status: "ruin", remnant_materials: 55, ruined_at: 1 })),
      exactBaseCursor: 0,
    } as PresentedHomeInput;
    const { actor: ruin } = actor(initial);

    ruin.apply({ kind: "scavenge", durationMs: 100, remnantMaterialsAfter: 0 }, 0, 1);
    ruin.reconcile({
      ...input(exactRecord({ status: "ruin", remnant_materials: 0, ruined_at: 1 })),
      exactBaseCursor: 0,
      projectedThroughCursor: 1,
    } as PresentedHomeInput);

    expect(ruin.snapshot().durable.remnantMaterials).toBe(55);
    expect(ruin.snapshot().visual.ruinFrameId).toBe("rubble-bare-scavenge");
    ruin.advanceTo(100);
    expect(ruin.snapshot().visual.ruinFrameId).toBe("rubble-bare");

    ruin.reconcile({
      ...input(exactRecord({ status: "ruin", remnant_materials: 0, ruined_at: 1 })),
      exactBaseCursor: 1,
      projectedThroughCursor: 1,
    } as PresentedHomeInput);
    expect(ruin.snapshot().durable.remnantMaterials).toBe(0);
    expect(ruin.snapshot().visual.ruinFrameId).toBe("rubble-bare");
  });

  it("keeps caught-up exact checkpoint truth above stale scavenge projection", () => {
    const { actor: ruin } = actor(input(
      exactRecord({ status: "ruin", remnant_materials: 55, ruined_at: 1 }),
      { exactBaseCursor: 1 },
    ));

    ruin.apply({ kind: "scavenge", durationMs: 100, remnantMaterialsAfter: 0 }, 0, 1);

    expect(ruin.snapshot().durable.remnantMaterials).toBe(55);
    expect(ruin.snapshot().visual.ruinFrameId).toBe("rubble-full-scavenge");
  });

  it("rejects an external exact-cursor regression outside transaction rollback", () => {
    const { actor: ruin } = actor(input(
      exactRecord({ status: "ruin", remnant_materials: 0, ruined_at: 1 }),
      { exactBaseCursor: 2 },
    ));

    expect(() => ruin.reconcile(input(
      exactRecord({ status: "ruin", remnant_materials: 55, ruined_at: 1 }),
      { exactBaseCursor: 1 },
    ))).toThrow("Home exact checkpoint cursor cannot regress.");
    expect(ruin.snapshot().durable.remnantMaterials).toBe(0);
  });

  it("restores exact and projected ruin truth when checkpoint reconciliation rolls back", () => {
    const oldInput = input(
      exactRecord({ status: "ruin", remnant_materials: 0, ruined_at: 1 }),
      { exactBaseCursor: 0 },
    );
    const { actor: ruin } = actor(input(
      exactRecord({ status: "ruin", remnant_materials: 55, ruined_at: 1 }),
      { exactBaseCursor: 0 },
    ));
    ruin.apply({ kind: "scavenge", durationMs: 100, remnantMaterialsAfter: 0 }, 0, 1);

    ruin.reconcile(input(
      exactRecord({ status: "ruin", remnant_materials: 0, ruined_at: 1 }),
      { exactBaseCursor: 1 },
    ));
    expect(ruin.snapshot().durable.remnantMaterials).toBe(0);

    ruin.reconcile(oldInput, "transaction-rollback");
    expect(ruin.snapshot().durable.remnantMaterials).toBe(55);
    expect(ruin.snapshot().visual.ruinFrameId).toBe("rubble-bare-scavenge");
  });

  it("restores projected ruin truth when a same-exact-cursor reconciliation rolls back", () => {
    const previous = input(
      exactRecord({ status: "ruin", remnant_materials: 55, ruined_at: 1 }),
      { exactBaseCursor: 0, projectedThroughCursor: 0 },
    );
    const { actor: ruin } = actor(previous);

    ruin.reconcile({
      ...previous,
      record: exactRecord({ status: "ruin", remnant_materials: 0, ruined_at: 1 }),
      projectedThroughCursor: 1,
      projectedRemnantMaterials: { value: 0, evidenceCursor: 1 },
    });
    expect(ruin.snapshot().visual.ruinFrameId).toBe("rubble-bare");

    ruin.reconcile(previous, "transaction-rollback");
    expect(ruin.snapshot().durable.remnantMaterials).toBe(55);
    expect(ruin.snapshot().visual.ruinFrameId).toBe("rubble-full");
  });

  it("does not commit a partially caught-up checkpoint record with newer evidence reapplied", () => {
    const { actor: ruin } = actor({
      ...input(exactRecord({ status: "ruin", remnant_materials: 55, ruined_at: 1 })),
      exactBaseCursor: 0,
      projectedThroughCursor: 0,
    } as PresentedHomeInput);
    ruin.apply({ kind: "scavenge", durationMs: 100, remnantMaterialsAfter: 0 }, 0, 2);

    ruin.reconcile({
      ...input(exactRecord({ status: "ruin", remnant_materials: 0, ruined_at: 1 })),
      exactBaseCursor: 1,
      projectedThroughCursor: 2,
      exactRemnantMaterials: 40,
      projectedRemnantMaterials: { value: 0, evidenceCursor: 2 },
    } as PresentedHomeInput);
    expect(ruin.snapshot().durable.remnantMaterials).toBe(40);
    expect(ruin.snapshot().visual.ruinFrameId).toBe("rubble-bare-scavenge");

    ruin.reconcile({
      ...input(exactRecord({ status: "ruin", remnant_materials: 0, ruined_at: 1 })),
      exactBaseCursor: 2,
      projectedThroughCursor: 2,
    } as PresentedHomeInput);
    expect(ruin.snapshot().durable.remnantMaterials).toBe(0);
  });

  it("mounts a late projected ruin without pretending its remnant value is exact", () => {
    const { actor: ruin } = actor({
      ...input(exactRecord({ status: "ruin", remnant_materials: 0, ruined_at: 1 })),
      exactBaseCursor: 0,
      projectedThroughCursor: 1,
      exactRemnantMaterials: null,
      projectedRemnantMaterials: { value: 0, evidenceCursor: 1 },
    } as PresentedHomeInput);

    expect(ruin.snapshot().durable.remnantMaterials).toBeNull();
    expect(ruin.snapshot().visual.ruinFrameId).toBe("rubble-bare");
  });

  it("renders malformed ruin remnant truth as explicitly unknown", () => {
    const malformed = exactRecord({
      status: "ruin",
      remnant_materials: Number.NaN,
      ruined_at: 1,
    });
    const { actor: ruin } = actor(input(malformed));

    expect(ruin.snapshot().durable.remnantMaterials).toBeNull();
    expect(ruin.snapshot().cues).toEqual([
      { kind: "unknown-hatch", shape: "hatch", colorIndependent: true },
    ]);
  });

  it("keeps exact standing truth while a projected collapse controls rubble fullness", () => {
    const { actor: ruin } = actor({
      ...input(exactRecord({ status: "ruin", remnant_materials: 55, ruined_at: 1 })),
      exactBaseCursor: 0,
      projectedThroughCursor: 1,
      exactRemnantMaterials: 0,
      projectedRemnantMaterials: { value: 55, evidenceCursor: 1 },
    } as PresentedHomeInput);

    expect(ruin.snapshot().durable.remnantMaterials).toBe(0);
    expect(ruin.snapshot().visual.ruinFrameId).toBe("rubble-full");
  });

  it("exposes only strictly future transient deadlines and never a ruin-removal deadline", () => {
    const { actor: home } = actor();
    expect(home.nextDeadlineMs()).toBeNull();
    home.apply({ kind: "build", durationMs: 1_000 }, 100);
    expect(home.nextDeadlineMs()).toBeGreaterThan(100);
    home.advanceTo(100);
    expect(home.nextDeadlineMs()).toBeGreaterThan(100);
    home.advanceTo(1_100);
    expect(home.nextDeadlineMs()).toBeNull();

    home.reconcile(input(exactRecord({ status: "ruin", remnant_materials: 0, ruined_at: 1 })));
    expect(home.nextDeadlineMs()).toBeNull();
  });

  it("places every bounded detail mark outside the clear doorway", () => {
    const stakeholders = Array.from({ length: 20 }, (_unused, index) => `stake_${index}`);
    const breachers = Array.from({ length: 20 }, (_unused, index) => `breach_${index}`);
    const { actor: home } = actor(input(exactRecord({ stakeholders, breachers })));
    home.setSelected(true);
    const context = draw(home, "front");
    const snapshot = home.snapshot();
    const detailAtlas = PRODUCTION_ASSET_MANIFEST.regions[snapshot.kit].homeManifest.detailAtlasId;
    const doorway = snapshot.geometry.doorClearance;
    for (const call of context.drawCalls.filter(({ atlasId }) => atlasId === detailAtlas)) {
      const [, , , , x, y, width, height] = call.args;
      const localX = x - snapshot.plot.x;
      const localY = y - snapshot.plot.y;
      const overlapsDoor = localX < doorway.x + doorway.width && localX + width > doorway.x
        && localY < doorway.y + doorway.height && localY + height > doorway.y;
      expect(overlapsDoor, `${localX},${localY},${width},${height}`).toBe(false);
    }
  });

  // Regression for the live "floating badge icons around homes" defect: a
  // yellow owner banner and a green stakeholder banner were reported hovering
  // near the roofline, "detached from the building and reading as visual
  // noise." Root cause: `draw()`'s mark loop anchored row 0 at `plot.y + 0`,
  // the very top of the home's 128x128 draw cell, where every kit's roof
  // sits (the ground line lands near the cell's bottom, per the hut-kit
  // derivation's own alpha-bounding-box measurements). Since the owner mark
  // alone draws for every owned standing home, this floated on effectively
  // every home in the game, not a rare edge case. Fixed by anchoring row 0 at
  // the structure's own ground line (`logicalBounds.height`) and stacking
  // additional rows upward.
  it("anchors status-mark badges near the structure's ground line instead of above the roof", () => {
    const { actor: home } = actor(input(exactRecord({ stakeholders: ["agent_friend"] })));
    home.setSelected(true);
    const snapshot = home.snapshot();
    const detailAtlas = PRODUCTION_ASSET_MANIFEST.regions[snapshot.kit].homeManifest.detailAtlasId;
    const marks = draw(home, "front").drawCalls.filter(({ atlasId }) => atlasId === detailAtlas);
    const groundRowY = snapshot.plot.y + snapshot.geometry.logicalBounds.height - 32;

    expect(marks.length).toBeGreaterThanOrEqual(2);
    const [ownerCall, stakeholderCall] = marks;
    // The owner mark (index 0, column 0) and the first stakeholder mark
    // (index 1, column 1) share row 0 -- both must land on the ground row.
    expect(ownerCall!.args.slice(4, 6)).toEqual([snapshot.plot.x, groundRowY]);
    expect(stakeholderCall!.args.slice(4, 6)).toEqual([snapshot.plot.x + 96, groundRowY]);
    // No mark may sit at the old, floating anchor (the plot's own top edge,
    // i.e. the roofline) -- every kit's logicalBounds.height exceeds 32, so
    // the ground row is strictly below it.
    for (const call of marks) {
      expect(call.args[5]).not.toBe(snapshot.plot.y);
    }
  });

  // Owner decision (home-cleanup, item 2): home status markers (owner/
  // stakeholder/vault/hoarding/breacher/loot/claim banners) are visual noise
  // during ordinary viewing -- show them only when that home is selected.
  // This renderer has no independent hover concept (grepped: nothing under
  // `renderer2d`/`app` tracks pointer-hover distinct from click-to-select),
  // so "hover or selection" resolves to selection-only, mirroring how
  // `ProductionSceneGraph` already drives `LayeredHumanActor`'s `#selected`
  // from `frame.selection`.
  it("hides status-mark badges until the home is selected, and hides them again once deselected", () => {
    const { actor: home } = actor(input(exactRecord({ stakeholders: ["agent_friend"] })));
    const snapshot = home.snapshot();
    const detailAtlas = PRODUCTION_ASSET_MANIFEST.regions[snapshot.kit].homeManifest.detailAtlasId;

    expect(home.snapshot().selected).toBe(false);
    expect(draw(home, "front").drawCalls.some(({ atlasId }) => atlasId === detailAtlas)).toBe(false);

    home.setSelected(true);
    expect(home.snapshot().selected).toBe(true);
    const selectedMarks = draw(home, "front").drawCalls.filter(({ atlasId }) => atlasId === detailAtlas);
    expect(selectedMarks.length).toBeGreaterThanOrEqual(2);

    home.setSelected(false);
    expect(home.snapshot().selected).toBe(false);
    expect(draw(home, "front").drawCalls.some(({ atlasId }) => atlasId === detailAtlas)).toBe(false);
  });

  it("crosses large-delta transient markers once in canonical order", () => {
    const { actor: home } = actor();
    home.apply({ kind: "collapse", durationMs: 1_000 }, 5_000);

    expect(home.advanceTo(6_000)).toEqual([
      { name: "hearth", atMs: 5_000 },
      { name: "roof", atMs: 5_180 },
      { name: "walls", atMs: 5_400 },
      { name: "door", atMs: 5_620 },
      { name: "collapse-commit", atMs: 6_000 },
    ]);
    expect(home.advanceTo(6_000)).toEqual([]);
    expect(home.advanceTo(99_000)).toEqual([]);
    expect(home.snapshot().durable.status).toBe("standing");
    expect(home.snapshot().transient.emittedMarkers).toEqual([
      "hearth", "roof", "walls", "door", "collapse-commit",
    ]);
  });

  it("emits build markers once even when one delta crosses the complete action", () => {
    const { actor: home } = actor();
    home.apply({ kind: "build", durationMs: 1_000 }, 200);
    expect(home.advanceTo(1_200).map(({ name }) => name)).toEqual([
      "foundation", "post", "walls", "roof", "door", "hearth", "build-commit",
    ]);
    expect(home.advanceTo(2_000)).toEqual([]);
    expect(home.snapshot().durable.status).toBe("standing");
  });

  it("uses neutral shape cues rather than color-only assertions for unknown fields", () => {
    const { actor: home } = actor(input(partialRecord({ home_id: "home_001" })));
    const unknown = home.snapshot().cues.find(({ kind }) => kind === "unknown-hatch");
    expect(unknown).toEqual({ kind: "unknown-hatch", shape: "hatch", colorIndependent: true });
    expect(home.snapshot().marks.every(({ kind }) => kind !== "owner" && kind !== "vault")).toBe(true);
    const context = draw(home, "front");
    expect(context.drawCalls.some(({ atlasId, args }) => (
      atlasId.endsWith("home-details") && args[0] === 0 && args[1] === 32
    ))).toBe(false);
  });

  // home-cleanup item 1: the black-outlined, diagonally-hatched square drawn
  // by `#drawUnknownHatch` for an "unknown" home is a developer/QA diagnostic
  // (it signals internal presentation-layer incompleteness -- a home whose
  // record is still `projected-partial` and missing a required durable field,
  // per `deriveDurable()` -- not in-universe home decor a viewer should ever
  // see). Confirmed live: it floated near a real, fully-legible home's roof
  // in production ("route-badge-fix" evidence), because homes introduced via
  // a live `home_built` event are deliberately left `projected-partial` with
  // several fields unresolved (`PresentedEventProjector.ts`) until the next
  // exact checkpoint reconciles them -- an expected, honest-incompleteness
  // condition of the live projection pipeline, not a broken asset lookup.
  // Gated behind the same pre-document `__vivariumEnableProductionDiagnosticsForTest`
  // flag `debug.ts` already uses for this renderer's other developer-only
  // instrumentation, so it stays invisible during normal viewing.
  describe("unknown-hatch diagnostic gating", () => {
    afterEach(() => {
      delete (window as { __vivariumEnableProductionDiagnosticsForTest?: boolean })
        .__vivariumEnableProductionDiagnosticsForTest;
    });

    it("stays hidden during normal (non-diagnostics) viewing", () => {
      delete (window as { __vivariumEnableProductionDiagnosticsForTest?: boolean })
        .__vivariumEnableProductionDiagnosticsForTest;
      const { actor: home } = actor(input(partialRecord({ home_id: "home_001" })));
      expect(home.snapshot().cues.some(({ kind }) => kind === "unknown-hatch")).toBe(true);

      const context = draw(home, "front");
      expect(context.strokeCalls).toEqual([]);
    });

    it("draws the diagnostic hatch only when production diagnostics are enabled for test", () => {
      (window as { __vivariumEnableProductionDiagnosticsForTest?: boolean })
        .__vivariumEnableProductionDiagnosticsForTest = true;
      const { actor: home } = actor(input(partialRecord({ home_id: "home_001" })));

      const context = draw(home, "front");
      expect(context.strokeCalls).toEqual([
        { kind: "rect", args: [104.5, 136.5, 15, 15] },
        { kind: "line", args: [107, 140, 117, 150] },
        { kind: "line", args: [112, 138, 120, 146] },
      ]);
    });
  });

  it("deep-owns initial and reconciled records, arrays, plot, door, and returned snapshots", () => {
    const stakeholders = ["agent_owner"];
    const breachers = ["agent_rival"];
    const initial = input(exactRecord({ stakeholders, breachers }));
    const { actor: home } = actor(initial);

    stakeholders.push("invented");
    breachers.length = 0;
    (initial.plot as { x: number }).x = 999;
    (initial.door as { y: number }).y = 999;
    const leaked = home.snapshot() as unknown as {
      plot: { x: number }; durable: { stakeholderIds: string[] }; visual: { backComponents: string[] };
    };
    leaked.plot.x = 777;
    leaked.durable.stakeholderIds.push("invented");
    leaked.visual.backComponents.pop();

    expect(home.snapshot()).toMatchObject({
      plot: { x: 96, y: 128 },
      door: { x: 153, y: 185 },
      durable: { stakeholderIds: ["agent_owner"], breacherIds: ["agent_rival"] },
    });
    expect(home.snapshot().visual.backComponents.length).toBeGreaterThan(0);

    const nextStakeholders = ["agent_next"];
    const next = input(partialRecord({ status: "standing", stakeholders: nextStakeholders }));
    home.reconcile(next);
    nextStakeholders.push("invented");
    expect(home.snapshot().durable.stakeholderIds).toEqual(["agent_next"]);
  });

  it("captures all four required regional leases and releases each exactly once", () => {
    const supplied = leasesFor();
    const replacement = leasesFor();
    const { actor: home } = actor(input(), supplied);
    supplied.leases.clear();
    replacement.leases.forEach((lease, id) => supplied.leases.set(id, lease));

    home.dispose();
    home.dispose();
    for (const release of supplied.releases.values()) expect(release).toHaveBeenCalledTimes(1);
    for (const release of replacement.releases.values()) expect(release).not.toHaveBeenCalled();
  });

  it("is completely inert after idempotent disposal", () => {
    const { actor: home } = actor();
    home.apply({ kind: "damage", durationMs: 1_000 }, 100);
    const before = home.snapshot();
    home.dispose();
    home.dispose();

    home.reconcile(input(exactRecord({ owner_id: "invented", status: "ruin" })));
    home.apply({ kind: "door", state: "open" }, 200);
    expect(home.advanceTo(9_999)).toEqual([]);
    expect(home.nextDeadlineMs()).toBeNull();
    expect(home.snapshot()).toEqual(before);
    expect(draw(home, "back").drawCalls).toEqual([]);
    expect(draw(home, "front").drawCalls).toEqual([]);
  });

  it("owns no timer, RAF, raw event, or StoryMoment interpretation", async () => {
    const source = await readFile("src/renderer2d/production/homes/HomeActor.ts", "utf8");
    expect(source).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|addEventListener/);
    expect(source).not.toMatch(/SerializedEvent|StoryMoment|event\.type|raw event/i);
  });
});
