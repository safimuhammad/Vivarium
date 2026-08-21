/**
 * The shared node atoms — the visual DNA every direction is built from.
 *
 * A node and its mark on the world plate carry the same glyph, the same family
 * accent, and the same tier treatment, so a watcher who learns one has learned
 * the other. The only inversion in the vocabulary is the knell (BUBBLE_UI.md
 * §4.5), and it is honoured here: a death and a birth are the two rows that go
 * to ink.
 */

import type { JSX } from "react";
import { JourneyGlyph } from "./journeyGlyphs";
import type { JourneyEvent } from "./journeyTypes";

/** `mm:ss.d` on the journey clock. */
export function formatJourneyTime(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

/** Three-letter region tag for aligned columns: `WSP`, `NIR`, `NEA`, `NWE`. */
export function regionTag(regionId: string | null): string {
  if (regionId === null) return "···";
  const parts = regionId.split("_");
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 3).toUpperCase();
  return `${(parts[0] ?? "").slice(0, 1)}${(parts[1] ?? "").slice(0, 2)}`.toUpperCase();
}

/** The glyph medallion — family accent field, vellum glyph. Same as a residue pip. */
export function GlyphMedallion(props: {
  readonly event: JourneyEvent;
  readonly size?: number;
}): JSX.Element {
  const size = props.size ?? 24;
  const invert = props.event.tier === "knell";
  return (
    <span
      className={`jn__medallion${invert ? " jn__medallion--knell" : ""}`}
      style={{
        width: size,
        height: size,
        background: invert ? "#12180f" : props.event.accent,
        borderColor: props.event.accent,
      }}
    >
      <JourneyGlyph name={props.event.glyph} size={Math.round(size * 0.62)} />
    </span>
  );
}

/** A being chip: identity-hued dot plus name. */
export function BeingChip(props: {
  readonly name: string | null;
  readonly hue: string | null;
}): JSX.Element | null {
  if (props.name === null) return null;
  return (
    <span className="jn__being">
      <i className="jn__beingDot" style={{ background: props.hue ?? "#8a8270" }} />
      {props.name}
    </span>
  );
}

/** Who it was between, in the grammar's own arrow. */
export function Participants(props: { readonly event: JourneyEvent }): JSX.Element | null {
  const { event } = props;
  if (event.actorName === null && event.targetName === null) return null;
  return (
    <span className="jn__participants">
      <BeingChip name={event.actorName} hue={event.actorHue} />
      {event.targetName !== null ? (
        <>
          <span className={`jn__arrow${event.mapping.thread === "severed" ? " jn__arrow--severed" : ""}`}>
            {event.mapping.thread === "severed" ? "⇸" : "→"}
          </span>
          <BeingChip name={event.targetName} hue={event.targetHue} />
        </>
      ) : null}
    </span>
  );
}

/**
 * The being's own words, with BUBBLE_UI.md §2's fullness bar.
 *
 * The bar is derived only from the real payload length: a curt reply shows a
 * full bar, a 509-character searching self-talk shows a nearly empty one.
 */
export function QuoteBlock(props: { readonly event: JourneyEvent }): JSX.Element | null {
  const { event } = props;
  if (event.narration.quote === null) return null;
  const total = event.quoteTotalChars ?? event.narration.quote.length;
  const shown = Math.min(1, event.narration.quote.length / Math.max(1, total));
  return (
    <span className={`jn__quote jn__quote--${event.kind}`}>
      <span className="jn__quoteText">{event.narration.quote}</span>
      <span className="jn__fullness" title={`${event.narration.quote.length} of ${total} characters`}>
        <i style={{ width: `${(shown * 100).toFixed(1)}%` }} />
      </span>
    </span>
  );
}

export interface JourneyNodeProps {
  readonly event: JourneyEvent;
  readonly focused: boolean;
  readonly onFocus: (id: string) => void;
  /** Chained consequences folded into this node, e.g. an attack's paralysis. */
  readonly consequences?: readonly JourneyEvent[];
  /** Repetition count for a collapsed burst, `null` when singular. */
  readonly repeat?: number | null;
  /** Live salience 0..1, drawn as a hairline meter so ranking is visible. */
  readonly weight?: number | null;
  readonly compact?: boolean;
  readonly showTime?: number | null;
}

/** The full node: the reading unit of curated, threaded and chronicle detail. */
export function JourneyNode(props: JourneyNodeProps): JSX.Element {
  const { event, focused, onFocus, consequences, repeat, weight, compact, showTime } = props;
  return (
    <article
      className={[
        "jn",
        `jn--${event.tier}`,
        `jn--${event.family}`,
        focused ? "is-focused" : "",
        compact === true ? "jn--compact" : "",
      ]
        .filter((token) => token.length > 0)
        .join(" ")}
      style={{ ["--accent" as string]: event.accent }}
      onClick={(): void => onFocus(event.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(keyEvent): void => {
        if (keyEvent.key === "Enter" || keyEvent.key === " ") onFocus(event.id);
      }}
    >
      <span className="jn__rail" />
      <GlyphMedallion event={event} size={compact === true ? 20 : 26} />
      <div className="jn__body">
        <p className="jn__line">
          {event.narration.line}
          {repeat !== undefined && repeat !== null && repeat > 1 ? (
            <span className="jn__repeat">×{repeat}</span>
          ) : null}
        </p>
        <QuoteBlock event={event} />
        {event.narration.detail !== null ? (
          <p className="jn__detail">{event.narration.detail}</p>
        ) : null}
        {consequences !== undefined && consequences.length > 0 ? (
          <p className="jn__chain">
            {consequences.map((child) => (
              <span key={child.id} className="jn__chainItem" style={{ ["--accent" as string]: child.accent }}>
                <JourneyGlyph name={child.glyph} size={11} />
                {child.narration.verb}
              </span>
            ))}
          </p>
        ) : null}
        <p className="jn__meta">
          {event.regionLabel !== null ? <span className="jn__region">{event.regionLabel}</span> : null}
          <Participants event={event} />
          {showTime !== undefined && showTime !== null ? (
            <span className="jn__time">{formatJourneyTime(showTime)}</span>
          ) : null}
        </p>
      </div>
      {weight !== undefined && weight !== null ? (
        <span className="jn__weight" title={`salience ${(weight * 100).toFixed(0)}`}>
          <i style={{ height: `${Math.round(Math.max(0.06, weight) * 100)}%` }} />
        </span>
      ) : null}
    </article>
  );
}
