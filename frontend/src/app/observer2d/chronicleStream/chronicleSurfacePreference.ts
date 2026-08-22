/**
 * Remembers whether the viewer keeps the killfeed open.
 *
 * **The feed now opens by default** (owner direction, Safi, 2026-08-22). It is
 * the live stream — the one surface that says what the world is doing right now
 * — and a world nobody can see running is Life with the screen off. It stays
 * closable, and a viewer who closes it still finds it closed next time; what
 * changed is only what an *untouched* install does.
 *
 * That reversal is why the key is versioned. The previous key stored `"false"`
 * for every viewer who had ever closed the old feed, and `"false"` is
 * indistinguishable from "chose closed under the new default" — a returning
 * viewer would have inherited the retired default forever. `.v2` is a fresh
 * slate: the old value is left where it lies, unread, and the first thing this
 * viewer's own choice writes is a v2 value.
 *
 * Storage failures (private browsing, a full quota, a disabled store) are not
 * errors worth surfacing to a viewer watching a world; they degrade to the
 * default rather than throwing.
 */

/**
 * Where the viewer's own choice lives.
 *
 * Versioned deliberately: see the module note. Bump it again if the default
 * ever flips back, and never re-read a retired key.
 */
const STORAGE_KEY = "vivarium.observer.chronicle-open.v2";

/** What an install that has never been touched does: show the live stream. */
const DEFAULT_OPEN = true;

/** Reads the remembered preference; open when unset, unreadable, or malformed. */
export function readChronicleSurfacePreference(): boolean {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    if (stored === "true") return true;
    if (stored === "false") return false;
    return DEFAULT_OPEN;
  } catch {
    return DEFAULT_OPEN;
  }
}

/** Records the viewer's own choice. Silently no-ops when storage is unavailable. */
export function writeChronicleSurfacePreference(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, open ? "true" : "false");
  } catch {
    // A viewer watching a world does not need to hear about storage quota.
  }
}

/**
 * Reads a `?buffer=` retention override, in milliseconds.
 *
 * The killfeed's rewind window is a real tuning dial for a world meant to run
 * forever, so it is inspectable from the address bar in exactly the way the
 * design pilot's was. Returns null for an absent, malformed or non-positive
 * value, which leaves the default in force.
 */
export function parseChronicleBufferMs(search: string): number | null {
  const raw = new URLSearchParams(search).get("buffer");
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
