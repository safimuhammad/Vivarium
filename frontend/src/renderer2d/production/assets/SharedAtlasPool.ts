import {
  PRODUCTION_ASSET_MANIFEST,
  type ProductionAssetLease,
  type ProductionAssetManifest,
  type ProductionAtlasDescriptor,
} from "./productionManifest";

export interface SharedAtlasDecodeResult {
  readonly bitmap: ImageBitmap;
  readonly compressedBytes: number;
}

export type SharedAtlasDecoder = (
  descriptor: ProductionAtlasDescriptor,
  signal: AbortSignal,
) => Promise<SharedAtlasDecodeResult>;

export interface SharedAtlasEntryDiagnostics {
  readonly id: string;
  readonly state: "loading" | "ready";
  readonly waiterCount: number;
  readonly leaseCount: number;
  readonly expectedCompressedBytes: number;
  readonly actualCompressedBytes: number;
  readonly expectedDecodedBytes: number;
  readonly actualDecodedBytes: number;
}

export interface SharedAtlasPoolDiagnostics {
  readonly disposed: boolean;
  readonly compressedBytes: number;
  readonly decodedBytes: number;
  readonly leases: number;
  readonly expectedActiveCompressedBytes: number;
  readonly activeCompressedMax: number;
  readonly currentUiCompressedBytes: number;
  readonly overBudget: boolean;
  readonly inFlightCount: number;
  readonly waiterCount: number;
  readonly closeCount: number;
  readonly abortCount: number;
  readonly failureCount: number;
  readonly activeAtlasIds: readonly string[];
  readonly entries: readonly SharedAtlasEntryDiagnostics[];
  readonly lifecycle: Readonly<{
    acquireCalls: number;
    retainCalls: number;
    decodeStarts: number;
    leasesCreated: number;
    leasesReleased: number;
    peakLeases: number;
  }>;
}

export interface SharedAtlasPool {
  acquire(id: string, signal?: AbortSignal): Promise<ProductionAssetLease<ImageBitmap>>;
  retain(id: string): ProductionAssetLease<ImageBitmap>;
  diagnostics(): SharedAtlasPoolDiagnostics;
  dispose(): void;
}

export type SharedAtlasPoolErrorCode =
  | "unknown-atlas"
  | "active-budget-exceeded"
  | "geometry-mismatch"
  | "compressed-size-mismatch"
  | "decoded-size-mismatch"
  | "not-ready"
  | "load-failed";

export class SharedAtlasPoolError extends Error {
  constructor(
    readonly code: SharedAtlasPoolErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "SharedAtlasPoolError";
  }
}

interface Waiter {
  active: boolean;
  readonly resolve: (lease: ProductionAssetLease<ImageBitmap>) => void;
  readonly reject: (reason: unknown) => void;
  cleanup(): void;
}

interface AtlasEntry {
  readonly descriptor: ProductionAtlasDescriptor;
  readonly controller: AbortController;
  readonly waiters: Set<Waiter>;
  state: "loading" | "ready";
  bitmap: ImageBitmap | null;
  actualCompressedBytes: number;
  leases: number;
  cancelled: boolean;
  bitmapClosed: boolean;
}

const abortError = (): DOMException => new DOMException("Aborted", "AbortError");

const defaultDecode: SharedAtlasDecoder = async (descriptor, signal) => {
  try {
    const response = await fetch(descriptor.url.href, { signal });
    if (!response.ok) {
      throw new SharedAtlasPoolError(
        "load-failed",
        `Failed to load ${descriptor.id}: HTTP ${response.status}.`,
      );
    }
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    if (signal.aborted) {
      bitmap.close();
      throw abortError();
    }
    return { bitmap, compressedBytes: blob.size };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof SharedAtlasPoolError) throw error;
    throw new SharedAtlasPoolError(
      "load-failed",
      `Failed to load ${descriptor.id}.`,
      { cause: error },
    );
  }
};

/** Creates one ref-counted pool for production atlas bitmaps. */
export function createSharedAtlasPool(options: {
  readonly manifest?: ProductionAssetManifest;
  readonly decode?: SharedAtlasDecoder;
} = {}): SharedAtlasPool {
  const manifest = options.manifest ?? PRODUCTION_ASSET_MANIFEST;
  const decode = options.decode ?? defaultDecode;
  const entries = new Map<string, AtlasEntry>();
  let disposed = false;
  let closeCount = 0;
  let abortCount = 0;
  let failureCount = 0;
  let acquireCalls = 0;
  let retainCalls = 0;
  let decodeStarts = 0;
  let leasesCreated = 0;
  let leasesReleased = 0;
  let peakLeases = 0;

  const removeIfCurrent = (entry: AtlasEntry): void => {
    if (entries.get(entry.descriptor.id) === entry) entries.delete(entry.descriptor.id);
  };

  const closeBitmap = (entry: AtlasEntry): void => {
    if (entry.bitmap === null || entry.bitmapClosed) return;
    entry.bitmapClosed = true;
    entry.bitmap.close();
    entry.bitmap = null;
    closeCount += 1;
  };

  const abortEntry = (entry: AtlasEntry): void => {
    if (entry.controller.signal.aborted) return;
    entry.controller.abort();
    abortCount += 1;
  };

  const cancelUnowned = (entry: AtlasEntry): void => {
    if (entry.waiters.size !== 0 || entry.leases !== 0) return;
    entry.cancelled = true;
    abortEntry(entry);
    closeBitmap(entry);
    removeIfCurrent(entry);
  };

  const rejectWaiters = (entry: AtlasEntry, reason: unknown): void => {
    const waiters = [...entry.waiters];
    entry.waiters.clear();
    for (const waiter of waiters) {
      if (!waiter.active) continue;
      waiter.active = false;
      waiter.cleanup();
      waiter.reject(reason);
    }
  };

  const activeExpectedBytes = (
    additional: ProductionAtlasDescriptor | null = null,
  ): number => {
    const descriptors = new Map<string, ProductionAtlasDescriptor>();
    for (const entry of entries.values()) descriptors.set(entry.descriptor.id, entry.descriptor);
    if (additional !== null) descriptors.set(additional.id, additional);

    let total = manifest.budgets.currentUiCompressedBytes;
    let hasCore = false;
    const regionKits = new Set<NonNullable<ProductionAtlasDescriptor["regionKit"]>>();
    for (const descriptor of descriptors.values()) {
      total += descriptor.compressedBytes;
      if (descriptor.group === "core") hasCore = true;
      else if (descriptor.regionKit !== null) regionKits.add(descriptor.regionKit);
    }
    if (hasCore) total += manifest.budgets.coreMetadataCompressedBytes;
    for (const kit of regionKits) total += manifest.budgets.regionMetadataCompressedBytes[kit];
    return total;
  };

  const validateDecoded = (
    descriptor: ProductionAtlasDescriptor,
    result: SharedAtlasDecodeResult,
  ): SharedAtlasPoolError | null => {
    const { bitmap, compressedBytes } = result;
    if (!Number.isSafeInteger(bitmap.width) || !Number.isSafeInteger(bitmap.height)
      || bitmap.width !== descriptor.width || bitmap.height !== descriptor.height) {
      return new SharedAtlasPoolError(
        "geometry-mismatch",
        `${descriptor.id} decoded at ${bitmap.width}x${bitmap.height}; expected ${descriptor.width}x${descriptor.height}.`,
      );
    }
    const actualDecodedBytes = bitmap.width * bitmap.height * 4;
    if (!Number.isSafeInteger(descriptor.decodedBytes)
      || descriptor.decodedBytes < 0
      || actualDecodedBytes !== descriptor.decodedBytes) {
      return new SharedAtlasPoolError(
        "decoded-size-mismatch",
        `${descriptor.id} decoded to ${actualDecodedBytes} bytes; expected ${descriptor.decodedBytes}.`,
      );
    }
    if (!Number.isSafeInteger(compressedBytes)
      || compressedBytes < 0
      || compressedBytes !== descriptor.compressedBytes) {
      return new SharedAtlasPoolError(
        "compressed-size-mismatch",
        `${descriptor.id} loaded ${compressedBytes} compressed bytes; expected ${descriptor.compressedBytes}.`,
      );
    }
    return null;
  };

  const lease = (entry: AtlasEntry): ProductionAssetLease<ImageBitmap> => {
    const bitmap = entry.bitmap;
    if (bitmap === null) throw new Error(`Atlas ${entry.descriptor.id} is not ready.`);
    entry.leases += 1;
    leasesCreated += 1;
    peakLeases = Math.max(peakLeases, leasesCreated - leasesReleased);
    let released = false;
    return Object.freeze({
      value: bitmap,
      release(): void {
        if (released) return;
        released = true;
        if (entry.cancelled || entry.leases === 0) return;
        entry.leases -= 1;
        leasesReleased += 1;
        cancelUnowned(entry);
      },
    });
  };

  const start = (descriptor: ProductionAtlasDescriptor): AtlasEntry => {
    decodeStarts += 1;
    const entry: AtlasEntry = {
      descriptor,
      controller: new AbortController(),
      waiters: new Set(),
      state: "loading",
      bitmap: null,
      actualCompressedBytes: 0,
      leases: 0,
      cancelled: false,
      bitmapClosed: false,
    };
    entries.set(descriptor.id, entry);

    void decode(descriptor, entry.controller.signal).then((result) => {
      if (disposed || entry.cancelled || entries.get(descriptor.id) !== entry) {
        result.bitmap.close();
        closeCount += 1;
        rejectWaiters(entry, abortError());
        return;
      }
      const validationError = validateDecoded(descriptor, result);
      if (validationError !== null) {
        result.bitmap.close();
        closeCount += 1;
        failureCount += 1;
        entry.cancelled = true;
        removeIfCurrent(entry);
        rejectWaiters(entry, validationError);
        return;
      }

      entry.bitmap = result.bitmap;
      entry.bitmapClosed = false;
      entry.actualCompressedBytes = result.compressedBytes;
      entry.state = "ready";
      const waiters = [...entry.waiters];
      entry.waiters.clear();
      for (const waiter of waiters) {
        if (!waiter.active) continue;
        waiter.active = false;
        waiter.cleanup();
        waiter.resolve(lease(entry));
      }
      cancelUnowned(entry);
    }).catch((error: unknown) => {
      if (entries.get(descriptor.id) !== entry) return;
      removeIfCurrent(entry);
      entry.cancelled = true;
      if (!(error instanceof DOMException && error.name === "AbortError")) failureCount += 1;
      rejectWaiters(entry, error);
    });
    return entry;
  };

  const acquire = (
    id: string,
    signal?: AbortSignal,
  ): Promise<ProductionAssetLease<ImageBitmap>> => {
    acquireCalls += 1;
    if (disposed || signal?.aborted) return Promise.reject(abortError());
    const descriptor = manifest.atlases[id];
    if (descriptor === undefined) {
      return Promise.reject(new SharedAtlasPoolError("unknown-atlas", `Unknown production atlas ${id}.`));
    }

    let entry = entries.get(id);
    if (entry === undefined) {
      const projectedBytes = activeExpectedBytes(descriptor);
      if (projectedBytes > manifest.budgets.activeCompressedMax) {
        return Promise.reject(new SharedAtlasPoolError(
          "active-budget-exceeded",
          `Loading ${id} would use ${projectedBytes} compressed bytes; cap is ${manifest.budgets.activeCompressedMax}.`,
        ));
      }
      entry = start(descriptor);
    }
    if (entry.bitmap !== null) return Promise.resolve(lease(entry));

    const ownedEntry = entry;
    return new Promise((resolve, reject) => {
      let onAbort: (() => void) | null = null;
      const waiter: Waiter = {
        active: true,
        resolve,
        reject,
        cleanup(): void {
          if (onAbort !== null && signal !== undefined) {
            signal.removeEventListener("abort", onAbort);
          }
        },
      };
      onAbort = (): void => {
        if (!waiter.active) return;
        waiter.active = false;
        waiter.cleanup();
        ownedEntry.waiters.delete(waiter);
        reject(abortError());
        cancelUnowned(ownedEntry);
      };
      if (signal !== undefined) signal.addEventListener("abort", onAbort, { once: true });
      ownedEntry.waiters.add(waiter);
    });
  };

  const retain = (id: string): ProductionAssetLease<ImageBitmap> => {
    retainCalls += 1;
    if (disposed) throw abortError();
    if (manifest.atlases[id] === undefined) {
      throw new SharedAtlasPoolError("unknown-atlas", `Unknown production atlas ${id}.`);
    }
    const entry = entries.get(id);
    if (entry === undefined || entry.state !== "ready" || entry.bitmap === null) {
      throw new SharedAtlasPoolError("not-ready", `Production atlas ${id} is not ready to retain.`);
    }
    return lease(entry);
  };

  const diagnostics = (): SharedAtlasPoolDiagnostics => {
    let compressedBytes = 0;
    let decodedBytes = 0;
    let leases = 0;
    let inFlightCount = 0;
    let waiterCount = 0;
    const rows: SharedAtlasEntryDiagnostics[] = [];
    for (const entry of entries.values()) {
      const actualDecodedBytes = entry.bitmap === null
        ? 0
        : entry.bitmap.width * entry.bitmap.height * 4;
      if (entry.state === "loading") inFlightCount += 1;
      compressedBytes += entry.bitmap === null ? 0 : entry.actualCompressedBytes;
      decodedBytes += actualDecodedBytes;
      leases += entry.leases;
      waiterCount += entry.waiters.size;
      rows.push({
        id: entry.descriptor.id,
        state: entry.state,
        waiterCount: entry.waiters.size,
        leaseCount: entry.leases,
        expectedCompressedBytes: entry.descriptor.compressedBytes,
        actualCompressedBytes: entry.bitmap === null ? 0 : entry.actualCompressedBytes,
        expectedDecodedBytes: entry.descriptor.decodedBytes,
        actualDecodedBytes,
      });
    }
    rows.sort((left, right) => left.id.localeCompare(right.id));
    const expectedActiveCompressedBytes = activeExpectedBytes();
    return deepFreeze({
      disposed,
      compressedBytes,
      decodedBytes,
      leases,
      expectedActiveCompressedBytes,
      activeCompressedMax: manifest.budgets.activeCompressedMax,
      currentUiCompressedBytes: manifest.budgets.currentUiCompressedBytes,
      overBudget: expectedActiveCompressedBytes > manifest.budgets.activeCompressedMax,
      inFlightCount,
      waiterCount,
      closeCount,
      abortCount,
      failureCount,
      activeAtlasIds: rows.map(({ id }) => id),
      entries: rows,
      lifecycle: {
        acquireCalls,
        retainCalls,
        decodeStarts,
        leasesCreated,
        leasesReleased,
        peakLeases,
      },
    });
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const entry of entries.values()) {
      entry.cancelled = true;
      abortEntry(entry);
      closeBitmap(entry);
      leasesReleased += entry.leases;
      entry.leases = 0;
      rejectWaiters(entry, abortError());
    }
    entries.clear();
  };

  return Object.freeze({ acquire, retain, diagnostics, dispose });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
