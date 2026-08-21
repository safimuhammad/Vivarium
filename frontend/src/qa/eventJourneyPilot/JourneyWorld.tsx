/**
 * The world plate — a small, honest stand-in for the 2D atlas.
 *
 * It exists so the pilot can answer two questions the feed alone cannot:
 * *jump-to-source* (a node has somewhere to point at) and *map-first* (a
 * direction that deliberately pushes attention off the log needs a world worth
 * looking at). It is **not** the production renderer and does not touch it: it
 * draws the four regions as tinted plates, beings as identity-hued pips, and
 * events using the same legibility grammar the real overlay uses — the five
 * silhouettes, the six family accents, the tier hold, the aim thread, and the
 * residue pips of BUBBLE_UI.md §4.3. A node in the feed and a mark on this
 * plate carry the same glyph and the same accent, on purpose.
 */

import { type JSX, useMemo } from "react";
import { OVERLAY_TIER_HOLD_MS, OVERLAY_TIER_RANK } from "../../presentation/eventLegibilityMap";
import { OVERLAY_PALETTE } from "../../renderer2d/production/environment/bubbleGrammar";
import { JOURNEY_GLYPH_PATHS } from "./journeyGlyphs";
import type { ScheduledStream } from "./journeyClock";
import type { JourneyEvent, JourneyRegion } from "./journeyTypes";

/** BUBBLE_UI.md §7: six text bubbles on screen, knells never demoted. */
const LIVE_MARK_BUDGET = 6;
/** BUBBLE_UI.md §4.3: three residue pips per being, fading over 6s. */
const RESIDUE_MS = 6_000;

interface Plate {
  readonly region: JourneyRegion;
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

interface PlateSpec {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
}

interface WorldLayout {
  readonly w: number;
  readonly h: number;
  readonly plates: Readonly<Record<string, PlateSpec>>;
  readonly fallback: PlateSpec;
}

/**
 * Two arrangements of the same four regions: a wide plate when the world is
 * the stage, a portrait one when it sits in a column beside a feed. MAP.md's
 * reading either way — a centre, a refuge below it, two thin marches to the
 * sides — so a viewer's mental map survives the switch.
 */
const LAYOUTS: Readonly<Record<"panel" | "stage", WorldLayout>> = Object.freeze({
  stage: {
    w: 1000,
    h: 620,
    plates: {
      nirvana: { x: 500, y: 190, rx: 188, ry: 114 },
      nirvana_east: { x: 848, y: 300, rx: 116, ry: 90 },
      nirvana_west: { x: 152, y: 378, rx: 114, ry: 88 },
      warm_springs: { x: 500, y: 486, rx: 196, ry: 116 },
    },
    fallback: { x: 500, y: 310, rx: 130, ry: 96 },
  },
  panel: {
    w: 640,
    h: 940,
    plates: {
      nirvana: { x: 320, y: 210, rx: 208, ry: 132 },
      nirvana_west: { x: 154, y: 500, rx: 128, ry: 100 },
      nirvana_east: { x: 492, y: 500, rx: 128, ry: 100 },
      warm_springs: { x: 320, y: 782, rx: 212, ry: 134 },
    },
    fallback: { x: 320, y: 470, rx: 140, ry: 104 },
  },
});

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

interface Anchored {
  readonly x: number;
  readonly y: number;
}

interface WorldFrame {
  readonly plates: readonly Plate[];
  readonly beingAt: ReadonlyMap<string, Anchored>;
  readonly beingRegion: ReadonlyMap<string, string>;
  readonly homeAt: ReadonlyMap<string, Anchored>;
  readonly gone: ReadonlySet<string>;
  readonly unborn: ReadonlySet<string>;
  readonly ruined: ReadonlySet<string>;
  readonly built: ReadonlySet<string>;
}

/** Where every being and home stands, given everything delivered so far. */
function buildFrame(
  scheduled: ScheduledStream,
  delivered: readonly JourneyEvent[],
  layout: WorldLayout,
): WorldFrame {
  const { stream } = scheduled;
  const plates: Plate[] = stream.regions.map((region) => {
    const spec = layout.plates[region.id] ?? layout.fallback;
    return { region, cx: spec.x, cy: spec.y, rx: spec.rx, ry: spec.ry };
  });

  const region = new Map<string, string>();
  const gone = new Set<string>();
  const unborn = new Set<string>();
  const ruined = new Set<string>();
  const built = new Set<string>();
  for (const being of stream.beings) {
    region.set(being.id, being.startRegion);
    if (being.bornAtCursor > 0) unborn.add(being.id);
  }
  for (const event of delivered) {
    if (event.type === "agent_entered_region" && event.actorId !== null && event.regionId !== null) {
      region.set(event.actorId, event.regionId);
    }
    // `agent_born` carries the newborn as its actor: the new life is the row's
    // subject, not something done to a third party.
    if (event.type === "agent_born" && event.actorId !== null) {
      unborn.delete(event.actorId);
      if (event.regionId !== null) region.set(event.actorId, event.regionId);
    }
    if (event.type === "agent_died" && event.targetId !== null) gone.add(event.targetId);
    if (event.type === "agent_decayed" && event.actorId !== null) {
      gone.delete(event.actorId);
      unborn.add(event.actorId);
    }
    if (event.type === "home_built" && event.homeId !== null) built.add(event.homeId);
    if (event.type === "home_collapsed" && event.homeId !== null) {
      ruined.add(event.homeId);
      built.delete(event.homeId);
    }
    if (
      event.homeId !== null
      && (event.type === "home_thieved" || event.type === "home_breached" || event.type === "hearth_used")
    ) {
      if (!ruined.has(event.homeId)) built.add(event.homeId);
    }
  }

  const plateOf = (id: string): Plate | undefined => plates.find((plate) => plate.region.id === id);

  const byRegion = new Map<string, string[]>();
  for (const being of stream.beings) {
    const where = region.get(being.id) ?? being.startRegion;
    const list = byRegion.get(where) ?? [];
    list.push(being.id);
    byRegion.set(where, list);
  }

  const beingAt = new Map<string, Anchored>();
  for (const [regionId, ids] of byRegion) {
    const plate = plateOf(regionId);
    if (plate === undefined) continue;
    const sorted = [...ids].sort();
    sorted.forEach((id, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const jitter = (stableHash(id) % 100) / 100 - 0.5;
      beingAt.set(id, {
        x: plate.cx + (column - 1) * plate.rx * 0.46 + jitter * 12,
        y: plate.cy + (row - 0.15) * plate.ry * 0.46 + 16,
      });
    });
  }

  const homeAt = new Map<string, Anchored>();
  for (const home of stream.homes) {
    const plate = plateOf(home.regionId);
    if (plate === undefined) continue;
    const hash = stableHash(home.id);
    const angle = ((hash % 360) / 360) * Math.PI * 2;
    homeAt.set(home.id, {
      x: plate.cx + Math.cos(angle) * plate.rx * 0.6,
      y: plate.cy - Math.abs(Math.sin(angle)) * plate.ry * 0.42 - 18,
    });
  }

  return { plates, beingAt, beingRegion: region, homeAt, gone, unborn, ruined, built };
}

interface MarkPlacement {
  readonly event: JourneyEvent;
  readonly at: Anchored;
  readonly target: Anchored | null;
  readonly phase: number;
  readonly live: boolean;
  readonly fade: number;
}

function anchorFor(event: JourneyEvent, frame: WorldFrame, plates: readonly Plate[]): Anchored | null {
  const which = event.mapping.anchor;
  if (which === "home" && event.homeId !== null) return frame.homeAt.get(event.homeId) ?? null;
  const beingId = which === "subject" ? (event.targetId ?? event.actorId) : (event.actorId ?? event.targetId);
  if (beingId !== null) {
    const at = frame.beingAt.get(beingId);
    if (at !== undefined) return at;
  }
  if (event.homeId !== null) {
    const at = frame.homeAt.get(event.homeId);
    if (at !== undefined) return at;
  }
  const plate = plates.find((candidate) => candidate.region.id === event.regionId);
  return plate === undefined ? null : { x: plate.cx, y: plate.cy - plate.ry * 0.3 };
}

export interface JourneyWorldProps {
  readonly scheduled: ScheduledStream;
  readonly delivered: readonly JourneyEvent[];
  readonly nowMs: number;
  readonly speed: number;
  readonly focusEventId: string | null;
  readonly onFocusEvent: (id: string | null) => void;
  /** `stage` is the map-first treatment: bigger, named, with live captions. */
  readonly variant: "panel" | "stage";
  /**
   * A place the viewer asked to look at, framed as it stands *at the playhead*.
   *
   * The finest location this world knows is a region and, sometimes, a home id —
   * there are no coordinates in any payload — so framing a place means dimming
   * every other region and ringing the dwelling, and nothing finer is available
   * to draw.
   */
  readonly placeFocus?: { readonly regionId: string | null; readonly homeId: string | null } | null;
  /** A being the viewer is following to wherever it now stands. */
  readonly followBeingId?: string | null;
}

/** The shared world plate. */
export function JourneyWorld(props: JourneyWorldProps): JSX.Element {
  const { scheduled, delivered, nowMs, speed, focusEventId, onFocusEvent, variant } = props;
  const placeFocus = props.placeFocus ?? null;
  const followBeingId = props.followBeingId ?? null;
  const layout = LAYOUTS[variant];
  const frame = useMemo(
    () => buildFrame(scheduled, delivered, layout),
    [scheduled, delivered, layout],
  );

  const focused = delivered.find((event) => event.id === focusEventId) ?? null;

  // Lifetimes are wall-clock, never divided by the speed multiplier
  // (BUBBLE_UI.md §6) — so in journey time they stretch WITH the speed.
  const marks: MarkPlacement[] = [];
  const residue: MarkPlacement[] = [];
  for (const event of delivered) {
    const age = nowMs - event.atMs;
    const hold = OVERLAY_TIER_HOLD_MS[event.tier] * speed;
    const at = anchorFor(event, frame, frame.plates);
    if (at === null) continue;
    const target =
      event.mapping.thread !== undefined && event.targetId !== null
        ? (frame.beingAt.get(event.targetId) ?? null)
        : null;
    if (age <= hold) {
      marks.push({ event, at, target, phase: Math.min(1, age / (420 * speed)), live: true, fade: 1 });
    } else if (age <= hold + RESIDUE_MS * speed) {
      residue.push({
        event,
        at,
        target: null,
        phase: 1,
        live: false,
        fade: 1 - (age - hold) / (RESIDUE_MS * speed),
      });
    }
  }

  // Crowd rule: tier descending, then most recent. Over budget demotes to a pip.
  marks.sort(
    (a, b) =>
      OVERLAY_TIER_RANK[b.event.tier] - OVERLAY_TIER_RANK[a.event.tier]
      || b.event.atMs - a.event.atMs,
  );
  const shown = marks.slice(0, LIVE_MARK_BUDGET);
  for (const demoted of marks.slice(LIVE_MARK_BUDGET)) {
    residue.push({ ...demoted, live: false, fade: 0.75 });
  }

  const perBeingResidue = new Map<string, number>();
  const residueShown = residue.filter((item) => {
    const key = item.event.actorId ?? item.event.homeId ?? item.event.id;
    const count = perBeingResidue.get(key) ?? 0;
    if (count >= 3) return false;
    perBeingResidue.set(key, count + 1);
    return true;
  });

  const connectors: Array<{ a: Plate; b: Plate }> = [];
  const seen = new Set<string>();
  for (const plate of frame.plates) {
    for (const other of plate.region.connections) {
      const key = [plate.region.id, other].sort().join("|");
      if (seen.has(key)) continue;
      const target = frame.plates.find((candidate) => candidate.region.id === other);
      if (target === undefined) continue;
      seen.add(key);
      connectors.push({ a: plate, b: target });
    }
  }

  const activeRegions = new Set(shown.map((mark) => mark.event.regionId).filter((id): id is string => id !== null));

  return (
    <svg
      className={`jw jw--${variant}`}
      viewBox={`0 0 ${layout.w} ${layout.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="The world plate"
      onClick={(): void => onFocusEvent(null)}
    >
      <defs>
        <radialGradient id="jw-vignette" cx="50%" cy="42%" r="72%">
          <stop offset="0%" stopColor="#151a12" />
          <stop offset="100%" stopColor="#090c08" />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={layout.w} height={layout.h} fill="url(#jw-vignette)" />

      {connectors.map(({ a, b }) => (
        <line
          key={`${a.region.id}|${b.region.id}`}
          x1={a.cx}
          y1={a.cy}
          x2={b.cx}
          y2={b.cy}
          stroke={OVERLAY_PALETTE.bone}
          strokeOpacity={0.1}
          strokeWidth={2}
          strokeDasharray="7 9"
        />
      ))}

      {frame.plates.map((plate) => {
        const hot = activeRegions.has(plate.region.id);
        // A framed place or a followed being outranks the focused event: the
        // viewer asked to look *there*, and the plate obeys the newer request.
        const framedRegion =
          // A being who is not in the world yet has no place to frame: its
          // "region" is only where the founding snapshot happens to file it.
          followBeingId !== null && !frame.unborn.has(followBeingId)
            ? (frame.beingRegion.get(followBeingId) ?? null)
            : placeFocus !== null
              ? placeFocus.regionId
              : focused !== null
                ? focused.regionId
                : null;
        const dim = framedRegion !== null && framedRegion !== plate.region.id;
        const framed = framedRegion === plate.region.id;
        return (
          <g key={plate.region.id} opacity={dim ? 0.26 : 1}>
            {framed && (placeFocus !== null || followBeingId !== null) ? (
              <ellipse
                cx={plate.cx}
                cy={plate.cy}
                rx={plate.rx + 9}
                ry={plate.ry + 9}
                fill="none"
                stroke={OVERLAY_PALETTE.vellum}
                strokeWidth={1.5}
                strokeOpacity={0.85}
                strokeDasharray="10 7"
              />
            ) : null}
            <ellipse
              cx={plate.cx}
              cy={plate.cy + 10}
              rx={plate.rx}
              ry={plate.ry}
              fill="#050704"
              opacity={0.55}
            />
            <ellipse
              cx={plate.cx}
              cy={plate.cy}
              rx={plate.rx}
              ry={plate.ry}
              fill={plate.region.ground}
              stroke={plate.region.rim}
              strokeWidth={hot ? 2.4 : 1.2}
              strokeOpacity={hot ? 0.95 : 0.45}
            />
            <text
              x={plate.cx}
              y={plate.cy - plate.ry - 13}
              textAnchor="middle"
              className="jw__region"
              fill={OVERLAY_PALETTE.bone}
              opacity={0.8}
            >
              {plate.region.label.toUpperCase()}
            </text>
          </g>
        );
      })}

      {scheduled.stream.homes.map((home) => {
        const at = frame.homeAt.get(home.id);
        if (at === undefined) return null;
        const isRuin = frame.ruined.has(home.id);
        if (!isRuin && !frame.built.has(home.id)) return null;
        const ringed = placeFocus !== null && placeFocus.homeId === home.id;
        return (
          <g key={home.id} opacity={isRuin ? 0.55 : 1}>
            {ringed ? (
              <rect
                x={at.x - 20}
                y={at.y - 20}
                width={40}
                height={34}
                rx={5}
                fill="none"
                stroke={OVERLAY_PALETTE.vellum}
                strokeWidth={1.6}
                strokeOpacity={0.9}
              />
            ) : null}
            <path
              d={
                isRuin
                  ? `M ${at.x - 11} ${at.y + 8} l 6 -9 l 5 5 l 5 -7 l 6 11 z`
                  : `M ${at.x - 12} ${at.y + 8} v -9 l 12 -9 l 12 9 v 9 z`
              }
              fill={isRuin ? "#4a463d" : "#7a6a4c"}
              stroke="#1a1d14"
              strokeWidth={1.4}
            />
          </g>
        );
      })}

      {scheduled.stream.beings.map((being) => {
        const at = frame.beingAt.get(being.id);
        if (at === undefined || frame.unborn.has(being.id)) return null;
        const dead = frame.gone.has(being.id);
        const followed = followBeingId === being.id;
        const involved =
          followed || (focused !== null && focused.participants.includes(being.id));
        return (
          <g key={being.id} opacity={dead ? 0.5 : 1}>
            {involved ? (
              <circle cx={at.x} cy={at.y} r={16} fill="none" stroke={OVERLAY_PALETTE.vellum} strokeWidth={1.6} strokeOpacity={0.9} />
            ) : null}
            {followed ? (
              <circle
                cx={at.x}
                cy={at.y}
                r={22}
                fill="none"
                stroke={OVERLAY_PALETTE.vellum}
                strokeWidth={1.1}
                strokeOpacity={0.5}
                strokeDasharray="4 5"
              />
            ) : null}
            <ellipse cx={at.x} cy={at.y + 9} rx={9} ry={3.2} fill="#050704" opacity={0.5} />
            {dead ? (
              <path
                d={`M ${at.x - 9} ${at.y + 4} h 18`}
                stroke={being.hue}
                strokeWidth={5}
                strokeLinecap="round"
                opacity={0.8}
              />
            ) : (
              <>
                <circle cx={at.x} cy={at.y} r={7.5} fill={being.hue} stroke="#10140d" strokeWidth={1.6} />
                <circle cx={at.x - 2} cy={at.y - 2.4} r={2} fill={OVERLAY_PALETTE.vellumHigh} opacity={0.5} />
              </>
            )}
            {variant === "stage" || involved ? (
              <text
                x={at.x}
                y={at.y + 25}
                textAnchor="middle"
                className="jw__name"
                fill={OVERLAY_PALETTE.bone}
                opacity={involved ? 0.95 : 0.55}
              >
                {being.name}
              </text>
            ) : null}
          </g>
        );
      })}

      {residueShown.map((item) => (
        <g key={`res-${item.event.id}`} opacity={Math.max(0, item.fade) * 0.8}>
          <rect
            x={item.at.x + 11}
            y={item.at.y - 20}
            width={15}
            height={15}
            rx={3}
            fill={item.event.accent}
            stroke="#10140d"
            strokeWidth={1}
          />
          <svg
            x={item.at.x + 12.5}
            y={item.at.y - 18.5}
            width={12}
            height={12}
            viewBox="0 0 12 12"
            fill="none"
            stroke={OVERLAY_PALETTE.vellum}
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            dangerouslySetInnerHTML={{ __html: JOURNEY_GLYPH_PATHS[item.event.glyph] }}
          />
        </g>
      ))}

      {shown.map((mark) => (
        <WorldMark
          key={mark.event.id}
          mark={mark}
          focused={focusEventId === mark.event.id}
          onSelect={onFocusEvent}
        />
      ))}

      {/* The stage variant carries its own NOW line; two captions is one too many. */}
      {focused !== null && variant === "panel" ? (
        <g className="jw__caption">
          <rect x={18} y={layout.h - 54} width={470} height={36} rx={4} fill="#0a0d07" opacity={0.86} />
          <rect x={18} y={layout.h - 54} width={3} height={36} fill={focused.accent} />
          <text x={34} y={layout.h - 31} className="jw__captionText" fill={OVERLAY_PALETTE.bone}>
            {focused.regionLabel ?? "Between regions"}
            {" · "}
            {[focused.actorName, focused.targetName].filter((name) => name !== null).join(" → ") || "the world"}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

/** One live mark, drawn in the silhouette its event's grammar calls for. */
function WorldMark(props: {
  readonly mark: MarkPlacement;
  readonly focused: boolean;
  readonly onSelect: (id: string) => void;
}): JSX.Element {
  const { mark, focused, onSelect } = props;
  const { event } = mark;
  const x = mark.at.x;
  const y = mark.at.y - 34;
  const grow = 0.55 + 0.45 * Math.min(1, mark.phase * 1.8);
  const invert = event.mapping.burst?.invert === true;
  const field = invert ? OVERLAY_PALETTE.ink : OVERLAY_PALETTE.vellum;
  const strokeInk = invert ? OVERLAY_PALETTE.vellum : OVERLAY_PALETTE.ink;
  const glyphInk = invert ? OVERLAY_PALETTE.bone : OVERLAY_PALETTE.ink;
  const knell = event.tier === "knell";
  const w = knell ? 40 : 32;
  const h = knell ? 28 : 23;

  const silhouette = ((): JSX.Element => {
    switch (event.kind) {
      case "speech":
      case "whisper":
        return (
          <>
            <rect
              x={-w / 2}
              y={-h / 2}
              width={w}
              height={h}
              rx={7}
              fill={field}
              stroke={strokeInk}
              strokeWidth={1.4}
              strokeDasharray={event.kind === "whisper" ? "3 2.6" : undefined}
            />
            <path
              d={`M -5 ${h / 2 - 1} L 0 ${h / 2 + 11} L 6 ${h / 2 - 1} Z`}
              fill={event.actorHue ?? OVERLAY_PALETTE.vellumLow}
              stroke={strokeInk}
              strokeWidth={1}
            />
          </>
        );
      case "thought":
        return (
          <>
            <ellipse
              cx={0}
              cy={0}
              rx={w / 2}
              ry={h / 2}
              fill={field}
              stroke={strokeInk}
              strokeWidth={1.3}
              strokeDasharray="3 2.6"
              opacity={0.92}
            />
            <circle cx={-3} cy={h / 2 + 5} r={3.1} fill={field} stroke={strokeInk} strokeWidth={1} opacity={0.9} />
            <circle cx={1} cy={h / 2 + 12} r={2} fill={field} stroke={strokeInk} strokeWidth={0.9} opacity={0.75} />
          </>
        );
      case "burst":
        return <BurstStar radius={w / 2 + 5} fill={field} stroke={event.accent} />;
      default:
        return (
          <>
            <path
              d={`M ${-w / 2} ${-h / 2 + 4} L ${-w / 2 + 5} ${-h / 2} H ${w / 2 - 5} L ${w / 2} ${-h / 2 + 4} V ${h / 2 - 4} L ${w / 2 - 5} ${h / 2} H ${-w / 2 + 5} L ${-w / 2} ${h / 2 - 4} Z`}
              fill={field}
              stroke={strokeInk}
              strokeWidth={1.4}
            />
            <rect x={-1.5} y={h / 2} width={3} height={12} fill={strokeInk} />
            <rect x={-5} y={h / 2 + 11} width={10} height={2.6} fill={strokeInk} />
          </>
        );
    }
  })();

  return (
    <g
      className="jw__mark"
      transform={`translate(${x} ${y}) scale(${grow})`}
      onClick={(clickEvent): void => {
        clickEvent.stopPropagation();
        onSelect(event.id);
      }}
    >
      {mark.target !== null ? (
        <line
          x1={0}
          y1={h / 2}
          x2={mark.target.x - x}
          y2={mark.target.y - y - 12}
          stroke={event.mapping.thread === "severed" ? event.accent : OVERLAY_PALETTE.ink}
          strokeWidth={1.4}
          strokeDasharray="2.5 3.5"
          strokeOpacity={0.85}
          pathLength={event.mapping.thread === "severed" ? undefined : undefined}
        />
      ) : null}
      {focused ? (
        <rect
          x={-w / 2 - 6}
          y={-h / 2 - 6}
          width={w + 12}
          height={h + 12}
          rx={6}
          fill="none"
          stroke={OVERLAY_PALETTE.vellumHigh}
          strokeWidth={1.4}
          strokeOpacity={0.85}
        />
      ) : null}
      {silhouette}
      <rect x={-w / 2} y={-h / 2} width={2.6} height={h} fill={event.accent} opacity={event.kind === "burst" ? 0 : 1} />
      <svg
        x={-6}
        y={-6}
        width={12}
        height={12}
        viewBox="0 0 12 12"
        fill="none"
        stroke={glyphInk}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: JOURNEY_GLYPH_PATHS[event.glyph] }}
      />
    </g>
  );
}

/** The 11-spike impact star. */
function BurstStar(props: { readonly radius: number; readonly fill: string; readonly stroke: string }): JSX.Element {
  const points: string[] = [];
  const spikes = 11;
  for (let index = 0; index < spikes * 2; index += 1) {
    const angle = (Math.PI * index) / spikes - Math.PI / 2;
    const radius = index % 2 === 0 ? props.radius : props.radius * 0.62;
    points.push(`${(Math.cos(angle) * radius).toFixed(2)},${(Math.sin(angle) * radius).toFixed(2)}`);
  }
  return <polygon points={points.join(" ")} fill={props.fill} stroke={props.stroke} strokeWidth={1.6} />;
}
