/**
 * The run-lifecycle contract, as seen from the screen that fills it in.
 *
 * Spec: `docs/superpowers/specs/2026-07-31-landing-and-config-design.md` §9.
 *
 * ```
 * POST /api/run/start   body: RunConfig -> 202 { run_id, status: "starting", warnings }
 * POST /api/run/stop                    -> 202 { run_id, status: "stopping" }
 * GET  /api/run                         -> RunMetadata (status honestly reported)
 * GET  /api/run/config                  -> { run_id, status, config, derived, warnings }
 * GET  /api/run/defaults                -> { defaults, knobs, regions, locked, derived }
 * ```
 *
 * Two rules this module exists to enforce:
 *
 * 1. **The screen hardcodes no bound and no knob label.** Every range, step,
 *    endpoint caption and slider marker is read from `GET /api/run/defaults`, so
 *    a tuning change in `core/constants.py` moves the screen with it. A defaults
 *    payload that is missing a knob is a hard parse failure — the screen refuses
 *    to invent a range rather than quietly offering a wrong one.
 * 2. **Nothing structural travels in `RunConfig`.** Regions are locked (spec §2)
 *    and are not in the payload; the coupled values (the mating-proposal timeout
 *    and the per-run memory root, spec §5) are derived by the server and are not
 *    in the payload either.
 *
 * **The server owns the wire shape; this module adapts to it.** The screen and
 * the API were built in parallel against the same spec section and disagreed on
 * `/api/run/defaults` in five places — the config lived under `defaults` not
 * `config`, the roster bounds under `beings.min_count`/`max_count` rather than a
 * `being_count` knob, per-being bounds under `beings.fields.*`, choice lists
 * under `choices` not `options`, and the tick interval under `locked`. The
 * server's shape is the richer one and is pinned by its own tests, so every
 * translation happens here, in one function, rather than the payload being bent
 * toward the screen. The domain types below are what the screen is written
 * against and did not move.
 */

// `formatDuration` reads a run length out in words. It is imported rather than
// duplicated so the option this module synthesises for the server's default run
// length is worded identically to every other run length on the screen. The
// import is one-way: `costEstimate` takes only types from here.
import { formatDuration } from "./costEstimate";

/**
 * Run lifecycle vocabulary from spec §9.
 *
 * `unknown` is not a server state — it is what this client reports when a server
 * answers with a status it does not recognise (an older build still saying
 * `"ready"`, for instance). Reporting `unknown` keeps a waiting screen waiting
 * instead of guessing that a world is alive.
 */
export type RunLifecycleStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "unknown";

const RUN_LIFECYCLE_STATUSES: readonly RunLifecycleStatus[] = [
  "starting",
  "running",
  "stopping",
  "stopped",
  "failed",
];

/** One being's starting conditions. `persona` is absent unless one was written. */
export interface BeingConfig {
  readonly name: string;
  readonly start_region: string;
  readonly energy: number;
  readonly materials: number;
  /** `null` means "born from the shared genesis seed" — the default. */
  readonly persona: string | null;
}

/** The complete set of knobs a viewer may set (spec §3.2). */
export interface RunConfig {
  readonly beings: readonly BeingConfig[];
  /** One multiplier applied to every region's regeneration rate together. */
  readonly abundance: number;
  /** Land shape, not reproducibility — see spec §4.2. */
  readonly seed: number;
  /** `null` means the run has no scheduled end. */
  readonly duration_seconds: number | null;
  readonly provider: string;
  readonly reflect_every_n_breaths: number;
  readonly max_offspring: number;
}

/** A fixed reference point drawn on a slider's track. */
export interface KnobMarker {
  readonly value: number;
  readonly label: string;
  readonly help: string | null;
}

/** Bounds and captions for one continuous knob. */
export interface NumericKnob {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly help: string | null;
  /** Caption for the low end of the track, e.g. "the land is dying". */
  readonly low_label: string | null;
  /** Caption for the high end of the track, e.g. "the land provides". */
  readonly high_label: string | null;
  /** Reference points drawn on the track itself, e.g. the 30-material floor. */
  readonly markers: readonly KnobMarker[];
  readonly unit: string | null;
}

/** One selectable value of a discrete knob. */
export interface ChoiceOption<TValue> {
  readonly value: TValue;
  readonly label: string;
  readonly help: string | null;
}

/** Options and caption for one discrete knob. */
export interface ChoiceKnob<TValue> {
  readonly label: string;
  readonly help: string | null;
  readonly options: readonly ChoiceOption<TValue>[];
}

/**
 * A place the minds can run, with the two consequences the screen must show.
 *
 * `cost_per_being_hour_usd` is `null` only when the server publishes no rate
 * **for this option**. A rate must be per-option or it cannot be multiplied: one
 * figure hung on the roster knob, attached to whichever place happens to be
 * chosen, would put a price on a run the server itself calls free. Where a rate
 * is absent the screen shows the option's own sentence rather than computing a
 * total it cannot stand behind — it never infers one from a neighbouring knob.
 *
 * A rate of exactly `0` is a *known* zero and reads as free; `null` is silence.
 */
export interface ProviderOption extends ChoiceOption<string> {
  readonly cost_per_being_hour_usd: number | null;
  /** Plain sentence about how fast a being thinks here. */
  readonly cadence: string | null;
}

/**
 * One of the four designed regions — display only.
 *
 * Regions are locked (spec §2): this rail shows what the land already is. The
 * key is the region's identity in the art registry, so it is passed through
 * untouched and never offered for editing.
 */
export interface RegionCard {
  readonly key: string;
  readonly title: string;
  readonly character: string;
  readonly energy_rate: number;
  readonly materials_rate: number;
}

/** The provider knob, whose options carry their own measured consequences. */
export interface ProviderKnob {
  readonly label: string;
  readonly help: string | null;
  readonly options: readonly ProviderOption[];
}

/** Every knob's bounds, keyed by the field it governs. */
export interface RunKnobs {
  readonly being_count: NumericKnob;
  readonly energy: NumericKnob;
  readonly materials: NumericKnob;
  readonly abundance: NumericKnob;
  readonly seed: NumericKnob;
  readonly max_offspring: NumericKnob;
  readonly duration: ChoiceKnob<number | null>;
  readonly provider: ProviderKnob;
  readonly reflect: ChoiceKnob<number>;
}

/** The whole payload the configuration screen is built from. */
export interface RunDefaults {
  readonly schema: 1;
  readonly config: RunConfig;
  readonly knobs: RunKnobs;
  /** Empty when the server does not describe the land; the rail then says so. */
  readonly regions: readonly RegionCard[];
  /**
   * Seconds per world tick, used to show effective per-second regeneration
   * beside the abundance slider (spec §5.3). `null` when the server is silent,
   * and the screen then states rates per tick rather than inventing a cadence.
   */
  readonly tick_interval_seconds: number | null;
  /**
   * Why the money on this screen is a magnitude and not a bill, in the server's
   * own words. `null` when it published none, and the screen then says nothing
   * rather than inventing a disclaimer it cannot stand behind.
   *
   * Two measured reasons, both of which make a bare figure a quiet lie: the
   * per-token prices behind the rate are unconfirmed placeholders, and cost per
   * hour is **not** flat within a run — lifecycle history accumulates into every
   * prompt, so measured prompt size grew roughly tenfold inside one run.
   */
  readonly cost_estimate_note: string | null;
}

/** The 202 body of `POST /api/run/start` and `POST /api/run/stop`. */
export interface RunStartAcknowledgement {
  readonly run_id: string;
  readonly status: RunLifecycleStatus;
  /**
   * The server's non-blocking cautions about a world that is legal but bleak —
   * every being alone, the land regenerating below what the roster drains,
   * nobody able to afford the mating floor. Empty when it had nothing to say.
   * These are judgements a viewer is entitled to make; they never refuse a start.
   */
  readonly warnings: readonly string[];
}

/** `GET /api/run`, read only for what the lifecycle needs. */
export interface RunLifecycle {
  readonly run_id: string;
  readonly status: RunLifecycleStatus;
  /** The server's own word, kept so an unrecognised status can be diagnosed. */
  readonly raw_status: string;
}

/** One per-field complaint from a rejected start. */
export interface RunConfigFieldError {
  readonly field: string;
  readonly message: string;
}

/** Raised when a server payload cannot be trusted to describe the screen. */
export class RunContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunContractError";
  }
}

/**
 * Reads `GET /api/run/defaults`, as the server actually sends it.
 *
 * The translations, each one a place the two halves disagreed:
 *
 * | the screen wants | the server sends |
 * |---|---|
 * | `config` | `defaults` |
 * | `knobs.being_count` | `knobs.beings.{label,help,min_count,max_count}` |
 * | `knobs.energy` / `knobs.materials` | `knobs.beings.fields.{energy,materials}` |
 * | `knobs.duration` / `knobs.reflect` | `knobs.duration_seconds` / `knobs.reflect_every_n_breaths` |
 * | a knob's `options` | a knob's `choices` |
 * | `low_label` / `high_label` | `min_label` / `max_label` |
 * | a marker's `value` | a marker's `at` |
 * | `regions[].key` / `.title` / `.character` | `regions[].name` / `.description` |
 * | `tick_interval_seconds` | `locked.world_tick_interval_seconds` |
 *
 * @param value - The decoded JSON body.
 * @returns Every default value and every bound the screen renders.
 * @throws RunContractError - When a knob, a bound or the default config is
 *   missing or incoherent. Refusing here is deliberate: a screen that silently
 *   substituted its own range would show a band the world does not have.
 */
export function parseRunDefaults(value: unknown): RunDefaults {
  const input = objectOf(value, "run defaults");
  const knobs = objectOf(input.knobs, "run defaults knobs");
  const beings = objectOf(knobs.beings, "knob beings");
  const fields = objectOf(beings.fields, "knob beings.fields");
  const locked = input.locked === undefined || input.locked === null
    ? {}
    : objectOf(input.locked, "run defaults locked");
  if (input.defaults === undefined) {
    throw new RunContractError(
      "run defaults has no `defaults` block"
      + (input.config === undefined ? "" : " (it sent `config`, which this contract does not use)"),
    );
  }
  const config = parseRunConfig(input.defaults);
  return {
    schema: 1,
    config,
    knobs: {
      being_count: rosterKnob(beings),
      energy: numericKnob(fields.energy, "beings.fields.energy"),
      materials: numericKnob(fields.materials, "beings.fields.materials"),
      abundance: numericKnob(knobs.abundance, "abundance"),
      seed: numericKnob(knobs.seed, "seed"),
      max_offspring: numericKnob(knobs.max_offspring, "max_offspring"),
      duration: withDefaultOption(
        choiceKnob(knobs.duration_seconds, "duration_seconds", nullableNumberValue),
        config.duration_seconds,
        formatDuration,
      ),
      provider: providerKnob(knobs.provider),
      reflect: choiceKnob(
        knobs.reflect_every_n_breaths,
        "reflect_every_n_breaths",
        (raw, field) => numberOf(raw, field),
      ),
    },
    regions: input.regions === undefined || input.regions === null
      ? []
      : arrayOf(input.regions, parseRegionCard, "regions"),
    tick_interval_seconds: nullableNumberOf(
      locked.world_tick_interval_seconds,
      "locked.world_tick_interval_seconds",
    ),
    cost_estimate_note: nullableStringOf(
      beings.cost_estimate_note,
      "knob beings.cost_estimate_note",
    ),
  };
}

/**
 * Reads `GET /api/run/config`, which wraps the config in run metadata.
 *
 * The server answers `{ schema, run_id, status, config, derived, warnings }`.
 * A bare config is accepted too, so one reader serves both this endpoint and the
 * `defaults` block of `/api/run/defaults`.
 *
 * @param value - The decoded JSON body.
 * @returns The configuration the current run started with.
 * @throws RunContractError - When the wrapped config is missing or malformed.
 */
export function parseRunConfigEnvelope(value: unknown): RunConfig {
  const input = objectOf(value, "run config envelope");
  return parseRunConfig(input.config === undefined ? input : input.config);
}

/**
 * Reads a `RunConfig` — the default one, or the one a live run started with.
 *
 * @param value - The decoded JSON body.
 * @returns The config with an explicit `persona: null` where none was written.
 * @throws RunContractError - When a required field is missing or has no beings.
 */
export function parseRunConfig(value: unknown): RunConfig {
  const input = objectOf(value, "run config");
  const beings = arrayOf(input.beings, parseBeingConfig, "beings");
  if (beings.length === 0) {
    throw new RunContractError("run config beings must not be empty");
  }
  return {
    beings,
    abundance: numberOf(input.abundance, "abundance"),
    seed: numberOf(input.seed, "seed"),
    duration_seconds: nullableNumberOf(input.duration_seconds, "duration_seconds"),
    provider: stringOf(input.provider, "provider"),
    reflect_every_n_breaths: numberOf(
      input.reflect_every_n_breaths,
      "reflect_every_n_breaths",
    ),
    max_offspring: numberOf(input.max_offspring, "max_offspring"),
  };
}

/**
 * Renders a `RunConfig` as the request body `POST /api/run/start` accepts.
 *
 * Omits `persona` entirely when it is absent or blank, so a being with no
 * written persona is born from the shared genesis seed rather than from an
 * empty string.
 */
export function serializeRunConfig(config: RunConfig): SerializedRunConfig {
  return {
    beings: config.beings.map((being) => {
      const persona = being.persona === null ? "" : being.persona.trim();
      return {
        name: being.name,
        start_region: being.start_region,
        energy: being.energy,
        materials: being.materials,
        ...(persona.length > 0 ? { persona } : {}),
      };
    }),
    abundance: config.abundance,
    seed: config.seed,
    duration_seconds: config.duration_seconds,
    provider: config.provider,
    reflect_every_n_breaths: config.reflect_every_n_breaths,
    max_offspring: config.max_offspring,
  };
}

/** The wire shape of a `RunConfig`, with `persona` present only when written. */
export interface SerializedRunConfig {
  readonly beings: readonly {
    readonly name: string;
    readonly start_region: string;
    readonly energy: number;
    readonly materials: number;
    readonly persona?: string;
  }[];
  readonly abundance: number;
  readonly seed: number;
  readonly duration_seconds: number | null;
  readonly provider: string;
  readonly reflect_every_n_breaths: number;
  readonly max_offspring: number;
}

/** Reads the 202 body of a start or stop, cautions included. */
export function parseRunStartAcknowledgement(value: unknown): RunStartAcknowledgement {
  const input = objectOf(value, "run acknowledgement");
  return {
    run_id: stringOf(input.run_id, "run_id"),
    status: lifecycleStatus(input.status),
    warnings: Array.isArray(input.warnings)
      ? input.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
  };
}

/**
 * Reads `GET /api/run` for lifecycle purposes only.
 *
 * Deliberately tolerant of the rest of `RunMetadata`: this call answers one
 * question — has the world this screen asked for actually come alive — and it
 * must keep answering it against a server that has not yet widened its status
 * vocabulary.
 */
export function parseRunLifecycle(value: unknown): RunLifecycle {
  const input = objectOf(value, "run metadata");
  const raw = input.status === undefined || input.status === null
    ? ""
    : stringOf(input.status, "status");
  return {
    run_id: stringOf(input.run_id, "run_id"),
    status: lifecycleStatus(raw),
    raw_status: raw,
  };
}

/**
 * Reads the per-field complaints from a rejected start.
 *
 * Three shapes are accepted, in the order they are looked for:
 *
 * 1. **`{ detail: { errors: [{ field, message }] } }`** — what this server sends.
 *    `RunConfigError.to_detail()` builds the list and FastAPI nests it under
 *    `detail`. Every bad field is reported in one pass, so the screen can mark
 *    them all at once instead of revealing them one submission at a time.
 * 2. **`{ errors: … }`** — the same list unwrapped, or the flat
 *    `{ field: message }` map the spec sketched.
 * 3. **`{ detail: [{ loc, msg }] }`** — FastAPI's own default, for a request
 *    rejected before `validate_run_config` ever sees it (malformed JSON body).
 *
 * Returns an empty list rather than guessing when the body says nothing
 * per-field; the caller then falls back to a whole-response message.
 */
export function parseRunStartRejection(value: unknown): readonly RunConfigFieldError[] {
  if (value === null || typeof value !== "object") return [];
  const input = value as Record<string, unknown>;
  const detail = input.detail;
  const nested = detail !== null && typeof detail === "object" && !Array.isArray(detail)
    ? (detail as Record<string, unknown>).errors
    : undefined;
  const errors = input.errors ?? nested;
  if (Array.isArray(errors)) return fieldErrorList(errors);
  if (errors !== null && errors !== undefined && typeof errors === "object") {
    return Object.entries(errors as Record<string, unknown>)
      .filter(([, message]) => typeof message === "string")
      .map(([field, message]) => ({ field, message: message as string }));
  }
  if (Array.isArray(detail)) return fieldErrorList(detail);
  return [];
}

/** Reads a list of per-field complaints in either the server's or FastAPI's spelling. */
function fieldErrorList(entries: readonly unknown[]): readonly RunConfigFieldError[] {
  return entries.flatMap((entry): readonly RunConfigFieldError[] => {
    if (entry === null || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const message = typeof record.message === "string"
      ? record.message
      : typeof record.msg === "string" ? record.msg : null;
    if (message === null) return [];
    const field = typeof record.field === "string"
      ? record.field
      : Array.isArray(record.loc)
        ? record.loc.filter((part) => part !== "body").join(".")
        : "";
    return [{ field, message }];
  });
}

function parseBeingConfig(value: unknown, field: string): BeingConfig {
  const input = objectOf(value, field);
  const persona = input.persona;
  return {
    name: stringOf(input.name, `${field}.name`),
    start_region: stringOf(input.start_region, `${field}.start_region`),
    energy: numberOf(input.energy, `${field}.energy`),
    materials: numberOf(input.materials, `${field}.materials`),
    persona: typeof persona === "string" && persona.trim().length > 0 ? persona : null,
  };
}

/**
 * Reads one region card from the server's `regions[]` entry.
 *
 * The server publishes a region's identity (`name`) and its authored character
 * (`description`) and nothing about how to display them. The title is the
 * identity title-cased, exactly as `observer2d/publicViewModels.ts` renders a
 * region name everywhere else in the piece, so the two screens agree; the
 * character is the authored sentence with its first letter raised, because
 * `config/world.yaml` writes them lowercase mid-sentence.
 */
function parseRegionCard(value: unknown, field: string): RegionCard {
  const input = objectOf(value, field);
  const key = stringOf(input.name, `${field}.name`);
  return {
    key,
    title: titleCase(key),
    character: sentenceCase(stringOf(input.description, `${field}.description`)),
    energy_rate: numberOf(input.energy_rate, `${field}.energy_rate`),
    materials_rate: numberOf(input.materials_rate, `${field}.materials_rate`),
  };
}

/**
 * Reads the roster size knob out of the beings knob's count fields.
 *
 * There is no `being_count` knob on the wire: the roster's bounds live beside
 * the per-being field bounds, under `knobs.beings`, because they describe the
 * same thing. A roster is whole beings, so the step is 1 by construction rather
 * than by a number the server had to send.
 */
function rosterKnob(beings: Record<string, unknown>): NumericKnob {
  const min = numberOf(beings.min_count, "knob beings.min_count");
  const max = numberOf(beings.max_count, "knob beings.max_count");
  if (!(max > min)) {
    throw new RunContractError(`knob beings has an inverted count range (${min}..${max})`);
  }
  return {
    label: stringOf(beings.label, "knob beings.label"),
    min,
    max,
    step: 1,
    help: nullableStringOf(beings.help, "knob beings.help"),
    low_label: null,
    high_label: null,
    markers: [],
    unit: null,
  };
}

/**
 * Reads one continuous knob.
 *
 * `step` is the one field allowed to be absent. It is a rendering granularity,
 * not a bound — the server validates the band, and a knob without a published
 * step is stepped by 1, which is the finest movement that is still a whole
 * being, a whole material or a whole seed. Every *bound* is still required, and
 * a missing one is still a hard failure.
 */
function numericKnob(value: unknown, field: string): NumericKnob {
  const input = objectOf(value, `knob ${field}`);
  const min = numberOf(input.min, `knob ${field}.min`);
  const max = numberOf(input.max, `knob ${field}.max`);
  if (!(max > min)) {
    throw new RunContractError(`knob ${field} has an inverted range (${min}..${max})`);
  }
  const step = input.step === undefined || input.step === null
    ? 1
    : numberOf(input.step, `knob ${field}.step`);
  if (!(step > 0)) {
    throw new RunContractError(`knob ${field} has a non-positive step (${step})`);
  }
  return {
    label: stringOf(input.label, `knob ${field}.label`),
    min,
    max,
    step,
    help: nullableStringOf(input.help, `knob ${field}.help`),
    low_label: nullableStringOf(input.min_label, `knob ${field}.min_label`),
    high_label: nullableStringOf(input.max_label, `knob ${field}.max_label`),
    markers: input.markers === undefined || input.markers === null
      ? []
      : arrayOf(input.markers, (raw, markerField) => {
        const marker = objectOf(raw, markerField);
        return {
          value: numberOf(marker.at, `${markerField}.at`),
          label: stringOf(marker.label, `${markerField}.label`),
          help: nullableStringOf(marker.help, `${markerField}.help`),
        };
      }, `knob ${field}.markers`),
    unit: nullableStringOf(input.unit, `knob ${field}.unit`),
  };
}

function choiceKnob<TValue>(
  value: unknown,
  field: string,
  readValue: (raw: unknown, valueField: string) => TValue,
): ChoiceKnob<TValue> {
  const input = objectOf(value, `knob ${field}`);
  const options = arrayOf(input.choices, (raw, optionField) => {
    const option = objectOf(raw, optionField);
    return {
      value: readValue(option.value, `${optionField}.value`),
      label: stringOf(option.label, `${optionField}.label`),
      help: nullableStringOf(option.help, `${optionField}.help`),
    };
  }, `knob ${field}.choices`);
  if (options.length === 0) {
    throw new RunContractError(`knob ${field} offers no choices`);
  }
  return {
    label: stringOf(input.label, `knob ${field}.label`),
    help: nullableStringOf(input.help, `knob ${field}.help`),
    options,
  };
}

/**
 * Puts the server's own default at the head of a choice list that omits it.
 *
 * The run-length knob defaults to 1800s and offers 900 / 3600 / 14400 /
 * unbounded. Without this the screen opens with no choice lit and no way back to
 * the length the world proposed for itself, because `setDuration` — correctly —
 * refuses any value the server did not offer. Nothing is invented: the value is
 * the server's `default`, and the label is that value read out in words.
 */
function withDefaultOption<TValue>(
  knob: ChoiceKnob<TValue>,
  current: TValue,
  label: (value: TValue) => string,
): ChoiceKnob<TValue> {
  if (knob.options.some((option) => option.value === current)) return knob;
  return {
    ...knob,
    options: [
      { value: current, label: label(current), help: "The length this world proposes for itself." },
      ...knob.options,
    ],
  };
}

/**
 * Reads the provider knob.
 *
 * `cadence` falls back to the option's own help sentence, so an older server
 * that states how fast a being thinks only in prose still reads correctly. See
 * {@link ProviderOption} for why no rate is inferred when none is published.
 */
function providerKnob(value: unknown): ProviderKnob {
  const input = objectOf(value, "knob provider");
  const options = arrayOf(input.choices, (raw, optionField): ProviderOption => {
    const option = objectOf(raw, optionField);
    const help = nullableStringOf(option.help, `${optionField}.help`);
    return {
      value: stringOf(option.value, `${optionField}.value`),
      label: stringOf(option.label, `${optionField}.label`),
      help,
      cost_per_being_hour_usd: nullableNumberOf(
        option.cost_per_being_hour_usd,
        `${optionField}.cost_per_being_hour_usd`,
      ),
      cadence: nullableStringOf(option.cadence, `${optionField}.cadence`) ?? help,
    };
  }, "knob provider.choices");
  if (options.length === 0) {
    throw new RunContractError("knob provider offers no choices");
  }
  return {
    label: stringOf(input.label, "knob provider.label"),
    help: nullableStringOf(input.help, "knob provider.help"),
    options,
  };
}

/** `nirvana_east` → `Nirvana East`, the way every other surface renders a region. */
function titleCase(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => (word.length === 0 ? word : word[0]?.toUpperCase() + word.slice(1)))
    .join(" ");
}

/** Raises the first letter of an authored fragment written to sit mid-sentence. */
function sentenceCase(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return trimmed;
  const stop = /[.!?]$/.test(trimmed) ? "" : ".";
  return `${trimmed[0]?.toUpperCase()}${trimmed.slice(1)}${stop}`;
}

function lifecycleStatus(value: unknown): RunLifecycleStatus {
  if (typeof value !== "string") return "unknown";
  const match = RUN_LIFECYCLE_STATUSES.find((status) => status === value);
  return match ?? "unknown";
}

function nullableNumberValue(value: unknown, field: string): number | null {
  return value === null ? null : numberOf(value, field);
}

function objectOf(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RunContractError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayOf<TItem>(
  value: unknown,
  read: (raw: unknown, field: string) => TItem,
  field: string,
): readonly TItem[] {
  if (!Array.isArray(value)) {
    throw new RunContractError(`${field} must be an array`);
  }
  return value.map((item, index) => read(item, `${field}[${index}]`));
}

function stringOf(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new RunContractError(`${field} must be a string`);
  }
  return value;
}

function nullableStringOf(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return stringOf(value, field);
}

function numberOf(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RunContractError(`${field} must be a finite number`);
  }
  return value;
}

function nullableNumberOf(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  return numberOf(value, field);
}
