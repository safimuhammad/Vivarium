/**
 * The configuration screen: the world's starting conditions, before it exists.
 *
 * Spec `docs/superpowers/specs/2026-07-31-landing-and-config-design.md` §3.
 * Three things about this screen are load-bearing and easy to lose:
 *
 * 1. **The region rail is a display, not a selector.** All four designed regions,
 *    always, in the order the server published them (richest first). There is no
 *    plus and no minus. Renaming or dropping one silently downgrades its art and,
 *    for `nirvana`, throws — so the screen never offers.
 * 2. **Abundance is one slider**, applied to all eight rates together, sitting
 *    directly beneath the rates it multiplies. The authored gradient survives in
 *    an advanced disclosure that shows every region's effective rate live.
 * 3. **The materials slider draws its own stakes.** The mating floor and the home
 *    cost are marks on the track. The gap between them *is* the nest-versus-child
 *    tension, and a viewer should be able to see they are choosing a position
 *    between two costs without being told so in a paragraph.
 *
 * Nothing on this screen is written into it. Every bound, caption, option and
 * marker arrives in the `/api/run/defaults` payload.
 */

import { useId, useMemo } from "react";

import { ChoiceKnobControl, NumberFieldControl, NumericKnobControl } from "./controls";
import {
  configNotices,
  regionKeys,
  rollSeed,
  setAbundance,
  setBeingCount,
  setBeingName,
  setBeingPersona,
  setBeingRegion,
  setDuration,
  setMaxOffspring,
  setProvider,
  setReflectEveryNBreaths,
  setSeed,
  setUniformEnergy,
  setUniformMaterials,
  uniformStock,
} from "./configModel";
import { personaDisclaimer, SEED_NOTE } from "./copy";
import { estimateRunCost, formatDuration, formatUsd } from "./costEstimate";
import type {
  RegionCard,
  RunConfig,
  RunConfigFieldError,
  RunDefaults,
} from "./runConfig";

/** Accent applied to each region card, ranked by how much the land gives there. */
const RICHNESS_ACCENTS: readonly string[] = [
  "var(--moss)",
  "var(--gold)",
  "var(--ember)",
  "var(--blood)",
];

export interface RunConfigScreenProps {
  readonly defaults: RunDefaults;
  readonly config: RunConfig;
  readonly onChange: (config: RunConfig) => void;
  readonly onBack: () => void;
  readonly onGoLive: () => void;
  /** True while a start is in flight; the action reports it rather than freezing. */
  readonly submitting: boolean;
  /** Per-field complaints from a rejected start. */
  readonly fieldErrors: readonly RunConfigFieldError[];
  /** Injected source for the dice roll, so a test can pin the land it draws. */
  readonly random?: () => number;
}

/** Renders the configuration screen. */
export function RunConfigScreen({
  defaults,
  config,
  onChange,
  onBack,
  onGoLive,
  submitting,
  fieldErrors,
  random,
}: RunConfigScreenProps) {
  const idPrefix = useId();
  const knobs = defaults.knobs;
  const stock = uniformStock(config);
  const cost = useMemo(() => estimateRunCost(config, defaults), [config, defaults]);
  const notices = useMemo(() => configNotices(config, defaults), [config, defaults]);
  const regions = defaults.regions;
  const accents = useMemo(() => richnessAccents(regions), [regions]);
  const occupancy = useMemo(() => {
    const counts = new Map<string, number>();
    for (const being of config.beings) {
      counts.set(being.start_region, (counts.get(being.start_region) ?? 0) + 1);
    }
    return counts;
  }, [config.beings]);
  const regionChoices = regionKeys(defaults);
  const regionTitle = useMemo(() => {
    const titles = new Map<string, string>();
    for (const region of regions) titles.set(region.key, region.title);
    return titles;
  }, [regions]);
  const materialMarks = [...knobs.materials.markers].sort((a, b) => a.value - b.value);
  const disclaimer = personaDisclaimer(config.reflect_every_n_breaths);

  return (
    <div className="gateway">
      <div className="config">
        <header className="config-header">
          <div>
            <p className="gateway-eyebrow">Before the first breath</p>
            <h1 className="config-header-title">Set the conditions</h1>
            <p className="config-header-lede">
              None of this is a goal. It is the state the world begins in — after
              that nothing is steered, and what happens is what happens.
            </p>
          </div>
          <button type="button" className="config-back" onClick={onBack}>
            ← Back
          </button>
        </header>

        <div className="config-body">
          {/* --------------------------------------------------------- land */}
          <fieldset className="config-section">
            <div className="config-section-head">
              <div>
                <p className="gateway-eyebrow">Locked</p>
                <legend className="config-section-title">The land</legend>
              </div>
              <p className="config-section-note">
                These four are the world, always. They cannot be added to or taken
                away — the gradient between them is the whole reason there is
                anywhere worth going.
              </p>
            </div>
            {regions.length === 0 ? (
              <p className="region-rail-empty">
                The land could not be read from the world&rsquo;s own description.
                The regions are unchanged; only their portrait is missing here.
              </p>
            ) : (
              <ul className="region-rail">
                {regions.map((region, index) => (
                  <li
                    key={region.key}
                    className="region-card"
                    style={{ ["--card-accent" as string]: accents[index] ?? "var(--edge)" }}
                  >
                    <h3 className="region-card-name">{region.title}</h3>
                    <p className="region-card-character">{region.character}</p>
                    <dl className="region-card-rates">
                      <div>
                        <dt>Energy</dt>
                        <dd className={region.energy_rate === 0 ? "is-nothing" : undefined}>
                          {formatRate(region.energy_rate * config.abundance)}
                        </dd>
                      </div>
                      <div>
                        <dt>Material</dt>
                        <dd className={region.materials_rate === 0 ? "is-nothing" : undefined}>
                          {region.materials_rate === 0
                            ? "none"
                            : formatRate(region.materials_rate * config.abundance)}
                        </dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            )}

            <div style={{ marginTop: 22 }}>
              <NumericKnobControl
                id={`${idPrefix}-abundance`}
                knob={knobs.abundance}
                value={config.abundance}
                display={`${round2(config.abundance)}×`}
                onChange={(value) => onChange(setAbundance(config, defaults, value))}
              >
                <details className="disclosure">
                  <summary>What that does to each region</summary>
                  <div className="disclosure-body">
                    {regions.length === 0 ? (
                      <p className="knob-help">
                        The per-region rates were not published with the defaults.
                      </p>
                    ) : (
                      <table className="rate-table">
                        <thead>
                          <tr>
                            <th scope="col">Region</th>
                            <th scope="col">
                              Energy {defaults.tick_interval_seconds === null
                                ? "per tick"
                                : `per ${formatSeconds(defaults.tick_interval_seconds)}`}
                            </th>
                            <th scope="col">Material</th>
                          </tr>
                        </thead>
                        <tbody>
                          {regions.map((region) => (
                            <tr key={region.key}>
                              <td className="is-region">{region.title}</td>
                              <td>{formatRate(region.energy_rate * config.abundance)}</td>
                              <td>
                                {region.materials_rate === 0
                                  ? "none"
                                  : formatRate(region.materials_rate * config.abundance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <p className="knob-help">
                      One multiplier, applied to every rate at once, so the
                      authored gradient between the regions is never flattened.
                    </p>
                  </div>
                </details>
              </NumericKnobControl>
            </div>
          </fieldset>

          {/* ------------------------------------------------------ beings */}
          <fieldset className="config-section">
            <div className="config-section-head">
              <div>
                <p className="gateway-eyebrow">The roster</p>
                <legend className="config-section-title">Who wakes</legend>
              </div>
              <p className="config-section-note">
                Names are labels, not characters. Who a being becomes is entirely
                its own, and it starts becoming it immediately.
              </p>
            </div>

            <div className="config-columns">
              <div>
                <NumericKnobControl
                  id={`${idPrefix}-count`}
                  knob={knobs.being_count}
                  value={config.beings.length}
                  onChange={(value) => onChange(setBeingCount(config, defaults, value))}
                >
                  {/* A total is shown only when the server published a rate for
                      the chosen place. When it did not, its own sentence about
                      that place is shown instead — a rate borrowed from another
                      knob would put a price on the run the server calls free.
                      The caveat under the table is not decoration: the prices
                      behind the rate are unconfirmed, and a being's prompt grows
                      through a run, so a flat per-hour figure understates a long
                      one. A number without that sentence would quietly lie. */}
                  {cost.perHourUsd === null ? (
                    <p className="knob-help">{cost.cadence ?? "The cost of this place is not published."}</p>
                  ) : (
                    <>
                      <dl className="estimate">
                        <div>
                          <dt>Per hour</dt>
                          <dd className="is-money">
                            {cost.free ? "nothing" : `about ${formatUsd(cost.perHourUsd)}`}
                          </dd>
                        </div>
                        <div>
                          <dt>{cost.bounded ? "This run" : "No end set"}</dt>
                          <dd className="is-money">
                            {cost.totalUsd === null
                              ? "runs until stopped"
                              : cost.free
                                ? "nothing"
                                : `about ${formatUsd(cost.totalUsd)}`}
                          </dd>
                        </div>
                        <div>
                          <dt>Cadence</dt>
                          <dd>{cost.cadence ?? "unknown"}</dd>
                        </div>
                      </dl>
                      {cost.free || defaults.cost_estimate_note === null ? null : (
                        <p className="estimate-caveat">{defaults.cost_estimate_note}</p>
                      )}
                    </>
                  )}
                </NumericKnobControl>
              </div>

              <div>
                <NumericKnobControl
                  id={`${idPrefix}-energy`}
                  knob={knobs.energy}
                  value={stock.energy ?? knobs.energy.min}
                  unit={knobs.energy.unit ?? "each"}
                  onChange={(value) => onChange(setUniformEnergy(config, defaults, value))}
                />
                <NumericKnobControl
                  id={`${idPrefix}-materials`}
                  knob={knobs.materials}
                  value={stock.materials ?? knobs.materials.min}
                  unit={knobs.materials.unit ?? "each"}
                  onChange={(value) => onChange(setUniformMaterials(config, defaults, value))}
                >
                  {materialMarks.length === 0 ? null : (
                    <p className="knob-marker-gap">
                      {materialGapSentence(
                        stock.materials ?? knobs.materials.min,
                        materialMarks[0]?.value ?? null,
                        materialMarks[1]?.value ?? null,
                      )}
                    </p>
                  )}
                </NumericKnobControl>
              </div>
            </div>

            <ul className="being-rail">
              {config.beings.map((being, index) => {
                const alone = (occupancy.get(being.start_region) ?? 0) === 1
                  && config.beings.length > 1;
                return (
                  <li className="being-card" key={index}>
                    <p className="being-card-index">Being {index + 1}</p>
                    <input
                      className="being-name"
                      type="text"
                      value={being.name}
                      aria-label={`Name of being ${index + 1}`}
                      onChange={(event) => onChange(
                        setBeingName(config, index, event.target.value),
                      )}
                    />
                    <span className="being-field-label">Wakes in</span>
                    <div className="being-regions" role="group" aria-label={`Where being ${index + 1} wakes`}>
                      {regionChoices.map((key) => (
                        <button
                          key={key}
                          type="button"
                          className="being-region"
                          aria-pressed={being.start_region === key}
                          onClick={() => onChange(setBeingRegion(config, defaults, index, key))}
                        >
                          {regionTitle.get(key) ?? key}
                        </button>
                      ))}
                    </div>
                    {alone ? <p className="being-alone">Wakes alone.</p> : null}
                    <details
                      className={`being-persona${being.persona === null ? "" : " being-persona-written"}`}
                    >
                      <summary>
                        {being.persona === null ? "Write a birth nature" : "Birth nature written"}
                      </summary>
                      <textarea
                        className="persona-input"
                        value={being.persona ?? ""}
                        placeholder="Leave this empty and the being is born from the same words as every other — that it is awake, its own, and free to decide who it is."
                        aria-label={`Birth nature of being ${index + 1}`}
                        onChange={(event) => onChange(
                          setBeingPersona(config, index, event.target.value),
                        )}
                      />
                      <div className="persona-disclaimer">
                        {disclaimer.map((line) => <p key={line.slice(0, 20)}>{line}</p>)}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          {/* -------------------------------------------------------- seed */}
          <fieldset className="config-section">
            <div className="config-section-head">
              <div>
                <p className="gateway-eyebrow">Terrain</p>
                <legend className="config-section-title">The shape of the land</legend>
              </div>
              {/* The server publishes this sentence itself. The spec-owned copy
                  stays as the fallback for a server that does not, so the note
                  is never said twice and never missing. */}
              <p className="config-section-note">{knobs.seed.help ?? SEED_NOTE}</p>
            </div>
            <div className="config-columns">
              <NumberFieldControl
                id={`${idPrefix}-seed`}
                // The sentence is already the section's note, directly above.
                knob={{ ...knobs.seed, help: null }}
                value={config.seed}
                onChange={(value) => onChange(setSeed(config, defaults, value))}
              >
                <div className="choice-row" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="choice"
                    onClick={() => onChange(rollSeed(config, defaults, random ?? Math.random))}
                  >
                    Draw a different land
                  </button>
                </div>
              </NumberFieldControl>
            </div>
          </fieldset>

          {/* ------------------------------------------------------ running */}
          <fieldset className="config-section">
            <div className="config-section-head">
              <div>
                <p className="gateway-eyebrow">Cadence and cost</p>
                <legend className="config-section-title">How it runs</legend>
              </div>
              <p className="config-section-note">
                Where the minds run decides both what a run costs and how fast a
                being thinks. Everything else about the world is unchanged by it.
              </p>
            </div>
            <div className="config-columns">
              <ChoiceKnobControl
                knob={knobs.duration}
                value={config.duration_seconds}
                onChange={(value) => onChange(setDuration(config, defaults, value))}
                consequence={
                  cost.bounded
                    ? `Ends on its own after ${formatDuration(config.duration_seconds)}.`
                    : "Runs until someone stops it."
                }
              />
              <ChoiceKnobControl
                knob={knobs.provider}
                value={config.provider}
                onChange={(value) => onChange(setProvider(config, defaults, value))}
                consequence={
                  cost.free
                    ? `Costs nothing, and thinks slowly — ${cost.cadence ?? "cadence unknown"}.`
                    : cost.perHourUsd === null
                      ? cost.cadence ?? "This place publishes no cost or cadence."
                      : `${formatUsd(cost.perHourUsd)} an hour for ${config.beings.length} beings — ${cost.cadence ?? "cadence unknown"}.`
                }
              />
              <ChoiceKnobControl
                knob={knobs.reflect}
                value={config.reflect_every_n_breaths}
                onChange={(value) => onChange(setReflectEveryNBreaths(config, defaults, value))}
                // Only when the server said nothing itself — it now says very
                // nearly this, and the screen must not repeat it back.
                consequence={knobs.reflect.help === null
                  ? "How fast a being's own account of itself appears beneath the words you wrote for it."
                  : undefined}
              />
              <details className="disclosure">
                <summary>Rarely touched</summary>
                <div className="disclosure-body">
                  <NumericKnobControl
                    id={`${idPrefix}-offspring`}
                    knob={knobs.max_offspring}
                    value={config.max_offspring}
                    onChange={(value) => onChange(setMaxOffspring(config, defaults, value))}
                  />
                  <p className="knob-help">
                    The ceiling on how many children one being may have. It is what
                    keeps a thriving world from becoming an exploding one.
                  </p>
                </div>
              </details>
            </div>
          </fieldset>
        </div>

        <div className="config-bar">
          <div className="config-bar-notices">
            {fieldErrors.length === 0 ? null : (
              <ul className="config-errors">
                {fieldErrors.map((error) => (
                  <li key={error.field}>
                    {error.field === "" ? error.message : `${error.field}: ${error.message}`}
                  </li>
                ))}
              </ul>
            )}
            {notices.map((notice) => (
              <p
                key={notice.id}
                className={`config-notice${notice.tone === "caution" ? " is-caution" : ""}`}
              >
                {notice.message}
              </p>
            ))}
            <p className="config-bar-summary">
              <strong>{config.beings.length}</strong>
              {config.beings.length === 1 ? " being" : " beings"}
              {" · land at "}<strong>{round2(config.abundance)}×</strong>
              {" · "}<strong>{formatDuration(config.duration_seconds)}</strong>
              {cost.free
                ? " · costs nothing"
                : cost.totalUsd === null ? "" : ` · about ${formatUsd(cost.totalUsd)}`}
            </p>
          </div>
          <button
            type="button"
            className="go-live"
            disabled={submitting}
            onClick={onGoLive}
          >
            {submitting ? "Waking the world…" : "Let's go live"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Ranks the published regions by how much energy they give and returns an
 * accent per card in the published order.
 *
 * The colour is not decoration: it reports the authored richness gradient that
 * makes one part of the world worth walking to.
 */
function richnessAccents(regions: readonly RegionCard[]): readonly string[] {
  const ranked = [...regions]
    .map((region, index) => ({ index, rate: region.energy_rate + region.materials_rate }))
    .sort((a, b) => b.rate - a.rate);
  const accents = new Array<string>(regions.length).fill("var(--edge)");
  ranked.forEach((entry, rank) => {
    accents[entry.index] = RICHNESS_ACCENTS[Math.min(rank, RICHNESS_ACCENTS.length - 1)]
      ?? "var(--edge)";
  });
  return accents;
}

/**
 * Says where the chosen starting materials sit between the two costs the server
 * marked on the track. Silent when the server published no marks.
 */
function materialGapSentence(
  value: number,
  child: number | null,
  home: number | null,
): string {
  if (child === null) return "";
  if (home === null) {
    return value >= child
      ? `Enough to put a child into the world straight away.`
      : `${child - value} short of what a pair must put toward a child.`;
  }
  if (value >= home) {
    return `Enough to raise a hall outright — or to choose a child instead, and still have ${value - child} left.`;
  }
  if (value >= child) {
    return `Enough for a child now. A hall is ${home - value} further off. They cannot have both.`;
  }
  return `Short of both: ${child - value} from a child, ${home - value} from a hall. They gather first.`;
}

function formatRate(rate: number): string {
  const rounded = Math.round(rate * 1000) / 1000;
  return rounded === 0 ? "0" : String(rounded);
}

function formatSeconds(seconds: number): string {
  return seconds === 1 ? "second" : `${round2(seconds)}s`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
