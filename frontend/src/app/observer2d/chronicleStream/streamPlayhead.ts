/**
 * The viewer's playhead over the bounded buffer — the livestream (DVR) model.
 *
 * The simulation only ever runs forward; the **viewer** is what moves. Events
 * already received sit in `streamBuffer`, the playhead reads over them, and LIVE
 * is a **jump** back to the leading edge rather than a fast-forward — exactly a
 * livestream's DVR window.
 *
 * Everything here is pure. The component owns one small piece of state (the
 * seek: where the viewer jumped to, and when) and derives the rest each frame,
 * so behind-live playback is "the seek plus real elapsed time", which behaves
 * identically in a live run and in a chronicle replay.
 */

/** Where the viewer jumped to, and the feed-clock instant they jumped. */
export interface StreamSeek {
  /** Feed-clock position the viewer asked for, in milliseconds. */
  readonly toMs: number;
  /** Feed-clock instant at which the jump was made. */
  readonly atMs: number;
}

/** The resolved playhead, ready to render. */
export interface StreamPlayheadState {
  /** Where the viewer is reading, feed-clock milliseconds. */
  readonly nowMs: number;
  /** The leading edge — where the world has actually got to. */
  readonly liveMs: number;
  /** How far behind the edge the viewer is. Zero at the edge. */
  readonly behindMs: number;
  readonly atLive: boolean;
  /** Retention window; events older than `liveMs - bufferMs` are gone. */
  readonly bufferMs: number;
  /** The oldest feed-clock instant still held. Seeking clamps here. */
  readonly floorMs: number;
  /** True when the playhead is sitting on the buffer floor. */
  readonly atFloor: boolean;
}

export interface ResolveStreamPlayheadInput {
  /** The active seek, or null when the viewer is riding the live edge. */
  readonly seek: StreamSeek | null;
  /** Feed-clock "now" — used to play forward from a seek in real time. */
  readonly clockMs: number;
  readonly liveMs: number;
  readonly floorMs: number;
  readonly bufferMs: number;
}

/**
 * Resolves the playhead for one render.
 *
 * A seek plays **forward** from where it landed at real speed; when it reaches
 * the live edge it snaps to live, so a viewer who rewinds and waits is returned
 * to the present rather than left stranded one frame behind it forever.
 */
export function resolveStreamPlayhead(
  input: ResolveStreamPlayheadInput,
): StreamPlayheadState {
  const { seek, clockMs, liveMs, floorMs, bufferMs } = input;
  const base = Object.freeze({ liveMs, bufferMs, floorMs });
  if (seek === null) {
    return Object.freeze({
      ...base,
      nowMs: liveMs,
      behindMs: 0,
      atLive: true,
      atFloor: false,
    });
  }
  const played = seek.toMs + Math.max(0, clockMs - seek.atMs);
  const clamped = Math.min(liveMs, Math.max(floorMs, played));
  const atLive = clamped >= liveMs;
  return Object.freeze({
    ...base,
    nowMs: clamped,
    behindMs: atLive ? 0 : liveMs - clamped,
    atLive,
    atFloor: !atLive && clamped <= floorMs,
  });
}

/** `m:ss.d` on the feed clock — the timestamp column's format. */
export function formatFeedTime(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}
