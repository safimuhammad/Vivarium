export type SpriteAtlasId = "human-body" | "human-face" | "human-held" | "shelter" | "nirvana-tiles";
export interface AssetLease<T> { readonly value: T; release(): void }
export interface SpriteAtlasStore {
  acquire(id: SpriteAtlasId, signal?: AbortSignal): Promise<AssetLease<ImageBitmap>>;
  diagnostics(): { readonly compressedBytes: number; readonly decodedBytes: number; readonly leaseCount: number };
  dispose(): void;
}
export type AtlasDecoder = (id: SpriteAtlasId, signal: AbortSignal) => Promise<{ readonly bitmap: ImageBitmap; readonly compressedBytes: number }>;

interface Waiter { active: boolean; resolve(value: AssetLease<ImageBitmap>): void; reject(reason: unknown): void; cleanup(): void }
interface Entry {
  readonly id: SpriteAtlasId; readonly controller: AbortController; readonly waiters: Set<Waiter>;
  bitmap?: ImageBitmap; compressedBytes: number; leaseCount: number; cancelled: boolean; bitmapClosed: boolean;
}

const urls: Record<SpriteAtlasId, URL> = {
  "human-body": new URL("../../assets/renderer2d/human-body-atlas.png", import.meta.url),
  "human-face": new URL("../../assets/renderer2d/human-face-atlas.png", import.meta.url),
  "human-held": new URL("../../assets/renderer2d/human-held-atlas.png", import.meta.url),
  shelter: new URL("../../assets/renderer2d/shelter-slice-atlas.png", import.meta.url),
  "nirvana-tiles": new URL("../../assets/renderer2d/nirvana-tile-atlas.png", import.meta.url),
};
const abortError = (): DOMException => new DOMException("Aborted", "AbortError");
const defaultDecode: AtlasDecoder = async (id, signal) => {
  const response = await fetch(urls[id], { signal });
  if (!response.ok) throw new Error(`Failed to load ${id}: HTTP ${response.status}`);
  const blob = await response.blob();
  return { bitmap: await createImageBitmap(blob), compressedBytes: blob.size };
};

export function createSpriteAtlasStore(options: { readonly decode?: AtlasDecoder } = {}): SpriteAtlasStore {
  const decode = options.decode ?? defaultDecode;
  const entries = new Map<SpriteAtlasId, Entry>();
  let disposed = false;

  const removeIfCurrent = (entry: Entry): void => { if (entries.get(entry.id) === entry) entries.delete(entry.id); };
  const closeEntryBitmap = (entry: Entry): void => {
    if (entry.bitmap && !entry.bitmapClosed) { entry.bitmapClosed = true; entry.bitmap.close(); }
    entry.bitmap = undefined;
  };
  const cancelEmpty = (entry: Entry): void => {
    if (entry.waiters.size === 0 && entry.leaseCount === 0) {
      entry.cancelled = true; entry.controller.abort(); closeEntryBitmap(entry); removeIfCurrent(entry);
    }
  };
  const start = (id: SpriteAtlasId): Entry => {
    const entry: Entry = { id, controller: new AbortController(), waiters: new Set(), compressedBytes: 0, leaseCount: 0, cancelled: false, bitmapClosed: false };
    entries.set(id, entry);
    void decode(id, entry.controller.signal).then(({ bitmap, compressedBytes }) => {
      if (disposed || entry.cancelled || entries.get(id) !== entry) {
        bitmap.close();
        for (const waiter of entry.waiters) { waiter.cleanup(); waiter.reject(abortError()); }
        entry.waiters.clear(); return;
      }
      entry.bitmap = bitmap; entry.bitmapClosed = false; entry.compressedBytes = compressedBytes;
      const waiters = [...entry.waiters]; entry.waiters.clear();
      for (const waiter of waiters) {
        if (!waiter.active) continue;
        waiter.active = false; waiter.cleanup(); entry.leaseCount += 1;
        let released = false;
        waiter.resolve({ value: bitmap, release: () => {
          if (released) return; released = true;
          if (entry.cancelled) return;
          entry.leaseCount -= 1;
          if (entry.leaseCount === 0 && entry.waiters.size === 0) { closeEntryBitmap(entry); removeIfCurrent(entry); }
        } });
      }
      cancelEmpty(entry);
    }).catch((error: unknown) => {
      removeIfCurrent(entry);
      const waiters = [...entry.waiters]; entry.waiters.clear();
      for (const waiter of waiters) { if (waiter.active) { waiter.active = false; waiter.cleanup(); waiter.reject(error); } }
    });
    return entry;
  };

  return {
    acquire(id, signal) {
      if (disposed || signal?.aborted) return Promise.reject(abortError());
      const entry = entries.get(id) ?? start(id);
      if (entry.bitmap) {
        entry.leaseCount += 1; let released = false; const bitmap = entry.bitmap;
        return Promise.resolve({ value: bitmap, release: () => {
          if (released) return; released = true;
          if (entry.cancelled) return;
          entry.leaseCount -= 1;
          if (entry.leaseCount === 0) { closeEntryBitmap(entry); removeIfCurrent(entry); }
        } });
      }
      return new Promise((resolve, reject) => {
        let onAbort: (() => void) | undefined;
        const waiter: Waiter = { active: true, resolve, reject, cleanup: () => { if (onAbort && signal) signal.removeEventListener("abort", onAbort); } };
        onAbort = () => {
          if (!waiter.active) return; waiter.active = false; waiter.cleanup(); entry.waiters.delete(waiter); reject(abortError()); cancelEmpty(entry);
        };
        if (signal) signal.addEventListener("abort", onAbort, { once: true });
        entry.waiters.add(waiter);
      });
    },
    diagnostics() {
      let compressedBytes = 0; let decodedBytes = 0; let leaseCount = 0;
      for (const entry of entries.values()) { compressedBytes += entry.compressedBytes; leaseCount += entry.leaseCount; if (entry.bitmap) decodedBytes += entry.bitmap.width * entry.bitmap.height * 4; }
      return { compressedBytes, decodedBytes, leaseCount };
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const entry of entries.values()) {
        entry.cancelled = true; entry.controller.abort(); closeEntryBitmap(entry); entry.leaseCount = 0;
        for (const waiter of entry.waiters) { if (waiter.active) { waiter.active = false; waiter.cleanup(); waiter.reject(abortError()); } }
        entry.waiters.clear();
      }
      entries.clear();
    },
  };
}
