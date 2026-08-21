import { describe, expect, it, vi } from "vitest";

import {
  PRODUCTION_ASSET_MANIFEST,
  type ProductionAssetLease,
  type ProductionAssetManifest,
  type ProductionAtlasDescriptor,
} from "./productionManifest";
import {
  createSharedAtlasPool,
  type SharedAtlasDecoder,
} from "./SharedAtlasPool";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const descriptor = (
  id: string,
  overrides: Partial<ProductionAtlasDescriptor> = {},
): ProductionAtlasDescriptor => ({
  id,
  url: { href: `https://assets.invalid/${id}.png` },
  group: "core",
  regionKit: null,
  width: 8,
  height: 4,
  cellWidth: 4,
  cellHeight: 4,
  columns: 2,
  rows: 1,
  compressedBytes: 40,
  decodedBytes: 128,
  sha256: "a".repeat(64),
  ...overrides,
});

const manifestWith = (
  descriptors: readonly ProductionAtlasDescriptor[],
  overrides: Partial<ProductionAssetManifest["budgets"]> = {},
): ProductionAssetManifest => ({
  ...PRODUCTION_ASSET_MANIFEST,
  atlases: Object.fromEntries(descriptors.map((atlas) => [atlas.id, atlas])),
  budgets: {
    ...PRODUCTION_ASSET_MANIFEST.budgets,
    currentUiCompressedBytes: 17,
    currentUiDecodedBytes: 19,
    coreMetadataCompressedBytes: 23,
    coreMetadataDecodedBytes: 23,
    regionMetadataCompressedBytes: {
      ...PRODUCTION_ASSET_MANIFEST.budgets.regionMetadataCompressedBytes,
      "worn-heartland": 29,
    },
    regionMetadataDecodedBytes: {
      ...PRODUCTION_ASSET_MANIFEST.budgets.regionMetadataDecodedBytes,
      "worn-heartland": 29,
    },
    ...overrides,
  },
});

const bitmap = (width = 8, height = 4): ImageBitmap => ({
  width,
  height,
  close: vi.fn(),
}) as unknown as ImageBitmap;

describe("SharedAtlasPool", () => {
  it("retains a ready atlas synchronously as a distinct idempotent lease without touching loading state", async () => {
    const atlas = descriptor("core-a");
    const pending = deferred<{ readonly bitmap: ImageBitmap; readonly compressedBytes: number }>();
    const pool = createSharedAtlasPool({
      manifest: manifestWith([atlas]),
      decode: () => pending.promise,
    });
    const acquiring = pool.acquire(atlas.id);

    expect(() => pool.retain(atlas.id)).toThrow(expect.objectContaining({
      name: "SharedAtlasPoolError",
      code: "not-ready",
    }));
    expect(pool.diagnostics()).toMatchObject({ leases: 0, inFlightCount: 1, waiterCount: 1 });

    const image = bitmap();
    pending.resolve({ bitmap: image, compressedBytes: atlas.compressedBytes });
    const primary = await acquiring;
    const retained = pool.retain(atlas.id);
    expect(retained).not.toBe(primary);
    expect(retained.value).toBe(primary.value);
    expect(pool.diagnostics().leases).toBe(2);

    primary.release();
    expect(image.close).not.toHaveBeenCalled();
    expect(pool.diagnostics().leases).toBe(1);
    retained.release();
    retained.release();
    expect(image.close).toHaveBeenCalledOnce();
    expect(pool.diagnostics()).toMatchObject({
      leases: 0,
      lifecycle: {
        acquireCalls: 1,
        retainCalls: 2,
        decodeStarts: 1,
        leasesCreated: 2,
        leasesReleased: 2,
        peakLeases: 2,
      },
    });
  });

  it("coalesces a same-ID decode and closes only after the last idempotent lease release", async () => {
    const atlas = descriptor("core-a");
    const pending = deferred<{ readonly bitmap: ImageBitmap; readonly compressedBytes: number }>();
    const decode: SharedAtlasDecoder = vi.fn(() => pending.promise);
    const pool = createSharedAtlasPool({ manifest: manifestWith([atlas]), decode });

    const firstAcquire = pool.acquire(atlas.id);
    const secondAcquire = pool.acquire(atlas.id);
    const image = bitmap();
    pending.resolve({ bitmap: image, compressedBytes: atlas.compressedBytes });
    const [first, second] = await Promise.all([firstAcquire, secondAcquire]);

    expect(decode).toHaveBeenCalledOnce();
    expect(first.value).toBe(image);
    expect(second.value).toBe(image);
    expect(pool.diagnostics().leases).toBe(2);
    first.release();
    first.release();
    expect(image.close).not.toHaveBeenCalled();
    expect(pool.diagnostics().leases).toBe(1);
    second.release();
    expect(image.close).toHaveBeenCalledOnce();
    expect(pool.diagnostics()).toMatchObject({ leases: 0, compressedBytes: 0, decodedBytes: 0 });
  });

  it("aborts one waiter independently while the surviving waiter receives the shared decode", async () => {
    const atlas = descriptor("core-a");
    const pending = deferred<{ readonly bitmap: ImageBitmap; readonly compressedBytes: number }>();
    let sharedSignal!: AbortSignal;
    const decode: SharedAtlasDecoder = vi.fn((_descriptor, signal) => {
      sharedSignal = signal;
      return pending.promise;
    });
    const pool = createSharedAtlasPool({ manifest: manifestWith([atlas]), decode });
    const controller = new AbortController();

    const abandoned = pool.acquire(atlas.id, controller.signal);
    const survivor = pool.acquire(atlas.id);
    controller.abort();

    await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
    expect(sharedSignal.aborted).toBe(false);
    const image = bitmap();
    pending.resolve({ bitmap: image, compressedBytes: atlas.compressedBytes });
    const lease = await survivor;
    expect(lease.value).toBe(image);
    expect(decode).toHaveBeenCalledOnce();
    lease.release();
  });

  it("aborts the shared decode once after all waiters leave and closes a late result once", async () => {
    const atlas = descriptor("core-a");
    const pending = deferred<{ readonly bitmap: ImageBitmap; readonly compressedBytes: number }>();
    const sharedAbort = vi.fn();
    const decode: SharedAtlasDecoder = (
      _descriptor: ProductionAtlasDescriptor,
      signal: AbortSignal,
    ) => {
      signal.addEventListener("abort", sharedAbort, { once: true });
      return pending.promise;
    };
    const pool = createSharedAtlasPool({ manifest: manifestWith([atlas]), decode });
    const first = new AbortController();
    const second = new AbortController();
    const firstAcquire = pool.acquire(atlas.id, first.signal);
    const secondAcquire = pool.acquire(atlas.id, second.signal);

    first.abort();
    second.abort();
    await Promise.allSettled([firstAcquire, secondAcquire]);
    expect(sharedAbort).toHaveBeenCalledOnce();

    const image = bitmap();
    pending.resolve({ bitmap: image, compressedBytes: atlas.compressedBytes });
    await Promise.resolve();
    await Promise.resolve();
    expect(image.close).toHaveBeenCalledOnce();
    expect(pool.diagnostics()).toMatchObject({ leases: 0, waiterCount: 0, inFlightCount: 0 });
  });

  it("evicts a failed entry so a later acquire retries cleanly", async () => {
    const atlas = descriptor("core-a");
    const image = bitmap();
    const decode: SharedAtlasDecoder = vi.fn()
      .mockRejectedValueOnce(new Error("decode failed"))
      .mockResolvedValueOnce({ bitmap: image, compressedBytes: atlas.compressedBytes });
    const pool = createSharedAtlasPool({ manifest: manifestWith([atlas]), decode });

    await expect(pool.acquire(atlas.id)).rejects.toThrow("decode failed");
    const lease = await pool.acquire(atlas.id);
    expect(decode).toHaveBeenCalledTimes(2);
    lease.release();
  });

  it.each([
    {
      label: "bitmap geometry",
      atlas: descriptor("core-a"),
      image: () => bitmap(7, 4),
      compressedBytes: 40,
      code: "geometry-mismatch",
    },
    {
      label: "descriptor decoded bytes",
      atlas: descriptor("core-a", { decodedBytes: 127 }),
      image: () => bitmap(),
      compressedBytes: 40,
      code: "decoded-size-mismatch",
    },
    {
      label: "compressed bytes",
      atlas: descriptor("core-a"),
      image: () => bitmap(),
      compressedBytes: 39,
      code: "compressed-size-mismatch",
    },
  ])("rejects $label drift and closes the unowned bitmap", async ({ atlas, image, compressedBytes, code }) => {
    const decoded = image();
    const pool = createSharedAtlasPool({
      manifest: manifestWith([atlas]),
      decode: async () => ({ bitmap: decoded, compressedBytes }),
    });

    await expect(pool.acquire(atlas.id)).rejects.toMatchObject({
      name: "SharedAtlasPoolError",
      code,
    });
    expect(decoded.close).toHaveBeenCalledOnce();
    expect(pool.diagnostics()).toMatchObject({ leases: 0, compressedBytes: 0, decodedBytes: 0 });
  });

  it("accounts for UI and metadata once, rejects a distinct over-budget ID before decode, and does not double-count coalesced waiters", async () => {
    const cap = PRODUCTION_ASSET_MANIFEST.budgets.activeCompressedMax;
    const first = descriptor("core-a", { compressedBytes: cap - 17 - 23 });
    const second = descriptor("core-b", { compressedBytes: 1 });
    const pending = deferred<{ readonly bitmap: ImageBitmap; readonly compressedBytes: number }>();
    const decode: SharedAtlasDecoder = vi.fn(() => pending.promise);
    const pool = createSharedAtlasPool({ manifest: manifestWith([first, second]), decode });

    const one = pool.acquire(first.id);
    const two = pool.acquire(first.id);
    expect(pool.diagnostics()).toMatchObject({
      expectedActiveCompressedBytes: cap,
      activeCompressedMax: cap,
      overBudget: false,
      inFlightCount: 1,
      waiterCount: 2,
    });
    await expect(pool.acquire(second.id)).rejects.toMatchObject({
      name: "SharedAtlasPoolError",
      code: "active-budget-exceeded",
    });
    expect(decode).toHaveBeenCalledOnce();

    const image = bitmap();
    pending.resolve({ bitmap: image, compressedBytes: first.compressedBytes });
    const leases = await Promise.all([one, two]);
    leases.forEach((lease: ProductionAssetLease<ImageBitmap>) => lease.release());
  });

  it("reports detached frozen loading and resident diagnostics with exact bytes", async () => {
    const atlas = descriptor("worn", {
      group: "region",
      regionKit: "worn-heartland",
      compressedBytes: 41,
    });
    const pending = deferred<{ readonly bitmap: ImageBitmap; readonly compressedBytes: number }>();
    const pool = createSharedAtlasPool({
      manifest: manifestWith([atlas]),
      decode: () => pending.promise,
    });
    const acquire = pool.acquire(atlas.id);

    const loading = pool.diagnostics();
    expect(loading).toMatchObject({
      compressedBytes: 0,
      decodedBytes: 0,
      leases: 0,
      expectedActiveCompressedBytes: 17 + 29 + 41,
      inFlightCount: 1,
      waiterCount: 1,
      activeAtlasIds: [atlas.id],
      entries: [{ id: atlas.id, state: "loading", actualCompressedBytes: 0 }],
    });
    expect(Object.isFrozen(loading)).toBe(true);
    expect(Object.isFrozen(loading.entries)).toBe(true);
    expect(Object.isFrozen(loading.entries[0])).toBe(true);

    const image = bitmap();
    pending.resolve({ bitmap: image, compressedBytes: atlas.compressedBytes });
    const lease = await acquire;
    expect(pool.diagnostics()).toMatchObject({
      compressedBytes: 41,
      decodedBytes: 128,
      leases: 1,
      inFlightCount: 0,
      waiterCount: 0,
      entries: [{ id: atlas.id, state: "ready", actualDecodedBytes: 128 }],
    });
    lease.release();
  });

  it("disposes loading and leased entries exactly once and never reinstalls late results", async () => {
    const loadingAtlas = descriptor("loading");
    const readyAtlas = descriptor("ready");
    const pending = deferred<{ readonly bitmap: ImageBitmap; readonly compressedBytes: number }>();
    const readyImage = bitmap();
    const decode: SharedAtlasDecoder = (atlas: ProductionAtlasDescriptor) => atlas.id === readyAtlas.id
      ? Promise.resolve({ bitmap: readyImage, compressedBytes: atlas.compressedBytes })
      : pending.promise;
    const pool = createSharedAtlasPool({ manifest: manifestWith([loadingAtlas, readyAtlas]), decode });
    const ready = await pool.acquire(readyAtlas.id);
    const loading = pool.acquire(loadingAtlas.id);

    pool.dispose();
    pool.dispose();
    ready.release();
    ready.release();
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    expect(readyImage.close).toHaveBeenCalledOnce();

    const lateImage = bitmap();
    pending.resolve({ bitmap: lateImage, compressedBytes: loadingAtlas.compressedBytes });
    await Promise.resolve();
    await Promise.resolve();
    expect(lateImage.close).toHaveBeenCalledOnce();
    expect(pool.diagnostics()).toMatchObject({
      disposed: true,
      leases: 0,
      compressedBytes: 0,
      decodedBytes: 0,
      activeAtlasIds: [],
    });
    await expect(pool.acquire(readyAtlas.id)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects unknown IDs without invoking the decoder", async () => {
    const decode: SharedAtlasDecoder = vi.fn();
    const pool = createSharedAtlasPool({ manifest: manifestWith([]), decode });

    await expect(pool.acquire("foreign-atlas")).rejects.toMatchObject({
      name: "SharedAtlasPoolError",
      code: "unknown-atlas",
    });
    expect(decode).not.toHaveBeenCalled();
  });
});
