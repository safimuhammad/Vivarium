/**
 * @fileoverview Bounded, signature-invalidated bitmap cache for the world-sheet's non-focused
 * regions (Task Z3, `docs/superpowers/plans/2026-07-24-world-sheet-camera.md`).
 *
 * Stores one rendered offscreen bitmap per region id, keyed additionally by a caller-supplied
 * "signature" string -- an opaque fingerprint of whatever the caller considers "this region's
 * content" (in `CanvasPresentationRenderer`, the recipe's `identityHash` plus its home/ruin set --
 * "terrain/home/ruin mutation" per the design spec, deliberately excluding tick-by-tick agent
 * movement or resource-level changes, which are drawn as a separate live layer on top of a
 * snapshot instead of invalidating it).
 *
 * This module never renders anything and never touches a region recipe object -- it only stores
 * and returns whatever `CanvasImageSource` the caller already built. A `get()` with a signature
 * that no longer matches the stored one is a cache MISS, not an eviction: the caller decides
 * whether to keep drawing the stale bitmap via `peek()` (non-destructive: no flash of empty
 * terrain while a fresh snapshot rebuilds) or to trigger a rebuild.
 *
 * Bounded by `maxEntries` (least-recently-touched eviction, tracked via `Map` insertion order).
 * The production world has exactly four regions; the default ceiling leaves headroom for a
 * transient fifth entry during a live region hand-off (Z3's focus-follow) without evicting one of
 * the other three still-visible plots.
 */

/** One region's rendered bitmap plus the pixel size it was rendered at. */
export interface RegionSnapshotBitmap {
  readonly source: CanvasImageSource;
  readonly widthPx: number;
  readonly heightPx: number;
}

interface CacheEntry extends RegionSnapshotBitmap {
  readonly signature: string;
}

/** A bounded, per-region cache of offscreen snapshot bitmaps. */
export interface RegionSnapshotCache {
  /**
   * The bitmap currently stored for `regionId`, regardless of whether it is stale, or `null` if
   * nothing has ever been stored for that region. Does not affect eviction recency.
   */
  peek(regionId: string): RegionSnapshotBitmap | null;
  /**
   * The bitmap stored for `regionId`, but only when its stored signature exactly matches
   * `signature`; otherwise `null` (a miss). A successful hit marks the entry
   * most-recently-touched.
   */
  get(regionId: string, signature: string): RegionSnapshotBitmap | null;
  /** Stores (or replaces) `regionId`'s bitmap under `signature`, evicting the
   * least-recently-touched entry if this exceeds `maxEntries`. */
  set(regionId: string, signature: string, bitmap: RegionSnapshotBitmap): void;
  /** Removes `regionId`'s entry, if any. A no-op if nothing is stored for it. */
  delete(regionId: string): void;
  /** Current number of stored regions. */
  readonly size: number;
  /** The bound passed to {@link createRegionSnapshotCache}. */
  readonly maxEntries: number;
}

/**
 * Default eviction ceiling: the production world's four regions plus one slot of headroom for a
 * transient fifth entry while a live region hand-off is in flight.
 */
export const DEFAULT_MAX_REGION_SNAPSHOTS = 5;

function stripSignature(entry: CacheEntry): RegionSnapshotBitmap {
  return { source: entry.source, widthPx: entry.widthPx, heightPx: entry.heightPx };
}

/**
 * Called whenever a stored bitmap is displaced -- overwritten by a new `set()` for the same
 * region, removed by `delete()`, or dropped by LRU overflow -- so the caller can release the
 * bitmap's backing store (e.g. `CacheCanvasOwner.dispose()`). This module owns only the
 * reference bookkeeping; it never renders or disposes anything itself.
 */
export type RegionSnapshotEvicted = (regionId: string, bitmap: RegionSnapshotBitmap) => void;

/**
 * Creates an empty {@link RegionSnapshotCache}.
 *
 * @param maxEntries - The eviction ceiling. Defaults to {@link DEFAULT_MAX_REGION_SNAPSHOTS}.
 * @param onEvicted - Optional callback invoked once per displaced bitmap (replaced, deleted, or
 *   LRU-evicted), so the caller can dispose its backing store.
 * @returns A fresh, empty cache.
 * @throws {RangeError} If `maxEntries` is not a positive safe integer.
 */
export function createRegionSnapshotCache(
  maxEntries: number = DEFAULT_MAX_REGION_SNAPSHOTS,
  onEvicted?: RegionSnapshotEvicted,
): RegionSnapshotCache {
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    throw new RangeError(
      `RegionSnapshotCache maxEntries must be a positive safe integer, got ${maxEntries}.`,
    );
  }
  // Map iteration order is insertion order; deleting then re-setting a key moves it to the end,
  // which is exactly the recency bookkeeping an LRU eviction policy needs, with no extra list.
  const entries = new Map<string, CacheEntry>();

  function touch(regionId: string, entry: CacheEntry): void {
    entries.delete(regionId);
    entries.set(regionId, entry);
  }

  function evictOverflow(): void {
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined) return;
      const evicted = entries.get(oldestKey);
      entries.delete(oldestKey);
      if (evicted !== undefined) onEvicted?.(oldestKey, stripSignature(evicted));
    }
  }

  return {
    peek(regionId): RegionSnapshotBitmap | null {
      const entry = entries.get(regionId);
      return entry === undefined ? null : stripSignature(entry);
    },
    get(regionId, signature): RegionSnapshotBitmap | null {
      const entry = entries.get(regionId);
      if (entry === undefined || entry.signature !== signature) return null;
      touch(regionId, entry);
      return stripSignature(entry);
    },
    set(regionId, signature, bitmap): void {
      const prior = entries.get(regionId);
      touch(regionId, { ...bitmap, signature });
      if (prior !== undefined) onEvicted?.(regionId, stripSignature(prior));
      evictOverflow();
    },
    delete(regionId): void {
      const prior = entries.get(regionId);
      if (prior === undefined) return;
      entries.delete(regionId);
      onEvicted?.(regionId, stripSignature(prior));
    },
    get size(): number {
      return entries.size;
    },
    maxEntries,
  };
}
