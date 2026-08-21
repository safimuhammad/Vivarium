/**
 * Remembers whether the viewer keeps the killfeed open.
 *
 * The feed is closable on purpose — the region is the main course — so the one
 * thing it must not do is force the viewer to reopen it on every load. The
 * preference is *only* written when the viewer acts: an untouched install still
 * starts with the world uncluttered, and the collapsed peek is what tells them
 * something is happening.
 *
 * Storage failures (private browsing, a full quota, a disabled store) are not
 * errors worth surfacing to a viewer watching a world; they degrade to the
 * default rather than throwing.
 */

const STORAGE_KEY = "vivarium.observer.chronicle-open";

/** Reads the remembered preference; false when unset or unreadable. */
export function readChronicleSurfacePreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
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
