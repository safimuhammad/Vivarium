import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_REGION_SNAPSHOTS,
  createRegionSnapshotCache,
  type RegionSnapshotBitmap,
} from "./regionSnapshotCache";

function fakeBitmap(label: string): RegionSnapshotBitmap {
  // A plain stand-in satisfying the CanvasImageSource-shaped field without needing a real
  // canvas -- this module never draws into or reads pixels from `source`, it only stores and
  // returns the reference, so any distinguishable object is a valid fixture here.
  return { source: { label } as unknown as CanvasImageSource, widthPx: 320, heightPx: 240 };
}

describe("createRegionSnapshotCache", () => {
  it("returns null from get/peek for a region never stored", () => {
    const cache = createRegionSnapshotCache();
    expect(cache.get("nirvana", "sig-1")).toBeNull();
    expect(cache.peek("nirvana")).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("stores and retrieves a bitmap by matching signature", () => {
    const cache = createRegionSnapshotCache();
    const bitmap = fakeBitmap("a");
    cache.set("nirvana", "sig-1", bitmap);
    expect(cache.get("nirvana", "sig-1")).toEqual(bitmap);
    expect(cache.size).toBe(1);
  });

  it("get() misses (returns null) when the signature no longer matches", () => {
    const cache = createRegionSnapshotCache();
    cache.set("nirvana", "sig-1", fakeBitmap("a"));
    expect(cache.get("nirvana", "sig-2")).toBeNull();
  });

  it("peek() returns the stored bitmap regardless of signature, for stale-but-drawable fallback", () => {
    const cache = createRegionSnapshotCache();
    const bitmap = fakeBitmap("a");
    cache.set("nirvana", "sig-1", bitmap);
    // Signature changed upstream (e.g. a home was built) but no fresh bitmap has been built yet;
    // the caller should still be able to draw the stale one rather than nothing.
    expect(cache.peek("nirvana")).toEqual(bitmap);
  });

  it("set() overwrites the prior bitmap and signature for the same region", () => {
    const cache = createRegionSnapshotCache();
    cache.set("nirvana", "sig-1", fakeBitmap("a"));
    const replacement = fakeBitmap("b");
    cache.set("nirvana", "sig-2", replacement);
    expect(cache.get("nirvana", "sig-2")).toEqual(replacement);
    expect(cache.size).toBe(1);
  });

  it("delete() removes a region's entry", () => {
    const cache = createRegionSnapshotCache();
    cache.set("nirvana", "sig-1", fakeBitmap("a"));
    cache.delete("nirvana");
    expect(cache.peek("nirvana")).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("delete() on a region never stored is a no-op", () => {
    const cache = createRegionSnapshotCache();
    expect(() => cache.delete("nowhere")).not.toThrow();
    expect(cache.size).toBe(0);
  });

  it("is bounded: exceeding maxEntries evicts the least-recently-touched region", () => {
    const cache = createRegionSnapshotCache(2);
    cache.set("a", "sig", fakeBitmap("a"));
    cache.set("b", "sig", fakeBitmap("b"));
    cache.set("c", "sig", fakeBitmap("c"));
    expect(cache.size).toBe(2);
    expect(cache.peek("a")).toBeNull();
    expect(cache.peek("b")).not.toBeNull();
    expect(cache.peek("c")).not.toBeNull();
  });

  it("a successful get() refreshes recency, protecting the region from the next eviction", () => {
    const cache = createRegionSnapshotCache(2);
    cache.set("a", "sig", fakeBitmap("a"));
    cache.set("b", "sig", fakeBitmap("b"));
    // Touch "a" so "b" becomes the least-recently-used entry.
    expect(cache.get("a", "sig")).not.toBeNull();
    cache.set("c", "sig", fakeBitmap("c"));
    expect(cache.peek("a")).not.toBeNull();
    expect(cache.peek("b")).toBeNull();
    expect(cache.peek("c")).not.toBeNull();
  });

  it("re-setting an existing region does not itself trigger eviction of another region", () => {
    const cache = createRegionSnapshotCache(2);
    cache.set("a", "sig-1", fakeBitmap("a"));
    cache.set("b", "sig-1", fakeBitmap("b"));
    cache.set("a", "sig-2", fakeBitmap("a2"));
    expect(cache.size).toBe(2);
    expect(cache.peek("b")).not.toBeNull();
  });

  it("exposes maxEntries and defaults to DEFAULT_MAX_REGION_SNAPSHOTS", () => {
    const cache = createRegionSnapshotCache();
    expect(cache.maxEntries).toBe(DEFAULT_MAX_REGION_SNAPSHOTS);
    expect(createRegionSnapshotCache(9).maxEntries).toBe(9);
  });

  it("rejects a non-positive or non-integer maxEntries", () => {
    expect(() => createRegionSnapshotCache(0)).toThrow(RangeError);
    expect(() => createRegionSnapshotCache(-1)).toThrow(RangeError);
    expect(() => createRegionSnapshotCache(1.5)).toThrow(RangeError);
  });
});

describe("createRegionSnapshotCache onEvicted", () => {
  it("fires when set() overwrites an existing region's bitmap", () => {
    const evicted: Array<[string, RegionSnapshotBitmap]> = [];
    const cache = createRegionSnapshotCache(5, (regionId, bitmap) => evicted.push([regionId, bitmap]));
    const first = fakeBitmap("a");
    cache.set("nirvana", "sig-1", first);
    const second = fakeBitmap("b");
    cache.set("nirvana", "sig-2", second);
    expect(evicted).toEqual([["nirvana", first]]);
  });

  it("does not fire on the first set() for a region (nothing prior to evict)", () => {
    const evicted: Array<[string, RegionSnapshotBitmap]> = [];
    const cache = createRegionSnapshotCache(5, (regionId, bitmap) => evicted.push([regionId, bitmap]));
    cache.set("nirvana", "sig-1", fakeBitmap("a"));
    expect(evicted).toEqual([]);
  });

  it("fires when delete() removes a stored region", () => {
    const evicted: Array<[string, RegionSnapshotBitmap]> = [];
    const cache = createRegionSnapshotCache(5, (regionId, bitmap) => evicted.push([regionId, bitmap]));
    const bitmap = fakeBitmap("a");
    cache.set("nirvana", "sig-1", bitmap);
    cache.delete("nirvana");
    expect(evicted).toEqual([["nirvana", bitmap]]);
  });

  it("does not fire when delete() targets a region never stored", () => {
    const evicted: Array<[string, RegionSnapshotBitmap]> = [];
    const cache = createRegionSnapshotCache(5, (regionId, bitmap) => evicted.push([regionId, bitmap]));
    cache.delete("nowhere");
    expect(evicted).toEqual([]);
  });

  it("fires for the region dropped by LRU overflow", () => {
    const evicted: Array<[string, RegionSnapshotBitmap]> = [];
    const cache = createRegionSnapshotCache(2, (regionId, bitmap) => evicted.push([regionId, bitmap]));
    const a = fakeBitmap("a");
    cache.set("a", "sig", a);
    cache.set("b", "sig", fakeBitmap("b"));
    cache.set("c", "sig", fakeBitmap("c"));
    expect(evicted).toEqual([["a", a]]);
  });
});
