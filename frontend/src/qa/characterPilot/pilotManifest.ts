import assetMetadata from "./assets/character-pilot-assets.json";
import {
  PRODUCTION_ASSET_MANIFEST,
  finalizeProductionAssetManifest,
  type ProductionAssetLease,
  type ProductionAssetManifest,
  type ProductionAtlasDescriptor,
} from "../../renderer2d/production/assets/productionManifest";
import {
  createSharedAtlasPool,
  type SharedAtlasPool,
} from "../../renderer2d/production/assets/SharedAtlasPool";
import type { HumanAppearance } from "../../renderer2d/production/actors/appearance";

export interface CharacterPilotBundle {
  readonly manifest: ProductionAssetManifest;
  readonly leases: ReadonlyMap<string, ProductionAssetLease<ImageBitmap>>;
  release(): void;
}

export const CHARACTER_PILOT_AGENT_ID = "character-pilot-balanced-male";

export const CHARACTER_PILOT_APPEARANCE: HumanAppearance = Object.freeze({
  rig: "human-a",
  skinRamp: "warm",
  hairSilhouette: "messy",
  hairRamp: "chestnut",
  clothingSilhouette: "work-shirt-sash",
  clothingPalette: "olive",
  secondaryAccent: null,
});

const PILOT_ATLAS_URLS: Readonly<Record<string, URL>> = Object.freeze({
  "core-human-body-rigs": new URL("./assets/character-pilot-body.png", import.meta.url),
  "core-human-face-planes": new URL("./assets/character-pilot-face.png", import.meta.url),
  "core-human-hair": new URL("./assets/character-pilot-hair.png", import.meta.url),
  "core-human-clothing-00": new URL("./assets/character-pilot-clothing.png", import.meta.url),
  "core-human-held": new URL("./assets/character-pilot-held.png", import.meta.url),
  "core-human-status-effects": new URL("./assets/character-pilot-status.png", import.meta.url),
});

const abortError = (): DOMException => new DOMException("Aborted", "AbortError");

/** Build a detached, validator-clean manifest over the immutable production source. */
export function createCharacterPilotManifest(): ProductionAssetManifest {
  const draft = structuredClone(PRODUCTION_ASSET_MANIFEST);
  const atlasRecord = draft.atlases as Record<string, ProductionAtlasDescriptor>;

  for (const atlas of assetMetadata.atlases) {
    const base = atlasRecord[atlas.id];
    const url = PILOT_ATLAS_URLS[atlas.id];
    if (base === undefined || url === undefined) {
      throw new Error(`Character pilot atlas ${atlas.id} has no production binding.`);
    }
    if (atlas.width % atlas.cellWidth !== 0 || atlas.height % atlas.cellHeight !== 0) {
      throw new Error(`Character pilot atlas ${atlas.id} has non-integral cell geometry.`);
    }
    atlasRecord[atlas.id] = {
      ...base,
      url: { href: url.href },
      width: atlas.width,
      height: atlas.height,
      cellWidth: atlas.cellWidth,
      cellHeight: atlas.cellHeight,
      columns: atlas.width / atlas.cellWidth,
      rows: atlas.height / atlas.cellHeight,
      compressedBytes: atlas.compressedBytes,
      decodedBytes: atlas.decodedBytes,
      sha256: atlas.sha256,
    };
  }

  const pilotFaceSha256 = atlasRecord["core-human-face-planes"]!.sha256;
  for (const rig of Object.values(draft.human.rigs)) {
    for (const facing of Object.values(rig.facePlanes)) {
      for (const face of Object.values(facing)) {
        (face as { measuredFromSha256: string }).measuredFromSha256 = pilotFaceSha256;
      }
    }
  }

  const coreArt = Object.values(atlasRecord).filter(({ group }) => group === "core");
  const coreCompressedBytes = coreArt.reduce(
    (sum, atlas) => sum + atlas.compressedBytes,
    draft.budgets.coreMetadataCompressedBytes,
  );
  const exactCoreDecodedBytes = coreArt.reduce(
    (sum, atlas) => sum + atlas.decodedBytes,
    draft.budgets.coreMetadataDecodedBytes,
  );
  const activeCompressedBytes = Object.fromEntries(Object.entries(draft.regions).map(
    ([kit, region]) => [
      kit,
      coreCompressedBytes + region.compressedBytes + draft.budgets.currentUiCompressedBytes,
    ],
  )) as ProductionAssetManifest["budgets"]["activeCompressedBytes"];
  const exactPeakActiveDecodedBytes = Object.fromEntries(Object.entries(draft.regions).map(
    ([kit, region]) => [
      kit,
      exactCoreDecodedBytes + region.decodedBytes + draft.budgets.currentUiDecodedBytes,
    ],
  )) as ProductionAssetManifest["budgets"]["exactPeakActiveDecodedBytes"];
  Object.assign(draft.budgets, {
    coreCompressedBytes,
    exactCoreDecodedBytes,
    activeCompressedBytes,
    exactPeakActiveDecodedBytes,
  });

  return finalizeProductionAssetManifest(draft);
}

export const CHARACTER_PILOT_MANIFEST = createCharacterPilotManifest();

const SELECTED_ATLAS_IDS = Object.freeze(assetMetadata.atlases.map(({ id }) => id));

class ImmutableReadonlyMap<K, V> implements ReadonlyMap<K, V> {
  readonly #values: ReadonlyMap<K, V>;

  constructor(values: ReadonlyMap<K, V>) {
    this.#values = new Map(values);
    Object.freeze(this);
  }

  get size(): number {
    return this.#values.size;
  }

  get(key: K): V | undefined {
    return this.#values.get(key);
  }

  has(key: K): boolean {
    return this.#values.has(key);
  }

  forEach(
    callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown,
  ): void {
    this.#values.forEach((value, key) => callback.call(thisArg, value, key, this));
  }

  entries(): MapIterator<[K, V]> {
    return this.#values.entries();
  }

  keys(): MapIterator<K> {
    return this.#values.keys();
  }

  values(): MapIterator<V> {
    return this.#values.values();
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  get [Symbol.toStringTag](): string {
    return "Map";
  }
}

function releaseAcquired(
  leases: ReadonlyMap<string, ProductionAssetLease<ImageBitmap>>,
  pool: SharedAtlasPool,
): void {
  for (const lease of new Set(leases.values())) lease.release();
  pool.dispose();
}

function borrowedAtlasLeases(
  leases: ReadonlyMap<string, ProductionAssetLease<ImageBitmap>>,
): ReadonlyMap<string, ProductionAssetLease<ImageBitmap>> {
  return new ImmutableReadonlyMap(new Map([...leases].map(([id, lease]) => [
    id,
    Object.freeze({
      value: lease.value,
      release(): void {},
    }),
  ])));
}

/** Acquire the six pilot atlases as one rollback-safe ownership bundle. */
export async function acquireCharacterPilotBundle(
  signal: AbortSignal,
): Promise<CharacterPilotBundle> {
  if (signal.aborted) throw abortError();
  const pool = createSharedAtlasPool({ manifest: CHARACTER_PILOT_MANIFEST });
  const acquired = new Map<string, ProductionAssetLease<ImageBitmap>>();
  try {
    for (const atlasId of SELECTED_ATLAS_IDS) {
      acquired.set(atlasId, await pool.acquire(atlasId, signal));
    }
    if (signal.aborted) throw abortError();
  } catch (error) {
    releaseAcquired(acquired, pool);
    throw error;
  }

  let released = false;
  const ownedLeases = new Map(acquired);
  const leases = borrowedAtlasLeases(ownedLeases);
  return Object.freeze({
    manifest: CHARACTER_PILOT_MANIFEST,
    leases,
    release(): void {
      if (released) return;
      released = true;
      releaseAcquired(ownedLeases, pool);
    },
  });
}
