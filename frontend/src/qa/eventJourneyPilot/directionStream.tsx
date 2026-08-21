/**
 * DIRECTION 7 — STREAM. The owner's chosen blend.
 *
 * **Base structure = COMPLETE. Surface treatment = REGIONS.** One ongoing
 * horizontal stream, one column, no lanes. Regions are told apart by *headings
 * and boxes inside the stream*, never by parallel columns. Everything Safi named
 * as liked is kept literally: the quiet mono timestamp at the left, the glyph,
 * the three-letter region tag, the being dot and name, the sentence voice with
 * its small mono figures trailing inline, the burst-group headings that say
 * `9 IN 1.0S   NIR`, and the left-edge accents.
 *
 * ## The tension, and how it is resolved
 *
 * Carding costs vertical space; density is the thing he liked. So the rule here
 * is **spend horizontal, never vertical**:
 *
 * - **A rupture breaks out sideways.** The torn left edge, the step right, the
 *   inverted medallion and the rust field are all *horizontal* and *chromatic*
 *   moves. They cost zero pixels of height, and they are the whole of "a failure
 *   is readable without reading". This is the single most important observation
 *   in the direction: the part of Regions Safi wanted is the part that is free.
 * - **The group is the card.** A burst-group is a bounded, elevated panel with
 *   its heading as a cap. Prominence lands on the *object* a reader actually
 *   parses — the clump — rather than being paid for 21 times over.
 * - **An ordinary row is carded minimally**: a tint, a hairline bound, a 2px
 *   accent edge, a medallion instead of a bare glyph. About four pixels taller
 *   than a Complete row.
 * - **Only notable rows get height.** Knells, strikes and anything at or above
 *   salience 60 take the full card. In C18 that is roughly one row in five, and
 *   they are precisely the rows a viewer would be sorry to skim past.
 *
 * ## Region grouping without columns
 *
 * Inside a group (and inside each quiet run between groups) consecutive events
 * from one region are wrapped in a **band**: a region-tinted field with a
 * region-coloured left rule. A band of two or more takes a small cap naming the
 * place. The `RGN` tag column survives untouched for single-row bands, so a lone
 * event never needs a heading of its own. Boxes and headings do the work Safi
 * asked them to do, and the stream stays one column.
 *
 * ## Persistent states
 *
 * Complete had nowhere for them and lost half the world. Here they live in a
 * **sticky standing bar at the top of the stream**. A single column cannot
 * afford a right rail without stealing width from the sentence — the thing he
 * praised — and the stream is bottom-anchored, so the top edge is the least
 * attended pixels on the surface. The bar costs about one row of density *once*,
 * and never grows with event volume, only with the number of conditions, which
 * is small and self-limiting.
 *
 * ## Navigation — the livestream model
 *
 * Clicking a card moves the **playhead** to that event and plays forward from
 * there; a LIVE button jumps back to the leading edge. The simulation never goes
 * backwards — the viewer does, over a bounded buffer of events already
 * received. Clicking a being's dot instead follows *them* to wherever they now
 * stand. Both affordances are honest when their subject is gone: a ruined home
 * says what lies there now, a decayed being says there is no one left to follow.
 */

import { type JSX, useMemo, useState } from "react";
import { JourneyGlyph } from "./journeyGlyphs";
import { chainAround, detailFor } from "./journeyDetail";
import { formatJourneyTime, regionTag } from "./journeyNode";
import { buildPresence, regionForSubject, type Presence } from "./journeyPresence";
import { CARD_POSTURE, standingConditions, type CardPosture } from "./journeySalience";
import type {
  DirectionProps,
  JourneyEvent,
  JourneyRegion,
  JourneyStream,
} from "./journeyTypes";

/** Identical to Complete's, so the group headings read the same. */
const BURST_WINDOW_MS = 700;
const BURST_MIN = 5;
/** At or above this base salience a row earns the full card and its extra height. */
const NOTABLE_FLOOR = 60;
/** Playhead lands slightly before the event so you see it *arrive*. */
const PREROLL_MS = 900;

interface StreamRow {
  readonly event: JourneyEvent;
  readonly repeat: number;
}

interface Band {
  readonly key: string;
  readonly regionId: string | null;
  readonly rows: readonly StreamRow[];
}

interface GroupItem {
  readonly kind: "group";
  readonly key: string;
  readonly rows: readonly StreamRow[];
  readonly spanMs: number;
}

interface LooseItem {
  readonly kind: "loose";
  readonly key: string;
  readonly rows: readonly StreamRow[];
}

interface AwayItem {
  readonly kind: "away";
  readonly key: string;
  readonly count: number;
}

type StreamItem = GroupItem | LooseItem | AwayItem;

/** Consecutive events sharing a fold key become one row with an exact `×n`. */
function collapse(delivered: readonly JourneyEvent[]): readonly StreamRow[] {
  const rows: StreamRow[] = [];
  for (const event of delivered) {
    const previous = rows[rows.length - 1];
    if (
      previous !== undefined
      && previous.event.foldKey === event.foldKey
      && previous.event.actorId === event.actorId
      && event.atMs - previous.event.atMs < 2_500
    ) {
      rows[rows.length - 1] = { event, repeat: previous.repeat + 1 };
      continue;
    }
    rows.push({ event, repeat: 1 });
  }
  return rows;
}

/** Split the stream into burst groups, quiet runs, and the look-away rule. */
function segment(
  rows: readonly StreamRow[],
  lastSeenMs: number | null,
  returnedAtMs: number | null,
): readonly StreamItem[] {
  const items: StreamItem[] = [];
  const loose: StreamRow[] = [];
  const flushLoose = (): void => {
    if (loose.length === 0) return;
    items.push({ kind: "loose", key: `l-${loose[0]?.event.id ?? items.length}`, rows: [...loose] });
    loose.length = 0;
  };

  let index = 0;
  let awayEmitted = false;
  const awayFrom = lastSeenMs !== null && returnedAtMs !== null ? lastSeenMs : null;

  while (index < rows.length) {
    const row = rows[index];
    if (row === undefined) break;
    if (awayFrom !== null && !awayEmitted && row.event.atMs > awayFrom) {
      flushLoose();
      const count = rows.filter(
        (candidate) =>
          candidate.event.atMs > awayFrom && candidate.event.atMs <= (returnedAtMs ?? Infinity),
      ).length;
      items.push({ kind: "away", key: "away", count });
      awayEmitted = true;
    }
    let end = index + 1;
    while (
      end < rows.length
      && (rows[end]?.event.atMs ?? Infinity) - (rows[end - 1]?.event.atMs ?? 0) <= BURST_WINDOW_MS / 2
    ) {
      end += 1;
    }
    const run = rows.slice(index, end);
    if (run.length >= BURST_MIN) {
      flushLoose();
      const span = (run[run.length - 1]?.event.atMs ?? 0) - (run[0]?.event.atMs ?? 0);
      items.push({ kind: "group", key: `g-${run[0]?.event.id ?? index}`, rows: run, spanMs: span });
    } else {
      loose.push(...run);
    }
    index = end;
  }
  flushLoose();
  return items;
}

/** Consecutive rows from one region become one band — the box, not a column. */
function bandsOf(rows: readonly StreamRow[]): readonly Band[] {
  const bands: Band[] = [];
  for (const row of rows) {
    const last = bands[bands.length - 1];
    if (last !== undefined && last.regionId === row.event.regionId) {
      bands[bands.length - 1] = { ...last, rows: [...last.rows, row] };
      continue;
    }
    bands.push({ key: `b-${row.event.id}`, regionId: row.event.regionId, rows: [row] });
  }
  return bands;
}

function isNotable(event: JourneyEvent): boolean {
  return event.tier === "knell" || event.tier === "strike" || event.baseSalience >= NOTABLE_FLOOR;
}

/** Where inside the region it happened. Never invented — read from the event. */
function placeWithin(event: JourneyEvent, presence: Presence): string | null {
  if (event.homeId === null) return null;
  if (presence.ruined.has(event.homeId)) return "at the ruin";
  switch (event.type) {
    case "hearth_used":
      return "at the hearth";
    case "home_started_hoarding":
    case "home_thieved":
      return "at the vault";
    case "ruins_scavenged":
      return "at the ruin";
    case "home_collapsed":
      return "where the home stood";
    default:
      return "at the home";
  }
}

/**
 * What is at that place *at the playhead* — the aftermath, not the moment.
 *
 * Honest about vanished places: a fallen home says it is rubble and how much is
 * left in it; a home that has not been raised yet says so.
 */
function placeNow(
  place: { regionId: string | null; homeId: string | null },
  presence: Presence,
  stream: JourneyStream,
  delivered: readonly JourneyEvent[],
): string {
  const region = stream.regions.find((candidate) => candidate.id === place.regionId);
  const where = region?.label ?? "Between regions";
  const here = stream.beings
    .filter((being) => !presence.absent.has(being.id) && presence.region.get(being.id) === place.regionId)
    .map((being) => (presence.gone.has(being.id) ? `${being.name} (fallen)` : being.name));
  const who = here.length === 0 ? "no one stands here" : here.join(", ");

  if (place.homeId === null) return `${where} · ${who}`;
  if (presence.ruined.has(place.homeId)) {
    const collapse = [...delivered]
      .reverse()
      .find((event) => event.type === "home_collapsed" && event.homeId === place.homeId);
    const left = collapse?.payload["remnant_materials"];
    const rubble = typeof left === "number" ? ` · ${left} materials in the rubble` : "";
    return `${where} · a ruin where the home stood${rubble} · ${who}`;
  }
  if (presence.built.has(place.homeId)) {
    const latest = [...delivered]
      .reverse()
      .find((event) => event.homeId === place.homeId && typeof event.payload["integrity"] === "number");
    const integrity = latest?.payload["integrity"];
    const wall = typeof integrity === "number" ? ` · integrity ${integrity}` : "";
    return `${where} · the home still stands${wall} · ${who}`;
  }
  // The buffer has not yet seen this dwelling raised. Saying so is the honest
  // move: the viewer is standing at a moment before it was known to be there.
  return `${where} · no dwelling stands here yet · ${who}`;
}

/** Where a being is now, or why it cannot be followed. */
function beingNow(
  beingId: string,
  presence: Presence,
  stream: JourneyStream,
): { readonly line: string; readonly reachable: boolean } {
  const being = stream.beings.find((candidate) => candidate.id === beingId);
  const name = being?.name ?? "someone";
  if (presence.gone.has(beingId)) {
    const region = stream.regions.find((candidate) => candidate.id === presence.region.get(beingId));
    return { line: `${name}'s body lies at ${region?.label ?? "an unknown place"}.`, reachable: true };
  }
  if (presence.absent.has(beingId)) {
    const unborn = being !== undefined && being.bornAtCursor > 0;
    const last = stream.regions.find((candidate) => candidate.id === presence.region.get(beingId));
    return {
      line: unborn
        ? `${name} is not in the world yet. There is nowhere to go.`
        // The plate still frames the place, so say what it is framing: the
        // last place they stood is a true answer to "where are they now".
        : `${name} has returned to the earth. There is no one to follow — this is where they last stood${last === undefined ? "" : `, at ${last.label}`}.`,
      reachable: false,
    };
  }
  const region = stream.regions.find((candidate) => candidate.id === presence.region.get(beingId));
  return { line: `${name} is at ${region?.label ?? "an unknown place"} now.`, reachable: true };
}

/* ------------------------------------------------------------------ rows - */

interface RowProps {
  readonly row: StreamRow;
  readonly presence: Presence;
  readonly focusEventId: string | null;
  readonly detailId: string | null;
  readonly delivered: readonly JourneyEvent[];
  readonly stream: JourneyStream;
  readonly followBeingId: string | null;
  readonly onOpenPlace: (event: JourneyEvent) => void;
  readonly onFollow: (beingId: string) => void;
  readonly onToggleDetail: (id: string) => void;
}

function StreamRowView(props: RowProps): JSX.Element {
  const { event, repeat } = props.row;
  const posture: CardPosture = CARD_POSTURE[event.type];
  const notable = isNotable(event);
  const open = props.detailId === event.id;
  const where = placeWithin(event, props.presence);

  const beingChip = (id: string | null, name: string | null, hue: string | null): JSX.Element | null => {
    if (id === null || name === null) return null;
    const status = beingNow(id, props.presence, props.stream);
    return (
      <button
        type="button"
        className={[
          "st__being",
          status.reachable ? "" : "is-gone",
          props.followBeingId === id ? "is-following" : "",
        ]
          .filter((token) => token.length > 0)
          .join(" ")}
        title={status.line}
        onClick={(click): void => {
          click.stopPropagation();
          props.onFollow(id);
        }}
      >
        <i style={{ background: hue ?? "#8a8270" }} />
        {name}
      </button>
    );
  };

  return (
    <>
      <li
        className={[
          "st__row",
          `st__row--${event.tier}`,
          `st__row--${posture}`,
          notable ? "is-notable" : "",
          props.focusEventId === event.id ? "is-focused" : "",
          open ? "is-open" : "",
        ]
          .filter((token) => token.length > 0)
          .join(" ")}
        style={{ ["--accent" as string]: event.accent }}
        data-event-id={event.id}
        onClick={(): void => props.onOpenPlace(event)}
      >
        {posture === "rupture" ? <span className="st__tear" aria-hidden /> : null}
        <span className="st__t">{formatJourneyTime(event.atMs)}</span>
        <span className="st__med" aria-hidden>
          <JourneyGlyph name={event.glyph} size={notable ? 14 : 11} />
        </span>
        <span className="st__r">{regionTag(event.regionId)}</span>
        <span className="st__a">
          {event.actorName !== null
            ? beingChip(event.actorId, event.actorName, event.actorHue)
            : <span className="st__world">the world</span>}
        </span>
        <span className="st__l">
          <span className="st__line">{event.narration.line}</span>
          {repeat > 1 ? <span className="st__x">×{repeat}</span> : null}
          {event.narration.detail !== null ? (
            <span className="st__d">{event.narration.detail}</span>
          ) : null}
          {where !== null && notable ? <span className="st__where">{where}</span> : null}
          {/* The chip only earns its width when the sentence has not already
              named who this was aimed at — otherwise it is the same fact twice. */}
          {event.targetName !== null && !event.narration.line.includes(event.targetName) ? (
            <span className="st__to">
              <span className={event.mapping.thread === "severed" ? "st__arrow is-cut" : "st__arrow"}>
                {event.mapping.thread === "severed" ? "⇸" : "→"}
              </span>
              {beingChip(event.targetId, event.targetName, event.targetHue)}
            </span>
          ) : null}
          {event.narration.quote !== null ? (
            <em className={`st__q st__q--${event.kind}`}>{event.narration.quote}</em>
          ) : null}
        </span>
        <button
          type="button"
          className={`st__more${open ? " is-on" : ""}`}
          title="what exactly happened"
          onClick={(click): void => {
            click.stopPropagation();
            props.onToggleDetail(event.id);
          }}
        >
          ⋯
        </button>
      </li>
      {open ? (
        <DetailDrawer event={event} delivered={props.delivered} stream={props.stream} onFollow={props.onFollow} />
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- drawer - */

function DetailDrawer(props: {
  readonly event: JourneyEvent;
  readonly delivered: readonly JourneyEvent[];
  readonly stream: JourneyStream;
  readonly onFollow: (beingId: string) => void;
}): JSX.Element {
  const nameOf = (id: string): string =>
    props.stream.beings.find((being) => being.id === id)?.name ?? id;
  const detail = useMemo(() => detailFor(props.event, nameOf), [props.event]);
  const chain = useMemo(
    () => chainAround(props.event, props.delivered),
    [props.event, props.delivered],
  );

  return (
    <li className="st__drawer" style={{ ["--accent" as string]: props.event.accent }}>
      <div className="st__drawerHead">
        <span className="st__drawerType">{props.event.type.replace(/_/gu, " ")}</span>
        <span className="st__drawerTier">{props.event.tier}</span>
        <span className="st__drawerScope">{props.event.scope} · {props.event.source}</span>
        <span className="st__drawerCursor">cursor {props.event.cursor}</span>
      </div>
      {detail.message !== null ? (
        <p className="st__drawerSaid">
          <span>their own words, in full</span>
          {detail.message}
        </p>
      ) : null}
      <div className="st__drawerCols">
        {detail.groups.map((group) => (
          <section key={group.title} className="st__drawerGroup">
            <h4>{group.title}</h4>
            <dl>
              {group.rows.map((row, index) => (
                <div key={`${index}:${row.label}`} className={row.weighty === true ? "is-weighty" : ""}>
                  <dt>{row.label}</dt>
                  <dd>
                    {row.beingId !== undefined ? (
                      <button
                        type="button"
                        className="st__drawerFollow"
                        onClick={(click): void => {
                          click.stopPropagation();
                          if (row.beingId !== undefined) props.onFollow(row.beingId);
                        }}
                      >
                        {row.value}
                      </button>
                    ) : (
                      row.value
                    )}
                    {row.derived === true ? <i className="st__derived">derived</i> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        {chain.length > 0 ? (
          <section className="st__drawerGroup st__drawerChain">
            <h4>around it</h4>
            <ul>
              {chain.map((related) => (
                <li key={related.id} style={{ ["--accent" as string]: related.accent }}>
                  <JourneyGlyph name={related.glyph} size={10} />
                  <b>{formatJourneyTime(related.atMs)}</b>
                  {related.narration.line}
                </li>
              ))}
            </ul>
            <p className="st__drawerNote">
              inferred from shared beings and adjacency — the world emits no causal link between
              events
            </p>
          </section>
        ) : null}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ band - */

function BandView(props: {
  readonly band: Band;
  readonly showCap: boolean;
  readonly region: JourneyRegion | undefined;
  readonly row: (row: StreamRow) => JSX.Element;
}): JSX.Element {
  const region = props.region;
  // Several canonical events (an asking, a refusal) genuinely belong to no
  // region. Tinting and captioning a "between regions" box would invent a place
  // the world does not have, so those rows sit plain and keep only their `···`.
  const placeless = region === undefined;
  return (
    <li
      className={[
        "st__band",
        props.band.rows.length > 1 ? "is-run" : "",
        placeless ? "is-placeless" : "",
      ]
        .filter((token) => token.length > 0)
        .join(" ")}
      style={{
        ["--band" as string]: region?.rim ?? "rgba(236,226,204,0.14)",
        ["--bandGround" as string]: region?.ground ?? "#2a2e26",
      }}
    >
      {props.showCap && !placeless ? (
        <span className="st__bandCap">
          {region?.label ?? "between regions"}
          <b>{props.band.rows.length}</b>
        </span>
      ) : null}
      <ul className="st__bandRows">{props.band.rows.map((row) => props.row(row))}</ul>
    </li>
  );
}

/* --------------------------------------------------------------- the view - */

/** The stream direction. */
export function DirectionStream(props: DirectionProps): JSX.Element {
  const [detailId, setDetailId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("detail"),
  );
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set<string>());

  const { playhead } = props;
  // The bounded buffer: anything older than the retention window is gone, and
  // the surface says so rather than quietly showing less than it claims.
  const retained = useMemo(
    () => props.delivered.filter((event) => event.atMs >= playhead.floorMs),
    [props.delivered, playhead.floorMs],
  );
  const evicted = props.delivered.length - retained.length;

  const presence = useMemo(
    () => buildPresence(props.stream, props.delivered),
    [props.stream, props.delivered],
  );
  const rows = useMemo(() => collapse(retained), [retained]);
  const items = useMemo(
    () => segment(rows, props.lastSeenMs, props.returnedAtMs),
    [rows, props.lastSeenMs, props.returnedAtMs],
  );
  const standing = useMemo(() => standingConditions(props.delivered), [props.delivered]);
  const folded = retained.length - rows.length;
  const ahead = props.events.filter(
    (event) => event.atMs > playhead.nowMs && event.atMs <= playhead.liveMs,
  ).length;

  const regionOf = (id: string | null): JourneyRegion | undefined =>
    props.stream.regions.find((region) => region.id === id);

  const openPlace = (event: JourneyEvent): void => {
    props.onFocusEvent(event.id);
    props.onFocusPlace({ regionId: event.regionId, homeId: event.homeId, sourceEventId: event.id });
    props.onFollowBeing(null);
    // The livestream move: the playhead goes to just before the event and PLAYS
    // ON from there. The simulation is untouched; only the reader moves.
    playhead.goTo(Math.max(0, event.atMs - PREROLL_MS));
  };

  const follow = (beingId: string): void => {
    props.onFollowBeing(beingId);
    props.onFocusPlace(null);
  };

  const lens = ((): { readonly kind: string; readonly line: string; readonly ok: boolean } | null => {
    if (props.followBeingId !== null) {
      const status = beingNow(props.followBeingId, presence, props.stream);
      return { kind: "following", line: status.line, ok: status.reachable };
    }
    if (props.placeFocus !== null) {
      return {
        kind: "at",
        line: placeNow(props.placeFocus, presence, props.stream, props.delivered),
        ok: true,
      };
    }
    return null;
  })();

  const renderRow = (row: StreamRow): JSX.Element => (
    <StreamRowView
      key={row.event.id}
      row={row}
      presence={presence}
      focusEventId={props.focusEventId}
      detailId={detailId}
      delivered={props.delivered}
      stream={props.stream}
      followBeingId={props.followBeingId}
      onOpenPlace={openPlace}
      onFollow={follow}
      onToggleDetail={(id): void => setDetailId((current) => (current === id ? null : id))}
    />
  );

  const renderBands = (bandRows: readonly StreamRow[]): JSX.Element[] => {
    const bands = bandsOf(bandRows);
    const multiRegion = new Set(bandRows.map((row) => row.event.regionId)).size > 1;
    return bands.map((band) => (
      <BandView
        key={band.key}
        band={band}
        showCap={multiRegion && band.rows.length > 1}
        region={regionOf(band.regionId)}
        row={renderRow}
      />
    ));
  };

  return (
    <div className={`dir dir--stream${playhead.atLive ? "" : " is-behind"}`}>
      <div className="cmp__worldSlot st__worldSlot">
        {props.world}
        {lens !== null ? (
          <div className={`st__lens${lens.ok ? "" : " is-gone"}`}>
            <span className="st__lensKind">{lens.kind}</span>
            {lens.line}
            <button
              type="button"
              className="st__lensClear"
              onClick={(): void => {
                props.onFocusPlace(null);
                props.onFollowBeing(null);
                props.onFocusEvent(null);
              }}
            >
              clear
            </button>
          </div>
        ) : null}
      </div>

      <section className="st__feed">
        {!playhead.atLive ? (
          <div className="st__behind">
            <span className="st__behindDot" aria-hidden />
            <b>BEHIND LIVE</b>
            <span>
              −{formatJourneyTime(playhead.behindMs)} · {ahead} event{ahead === 1 ? "" : "s"} received
              since
            </span>
            <button type="button" className="st__goLive" onClick={playhead.goLive}>
              ▶ GO LIVE
            </button>
          </div>
        ) : null}

        <div className={`st__standing${standing.length === 0 ? " is-empty" : ""}`}>
          <span className="st__standingLabel">standing</span>
          {standing.length === 0 ? (
            <em>nothing stands</em>
          ) : (
            <ul>
              {standing.map((condition) => {
                const regionId = regionForSubject(
                  condition.subjectKind,
                  condition.subjectId,
                  condition.regionId,
                  presence,
                  props.stream,
                );
                return (
                  <li
                    key={`${condition.key}:${condition.subjectId}`}
                    className={`st__cond st__cond--${condition.severity}`}
                    title={condition.label}
                    onClick={(): void => {
                      const source = props.delivered.find(
                        (event) => event.id === condition.sourceEventId,
                      );
                      if (source !== undefined) openPlace(source);
                    }}
                  >
                    <span className="st__condTag">{condition.tag}</span>
                    <span className="st__condWhere">{regionTag(regionId)}</span>
                    <b>{formatJourneyTime(props.nowMs - condition.sinceMs)}</b>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <header className="st__head">
          <span className="st__t">time</span>
          <span className="st__med" />
          <span className="st__r">rgn</span>
          <span className="st__a">who</span>
          <span className="st__l">what</span>
          <span />
        </header>

        <div className="st__scroll" data-scroll="bottom">
          <ul className="st__items">
            <li className="st__horizon">
              <span>
                {evicted > 0
                  ? `${evicted} event${evicted === 1 ? "" : "s"} have left the buffer`
                  : "the buffer begins here"}
              </span>
              <b>{Math.round(playhead.bufferMs / 1000)}s retained</b>
            </li>
            {items.map((item) => {
              if (item.kind === "away") {
                return (
                  <li key={item.key} className="st__away">
                    <span>{item.count} while you were away</span>
                  </li>
                );
              }
              if (item.kind === "loose") {
                return (
                  <li key={item.key} className="st__loose">
                    <ul className="st__bands">{renderBands(item.rows)}</ul>
                  </li>
                );
              }
              const regions = [...new Set(item.rows.map((row) => regionTag(row.event.regionId)))];
              const open = !openGroups.has(item.key);
              return (
                <li key={item.key} className={`st__group${open ? " is-open" : ""}`}>
                  <button
                    type="button"
                    className="st__groupHead"
                    onClick={(): void =>
                      setOpenGroups((current) => {
                        const next = new Set(current);
                        if (next.has(item.key)) next.delete(item.key);
                        else next.add(item.key);
                        return next;
                      })
                    }
                  >
                    <span className="st__groupCount">{item.rows.length}</span>
                    <span className="st__groupIn">in {(item.spanMs / 1000).toFixed(1)}s</span>
                    <span className="st__groupRegions">{regions.join(" · ")}</span>
                    <span className="st__groupHint">{open ? "collapse" : "expand"}</span>
                  </button>
                  {open ? <ul className="st__bands">{renderBands(item.rows)}</ul> : null}
                </li>
              );
            })}
            {!playhead.atLive ? (
              <li className="st__playhead">
                <span>playhead · playing forward</span>
                <b>{ahead} more buffered ahead</b>
              </li>
            ) : null}
          </ul>
        </div>

        <footer className="st__foot">
          <button
            type="button"
            className={`st__live${playhead.atLive ? " is-on" : ""}`}
            onClick={playhead.goLive}
          >
            <i />
            LIVE
          </button>
          <span className="st__contract">
            {retained.length} in buffer · {rows.length} rows
            {folded > 0 ? ` · ${folded} folded into repeat counts` : ""}
            {evicted > 0 ? ` · ${evicted} aged out` : ""} · nothing omitted
          </span>
          {playhead.atFloor ? (
            <span className="st__floorWarn">at the edge of the buffer — nothing older is held</span>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
