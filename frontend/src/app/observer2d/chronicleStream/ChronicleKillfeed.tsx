/**
 * THE CHRONICLE KILLFEED — the live event journey, as an overlay on the world.
 *
 * Owner direction (Safi, 2026-07-30): *"Take an example from DOTA and CS, or
 * Overwatch or Call of Duty where deathmatches are happening. They just show it
 * regardless of how fast they're happening… an event appears at the bottom and
 * then gets pushed by other events to the top until it makes its way out of the
 * screen… it should not have too much real estate on the screen because the main
 * course is still the region… give it a transparent background and only cards
 * have opacity so that you can see the cards and still click and replay them."*
 *
 * Four consequences, all structural:
 *
 * 1. **No surface.** The container is fully transparent and `pointer-events:
 *    none`; only cards, chips and controls carry opacity and accept clicks. The
 *    region is visible through every gap, and a click that lands in a gap
 *    reaches the world beneath.
 * 2. **Bottom-in, pushed up, off the top.** New events enter at the bottom of a
 *    fixed band, push their elders upward, and are clipped and faded off the
 *    top. A card has a finite journey and then it is gone.
 * 3. **Everything is shown.** No salience threshold, no folding into counts, no
 *    inhibition. A burst simply moves faster. Salience decides only how much
 *    weight a card carries, never whether it appears.
 * 4. **Minimal real estate.** A modest band, closable entirely, with a collapsed
 *    peek so a viewer can watch the world uncluttered and still see that
 *    something is happening.
 *
 * What survives from the design pilot, because the owner named each as a reason
 * he chose it: the timestamp, the sentence voice, ruptures breaking the column
 * structurally, the card treatment, the burst headings, and the standing bar —
 * kept here as a slim strip above the flow, because it is the only non-decaying
 * truth on the surface and a killfeed without it is amnesiac.
 *
 * The livestream model is intact: clicking a card moves the playhead to that
 * event and plays forward from there while the world navigates to where it
 * happened; clicking a being follows them to where they are *now*; LIVE is a
 * jump back to the leading edge, never a fast-forward.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from "react";

import type {
  PresentationGap,
  PresentationNotice,
} from "../../../presentation/contracts";
import type { ObserverLivenessView } from "../observerLiveness";
import { StreamGlyph } from "./StreamGlyph";
import { chainAround, detailFor } from "./streamDetail";
import { regionTag, type StreamEvent } from "./streamEvent";
import type { ChronicleStreamBuffer, StreamPresence } from "./streamBuffer";
import { formatEventTime, formatFeedTime, resolveStreamPlayhead, type StreamSeek } from "./streamPlayhead";
import type { StandingCondition } from "./streamSalience";
import type { ChronicleStreamView } from "./useChronicleStream";

import "./ChronicleKillfeed.css";

/**
 * How many standing chips the strip shows before it collapses the rest.
 *
 * The strip is an annunciator, not a census: past about five chips it stops
 * being readable at a glance, which is the only job it has. Conditions are
 * already sorted gravest-first, so the overflow is always the least urgent.
 */
const MAX_STANDING_CHIPS = 5;

/** Burst grouping, kept verbatim from the pilot so the wording matches. */
const BURST_WINDOW_MS = 700;
const BURST_MIN = 5;
/**
 * Hard ceiling on cards in the DOM, so an 8x burst cannot grow it without bound.
 * The band normally holds far fewer — see `fittingCount`.
 */
const MAX_RENDERED_CARDS = 24;
/**
 * How long a card that has left the band survives, fading, before it is removed.
 *
 * A card used to leave by being *parked* in the flow's top gradient: it sat
 * there, half-erased and legible-but-fieldless over the world, until enough new
 * events arrived to push it out — tens of seconds at an observed rate. Read at
 * native size that is not an exit, it is a broken card. The band now shows only
 * cards that FIT, and the one that no longer does gets a bounded exit instead.
 */
const CARD_EXIT_MS = 280;
/** The playhead lands slightly before the event, so you see it *arrive*. */
const PREROLL_MS = 900;

/** The Chronicle lens chosen by the reader. World is always the complete feed. */
export type ChronicleFeedFilter = "world" | "nearby" | "following";

export interface ChronicleKillfeedProps {
  readonly stream: ChronicleStreamView;
  /** Ranges the viewer did not see, offered to the Archive. */
  readonly gaps: readonly PresentationGap[];
  /** Presentation transport state, shared with the World drawer's controls. */
  readonly paused: boolean;
  readonly speed: 0.5 | 1 | 1.5 | 2;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onSpeedChange: (speed: 0.5 | 1 | 1.5 | 2) => void;
  /** Navigates the world to the moment that carries this cursor. */
  readonly onViewCursor: (cursor: number) => void;
  /** A restored archive owns its own playhead; do not apply the prior feed seek again. */
  readonly historicalSourceKey?: string | null;
  /** Returns the world, as well as its feed, to the current observation. */
  readonly onReturnLive?: () => void;
  /** Selects and frames one being on the world. */
  readonly onFocusBeing: (beingId: string) => void;
  readonly onOpenArchive: (gap: { readonly firstCursor: number; readonly lastCursor: number }) => void;
  readonly onClose: () => void;
  /**
   * Route-local controls folded into the feed's transport cluster. The QA
   * chronicle route passes its chronicle picker and review controls here so the
   * old full-width bottom bar has nowhere left to be.
   */
  readonly sourceControls?: ReactNode;
  /**
   * The reading lens. Omitting it preserves the complete World feed for older
   * callers; providing it makes the tabs controlled by the observer shell.
   */
  readonly filter?: ChronicleFeedFilter;
  readonly onFilterChange?: (filter: ChronicleFeedFilter) => void;
  /** Region the observer is currently looking at, for the Nearby lens. */
  readonly nearbyRegionId?: string | null;
  /** Being the observer is currently pursuing, for the Following lens. */
  readonly followingBeingId?: string | null;
  /** Releases the observer's real camera pursuit when the reader offers Stop following. */
  readonly onStopFollowing?: () => void;
  /** Camera controls shared with the world surface, placed beside the filters. */
  readonly cameraControls?: ReactNode;
  /**
   * How the world itself is doing, as opposed to where the playhead is.
   *
   * The pill used to read only `playhead.atLive` — a position in the buffer. It
   * therefore said LIVE over a finished run, a dead socket and a frozen stage
   * alike, which is exactly what the live-replay route caught it doing for 150s.
   * Optional so seams that predate the reading are unaffected.
   */
  readonly liveness?: ObserverLivenessView;
  /**
   * Faults the presentation absorbed and a watcher must still be told about.
   *
   * A silent zero is the worst failure mode a live view has.
   */
  readonly notices?: readonly PresentationNotice[];
  /** Offered when the liveness reading says a reconnect is worth trying. */
  readonly onReconnect?: () => void;
  /**
   * The cursor range of the moment the world is playing RIGHT NOW.
   *
   * The feed used to run beside a separate bottom-right NOW card that named the
   * current moment and carried the only "View moment" button. Two surfaces, one
   * job, and they collided (owner direction, Safi, 2026-08-22: *"remove this
   * 'View latest moment' card because it collides with the live stream… just
   * consolidate into one UI instead of two confusing ones"*). The card is gone
   * and the feed took the job: the newest entry is marked as the leading edge,
   * and this range is what decides whether that edge is a moment still playing
   * (**Now**) or the last one that finished (**Latest**).
   *
   * `null` when no moment is active, which is the ordinary quiet case.
   */
  readonly activeMomentRange?: Readonly<{
    readonly firstCursor: number;
    readonly lastCursor: number;
  }> | null;
}

type FlowItem =
  | Readonly<{ kind: "burst"; key: string; count: number; spanMs: number; regions: readonly string[] }>
  | Readonly<{ kind: "card"; key: string; event: StreamEvent }>;

/** Splits the visible run into burst headings and cards, preserving order. */
export function buildFlowItems(events: readonly StreamEvent[]): readonly FlowItem[] {
  const items: FlowItem[] = [];
  let index = 0;
  while (index < events.length) {
    let end = index + 1;
    while (
      end < events.length
      && (events[end]?.atMs ?? Infinity) - (events[end - 1]?.atMs ?? 0) <= BURST_WINDOW_MS / 2
    ) {
      end += 1;
    }
    const run = events.slice(index, end);
    if (run.length >= BURST_MIN) {
      const first = run[0]!;
      items.push(Object.freeze({
        kind: "burst",
        key: `burst-${first.id}`,
        count: run.length,
        spanMs: Math.max(0, (run.at(-1)?.atMs ?? 0) - first.atMs),
        regions: Object.freeze([...new Set(run.map((event) => regionTag(event.regionId)))]),
      }));
    }
    for (const event of run) items.push(Object.freeze({ kind: "card", key: event.id, event }));
    index = end;
  }
  return Object.freeze(items);
}

/**
 * How many of the newest items fit inside the band, measured from the bottom up.
 *
 * The flow is bottom-anchored, so the last item is always whole and each earlier
 * one is kept only while the whole of it still fits. At least one item is always
 * returned: a band too short for even one card should show one clipped card
 * rather than nothing. A zero or unknown height (jsdom does no layout, and the
 * band is unmeasurable while closed) yields `max`, which is the pre-measurement
 * behaviour and never hides anything.
 *
 * @param heights Rendered heights, oldest first, including the gaps between them.
 * @param flowHeight The band's inner height in the same units.
 * @param max The DOM ceiling, never exceeded.
 */
export function fittingCount(
  heights: readonly number[],
  flowHeight: number,
  max: number,
): number {
  if (!Number.isFinite(flowHeight) || flowHeight <= 0) return max;
  let used = 0;
  let count = 0;
  for (let index = heights.length - 1; index >= 0; index -= 1) {
    used += Math.max(0, heights[index] ?? 0);
    if (used > flowHeight && count > 0) break;
    count += 1;
    if (count >= max) break;
  }
  return Math.max(1, count);
}

/**
 * Selects a reader lens without changing the chronological order or the source
 * buffer. A missing Nearby/Following context intentionally yields no events:
 * inventing a region or person would make the filter lie.
 */
export function eventsForChronicleFilter(
  events: readonly StreamEvent[],
  filter: ChronicleFeedFilter,
  nearbyRegionId: string | null | undefined,
  followingBeingId: string | null | undefined,
): readonly StreamEvent[] {
  switch (filter) {
    case "nearby":
      return nearbyRegionId === null || nearbyRegionId === undefined
        ? []
        : events.filter((event) => event.regionId === nearbyRegionId);
    case "following":
      return followingBeingId === null || followingBeingId === undefined
        ? []
        : events.filter((event) => event.participants.includes(followingBeingId));
    case "world":
      return events;
  }
}

/** Whether a reader has scrolled close enough to the newest retained card. */
export function isNearChronicleEnd(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  tolerance = 20,
): boolean {
  return scrollHeight - clientHeight - scrollTop <= tolerance;
}

/**
 * Splits the flow into the cards that fit and the ones on their way out.
 *
 * The measurement is deliberately **feedback-free**: everything the buffer
 * offers stays in the DOM until its exit has finished, so the heights read back
 * are the heights of the whole run rather than of the window the last
 * measurement chose. Measuring only what is currently shown makes the window a
 * function of itself, and such a window can only ever shrink.
 *
 * Side effects: reads layout from `flowRef` after every commit, and holds one
 * timer per departure for `CARD_EXIT_MS`.
 */
function useFittedFlow(
  flowRef: RefObject<HTMLOListElement | null>,
  items: readonly FlowItem[],
): Readonly<{ shown: readonly FlowItem[]; leaving: readonly FlowItem[] }> {
  const [fits, setFits] = useState(MAX_RENDERED_CARDS);
  const [retired, setRetired] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const measuredHeight = useRef(0);

  const live = useMemo(() => {
    const kept = items.filter((item) => !retired.has(item.key));
    // A rewind re-derives the feed from an older cursor, so every key on screen
    // can be one this feed has already retired. Start it over rather than show
    // an empty band. (The other way the set can go stale — the band growing
    // room back — is handled on resize in the measurement effect, which cannot
    // oscillate the way a size-derived condition here would.)
    return kept.length === 0 ? items : kept;
  }, [items, retired]);

  const shown = useMemo(() => live.slice(-fits), [live, fits]);
  const leaving = useMemo(() => live.slice(0, Math.max(0, live.length - fits)), [live, fits]);

  useLayoutEffect(() => {
    const flow = flowRef.current;
    if (flow === null) return;
    const gap = Number.parseFloat(getComputedStyle(flow).rowGap);
    const heights = [...flow.children]
      .filter((child): child is HTMLElement => child instanceof HTMLElement)
      .map((child) => child.offsetHeight + (Number.isFinite(gap) ? gap : 0));
    const height = flow.clientHeight;
    const next = fittingCount(heights, height, MAX_RENDERED_CARDS);
    setFits((current) => (current === next ? current : next));
    // A band that has grown — the viewport was resized taller — has room for
    // cards it retired while it was short. Retirement is otherwise permanent,
    // which is what keeps this from oscillating: only a real size increase
    // revives anything.
    if (height > measuredHeight.current) {
      measuredHeight.current = height;
      setRetired((current) => (current.size === 0 ? current : new Set()));
    } else if (height < measuredHeight.current) {
      measuredHeight.current = height;
    }
  });

  // Keyed by identity, not by array: the buffer hands back a fresh `items`
  // array on every 250ms clock tick, and an effect that restarted on that would
  // reset the exit timer forever and never retire anything.
  const leavingKey = leaving.map((item) => item.key).join("|");
  const offeredRef = useRef(items);
  offeredRef.current = items;
  useEffect(() => {
    if (leavingKey === "") return undefined;
    const going = leavingKey.split("|");
    const handle = setTimeout(() => {
      timers.current.delete(handle);
      setRetired((current) => {
        const next = new Set(current);
        for (const key of going) next.add(key);
        // Bounded: only keys the buffer still offers are worth remembering.
        const offered = new Set(offeredRef.current.map((item) => item.key));
        for (const key of next) if (!offered.has(key)) next.delete(key);
        return next;
      });
    }, CARD_EXIT_MS);
    timers.current.add(handle);
    return () => {
      timers.current.delete(handle);
      clearTimeout(handle);
    };
  }, [leavingKey]);

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const handle of held) clearTimeout(handle);
      held.clear();
    };
  }, []);

  return useMemo(() => Object.freeze({ shown, leaving }), [shown, leaving]);
}

/** Where inside the region it happened. Never invented — read from the event. */
function placeWithin(event: StreamEvent, presence: StreamPresence): string | null {
  if (event.homeId === null) return null;
  if (presence.ruined.has(event.homeId)) return "at the ruin";
  switch (event.type) {
    case "hearth_used": return "at the hearth";
    case "home_started_hoarding":
    case "home_thieved": return "at the vault";
    case "ruins_scavenged": return "at the ruin";
    case "home_collapsed": return "where the home stood";
    default: return "at the home";
  }
}

/** Where a being is *now*, or why they cannot be followed. */
export function beingNow(
  beingId: string,
  presence: StreamPresence,
  nameOf: (id: string) => string,
): Readonly<{ line: string; reachable: boolean }> {
  const name = nameOf(beingId);
  const regionId = presence.region.get(beingId) ?? null;
  const where = regionId === null ? "an unknown place" : titleCase(regionId);
  if (presence.absent.has(beingId)) {
    return Object.freeze({
      line: `${name} has returned to the earth. There is no one to follow — `
        + `this is where they last stood, at ${where}.`,
      reachable: false,
    });
  }
  if (presence.gone.has(beingId)) {
    return Object.freeze({
      line: `${name}'s body lies at ${where}. There is no present being to follow.`,
      reachable: false,
    });
  }
  if (regionId === null) {
    return Object.freeze({
      line: `${name}'s current place is unknown. Replay the event to revisit it.`,
      reachable: false,
    });
  }
  return Object.freeze({ line: `${name} is at ${where} now.`, reachable: true });
}

function titleCase(id: string): string {
  return id
    .split(/[_-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** The killfeed overlay. */
export function ChronicleKillfeed(props: ChronicleKillfeedProps): JSX.Element {
  const { stream } = props;
  const [seek, setSeek] = useState<StreamSeek | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [localFollowBeingId, setLocalFollowBeingId] = useState<string | null>(null);
  const [localFilter, setLocalFilter] = useState<ChronicleFeedFilter>("world");
  const [autoScrollPaused, setAutoScrollPaused] = useState(false);
  const readerRef = useRef<HTMLDivElement | null>(null);
  const historicalSourceKey = props.historicalSourceKey ?? null;
  const historical = historicalSourceKey !== null;
  useEffect(() => {
    setSeek(null);
    setDetailId(null);
    setAutoScrollPaused(false);
  }, [historicalSourceKey]);
  const followBeingId = props.followingBeingId === undefined
    ? localFollowBeingId
    : props.followingBeingId;
  const followIsControlled = props.followingBeingId !== undefined;
  const canStopFollowing = !followIsControlled || props.onStopFollowing !== undefined;

  const playhead = resolveStreamPlayhead({
    seek,
    clockMs: stream.clockMs,
    liveMs: stream.liveMs,
    floorMs: stream.floorMs,
    bufferMs: stream.diagnostics.bufferMs,
  });

  const throughCursor = playhead.atLive
    ? (stream.events.at(-1)?.cursor ?? 0)
    : stream.buffer.cursorAt(playhead.nowMs);
  const delivered = useMemo(
    () => stream.events.filter((event) => event.cursor <= throughCursor),
    [stream.events, throughCursor],
  );
  const filter = props.filter ?? localFilter;
  const filtered = useMemo(
    () => eventsForChronicleFilter(
      delivered,
      filter,
      props.nearbyRegionId,
      followBeingId,
    ),
    [delivered, filter, props.nearbyRegionId, followBeingId],
  );
  const presence = useMemo(
    () => stream.buffer.derivePresence(throughCursor),
    [stream.buffer, throughCursor],
  );
  const standing = useMemo(
    () => stream.buffer.deriveStanding(throughCursor),
    [stream.buffer, throughCursor],
  );
  const items = useMemo(() => buildFlowItems(filtered), [filtered]);
  const ahead = stream.events.length - delivered.length;
  const openDetail = detailId === null
    ? null
    : filtered.find((event) => event.id === detailId) ?? null;
  const quietMs = delivered.length === 0
    ? null
    : playhead.nowMs - (delivered.at(-1)?.atMs ?? 0);
  const livenessState = props.liveness?.state ?? "live";
  const livenessLabel = props.liveness?.label ?? "Live";
  const livenessDetail = props.liveness?.detail ?? "Watching the world as it happens.";
  const feedCount = filter === "world" ? delivered.length : filtered.length;
  const feedCountLabel = filter === "world" ? "recent" : "matching";

  /**
   * The one card that is the present tense, and what to call it.
   *
   * Only while the playhead is at the leading edge: once a viewer has rewound,
   * the newest card on screen is a card they chose to look at, not the world's
   * current moment, and the "Behind live" banner already owns that state. A
   * badge saying NOW over a rewound feed would be a lie.
   */
  const newest = playhead.atLive && filter === "world" ? delivered.at(-1) ?? null : null;
  const activeRange = props.activeMomentRange ?? null;
  const leadingEdge: Readonly<{ id: string; label: "Now" | "Latest" }> | null = newest === null
    ? null
    : Object.freeze({
        id: newest.id,
        label: activeRange !== null
          && activeRange.firstCursor <= newest.cursor
          && newest.cursor <= activeRange.lastCursor
          ? "Now"
          : "Latest",
      });

  const goLive = (): void => {
    setSeek(null);
    if (historical) props.onReturnLive?.();
  };
  const chooseFilter = (next: ChronicleFeedFilter): void => {
    if (props.filter === undefined) setLocalFilter(next);
    props.onFilterChange?.(next);
    setAutoScrollPaused(false);
    setDetailId(null);
  };
  const resumeAutoScroll = (): void => {
    setAutoScrollPaused(false);
    const reader = readerRef.current;
    if (reader !== null) reader.scrollTop = reader.scrollHeight;
  };
  const openEvent = (event: StreamEvent): void => {
    // Viewing the CURRENT moment must not rewind. Every other card seeks back a
    // beat so the viewer sees the event arrive; doing that to the leading edge
    // would drop the feed 900ms behind live and hang a "Behind live" banner over
    // a viewer who only asked to look at what is happening now.
    if (historical && (
      event.type === "spatial_travel_started"
      || event.type === "spatial_travel_cancelled"
      || event.type === "spatial_travel_arrived"
    )) {
      // Replaying the same card can reuse its source key. Its fresh world
      // session supplies the clock, so never install a second local offset.
      setSeek(null);
    } else if (event.id !== leadingEdge?.id) {
      setSeek({ toMs: Math.max(stream.floorMs, event.atMs - PREROLL_MS), atMs: stream.clockMs });
    }
    props.onViewCursor(event.cursor);
  };
  const follow = (beingId: string): void => {
    if (!followIsControlled) setLocalFollowBeingId(beingId);
    props.onFocusBeing(beingId);
  };
  const stopFollowing = (): void => {
    if (followIsControlled) {
      props.onStopFollowing?.();
    } else {
      setLocalFollowBeingId(null);
    }
  };

  const lens = followBeingId === null
    ? null
    : beingNow(followBeingId, presence, (id) => stream.buffer.nameOf(id));

  // Retention can replace old cards without changing the row count. Follow
  // the actual boundaries, including when switching between equal-size views.
  const firstVisibleId = filtered[0]?.id ?? null;
  const lastVisibleId = filtered.at(-1)?.id ?? null;
  useLayoutEffect(() => {
    const reader = readerRef.current;
    if (reader !== null && !autoScrollPaused) reader.scrollTop = reader.scrollHeight;
  }, [autoScrollPaused, filtered.length, filter, firstVisibleId, lastVisibleId, followBeingId]);

  return (
    <section
      className={`observer-drawer chronicle-killfeed chronicle-killfeed--reader${playhead.atLive ? "" : " is-behind"}`}
      aria-labelledby="chronicle-drawer-heading"
    >
      <div className="chronicle-killfeed__top">
      <header className="chronicle-killfeed__head">
        <span>
          <h2 id="chronicle-drawer-heading" tabIndex={-1}>Chronicle</h2>
          <small className={`chronicle-killfeed__live-note is-${livenessState}`}>
            <i aria-hidden="true" />{livenessLabel}
          </small>
        </span>
        <button type="button" aria-label="Close Chronicle" onClick={props.onClose}>Close</button>
      </header>

      <div className="chronicle-killfeed__filters" role="tablist" aria-label="Chronicle events">
        {(["world", "nearby", "following"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={filter === option}
            className={filter === option ? "is-selected" : ""}
            onClick={() => chooseFilter(option)}
          >{option.charAt(0).toUpperCase() + option.slice(1)}</button>
        ))}
      </div>

      {props.cameraControls === undefined ? null : (
        <div className="chronicle-killfeed__camera" aria-label="Camera controls">
          {props.cameraControls}
        </div>
      )}

      <StandingStrip
        conditions={standing}
        nowMs={playhead.nowMs}
        onOpen={(condition) => {
          const source = delivered.find((event) => event.id === condition.sourceEventId);
          if (source !== undefined) openEvent(source);
        }}
      />
      </div>

      <div className="chronicle-killfeed__bottom">

      {historical ? (
        <div className="chronicle-killfeed__behind" role="status">
          <span className="chronicle-killfeed__behind-dot" aria-hidden="true" />
          <b>Recorded moment</b>
          <span>{props.paused ? "Playback paused" : "Replaying the recorded world"}</span>
          <button type="button" aria-label="Return to current view" onClick={goLive}>
            Return to current view
          </button>
        </div>
      ) : playhead.atLive ? null : (
        <div className="chronicle-killfeed__behind" role="status">
          <span className="chronicle-killfeed__behind-dot" aria-hidden="true" />
          <b>Behind live</b>
          <span>
            −{formatFeedTime(playhead.behindMs)} · {ahead} event{ahead === 1 ? "" : "s"} received since
          </span>
          <button type="button" aria-label="Go live" onClick={goLive}>Go live</button>
        </div>
      )}

      <div
        ref={readerRef}
        className="chronicle-killfeed__reader"
        data-autoscroll={autoScrollPaused ? "paused" : "on"}
        onScroll={(event) => {
          const reader = event.currentTarget;
          setAutoScrollPaused(!isNearChronicleEnd(
            reader.scrollTop,
            reader.scrollHeight,
            reader.clientHeight,
          ));
        }}
      >
      <ol className="chronicle-killfeed__flow" aria-label={`${filter} events, oldest first`}>
        {stream.evictedCount > 0 && delivered.length > 0 ? (
          <li className="chronicle-killfeed__horizon" aria-hidden="true">
            {stream.evictedCount} left the buffer · {Math.round(playhead.bufferMs / 1000)}s retained
          </li>
        ) : null}
        {filtered.length === 0 ? (
          <li className="chronicle-killfeed__quiet">{
            filter === "world"
              ? "The world is quiet."
              : filter === "nearby"
                ? props.nearbyRegionId === null || props.nearbyRegionId === undefined
                  ? "No observed region is available yet."
                  : "Nothing has happened here in the retained history."
                : followBeingId === null
                  ? "No being is being followed yet."
                  : "No retained events involve the followed being."
          }</li>
        ) : null}
        {items.map((item) => (item.kind === "burst"
          ? (
            <li
              key={item.key}
              className="chronicle-killfeed__burst"
              aria-hidden="true"
            >
              <b>{item.count}</b>
              <span>in {(item.spanMs / 1000).toFixed(1)}s</span>
              <span>{item.regions.join(" · ")}</span>
            </li>
          )
          : (
            <KillfeedCard
              key={item.key}
              event={item.event}
              leaving={false}
              leadingEdge={item.event.id === leadingEdge?.id ? leadingEdge.label : null}
              presence={presence}
              nameOf={(id) => stream.buffer.nameOf(id)}
              followBeingId={followBeingId}
              detailOpen={detailId === item.event.id}
              onOpen={openEvent}
              onFollow={follow}
              onToggleDetail={(id) => setDetailId((current) => (current === id ? null : id))}
            />
          )))}
      </ol>
      </div>

      {!historical && quietMs !== null && quietMs > 6_000 && playhead.atLive && filter === "world" ? (
        <p className="chronicle-killfeed__still">still for {formatFeedTime(quietMs)}</p>
      ) : null}

      {autoScrollPaused ? (
        <p className="chronicle-killfeed__reader-pause" role="status">
          Reading history. The world continues; new events wait below.
          <button type="button" aria-label="Resume auto-scroll" onClick={resumeAutoScroll}>
            Resume auto-scroll
          </button>
        </p>
      ) : null}

      {lens === null ? null : (
        <p className={`chronicle-killfeed__lens${lens.reachable ? "" : " is-gone"}`}>
          <span>following</span>
          {lens.line}
          {canStopFollowing ? (
            <button type="button" aria-label="Stop following" onClick={stopFollowing}>Clear</button>
          ) : null}
        </p>
      )}

      {openDetail === null ? null : (
        <DetailPanel
          event={openDetail}
          delivered={delivered}
          nameOf={(id) => stream.buffer.nameOf(id)}
          onFollow={follow}
          onClose={() => setDetailId(null)}
        />
      )}

      {props.gaps.map((gap) => (
        <p key={`${gap.firstCursor}:${gap.lastCursor}`} className="chronicle-killfeed__gap">
          <span>{gap.chapter === "while-away" ? "While you were away" : "The world moved ahead"}</span>
          <span>{gap.firstCursor === gap.lastCursor
            ? gap.firstCursor
            : `${gap.firstCursor}–${gap.lastCursor}`}</span>
          {gap.archiveAvailable ? (
            <button type="button" onClick={() => props.onOpenArchive(gap)}>Open Archive</button>
          ) : null}
        </p>
      ))}

      {props.notices === undefined || props.notices.length === 0 ? null : (
        <ul className="chronicle-killfeed__notices" role="status" aria-label="Presentation faults">
          {props.notices.map((notice) => (
            <li key={notice.kind}>
              <b>{notice.detail}</b>
              <span>
                {notice.count}×
                {notice.firstCursor === null || notice.lastCursor === null
                  ? ""
                  : notice.firstCursor === notice.lastCursor
                    ? ` · ${notice.firstCursor}`
                    : ` · ${notice.firstCursor}–${notice.lastCursor}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="chronicle-killfeed__transport">
        <button
          type="button"
          className={`chronicle-killfeed__live${
            !historical && playhead.atLive && livenessState === "live" ? " is-on" : ""
          } is-${livenessState}`}
          aria-pressed={!historical && playhead.atLive}
          aria-label={historical ? "Return from recorded history" : playhead.atLive
            ? `${livenessLabel}. ${livenessDetail}`
            : "Return to live"}
          title={livenessDetail}
          onClick={goLive}
        >
          <i aria-hidden="true" />{historical ? "Replay" : playhead.atLive ? livenessLabel : "Live"}
        </button>
        {props.liveness?.retryable === true && props.onReconnect !== undefined ? (
          <button type="button" aria-label="Reconnect now" onClick={props.onReconnect}>
            Reconnect
          </button>
        ) : null}
        <button
          type="button"
          aria-label={props.paused ? "Resume view" : "Pause view"}
          onClick={props.paused ? props.onResume : props.onPause}
        >{props.paused ? "Resume view" : "Pause view"}</button>
        <label>
          <span>View speed</span>
          <select
            aria-label="View speed"
            value={props.speed}
            onChange={(event) => props.onSpeedChange(parseSpeed(event.currentTarget.value))}
          >
            {([0.5, 1, 1.5, 2] as const).map((option) => (
              <option key={option} value={option}>{option}×</option>
            ))}
          </select>
        </label>
        <span className="chronicle-killfeed__contract">
          {feedCount} {feedCountLabel} event{feedCount === 1 ? "" : "s"}
        </span>
        {props.sourceControls}
      </div>
      </div>
    </section>
  );
}

function parseSpeed(value: string): 0.5 | 1 | 1.5 | 2 {
  const speed = Number(value);
  return speed === 0.5 || speed === 1 || speed === 1.5 || speed === 2 ? speed : 1;
}

type ChronicleCardGrammar =
  | "speech"
  | "private-thought"
  | "proposal"
  | "travel"
  | "resource"
  | "interaction"
  | "shelter"
  | "lifecycle"
  | "world";

interface QuotePresentation {
  readonly kind: "speech" | "private-thought" | "proposal" | "refusal";
  readonly label: string;
  readonly text: string;
}

interface TravelRoute {
  readonly from: string;
  readonly to: string;
  readonly state: "departed" | "walking" | "stopped" | "arrived";
}

interface LifecycleNotice {
  readonly state: "born" | "fallen" | "recovered" | "dead" | "decayed";
  readonly label: string;
}

function grammarFor(event: StreamEvent): ChronicleCardGrammar {
  switch (event.type) {
    case "speak": return "speech";
    case "self_talk": return "private-thought";
    case "mating_initiated":
    case "mating_rejected":
    case "mating_proposal_invalidated":
    case "mating_proposal_timeout": return "proposal";
    case "agent_left_region":
    case "agent_entered_region": return "travel";
    case "spatial_travel_started":
    case "spatial_travel_cancelled":
    case "spatial_travel_arrived": return "travel";
    case "resource_changed":
    case "resource_transferred":
    case "ruins_scavenged": return "resource";
    case "attack": return "interaction";
    case "home_built":
    case "hearth_used":
    case "home_joined":
    case "home_left":
    case "home_started_hoarding":
    case "home_collapsed":
    case "home_breached":
    case "home_thieved":
    case "home_colonized": return "shelter";
    case "agent_born":
    case "agent_paralyzed":
    case "agent_recovered":
    case "agent_died":
    case "agent_decayed": return "lifecycle";
    default: return "world";
  }
}

function grammarLabel(grammar: ChronicleCardGrammar, event: StreamEvent): string {
  switch (grammar) {
    case "speech": return event.targetId === null ? "Speech" : "Directed speech";
    case "private-thought": return "Private thought";
    case "proposal": return "Proposal";
    case "travel":
      if (event.type === "agent_entered_region" || event.type === "spatial_travel_arrived") {
        return "Arrival";
      }
      return event.type === "spatial_travel_cancelled" ? "At rest" : "Travel";
    case "resource": return "Resource fact";
    case "interaction": return "Interaction";
    case "shelter": return event.type === "home_built" ? "Shelter built" : "Shelter";
    case "lifecycle": return "Life cycle";
    case "world": return "World";
  }
}

function stringPayload(event: StreamEvent, key: string): string | null {
  const value = event.payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberPayload(event: StreamEvent, key: string): number | null {
  const value = event.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function displayNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return String(normalized);
}

function quotePresentationFor(event: StreamEvent): QuotePresentation | null {
  const text = event.narration.quote;
  if (text === null) return null;
  switch (event.type) {
    case "speak":
      return Object.freeze({
        kind: "speech",
        label: event.targetName === null ? "Spoken aloud" : `Spoken to ${event.targetName}`,
        text,
      });
    case "self_talk":
      return Object.freeze({ kind: "private-thought", label: "Private thought", text });
    case "mating_initiated":
      return Object.freeze({ kind: "proposal", label: "Proposal", text });
    case "mating_rejected":
      return Object.freeze({ kind: "refusal", label: "Refusal", text });
    default:
      return null;
  }
}

function travelRouteFor(event: StreamEvent): TravelRoute | null {
  if (event.type === "spatial_travel_started"
    || event.type === "spatial_travel_cancelled"
    || event.type === "spatial_travel_arrived") {
    const destination = spatialDestinationFor(event);
    if (destination === null) return null;
    return Object.freeze({
      from: event.regionLabel ?? "Nirvana",
      to: destination,
      state: event.type === "spatial_travel_started"
        ? "walking"
        : event.type === "spatial_travel_cancelled"
          ? "stopped"
          : "arrived",
    });
  }
  if (event.type !== "agent_left_region" && event.type !== "agent_entered_region") return null;
  const from = stringPayload(event, "from_region");
  const to = stringPayload(event, "to_region");
  if (from === null || to === null) return null;
  return Object.freeze({
    from: titleCase(from),
    to: titleCase(to),
    state: event.type === "agent_entered_region" ? "arrived" : "departed",
  });
}

/** Destination ids are backend keys; display only the bounded anchor form. */
function spatialDestinationFor(event: StreamEvent): string | null {
  if (typeof event.spatialDestinationLabel === "string") return event.spatialDestinationLabel;
  const destinationId = stringPayload(event, "destination_id");
  return destinationId !== null && /^[a-z][a-z0-9_-]{0,79}$/iu.test(destinationId)
    ? titleCase(destinationId)
    : null;
}

function resourceFactFor(event: StreamEvent): string | null {
  const amount = numberPayload(event, "amount");
  const resource = stringPayload(event, "resource_type");
  if (amount === null || resource === null) return null;
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${displayNumber(Math.abs(amount))} ${resource}`;
}

function shelterNoticeFor(event: StreamEvent): string | null {
  switch (event.type) {
    case "home_built": {
      const cost = numberPayload(event, "materials_cost");
      return cost === null ? "Shelter built" : `Shelter built · −${displayNumber(cost)} materials`;
    }
    case "home_collapsed": {
      const remains = numberPayload(event, "remnant_materials");
      return remains === null ? "Shelter became ruins" : `Shelter became ruins · ${displayNumber(remains)} materials remain`;
    }
    case "home_breached": return "Shelter breached";
    case "home_thieved": return "Shelter raided";
    case "home_colonized": return "Shelter claimed";
    case "hearth_used": return "Hearth used";
    case "home_joined": return "Shelter joined";
    case "home_left": return "Shelter left";
    case "home_started_hoarding": return "Shelter hoarding";
    default: return null;
  }
}

function lifecycleNoticeFor(event: StreamEvent): LifecycleNotice | null {
  switch (event.type) {
    case "agent_born": return Object.freeze({ state: "born", label: "Born" });
    case "agent_paralyzed": return Object.freeze({ state: "fallen", label: "Fallen — recoverable" });
    case "agent_recovered": return Object.freeze({ state: "recovered", label: "Recovered" });
    case "agent_died": return Object.freeze({ state: "dead", label: "Died" });
    case "agent_decayed": return Object.freeze({ state: "decayed", label: "Returned to earth" });
    default: return null;
  }
}

interface KillfeedCardProps {
  readonly event: StreamEvent;
  /** The card has left the band and is being shown out. Inert while it fades. */
  readonly leaving: boolean;
  /**
   * `"Now"` while this card belongs to the moment still playing, `"Latest"`
   * while it is the newest thing that has finished, `null` for every other card
   * and for every card once the viewer has rewound. This is the mark that
   * replaced the retired NOW panel.
   */
  readonly leadingEdge: "Now" | "Latest" | null;
  readonly presence: StreamPresence;
  readonly nameOf: (id: string) => string;
  readonly followBeingId: string | null;
  readonly detailOpen: boolean;
  readonly onOpen: (event: StreamEvent) => void;
  readonly onFollow: (beingId: string) => void;
  readonly onToggleDetail: (id: string) => void;
}

function KillfeedCard(props: KillfeedCardProps): JSX.Element {
  const { event } = props;
  const [quoteExpanded, setQuoteExpanded] = useState(false);
  const where = placeWithin(event, props.presence);
  const grammar = grammarFor(event);
  const quote = quotePresentationFor(event);
  const route = travelRouteFor(event);
  const resourceFact = resourceFactFor(event);
  const shelterNotice = shelterNoticeFor(event);
  const lifecycleNotice = lifecycleNoticeFor(event);
  const actorStatus = event.actorId === null
    ? null
    : beingNow(event.actorId, props.presence, props.nameOf);
  const meta = [
    resourceFact === null ? event.narration.detail : null,
    event.notable ? where : null,
  ].filter((part): part is string => part !== null && part.length > 0);

  return (
    <li
      className={[
        "chronicle-killfeed__card",
        `is-${event.posture}`,
        `is-${event.tier}`,
        event.notable ? "is-notable" : "",
        props.detailOpen ? "is-open" : "",
        props.leaving ? "is-leaving" : "",
        props.leadingEdge === null ? "" : "is-leading",
      ].filter((token) => token.length > 0).join(" ")}
      style={{ ["--accent" as string]: event.accent }}
      data-event-cursor={event.cursor}
      data-posture={event.posture}
      {...(props.leadingEdge === null
        ? {}
        : { "data-chronicle-now": props.leadingEdge, "aria-current": "true" as const })}
      // The whole card replays, not only its sentence: in a killfeed the card IS
      // the object a viewer aims at. The inner button remains the keyboard and
      // screen-reader path, and the two secondary controls stop propagation.
      onClick={() => props.onOpen(event)}
    >
      {event.posture === "rupture" ? (
        <span className="chronicle-killfeed__tear" aria-hidden="true" />
      ) : null}
      <header className="chronicle-killfeed__card-head">
        <span className="chronicle-killfeed__kind" data-event-grammar={grammar}>
          {grammarLabel(grammar, event)}
        </span>
        <time>{formatEventTime(event.wallTimestamp, event.atMs)}</time>
        {event.regionLabel === null ? null : <span>{event.regionLabel}</span>}
        <PortraitPair
          event={event}
          nameOf={props.nameOf}
          presence={props.presence}
          followingBeingId={props.followBeingId}
          onFollow={props.onFollow}
        />
      </header>
      <button
        type="button"
        className="chronicle-killfeed__replay"
        aria-label={props.leadingEdge === null
          ? `Replay from ${event.narration.line}`
          : `View shown moment. ${props.leadingEdge === "Now" ? "Happening now" : "The latest moment"}: `
            + event.narration.line}
        // The card around this button carries the same action, so a click here
        // would otherwise bubble into it and navigate the world twice for one
        // press. The two other in-card controls already stop propagation for
        // exactly this reason; this one was simply never noticed, because until
        // the Chronicle became the only way to view a moment nothing counted.
        onClick={(click) => {
          click.stopPropagation();
          props.onOpen(event);
        }}
      >
        {props.leadingEdge === null ? null : (
          // In the sentence row rather than pinned over it: the mark is part of
          // what the card SAYS ("now, this"), and an absolutely-placed tag would
          // have to reserve a corner of every leading card's copy to sit in.
          // The button's own label already carries the meaning, so this is ink.
          <span className="chronicle-killfeed__edge" aria-hidden="true">
            {props.leadingEdge}
          </span>
        )}
        <span className="chronicle-killfeed__medallion" aria-hidden="true">
          <StreamGlyph name={event.glyph} size={event.notable ? 13 : 11} />
        </span>
        <span className="chronicle-killfeed__line">{event.narration.line}</span>
      </button>
      {quote === null ? null : (
        <p
          className={`chronicle-killfeed__quote is-${quote.kind}${quoteExpanded ? " is-expanded" : ""}`}
          data-quote-kind={quote.kind}
        >
          <span>{quote.label}</span>
          <q>{quote.text}</q>
          <button
            type="button"
            className="chronicle-killfeed__quote-disclosure"
            aria-label={quoteExpanded ? "Show message preview" : "Read full message"}
            aria-expanded={quoteExpanded}
            onClick={(click) => {
              click.stopPropagation();
              setQuoteExpanded((expanded) => !expanded);
            }}
          >{quoteExpanded ? "Show preview" : "Read full message"}</button>
        </p>
      )}
      {route === null ? null : (
        <p className="chronicle-killfeed__travel-route" data-travel-route>
          <span>{route.from}</span><b aria-hidden="true">→</b><span>{route.to}</span>
          <small>{route.state === "stopped" ? "at rest" : route.state}</small>
        </p>
      )}
      {resourceFact === null ? null : (
        <p className="chronicle-killfeed__resource-fact" data-resource-fact>{resourceFact}</p>
      )}
      {shelterNotice === null ? null : (
        <p className="chronicle-killfeed__shelter-notice">{shelterNotice}</p>
      )}
      {lifecycleNotice === null ? null : (
        <p className="chronicle-killfeed__lifecycle-notice" data-lifecycle-state={lifecycleNotice.state}>
          {lifecycleNotice.label}
        </p>
      )}
      <p className="chronicle-killfeed__meta">
        <BeingChip
          beingId={event.actorId}
          nameOf={props.nameOf}
          hue={event.actorHue}
          presence={props.presence}
          following={props.followBeingId === event.actorId}
          onFollow={props.onFollow}
        />
        {event.targetId === null ? null : (
          <>
            <span
              className={`chronicle-killfeed__arrow${event.mapping.thread === "severed" ? " is-cut" : ""}`}
              aria-hidden="true"
            >{event.mapping.thread === "severed" ? "⇸" : "→"}</span>
            <BeingChip
              beingId={event.targetId}
              nameOf={props.nameOf}
              hue={event.targetHue}
              presence={props.presence}
              following={props.followBeingId === event.targetId}
              onFollow={props.onFollow}
            />
          </>
        )}
        <span className="chronicle-killfeed__figures">{meta.join(" · ")}</span>
        <button
          type="button"
          className="chronicle-killfeed__more"
          aria-label={`What exactly happened: ${event.narration.line}`}
          aria-expanded={props.detailOpen}
          onClick={(click) => {
            click.stopPropagation();
            props.onToggleDetail(event.id);
          }}
        >⋯</button>
      </p>
      <div className="chronicle-killfeed__card-actions">
        <button
          type="button"
          aria-label={`Replay historical event: ${event.narration.line}`}
          onClick={(click) => {
            click.stopPropagation();
            props.onOpen(event);
          }}
        >Replay</button>
        <button
          type="button"
          aria-label={`What exactly happened: ${event.narration.line}`}
          onClick={(click) => {
            click.stopPropagation();
            props.onToggleDetail(event.id);
          }}
        >Details</button>
        {event.actorId === null || actorStatus?.reachable !== true ? null : (
          <button
            type="button"
            aria-label={`Follow ${props.nameOf(event.actorId)} now`}
            onClick={(click) => {
              click.stopPropagation();
              if (event.actorId !== null) props.onFollow(event.actorId);
            }}
          >Follow now</button>
        )}
      </div>
    </li>
  );
}

interface PortraitPairProps {
  readonly event: StreamEvent;
  readonly nameOf: (id: string) => string;
  readonly presence: StreamPresence;
  readonly followingBeingId: string | null;
  readonly onFollow: (beingId: string) => void;
}

/** A deterministic identity tile, never an invented likeness or portrait image. */
function PortraitPair(props: PortraitPairProps): JSX.Element | null {
  const candidates = props.event.type === "agent_born"
    ? props.event.participants
    : [props.event.actorId, props.event.targetId].filter((id): id is string => id !== null);
  const people = [...new Set(candidates)].slice(0, 3).map((id) => Object.freeze({
    id,
    hue: id === props.event.actorId
      ? props.event.actorHue
      : id === props.event.targetId
        ? props.event.targetHue
        : null,
  }));
  if (people.length === 0) return null;
  return (
    <span className="chronicle-killfeed__portraits" aria-label="People involved">
      {people.map((person) => {
        const status = beingNow(person.id, props.presence, props.nameOf);
        const name = props.nameOf(person.id);
        return (
          <button
            key={person.id}
            type="button"
            className={[
              "chronicle-killfeed__portrait",
              status.reachable ? "" : "is-gone",
              props.followingBeingId === person.id ? "is-following" : "",
            ].filter((token) => token.length > 0).join(" ")}
            style={{ ["--portrait-hue" as string]: person.hue ?? "#7f8b6c" }}
            title={status.line}
            aria-label={status.reachable ? `Follow ${name}` : status.line}
            disabled={!status.reachable}
            onClick={(click) => {
              click.stopPropagation();
              if (status.reachable) props.onFollow(person.id);
            }}
          >{initialsFor(name)}</button>
        );
      })}
    </span>
  );
}

function initialsFor(name: string): string {
  const letters = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  return letters.map((word) => word.charAt(0).toUpperCase()).join("").slice(0, 2) || "?";
}

interface BeingChipProps {
  readonly beingId: string | null;
  readonly nameOf: (id: string) => string;
  readonly hue: string | null;
  readonly presence: StreamPresence;
  readonly following: boolean;
  readonly onFollow: (beingId: string) => void;
}

function BeingChip(props: BeingChipProps): JSX.Element | null {
  if (props.beingId === null) return null;
  const status = beingNow(props.beingId, props.presence, props.nameOf);
  const beingId = props.beingId;
  return (
    <button
      type="button"
      className={[
        "chronicle-killfeed__being",
        status.reachable ? "" : "is-gone",
        props.following ? "is-following" : "",
      ].filter((token) => token.length > 0).join(" ")}
      aria-label={status.reachable ? `Follow ${props.nameOf(beingId)}` : status.line}
      title={status.line}
      disabled={!status.reachable}
      onClick={(click) => {
        // The whole card replays; a being chip must not do that on the way past.
        click.stopPropagation();
        props.onFollow(beingId);
      }}
    >
      <i style={{ background: props.hue ?? "#8a8270" }} aria-hidden="true" />
      {props.nameOf(beingId)}
    </button>
  );
}

function StandingStrip(props: Readonly<{
  conditions: readonly StandingCondition[];
  nowMs: number;
  onOpen: (condition: StandingCondition) => void;
}>): JSX.Element | null {
  if (props.conditions.length === 0) return null;
  const shown = props.conditions.slice(0, MAX_STANDING_CHIPS);
  const hidden = props.conditions.length - shown.length;
  return (
    <ul className="chronicle-killfeed__standing" aria-label="Standing conditions">
      {shown.map((condition) => (
        <li key={`${condition.key}:${condition.subjectId}`}>
          <button
            type="button"
            className={`chronicle-killfeed__condition is-${condition.severity}`}
            aria-label={condition.label}
            title={condition.label}
            onClick={() => props.onOpen(condition)}
          >
            <span>{condition.tag}</span>
            <b>{formatFeedTime(Math.max(0, props.nowMs - condition.sinceMs))}</b>
          </button>
        </li>
      ))}
      {hidden > 0 ? (
        <li>
          <span
            className="chronicle-killfeed__condition is-more"
            aria-label={`${hidden} further standing conditions: `
              + props.conditions.slice(MAX_STANDING_CHIPS)
                .map((condition) => condition.label).join(" ")}
          >+{hidden}</span>
        </li>
      ) : null}
    </ul>
  );
}

function DetailPanel(props: Readonly<{
  event: StreamEvent;
  delivered: readonly StreamEvent[];
  nameOf: (id: string) => string;
  onFollow: (beingId: string) => void;
  onClose: () => void;
}>): JSX.Element {
  const detail = detailFor(props.event, props.nameOf);
  const chain = chainAround(props.event, props.delivered);
  return (
    <section
      className="chronicle-killfeed__detail"
      style={{ ["--accent" as string]: props.event.accent }}
      aria-label={`What exactly happened: ${props.event.narration.line}`}
    >
      <header>
        <span className="chronicle-killfeed__detail-type">
          {props.event.type.replace(/_/gu, " ")}
        </span>
        <span>{props.event.tier} · {props.event.scope}</span>
        <span>cursor {props.event.cursor}</span>
        <button type="button" aria-label="Close event detail" onClick={props.onClose}>Close</button>
      </header>
      <div className="chronicle-killfeed__detail-scroll">
        {detail.message === null ? null : (
          <p className="chronicle-killfeed__said">
            <span>their own words, in full</span>
            {detail.message}
          </p>
        )}
        {detail.groups.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.rows.map((row, index) => (
                <div key={`${index}:${row.label}`} className={row.weighty === true ? "is-weighty" : ""}>
                  <dt>{row.label}</dt>
                  <dd>
                    {row.beingId === undefined ? row.value : (
                      <button
                        type="button"
                        onClick={() => { if (row.beingId !== undefined) props.onFollow(row.beingId); }}
                      >{row.value}</button>
                    )}
                    {row.derived === true ? <i>derived</i> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        {chain.length === 0 ? null : (
          <section className="chronicle-killfeed__chain">
            <h3>around it</h3>
            <ul>
              {chain.map((related) => (
                <li key={related.id} style={{ ["--accent" as string]: related.accent }}>
                  <StreamGlyph name={related.glyph} size={10} />
                  <b>{formatEventTime(related.wallTimestamp, related.atMs)}</b>
                  {related.narration.line}
                </li>
              ))}
            </ul>
            <p>inferred from shared beings and adjacency — the world emits no causal link</p>
          </section>
        )}
      </div>
    </section>
  );
}
