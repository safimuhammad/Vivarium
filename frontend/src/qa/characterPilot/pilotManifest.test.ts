import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const atlasPoolHarness = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("../../renderer2d/production/assets/SharedAtlasPool", () => ({
  createSharedAtlasPool: atlasPoolHarness.create,
}));

import assetMetadata from "./assets/character-pilot-assets.json";
import {
  CHARACTER_PILOT_AGENT_ID,
  CHARACTER_PILOT_APPEARANCE,
  CHARACTER_PILOT_MANIFEST,
  acquireCharacterPilotBundle,
  createCharacterPilotManifest,
} from "./pilotManifest";
import {
  HUMAN_BODY_ACTIONS,
  PRODUCTION_ASSET_MANIFEST,
  PRODUCTION_FACINGS,
  validateProductionAssetManifest,
  type ProductionAssetLease,
  type ProductionAtlasDescriptor,
} from "../../renderer2d/production/assets/productionManifest";
import {
  LayeredHumanActor,
} from "../../renderer2d/production/actors/LayeredHumanActor";
import { deriveHumanAppearance } from "../../renderer2d/production/actors/appearance";

const SELECTED_ATLAS_IDS = assetMetadata.atlases.map(({ id }) => id);

interface FakeBitmap extends ImageBitmap {
  readonly atlasId: string;
  readonly close: Mock<() => void>;
}

function fakeLease(id: string): ProductionAssetLease<ImageBitmap> & {
  readonly release: Mock<() => void>;
  readonly bitmap: FakeBitmap;
} {
  const bitmap = {
    atlasId: id,
    width: CHARACTER_PILOT_MANIFEST.atlases[id]!.width,
    height: CHARACTER_PILOT_MANIFEST.atlases[id]!.height,
    close: vi.fn(),
  } as unknown as FakeBitmap;
  let released = false;
  return {
    value: bitmap,
    bitmap,
    release: vi.fn(() => {
      if (released) return;
      released = true;
      bitmap.close();
    }),
  };
}

function poolFixture(
  acquire: (id: string, signal?: AbortSignal) => Promise<ProductionAssetLease<ImageBitmap>>,
) {
  return {
    acquire: vi.fn(acquire),
    retain: vi.fn(),
    diagnostics: vi.fn(),
    dispose: vi.fn(),
  };
}

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value as Record<string, unknown>)) {
    expectDeepFrozen(child);
  }
}

function drawingContext(filters: string[]): CanvasRenderingContext2D {
  let filter = "none";
  return {
    imageSmoothingEnabled: true,
    get filter() {
      return filter;
    },
    set filter(value: string) {
      filter = value;
    },
    globalCompositeOperation: "source-over",
    globalAlpha: 1,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    save: () => undefined,
    restore: () => undefined,
    drawImage: () => filters.push(filter),
    fillRect: () => undefined,
    strokeRect: () => undefined,
  } as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  atlasPoolHarness.create.mockReset();
});

describe("character pilot manifest", () => {
  it("publishes a detached deeply frozen validator-clean manifest without mutating production", () => {
    const productionBefore = JSON.stringify(PRODUCTION_ASSET_MANIFEST);
    const rebuilt = createCharacterPilotManifest();

    expect(CHARACTER_PILOT_MANIFEST).not.toBe(PRODUCTION_ASSET_MANIFEST);
    expect(CHARACTER_PILOT_MANIFEST.human).not.toBe(PRODUCTION_ASSET_MANIFEST.human);
    expect(JSON.stringify(PRODUCTION_ASSET_MANIFEST)).toBe(productionBefore);
    expect(rebuilt).toEqual(CHARACTER_PILOT_MANIFEST);
    expect(validateProductionAssetManifest(CHARACTER_PILOT_MANIFEST)).toEqual([]);
    expectDeepFrozen(CHARACTER_PILOT_MANIFEST);

    const core = Object.values(CHARACTER_PILOT_MANIFEST.atlases)
      .filter(({ group }) => group === "core");
    const coreCompressed = core.reduce(
      (sum, atlas) => sum + atlas.compressedBytes,
      CHARACTER_PILOT_MANIFEST.budgets.coreMetadataCompressedBytes,
    );
    const coreDecoded = core.reduce(
      (sum, atlas) => sum + atlas.decodedBytes,
      CHARACTER_PILOT_MANIFEST.budgets.coreMetadataDecodedBytes,
    );
    expect(CHARACTER_PILOT_MANIFEST.budgets.coreCompressedBytes).toBe(coreCompressed);
    expect(CHARACTER_PILOT_MANIFEST.budgets.exactCoreDecodedBytes).toBe(coreDecoded);
    for (const [kit, region] of Object.entries(CHARACTER_PILOT_MANIFEST.regions)) {
      expect(CHARACTER_PILOT_MANIFEST.budgets.activeCompressedBytes[
        kit as keyof typeof CHARACTER_PILOT_MANIFEST.budgets.activeCompressedBytes
      ]).toBe(
        coreCompressed
          + region.compressedBytes
          + CHARACTER_PILOT_MANIFEST.budgets.currentUiCompressedBytes,
      );
      expect(CHARACTER_PILOT_MANIFEST.budgets.exactPeakActiveDecodedBytes[
        kit as keyof typeof CHARACTER_PILOT_MANIFEST.budgets.exactPeakActiveDecodedBytes
      ]).toBe(
        coreDecoded
          + region.decodedBytes
          + CHARACTER_PILOT_MANIFEST.budgets.currentUiDecodedBytes,
      );
    }
  });

  it("redirects exactly the six selected descriptors to byte-exact pilot PNGs", () => {
    expect(SELECTED_ATLAS_IDS).toHaveLength(6);
    for (const atlas of assetMetadata.atlases) {
      const descriptor = CHARACTER_PILOT_MANIFEST.atlases[atlas.id]!;
      const production = PRODUCTION_ASSET_MANIFEST.atlases[atlas.id]!;
      expect(descriptor).toMatchObject({
        id: atlas.id,
        group: production.group,
        regionKit: production.regionKit,
        width: atlas.width,
        height: atlas.height,
        cellWidth: atlas.cellWidth,
        cellHeight: atlas.cellHeight,
        columns: atlas.width / atlas.cellWidth,
        rows: atlas.height / atlas.cellHeight,
        decodedBytes: atlas.width * atlas.height * 4,
        compressedBytes: statSync(resolve(
          process.cwd(),
          "src/qa/characterPilot/assets",
          atlas.file,
        )).size,
        sha256: atlas.sha256,
      } satisfies Partial<ProductionAtlasDescriptor>);
      expect(descriptor.url.href).toMatch(
        new RegExp(`/src/qa/characterPilot/assets/${atlas.file.replace(".", "\\.")}$`),
      );
    }

    const untouched = Object.keys(PRODUCTION_ASSET_MANIFEST.atlases)
      .filter((id) => !SELECTED_ATLAS_IDS.includes(id));
    for (const id of untouched) {
      expect(CHARACTER_PILOT_MANIFEST.atlases[id])
        .toEqual(PRODUCTION_ASSET_MANIFEST.atlases[id]);
    }
  });

  it("retains exact human-a topology, frame anchors, markers, and selected bindings", () => {
    expect(CHARACTER_PILOT_MANIFEST.human.layerAtlases).toEqual(
      PRODUCTION_ASSET_MANIFEST.human.layerAtlases,
    );
    expect(CHARACTER_PILOT_MANIFEST.human.clothingAtlasBySilhouette["work-shirt-sash"])
      .toBe("core-human-clothing-00");
    for (const action of HUMAN_BODY_ACTIONS) {
      for (const facing of PRODUCTION_FACINGS) {
        const key = `${action}:${facing}`;
        expect(CHARACTER_PILOT_MANIFEST.human.rigs["human-a"].bodyClips[key])
          .toEqual(PRODUCTION_ASSET_MANIFEST.human.rigs["human-a"].bodyClips[key]);
      }
    }
    expect(assetMetadata.bodyFrameAnchors).toEqual(
      PRODUCTION_FACINGS.flatMap((facing) => HUMAN_BODY_ACTIONS.flatMap((action) => (
        PRODUCTION_ASSET_MANIFEST.human.rigs["human-a"].bodyClips[`${action}:${facing}`]
          .frames.map(({ feet, faceAnchor, heldAnchor }) => [
            feet.x,
            feet.y,
            faceAnchor.x,
            faceAnchor.y,
            heldAnchor.x,
            heldAnchor.y,
          ])
      ))),
    );
  });

  it("uses an immutable explicit pilot appearance and bypasses filters only in authored mode", () => {
    expect(CHARACTER_PILOT_AGENT_ID).toMatch(/character-pilot/i);
    expect(CHARACTER_PILOT_APPEARANCE).toMatchObject({
      rig: "human-a",
      hairSilhouette: "messy",
      clothingSilhouette: "work-shirt-sash",
      secondaryAccent: null,
    });
    expectDeepFrozen(CHARACTER_PILOT_APPEARANCE);

    const leases = new Map(SELECTED_ATLAS_IDS.map((id) => [id, fakeLease(id)]));
    const actor = new LayeredHumanActor({
      id: CHARACTER_PILOT_AGENT_ID,
      name: "Pilot",
      position: { x: 24, y: 61 },
      facing: "south",
      manifest: CHARACTER_PILOT_MANIFEST,
      atlasLeases: leases,
      appearance: CHARACTER_PILOT_APPEARANCE,
      paletteMode: "authored",
    });
    expect(actor.snapshot().appearance).toEqual(CHARACTER_PILOT_APPEARANCE);
    expect(actor.snapshot().appearance).not.toBe(CHARACTER_PILOT_APPEARANCE);
    const filters: string[] = [];
    actor.draw(drawingContext(filters));
    expect(filters).toHaveLength(4);
    expect(new Set(filters)).toEqual(new Set(["none"]));
  });

  it("keeps default actors ID-derived with the existing filtered rendering behavior", () => {
    const id = "default-production-regression";
    const leases = new Map(
      Object.values(PRODUCTION_ASSET_MANIFEST.atlases)
        .filter(({ group }) => group === "core")
        .map(({ id: atlasId }) => [atlasId, fakeLease(atlasId)]),
    );
    const actor = new LayeredHumanActor({
      id,
      name: "Default",
      persona: "unchanged default",
      position: { x: 24, y: 61 },
      facing: "south",
      manifest: PRODUCTION_ASSET_MANIFEST,
      atlasLeases: leases,
    });
    expect(actor.snapshot().appearance).toEqual(deriveHumanAppearance(id, "unchanged default"));
    const filters: string[] = [];
    actor.draw(drawingContext(filters));
    expect(filters).toHaveLength(4);
    expect(filters.every((filter) => filter !== "none")).toBe(true);
  });

  it("detaches and freezes an explicit appearance override at the actor boundary", () => {
    const appearance = { ...CHARACTER_PILOT_APPEARANCE };
    const leases = new Map(SELECTED_ATLAS_IDS.map((id) => [id, fakeLease(id)]));
    const actor = new LayeredHumanActor({
      id: CHARACTER_PILOT_AGENT_ID,
      name: "Pilot",
      position: { x: 24, y: 61 },
      manifest: CHARACTER_PILOT_MANIFEST,
      atlasLeases: leases,
      appearance,
      paletteMode: "authored",
    });
    appearance.rig = "human-b";

    expect(actor.snapshot().appearance).toEqual(CHARACTER_PILOT_APPEARANCE);
    expect(actor.snapshot().appearance).not.toBe(appearance);
    expect(Object.isFrozen(actor.snapshot().appearance)).toBe(true);
  });

  it("publishes borrowed leases while the bundle retains sole release ownership", async () => {
    const leases = new Map(SELECTED_ATLAS_IDS.map((id) => [id, fakeLease(id)]));
    const pool = poolFixture(async (id) => leases.get(id)!);
    atlasPoolHarness.create.mockReturnValue(pool);

    const bundle = await acquireCharacterPilotBundle(new AbortController().signal);
    expect(atlasPoolHarness.create).toHaveBeenCalledWith({ manifest: CHARACTER_PILOT_MANIFEST });
    expect(pool.acquire.mock.calls.map(([id]) => id)).toEqual(SELECTED_ATLAS_IDS);
    expect([...bundle.leases.keys()]).toEqual(SELECTED_ATLAS_IDS);
    expect(Object.isFrozen(bundle.leases)).toBe(true);
    expect((bundle.leases as unknown as { set?: unknown }).set).toBeUndefined();
    expect((bundle.leases as unknown as { clear?: unknown }).clear).toBeUndefined();

    for (const [id, borrowed] of bundle.leases) {
      expect(Object.isFrozen(borrowed)).toBe(true);
      expect(borrowed).not.toBe(leases.get(id));
      expect(borrowed.value).toBe(leases.get(id)!.value);
    }
    const actor = new LayeredHumanActor({
      id: CHARACTER_PILOT_AGENT_ID,
      name: "Pilot",
      position: { x: 24, y: 61 },
      facing: "south",
      manifest: bundle.manifest,
      atlasLeases: bundle.leases,
      appearance: CHARACTER_PILOT_APPEARANCE,
      paletteMode: "authored",
    });
    actor.dispose();
    for (const borrowed of bundle.leases.values()) borrowed.release();
    for (const lease of leases.values()) {
      expect(lease.release).not.toHaveBeenCalled();
      expect(lease.bitmap.close).not.toHaveBeenCalled();
    }
    expect(pool.dispose).not.toHaveBeenCalled();

    bundle.release();
    bundle.release();
    for (const lease of leases.values()) {
      expect(lease.release).toHaveBeenCalledOnce();
      expect(lease.bitmap.close).toHaveBeenCalledOnce();
    }
    expect(pool.dispose).toHaveBeenCalledOnce();
  });

  it("rolls back a partial acquisition on one decode failure", async () => {
    const failure = new Error("decode failed");
    const leases = new Map(SELECTED_ATLAS_IDS.map((id) => [id, fakeLease(id)]));
    let acquired = 0;
    const pool = poolFixture(async (id) => {
      if (acquired === 2) throw failure;
      acquired += 1;
      return leases.get(id)!;
    });
    atlasPoolHarness.create.mockReturnValue(pool);

    await expect(acquireCharacterPilotBundle(new AbortController().signal)).rejects.toBe(failure);
    for (const [index, lease] of [...leases.values()].entries()) {
      expect(lease.release).toHaveBeenCalledTimes(index < 2 ? 1 : 0);
      expect(lease.bitmap.close).toHaveBeenCalledTimes(index < 2 ? 1 : 0);
    }
    expect(pool.dispose).toHaveBeenCalledOnce();
  });

  it("rolls back acquired ownership when the caller aborts mid-transaction", async () => {
    const controller = new AbortController();
    const leases = new Map(SELECTED_ATLAS_IDS.map((id) => [id, fakeLease(id)]));
    let acquired = 0;
    const pool = poolFixture(async (id, signal) => {
      if (acquired === 2) {
        controller.abort();
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      }
      acquired += 1;
      return leases.get(id)!;
    });
    atlasPoolHarness.create.mockReturnValue(pool);

    await expect(acquireCharacterPilotBundle(controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    for (const [index, lease] of [...leases.values()].entries()) {
      expect(lease.release).toHaveBeenCalledTimes(index < 2 ? 1 : 0);
      expect(lease.bitmap.close).toHaveBeenCalledTimes(index < 2 ? 1 : 0);
    }
    expect(pool.dispose).toHaveBeenCalledOnce();
  });

  it("does not create a pool or listener when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(acquireCharacterPilotBundle(controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(atlasPoolHarness.create).not.toHaveBeenCalled();
  });

  it("has no legacy sprite-atlas, Three.js, backend, or provider dependency", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/qa/characterPilot/pilotManifest.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/renderer2d\/assets\/(?:demoManifest|spriteManifest)/);
    expect(source).not.toMatch(/(?:from|import\s*\()\s*["'][^"']*three/i);
    expect(source).not.toMatch(/(?:backend|ollama|gemini|provider)/i);
  });
});
