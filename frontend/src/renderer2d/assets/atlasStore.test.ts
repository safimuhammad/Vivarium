import { describe, expect, it, vi } from "vitest";

import { createSpriteAtlasStore, type AtlasDecoder } from "./atlasStore";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const bitmap = () => ({ width: 64, height: 32, close: vi.fn() }) as unknown as ImageBitmap;

describe("SpriteAtlasStore", () => {
  it("shares an in-flight load and closes only after the last idempotent release", async () => {
    const pending = deferred<{ bitmap: ImageBitmap; compressedBytes: number }>();
    const decode: AtlasDecoder = vi.fn(() => pending.promise);
    const store = createSpriteAtlasStore({ decode });
    const first = store.acquire("human-body");
    const second = store.acquire("human-body");
    const image = bitmap();
    pending.resolve({ bitmap: image, compressedBytes: 123 });
    const [a, b] = await Promise.all([first, second]);
    expect(decode).toHaveBeenCalledTimes(1);
    a.release(); a.release();
    expect(image.close).not.toHaveBeenCalled();
    b.release();
    expect(image.close).toHaveBeenCalledTimes(1);
  });

  it("aborting one caller does not cancel another", async () => {
    const pending = deferred<{ bitmap: ImageBitmap; compressedBytes: number }>();
    const decode: AtlasDecoder = vi.fn(() => pending.promise);
    const store = createSpriteAtlasStore({ decode });
    const controller = new AbortController();
    const one = store.acquire("human-face", controller.signal);
    const two = store.acquire("human-face");
    controller.abort();
    await expect(one).rejects.toMatchObject({ name: "AbortError" });
    const image = bitmap(); pending.resolve({ bitmap: image, compressedBytes: 12 });
    const lease = await two;
    expect(image.close).not.toHaveBeenCalled();
    lease.release();
  });

  it("all callers abort cancels the entry", async () => {
    const aborted = vi.fn();
    const decode: AtlasDecoder = (_id, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted(); reject(new DOMException("Aborted", "AbortError")); });
    });
    const store = createSpriteAtlasStore({ decode });
    const a = new AbortController(); const b = new AbortController();
    const pa = store.acquire("human-held", a.signal); const pb = store.acquire("human-held", b.signal);
    a.abort(); b.abort();
    await Promise.allSettled([pa, pb]);
    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it("retries failed loads and acquire after close creates a new entry", async () => {
    const firstImage = bitmap(); const secondImage = bitmap();
    const decode = vi.fn()
      .mockRejectedValueOnce(new Error("decode"))
      .mockResolvedValueOnce({ bitmap: firstImage, compressedBytes: 1 })
      .mockResolvedValueOnce({ bitmap: secondImage, compressedBytes: 1 });
    const store = createSpriteAtlasStore({ decode });
    await expect(store.acquire("shelter")).rejects.toThrow("decode");
    const first = await store.acquire("shelter"); first.release();
    const second = await store.acquire("shelter"); second.release();
    expect(decode).toHaveBeenCalledTimes(3);
  });

  it("dispose during decode leaves no bitmap or lease", async () => {
    const pending = deferred<{ bitmap: ImageBitmap; compressedBytes: number }>();
    const image = bitmap();
    const store = createSpriteAtlasStore({ decode: () => pending.promise });
    const acquired = store.acquire("nirvana-tiles");
    store.dispose();
    pending.resolve({ bitmap: image, compressedBytes: 40 });
    await expect(acquired).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    expect(image.close).toHaveBeenCalledTimes(1);
    expect(store.diagnostics().leaseCount).toBe(0);
  });

  it("dispose with active leases closes the bitmap exactly once even after releases", async () => {
    const image = bitmap();
    const store = createSpriteAtlasStore({ decode: async () => ({ bitmap: image, compressedBytes: 8 }) });
    const first = await store.acquire("human-body");
    const second = await store.acquire("human-body");
    store.dispose();
    first.release(); second.release(); first.release();
    expect(image.close).toHaveBeenCalledTimes(1);
    expect(store.diagnostics().leaseCount).toBe(0);
  });

  it("all waiters abort and a decoder that resolves late closes once without a lease", async () => {
    const pending = deferred<{ bitmap: ImageBitmap; compressedBytes: number }>();
    const image = bitmap();
    const store = createSpriteAtlasStore({ decode: () => pending.promise });
    const a = new AbortController(); const b = new AbortController();
    const pa = store.acquire("human-face", a.signal); const pb = store.acquire("human-face", b.signal);
    a.abort(); b.abort();
    await Promise.allSettled([pa, pb]);
    pending.resolve({ bitmap: image, compressedBytes: 5 });
    await Promise.resolve(); await Promise.resolve();
    expect(image.close).toHaveBeenCalledTimes(1);
    expect(store.diagnostics().leaseCount).toBe(0);
  });
});
