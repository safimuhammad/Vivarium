/**
 * The comparison harness.
 *
 * Five directions for the live event journey, over identical real data, under
 * two conditions, with a real transport. The point of the harness is that the
 * only thing changing when you flip a switch is the *reading* — the stream, the
 * order, the pacing and the world are held constant, so a preference is a
 * preference about the design and not about the sample.
 */

import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import { JourneyGlyphSheet } from "./journeyGlyphs";
import { JourneyWorld } from "./JourneyWorld";
import { DirectionStream } from "./directionStream";
import {
  JOURNEY_SPEEDS,
  deliveredThrough,
  scheduleStream,
  useJourneyClock,
  type JourneySpeed,
} from "./journeyClock";
import { formatJourneyTime } from "./journeyNode";
import { loadJourneyStream } from "./journeyStream";
import type {
  DirectionProps,
  JourneyCondition,
  JourneyDirection,
  JourneyPlaceFocus,
  JourneyPlayhead,
  JourneyStreamId,
} from "./journeyTypes";
import "./journeyPilot.css";

interface DirectionMeta {
  readonly id: JourneyDirection;
  readonly label: string;
  readonly blurb: string;
}

/**
 * Only STREAM remains. The six comparison directions this pilot existed to weigh
 * were retired once the owner chose Stream and it was integrated into the
 * production observer as the Chronicle killfeed
 * (`src/app/observer2d/chronicleStream/`). The written comparison survives in
 * `.superpowers/sdd/event-journey-pilot-report.md`.
 */
const DIRECTIONS: readonly DirectionMeta[] = [
  {
    id: "stream",
    label: "Stream",
    blurb:
      "Complete's one ongoing stream, wearing Regions' cards. Headings and boxes tell regions apart inside the column; a rupture breaks out sideways, which costs no height. Click a card to move the playhead there; click a being to follow it.",
  },
];

const STREAMS: readonly { readonly id: JourneyStreamId; readonly label: string }[] = [
  { id: "C18", label: "C18 · grand tour" },
  { id: "C19", label: "C19 · two beings" },
];

const CONDITIONS: readonly { readonly id: JourneyCondition; readonly label: string; readonly note: string }[] = [
  { id: "burst", label: "Burst", note: "clumps of 6–11 events inside a couple of seconds, several regions at once" },
  { id: "lull", label: "Lull", note: "2–4s between events, with dead stretches of seven seconds or more" },
];

/** Look-away length, in journey ms. */
const LOOK_AWAY_MS = 22_000;

/**
 * How much already-received stream the viewer may scrub back over, journey ms.
 *
 * This world is meant to run forever, so the rewind window has to be bounded:
 * retention is minutes, not days. 90s comfortably contains either fixture, so
 * the comparison plates against Complete are like-for-like; `?buffer=8000`
 * shrinks it until the horizon bites and the floor behaviour is visible.
 */
const DEFAULT_BUFFER_MS = 90_000;

/**
 * Optional deep link, so a still can be reproduced exactly:
 * `?dir=curated&cond=burst&stream=C18&at=9000&paused=1&speed=1&focus=C18:26`.
 */
interface PilotQuery {
  readonly direction: JourneyDirection | null;
  readonly condition: JourneyCondition | null;
  readonly stream: JourneyStreamId | null;
  readonly atMs: number | null;
  readonly paused: boolean;
  readonly speed: JourneySpeed | null;
  readonly focus: string | null;
  readonly away: boolean;
  /** `?place=C18:30` frames that event's place; `?follow=wanderer_002` a being. */
  readonly place: string | null;
  readonly follow: string | null;
  /** `?live=12000` parks the leading edge ahead of the playhead, for a still. */
  readonly liveAt: number | null;
  readonly bufferMs: number;
}

function readQuery(): PilotQuery {
  const params = new URLSearchParams(window.location.search);
  const direction = params.get("dir");
  const condition = params.get("cond");
  const stream = params.get("stream");
  const at = params.get("at");
  const speed = Number(params.get("speed"));
  const live = params.get("live");
  const buffer = Number(params.get("buffer"));
  return {
    place: params.get("place"),
    follow: params.get("follow"),
    liveAt: live === null || Number.isNaN(Number(live)) ? null : Number(live),
    bufferMs: Number.isFinite(buffer) && buffer > 0 ? buffer : DEFAULT_BUFFER_MS,
    direction: DIRECTIONS.some((meta) => meta.id === direction)
      ? (direction as JourneyDirection)
      : null,
    condition: condition === "burst" || condition === "lull" ? condition : null,
    stream: stream === "C18" || stream === "C19" ? stream : null,
    atMs: at === null || Number.isNaN(Number(at)) ? null : Number(at),
    paused: params.get("paused") === "1",
    speed: JOURNEY_SPEEDS.includes(speed as JourneySpeed) ? (speed as JourneySpeed) : null,
    focus: params.get("focus"),
    away: params.get("away") === "1",
  };
}

export function EventJourneyPilot(): JSX.Element {
  const query = useMemo(readQuery, []);
  const [streamId, setStreamId] = useState<JourneyStreamId>(query.stream ?? "C18");
  const [condition, setCondition] = useState<JourneyCondition>(query.condition ?? "burst");
  const [direction, setDirection] = useState<JourneyDirection>(query.direction ?? "stream");
  const [focusEventId, setFocusEventId] = useState<string | null>(query.focus);
  const [placeFocus, setPlaceFocus] = useState<JourneyPlaceFocus | null>(null);
  const [followBeingId, setFollowBeingId] = useState<string | null>(query.follow);
  /**
   * The leading edge of the broadcast, which advances independently of where the
   * viewer is reading. Pausing the pilot pauses the broadcast too — this is a
   * replay harness, and a frozen frame has to freeze everything for a still.
   */
  const [liveMs, setLiveMs] = useState<number>(query.liveAt ?? query.atMs ?? 0);

  const stream = useMemo(() => loadJourneyStream(streamId), [streamId]);
  const scheduled = useMemo(() => scheduleStream(stream, condition), [stream, condition]);
  const clock = useJourneyClock(scheduled.durationMs, `${streamId}:${condition}`, {
    nowMs: query.atMs ?? 0,
    playing: !query.paused,
    speed: query.speed ?? 1,
    lastSeenMs: query.away ? Math.max(0, (query.atMs ?? 0) - LOOK_AWAY_MS) : null,
    returnedAtMs: query.away ? (query.atMs ?? 0) : null,
  });
  const delivered = useMemo(
    () => deliveredThrough(scheduled.events, clock.nowMs),
    [scheduled.events, clock.nowMs],
  );

  // The leading edge only ever moves forward, and never behind the playhead:
  // scrubbing ahead of live simply *is* live.
  const liveResetKey = `${streamId}:${condition}`;
  const seenLiveKey = useRef<string>(liveResetKey);
  useEffect(() => {
    // Skip the first run, or this stamps on the `?live=`/`?at=` seed the deep
    // links rely on — the same guard `useJourneyClock` needs and for the same
    // reason.
    if (seenLiveKey.current === liveResetKey) return;
    seenLiveKey.current = liveResetKey;
    setLiveMs(0);
  }, [liveResetKey]);
  useEffect(() => {
    setLiveMs((current) => Math.min(scheduled.durationMs, Math.max(current, clock.nowMs)));
  }, [clock.nowMs, scheduled.durationMs]);

  const behindMs = Math.max(0, liveMs - clock.nowMs);
  const floorMs = Math.max(0, liveMs - query.bufferMs);
  const playhead: JourneyPlayhead = {
    nowMs: clock.nowMs,
    liveMs,
    behindMs,
    atLive: behindMs < 250,
    bufferMs: query.bufferMs,
    floorMs,
    atFloor: clock.nowMs <= floorMs + 300 && floorMs > 0,
    goTo: (ms: number): void => {
      clock.seek(Math.max(floorMs, ms));
      clock.play();
    },
    goLive: (): void => {
      clock.seek(liveMs);
      clock.play();
    },
  };

  const stageRef = useRef<HTMLDivElement | null>(null);
  const deliveredCount = delivered.length;
  useEffect(() => {
    const host = stageRef.current;
    if (host === null) return;
    const pin = (): void => {
      for (const node of host.querySelectorAll<HTMLElement>('[data-scroll="bottom"]')) {
        node.scrollTop = node.scrollHeight;
      }
    };
    pin();
    const frame = requestAnimationFrame(pin);
    // Fonts and elastic lane widths settle a beat after paint; re-pin once more
    // or the newest card sits half-clipped under the lane foot.
    const settle = window.setTimeout(pin, 180);
    return (): void => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [deliveredCount, direction, condition, streamId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === " ") {
        event.preventDefault();
        clock.toggle();
      }
      if (event.key === "Escape") setFocusEventId(null);
    };
    window.addEventListener("keydown", onKey);
    return (): void => window.removeEventListener("keydown", onKey);
  });

  // `?place=C18:30` resolves once the event has been delivered, so a still can
  // be reproduced without a click.
  const linkedPlace = useMemo<JourneyPlaceFocus | null>(() => {
    if (query.place === null) return null;
    const source = scheduled.events.find((event) => event.id === query.place);
    return source === undefined
      ? null
      : { regionId: source.regionId, homeId: source.homeId, sourceEventId: source.id };
  }, [query.place, scheduled.events]);
  const activePlace = placeFocus ?? linkedPlace;

  const world = (
    <JourneyWorld
      scheduled={scheduled}
      delivered={delivered}
      nowMs={clock.nowMs}
      speed={clock.speed}
      focusEventId={focusEventId}
      onFocusEvent={setFocusEventId}
      variant={direction === "map-first" ? "stage" : "panel"}
      placeFocus={activePlace}
      followBeingId={followBeingId}
    />
  );

  const directionProps: DirectionProps = {
    stream,
    events: scheduled.events,
    delivered,
    nowMs: clock.nowMs,
    speed: clock.speed,
    condition,
    focusEventId,
    onFocusEvent: setFocusEventId,
    lastSeenMs: clock.lastSeenMs,
    returnedAtMs: clock.returnedAtMs,
    away: clock.away,
    world,
    placeFocus: activePlace,
    onFocusPlace: setPlaceFocus,
    followBeingId,
    onFollowBeing: setFollowBeingId,
    playhead,
  };

  const active = DIRECTIONS.find((meta) => meta.id === direction) ?? DIRECTIONS[0];
  const conditionMeta = CONDITIONS.find((meta) => meta.id === condition) ?? CONDITIONS[0];

  return (
    <div className="jp">
      <header className="jp__head">
        <div className="jp__brand">
          <span className="jp__mark">VIVARIUM</span>
          <span className="jp__sub">the live event journey · design pilot</span>
        </div>
        <nav className="jp__dirs" aria-label="Direction">
          {DIRECTIONS.map((meta) => (
            <button
              key={meta.id}
              type="button"
              className={`jp__dir${direction === meta.id ? " is-on" : ""}`}
              onClick={(): void => setDirection(meta.id)}
            >
              {meta.label}
            </button>
          ))}
        </nav>
        <div className="jp__switches">
          <div className="jp__group" role="group" aria-label="Condition">
            {CONDITIONS.map((meta) => (
              <button
                key={meta.id}
                type="button"
                className={`jp__pill${condition === meta.id ? " is-on" : ""}`}
                onClick={(): void => setCondition(meta.id)}
              >
                {meta.label}
              </button>
            ))}
          </div>
          <div className="jp__group" role="group" aria-label="Stream">
            {STREAMS.map((meta) => (
              <button
                key={meta.id}
                type="button"
                className={`jp__pill jp__pill--quiet${streamId === meta.id ? " is-on" : ""}`}
                onClick={(): void => setStreamId(meta.id)}
              >
                {meta.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <p className="jp__blurb">
        <b>{active?.label}</b> — {active?.blurb}
        <span className="jp__blurbCond">
          {conditionMeta?.label}: {conditionMeta?.note}
        </span>
      </p>

      <main className="jp__stage" ref={stageRef}>
        {direction === "stream" ? <DirectionStream {...directionProps} /> : null}
        {clock.away ? (
          <div className="jp__blind">
            <span>looking away…</span>
            <b>{formatJourneyTime(Math.max(0, clock.nowMs - (clock.lastSeenMs ?? 0)))}</b>
          </div>
        ) : null}
      </main>

      <footer className="jp__transport">
        <button type="button" className="jp__btn jp__btn--primary" onClick={clock.toggle}>
          {clock.playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="jp__btn" onClick={clock.restart}>
          Restart
        </button>
        <button
          type="button"
          className="jp__btn"
          onClick={(): void => clock.lookAway(LOOK_AWAY_MS)}
          disabled={clock.away}
        >
          Look away 22s
        </button>
        <input
          className="jp__scrub"
          type="range"
          min={0}
          max={Math.round(scheduled.durationMs)}
          value={Math.round(clock.nowMs)}
          step={50}
          onChange={(event): void => clock.seek(Number(event.target.value))}
          aria-label="Scrub"
        />
        <span className="jp__clock">
          {formatJourneyTime(clock.nowMs)} / {formatJourneyTime(scheduled.durationMs)}
        </span>
        <span className="jp__count">
          {delivered.length}/{scheduled.events.length}
        </span>
        <div className="jp__group" role="group" aria-label="Speed">
          {JOURNEY_SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              className={`jp__pill jp__pill--speed${clock.speed === speed ? " is-on" : ""}`}
              onClick={(): void => clock.setSpeed(speed as JourneySpeed)}
            >
              {speed}×
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}

/** Route: the pilot, or the glyph sheet at `?sheet=glyphs`. */
export function EventJourneyPilotRoute(): JSX.Element {
  const sheet = new URLSearchParams(window.location.search).get("sheet");
  if (sheet === "glyphs") return <JourneyGlyphSheet />;
  return <EventJourneyPilot />;
}
