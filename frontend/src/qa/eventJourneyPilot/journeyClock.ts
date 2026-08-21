/**
 * The pilot's transport: a scrubbable journey clock over a scheduled stream.
 *
 * The fixtures carry only three distinct wall timestamps across 37 entries, so
 * they encode no pacing. *Pacing is the experiment*: the same real events, in
 * their true emission order, delivered either as a **burst** (many events across
 * several regions inside a couple of seconds — where a complete feed drowns) or
 * a **lull** (long quiet stretches — where a curated feed can feel dead). The
 * schedule is deterministic per stream and condition, so two directions viewed
 * back to back see the identical arrival pattern.
 */

import { useEffect, useRef, useState } from "react";
import type { JourneyCondition, JourneyEvent, JourneyStream } from "./journeyTypes";

/** Deterministic 32-bit LCG so a schedule is identical on every open. */
function makeRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const LEAD_IN_MS = 900;
/** Journey ms held after the last event so the tail can be watched. */
export const TAIL_MS = 6_000;

/**
 * Burst: tight clumps of 6-11 events at 90-190ms, separated by ~1.6-2.5s of
 * quiet. This is what four regions breathing concurrently looks like once the
 * beings are no longer taking polite turns.
 */
function burstSchedule(events: readonly JourneyEvent[], seed: number): number[] {
  const random = makeRandom(seed);
  const out: number[] = [];
  let at = LEAD_IN_MS;
  let remainingInClump = 0;
  for (let index = 0; index < events.length; index += 1) {
    if (remainingInClump === 0) {
      if (index > 0) at += 1_600 + random() * 900;
      remainingInClump = 6 + Math.floor(random() * 6);
    } else {
      at += 90 + random() * 100;
    }
    remainingInClump -= 1;
    out.push(Math.round(at));
  }
  return out;
}

/**
 * Lull: 2.2-3.6s between events with a ~7.5s dead stretch every seventh, so the
 * viewer genuinely experiences nothing happening.
 */
function lullSchedule(events: readonly JourneyEvent[], seed: number): number[] {
  const random = makeRandom(seed ^ 0x5f3a);
  const out: number[] = [];
  let at = LEAD_IN_MS;
  for (let index = 0; index < events.length; index += 1) {
    if (index > 0) {
      at += index % 7 === 0 ? 7_500 + random() * 1_500 : 2_200 + random() * 1_400;
    }
    out.push(Math.round(at));
  }
  return out;
}

export interface ScheduledStream {
  readonly stream: JourneyStream;
  readonly condition: JourneyCondition;
  readonly events: readonly JourneyEvent[];
  readonly durationMs: number;
}

/** Apply a condition's pacing to a loaded stream. */
export function scheduleStream(
  stream: JourneyStream,
  condition: JourneyCondition,
): ScheduledStream {
  const seed = stream.id === "C18" ? 30_018 : 30_019;
  const times =
    condition === "burst"
      ? burstSchedule(stream.events, seed)
      : lullSchedule(stream.events, seed);
  const events = stream.events.map((event, index) => ({
    ...event,
    atMs: times[index] ?? 0,
  }));
  const last = events.length === 0 ? 0 : (events[events.length - 1]?.atMs ?? 0);
  return { stream, condition, events, durationMs: last + TAIL_MS };
}

export const JOURNEY_SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;
export type JourneySpeed = (typeof JOURNEY_SPEEDS)[number];

export interface JourneyClockState {
  readonly nowMs: number;
  readonly playing: boolean;
  readonly speed: JourneySpeed;
  /** True while the viewer is deliberately not watching. */
  readonly away: boolean;
  /** Journey ms at which the viewer last had eyes on the surface, or null. */
  readonly lastSeenMs: number | null;
  /** Journey ms at which they came back, or null once the marker has aged out. */
  readonly returnedAtMs: number | null;
}

export interface JourneyClock extends JourneyClockState {
  play(): void;
  pause(): void;
  toggle(): void;
  seek(ms: number): void;
  restart(): void;
  setSpeed(speed: JourneySpeed): void;
  /** Look away for a stretch of journey time, then come back. */
  lookAway(journeyMs: number): void;
  /**
   * Place the clock as if the viewer had just returned from `journeyMs` away —
   * the catch-up state, without waiting for it. Used to capture stills.
   */
  simulateReturn(journeyMs: number): void;
}

/** How long the "while you were away" marker stays after returning, journey ms. */
const RETURN_MARKER_MS = 14_000;

/**
 * A rAF-driven journey clock with scrub, speed, and a look-away affordance.
 *
 * `initial` seeds the clock so a deep link (`?at=…&paused=1`) lands exactly on
 * the frame it names; the reset-on-`resetKey` effect deliberately skips its own
 * first run so it cannot stamp on that seed.
 */
export function useJourneyClock(
  durationMs: number,
  resetKey: string,
  initial?: Partial<JourneyClockState>,
): JourneyClock {
  const [state, setState] = useState<JourneyClockState>({
    nowMs: 0,
    playing: true,
    speed: 1,
    away: false,
    lastSeenMs: null,
    returnedAtMs: null,
    ...initial,
  });
  const awayUntil = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const previous = useRef<number | null>(null);
  const seenKey = useRef<string>(resetKey);

  useEffect(() => {
    if (seenKey.current === resetKey) return;
    seenKey.current = resetKey;
    setState((current) => ({
      ...current,
      nowMs: 0,
      away: false,
      lastSeenMs: null,
      returnedAtMs: null,
      playing: true,
    }));
    awayUntil.current = null;
    previous.current = null;
  }, [resetKey]);

  useEffect(() => {
    const step = (timestamp: number): void => {
      frame.current = requestAnimationFrame(step);
      const last = previous.current;
      previous.current = timestamp;
      if (last === null) return;
      const realDelta = Math.min(120, timestamp - last);
      setState((current) => {
        if (!current.playing) return current;
        const next = Math.min(durationMs, current.nowMs + realDelta * current.speed);
        let away = current.away;
        let returnedAtMs = current.returnedAtMs;
        const until = awayUntil.current;
        if (away && until !== null && next >= until) {
          away = false;
          awayUntil.current = null;
          returnedAtMs = next;
        }
        if (
          returnedAtMs !== null
          && !away
          && next - returnedAtMs > RETURN_MARKER_MS
        ) {
          returnedAtMs = null;
        }
        if (next === current.nowMs && away === current.away && returnedAtMs === current.returnedAtMs) {
          return current;
        }
        return { ...current, nowMs: next, away, returnedAtMs };
      });
    };
    frame.current = requestAnimationFrame(step);
    return (): void => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      previous.current = null;
    };
  }, [durationMs]);

  return {
    ...state,
    play: (): void => setState((c) => ({ ...c, playing: true })),
    pause: (): void => setState((c) => ({ ...c, playing: false })),
    toggle: (): void => setState((c) => ({ ...c, playing: !c.playing })),
    seek: (ms: number): void =>
      setState((c) => ({
        ...c,
        nowMs: Math.max(0, Math.min(durationMs, ms)),
        away: false,
        lastSeenMs: null,
        returnedAtMs: null,
      })),
    restart: (): void => {
      awayUntil.current = null;
      setState((c) => ({
        ...c,
        nowMs: 0,
        playing: true,
        away: false,
        lastSeenMs: null,
        returnedAtMs: null,
      }));
    },
    setSpeed: (speed: JourneySpeed): void => setState((c) => ({ ...c, speed })),
    simulateReturn: (journeyMs: number): void => {
      awayUntil.current = null;
      setState((c) => ({
        ...c,
        away: false,
        lastSeenMs: Math.max(0, c.nowMs - journeyMs),
        returnedAtMs: c.nowMs,
      }));
    },
    lookAway: (journeyMs: number): void =>
      setState((c) => {
        awayUntil.current = c.nowMs + journeyMs;
        return {
          ...c,
          playing: true,
          away: true,
          lastSeenMs: c.nowMs,
          returnedAtMs: null,
        };
      }),
  };
}

/** Events delivered at or before `nowMs`, in emission order. */
export function deliveredThrough(
  events: readonly JourneyEvent[],
  nowMs: number,
): readonly JourneyEvent[] {
  let count = 0;
  while (count < events.length && (events[count]?.atMs ?? Infinity) <= nowMs) count += 1;
  return events.slice(0, count);
}
