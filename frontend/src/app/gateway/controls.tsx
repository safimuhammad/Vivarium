/**
 * The two control shapes the configuration screen is built from.
 *
 * Both are dumb about the world and strict about one thing: **every bound,
 * caption and marker is passed in from the server's `/api/run/defaults` payload
 * and nothing is written here.** A knob renders the range it was handed; if a
 * tuning change moves the range, the control moves with it without being edited.
 */

import type { ReactNode } from "react";

import type { ChoiceKnob, NumericKnob } from "./runConfig";

/** How a marker on a slider's track is drawn. */
interface MarkerView {
  readonly value: number;
  readonly label: string;
  readonly help: string | null;
  readonly reached: boolean;
}

export interface NumericKnobControlProps {
  readonly id: string;
  readonly knob: NumericKnob;
  readonly value: number;
  readonly onChange: (value: number) => void;
  /** What the current value reads as, e.g. `1.4×`. Defaults to the raw number. */
  readonly display?: ReactNode;
  /** A short unit shown beside the value, e.g. `materials`. */
  readonly unit?: string | null;
  /** Anything to render under the track — a gap explanation, an estimate. */
  readonly children?: ReactNode;
  readonly describedBy?: string;
}

/**
 * A slider bounded by the server's own knob.
 *
 * Any markers the knob carries are drawn **on the track**, positioned inside the
 * thumb's travel so a mark sits under the value it names. That is the whole
 * point of the materials slider: a viewer should be able to see that a child
 * costs 30 and a hall costs 80, and that they are choosing where to sit between
 * them, without reading a sentence about it.
 */
export function NumericKnobControl({
  id,
  knob,
  value,
  onChange,
  display,
  unit,
  children,
  describedBy,
}: NumericKnobControlProps) {
  const span = knob.max - knob.min;
  const fill = span === 0 ? 0 : ((value - knob.min) / span) * 100;
  const markers: readonly MarkerView[] = knob.markers.map((marker) => ({
    value: marker.value,
    label: marker.label,
    help: marker.help,
    reached: value >= marker.value,
  }));
  const helpId = knob.help === null ? undefined : `${id}-help`;
  return (
    <div className="knob">
      <div className="knob-head">
        <label className="knob-label" htmlFor={id}>{knob.label}</label>
        <span className="knob-value" aria-hidden="true">
          {display ?? value}
          {unit === null || unit === undefined ? null : <small>{unit}</small>}
        </span>
      </div>
      <div className="knob-track" style={{ ["--fill" as string]: `${fill}%` }}>
        <input
          id={id}
          type="range"
          min={knob.min}
          max={knob.max}
          step={knob.step}
          value={value}
          aria-describedby={[helpId, describedBy].filter(Boolean).join(" ") || undefined}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {knob.low_label === null && knob.high_label === null ? null : (
          <div className="knob-ends">
            <span>{knob.low_label ?? ""}</span>
            <span>{knob.high_label ?? ""}</span>
          </div>
        )}
        {markers.length < 2 ? null : (
          // The span between the first and last mark, drawn as a band. On the
          // materials slider that band *is* the nest-versus-child tension: it is
          // the range in which a being can afford one of the two and not both.
          <span
            className="knob-marker-band"
            style={{
              ["--from" as string]: String(((markers[0]?.value ?? 0) - knob.min) / (span || 1)),
              ["--to" as string]: String(((markers.at(-1)?.value ?? 0) - knob.min) / (span || 1)),
            }}
            aria-hidden="true"
          />
        )}
        {markers.length === 0 ? null : (
          <div className="knob-markers">
            {markers.map((marker) => (
              <span
                key={marker.value}
                className={`knob-marker${marker.reached ? " is-reached" : ""}`}
                style={{
                  ["--at" as string]: span === 0
                    ? "0"
                    : String((marker.value - knob.min) / span),
                }}
                title={marker.help ?? undefined}
              >
                <span className="knob-marker-label">{marker.label}</span>
                <span className="knob-marker-value">{marker.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      {knob.help === null ? null : (
        <p className="knob-help" id={helpId}>{knob.help}</p>
      )}
      {children}
    </div>
  );
}

export interface NumberFieldControlProps {
  readonly id: string;
  readonly knob: NumericKnob;
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly children?: ReactNode;
}

/**
 * A typed number bounded by the server's own knob.
 *
 * Used where a slider would be a lie about the control a viewer has: the land
 * seed runs over a million whole values, where one pixel of travel is a
 * thousand different worlds and the thumb can never be put back where it was.
 * A field can be read, typed, and copied; a slider cannot.
 */
export function NumberFieldControl({
  id,
  knob,
  value,
  onChange,
  children,
}: NumberFieldControlProps) {
  return (
    <div className="knob">
      <div className="knob-head">
        <label className="knob-label" htmlFor={id}>{knob.label}</label>
      </div>
      <input
        id={id}
        className="knob-number"
        type="number"
        min={knob.min}
        max={knob.max}
        step={knob.step}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
      {knob.help === null ? null : <p className="knob-help">{knob.help}</p>}
      {children}
    </div>
  );
}

export interface ChoiceKnobControlProps<TValue> {
  readonly knob: ChoiceKnob<TValue>;
  readonly value: TValue;
  readonly onChange: (value: TValue) => void;
  /** Rendered under the row — the consequence of the current choice. */
  readonly consequence?: ReactNode;
}

/**
 * A row of exclusive choices, drawn from the options the server offered.
 *
 * Rendered as pressed buttons rather than a `<select>` so every option — and so
 * every consequence a viewer is choosing between — is visible at once.
 */
export function ChoiceKnobControl<TValue extends string | number | null>({
  knob,
  value,
  onChange,
  consequence,
}: ChoiceKnobControlProps<TValue>) {
  return (
    <div className="knob">
      <div className="knob-head">
        <span className="knob-label">{knob.label}</span>
      </div>
      <div className="choice-row" role="group" aria-label={knob.label}>
        {knob.options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className="choice"
            aria-pressed={option.value === value}
            title={option.help ?? undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {knob.help === null ? null : <p className="knob-help">{knob.help}</p>}
      {consequence === undefined ? null : (
        <p className="choice-consequence">{consequence}</p>
      )}
    </div>
  );
}
