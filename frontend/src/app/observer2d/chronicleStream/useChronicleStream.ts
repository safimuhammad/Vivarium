/**
 * Owns the killfeed's buffer for as long as the observer is mounted.
 *
 * The buffer deliberately lives **above** the killfeed surface rather than
 * inside it: the feed is closable, and a viewer who closes it and reopens it
 * must not find the world's recent history erased. It also lets the collapsed
 * peek affordance report what has happened while the feed was shut.
 *
 * The hook ingests on every presented frame and ticks a coarse clock so that
 * behind-live playback, standing-condition ages and the quiet-since readout all
 * advance without depending on new events arriving.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { PresentedObserverFrame } from "../../../presentation/contracts";
import type { PresentedChronicleWindow } from "../../../presentation/selectors";
import { frameEntityIdDenylist } from "../publicCopy";
import {
  createChronicleStreamBuffer,
  DEFAULT_STREAM_BUFFER_MS,
  type ChronicleStreamBuffer,
  type StreamBufferDiagnostics,
} from "./streamBuffer";
import type { StreamEvent } from "./streamEvent";

/** How often the feed clock advances for age readouts and behind-live playback. */
export const STREAM_TICK_MS = 250;

/** Everything the killfeed surface needs about the live stream. */
export interface ChronicleStreamView {
  readonly events: readonly StreamEvent[];
  readonly liveMs: number;
  readonly floorMs: number;
  readonly clockMs: number;
  readonly evictedCount: number;
  readonly buffer: ChronicleStreamBuffer;
  readonly diagnostics: StreamBufferDiagnostics;
}

export interface UseChronicleStreamOptions {
  readonly frame: PresentedObserverFrame | null;
  readonly chronicle: PresentedChronicleWindow | null;
  /**
   * Whether the feed is on screen.
   *
   * The buffer keeps ingesting either way — closing the feed must not erase the
   * world's recent history — but the age/behind-live clock only ticks while
   * somebody is reading it. A closed feed therefore costs no repaints at all,
   * which is the point of being closable.
   */
  readonly active: boolean;
  /** Retention window override, e.g. from a `?buffer=` query parameter. */
  readonly bufferMs?: number;
  /** Monotonic clock, injected in tests. Defaults to `performance.now()`. */
  readonly now?: () => number;
  /** Tick scheduler, injected in tests. Defaults to `setInterval`. */
  readonly schedule?: (callback: () => void, intervalMs: number) => () => void;
}

/**
 * Reads the presented frame into a bounded, checkpoint-anchored killfeed buffer.
 *
 * Side effects: creates one buffer per mount, installs one interval timer, and
 * ingests on every frame change. It never mutates world state and never talks to
 * the transport.
 */
export function useChronicleStream(options: UseChronicleStreamOptions): ChronicleStreamView {
  const { frame, chronicle } = options;
  const now = options.now ?? defaultNow;
  const schedule = options.schedule ?? defaultSchedule;
  const bufferMs = options.bufferMs ?? DEFAULT_STREAM_BUFFER_MS;

  const nowRef = useRef(now);
  nowRef.current = now;
  const buffer = useMemo(
    () => createChronicleStreamBuffer({ now: () => nowRef.current(), bufferMs }),
    [bufferMs],
  );
  const [revision, setRevision] = useState(0);
  const [clockMs, setClockMs] = useState(() => now());

  useEffect(() => {
    if (!options.active) return undefined;
    const stop = schedule(() => {
      setClockMs(nowRef.current());
      // Eviction is time-based, so a quiet stretch still has to be folded in.
      setRevision((current) => current + 1);
    }, STREAM_TICK_MS);
    return stop;
  }, [options.active, schedule]);

  useEffect(() => {
    if (frame === null || chronicle === null) return;
    const entries = [
      ...(chronicle.now?.evidence ?? []),
      ...chronicle.previous.flatMap((moment) => moment.evidence),
    ];
    if (entries.length === 0 && buffer.getEvents().length > 0) return;
    buffer.ingest({
      sourceKey: frame.sourceKey,
      world: frame.world,
      entries,
      deniedIds: frameEntityIdDenylist(frame),
    });
    setClockMs(nowRef.current());
    setRevision((current) => current + 1);
  }, [buffer, chronicle, frame]);

  return useMemo(() => Object.freeze({
    events: buffer.getEvents(),
    liveMs: buffer.getLiveMs(),
    floorMs: buffer.getFloorMs(),
    clockMs,
    evictedCount: buffer.getEvictedCount(),
    buffer,
    diagnostics: buffer.diagnostics(),
  }), [buffer, clockMs, revision]);
}

function defaultNow(): number {
  return typeof performance === "object" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function defaultSchedule(callback: () => void, intervalMs: number): () => void {
  const handle = setInterval(callback, intervalMs);
  return () => clearInterval(handle);
}
