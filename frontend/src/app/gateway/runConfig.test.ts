import { describe, expect, it } from "vitest";

import { MOCK_RUN_DEFAULTS_PAYLOAD } from "./mockRunLifecycleClient";
import {
  parseRunConfig,
  parseRunConfigEnvelope,
  parseRunDefaults,
  parseRunLifecycle,
  parseRunStartAcknowledgement,
  parseRunStartRejection,
  serializeRunConfig,
} from "./runConfig";

/**
 * A fresh copy of the payload the real server answers `GET /api/run/defaults`
 * with. Every test that mutates it works on its own copy.
 */
function defaultsPayload(): Record<string, unknown> {
  return structuredClone(MOCK_RUN_DEFAULTS_PAYLOAD);
}

function knobsOf(payload: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return payload.knobs as Record<string, Record<string, unknown>>;
}

describe("parseRunDefaults", () => {
  it("reads the server's own payload: defaults, not config", () => {
    const defaults = parseRunDefaults(defaultsPayload());

    expect(defaults.config.beings).toHaveLength(4);
    expect(defaults.config.beings[0]).toEqual({
      name: "Joe",
      start_region: "warm_springs",
      energy: 100,
      materials: 45,
      persona: null,
    });
    expect(defaults.config.abundance).toBe(1);
    expect(defaults.config.seed).toBe(7);
    expect(defaults.config.provider).toBe("mlx");
  });

  it("reads the roster bounds out of the beings knob's own count fields", () => {
    const knob = parseRunDefaults(defaultsPayload()).knobs.being_count;

    expect(knob.label).toBe("The beings");
    expect(knob.min).toBe(1);
    expect(knob.max).toBe(12);
    expect(knob.step).toBe(1);
    expect(knob.help).toContain("biggest lever on cost");
  });

  it("reads the per-being bounds out of the beings knob's fields", () => {
    const knobs = parseRunDefaults(defaultsPayload()).knobs;

    expect(knobs.energy).toMatchObject({ label: "Starting energy", min: 50, max: 200 });
    expect(knobs.materials).toMatchObject({ label: "Starting materials", min: 0, max: 100 });
    expect(knobs.energy.help).toContain("frozen");
  });

  it("reads the abundance endpoint captions from min_label/max_label", () => {
    const knob = parseRunDefaults(defaultsPayload()).knobs.abundance;

    expect(knob.low_label).toBe("the land is dying");
    expect(knob.high_label).toBe("the land provides");
    expect(knob.step).toBe(0.05);
  });

  it("reads the materials marks from the server's `at`, keeping both costs", () => {
    expect(parseRunDefaults(defaultsPayload()).knobs.materials.markers).toEqual([
      { value: 30, label: "a child", help: null },
      { value: 80, label: "a home", help: null },
    ]);
  });

  it("reads the choice knobs from `choices`, under the field names they set", () => {
    const knobs = parseRunDefaults(defaultsPayload()).knobs;

    expect(knobs.duration.options.map((option) => option.value))
      .toEqual([1800, 900, 3600, 14400, null]);
    expect(knobs.reflect.options.map((option) => option.value)).toEqual([6, 12, 24]);
    expect(knobs.provider.options.map((option) => option.value))
      .toEqual(["mlx", "gemini", "ollama"]);
  });

  it("offers the server's own default run length even when its choices omit it", () => {
    // The server's default is 1800s and its four choices are 900/3600/14400/
    // unbounded. Without this the screen opens with nothing selected and no way
    // back to the length the world itself proposed.
    const duration = parseRunDefaults(defaultsPayload()).knobs.duration;

    expect(duration.options[0]).toEqual({
      value: 1800,
      label: "30 minutes",
      help: "The length this world proposes for itself.",
    });
  });

  it("reads a rate and a cadence per place, both from the server", () => {
    const options = parseRunDefaults(defaultsPayload()).knobs.provider.options;
    const mlx = options.find((option) => option.value === "mlx");
    const gemini = options.find((option) => option.value === "gemini");
    const ollama = options.find((option) => option.value === "ollama");

    expect(mlx).toMatchObject({
      label: "This Mac · MLX",
      cadence: "one being at a time",
      cost_per_being_hour_usd: 0,
    });
    expect(gemini).toMatchObject({
      label: "The cloud",
      cadence: "a breath every second or two",
      cost_per_being_hour_usd: 3,
    });
    expect(ollama).toMatchObject({
      cost_per_being_hour_usd: 0,
      cadence: "minutes between breaths, one being at a time",
    });
  });

  it("invents no rate for a place the server described without one", () => {
    // A known zero (free) and an unpublished rate are different facts, and the
    // screen must never turn silence into a price.
    const payload = defaultsPayload();
    const choices = knobsOf(payload).provider.choices as Record<string, unknown>[];
    const gemini = choices.find((choice) => choice.value === "gemini");
    if (gemini === undefined) throw new Error("the captured payload has no Gemini choice");
    delete gemini.cost_per_being_hour_usd;
    delete gemini.cadence;

    const options = parseRunDefaults(payload).knobs.provider.options;
    const geminiOption = options.find((option) => option.value === "gemini");

    expect(geminiOption?.cost_per_being_hour_usd).toBeNull();
    // Falls back to the option's own prose so an older server still reads right.
    expect(geminiOption?.cadence).toContain("Every being thinks at once");
  });

  it("carries the server's cost caveat, and invents none when it publishes none", () => {
    expect(parseRunDefaults(defaultsPayload()).cost_estimate_note)
      .toContain("Indicative, not a quote");

    const payload = defaultsPayload();
    delete knobsOf(payload).beings.cost_estimate_note;

    expect(parseRunDefaults(payload).cost_estimate_note).toBeNull();
  });

  it("reads the region rail from name/description, title-cased as elsewhere", () => {
    const regions = parseRunDefaults(defaultsPayload()).regions;

    expect(regions.map((region) => region.key))
      .toEqual(["nirvana", "nirvana_east", "warm_springs", "nirvana_west"]);
    expect(regions[1]).toEqual({
      key: "nirvana_east",
      title: "Nirvana East",
      character: "A struggling, near-barren stretch.",
      energy_rate: 0.1,
      materials_rate: 0.1,
    });
  });

  it("reads the tick interval from `locked`, where a value nobody may set belongs", () => {
    expect(parseRunDefaults(defaultsPayload()).tick_interval_seconds).toBe(5);
  });

  it("keeps optional presentation fields nullable rather than inventing them", () => {
    const payload = defaultsPayload();
    delete payload.locked;
    delete payload.regions;

    const defaults = parseRunDefaults(payload);

    expect(defaults.tick_interval_seconds).toBeNull();
    expect(defaults.regions).toEqual([]);
  });

  it("rejects a payload with no bounds rather than falling back to invented ones", () => {
    const payload = defaultsPayload();
    delete knobsOf(payload).abundance;

    expect(() => parseRunDefaults(payload)).toThrow(/abundance/);
  });

  it("rejects a knob whose range is inverted", () => {
    const payload = defaultsPayload();
    const fields = knobsOf(payload).beings?.fields as Record<string, Record<string, unknown>>;
    fields.energy = { label: "Starting energy", min: 200, max: 50 };

    expect(() => parseRunDefaults(payload)).toThrow(/energy/);
  });

  it("rejects a choice knob with no options", () => {
    const payload = defaultsPayload();
    knobsOf(payload).reflect_every_n_breaths = {
      label: "How often a being reflects",
      choices: [],
    };

    expect(() => parseRunDefaults(payload)).toThrow(/reflect/);
  });

  it("rejects the shape the screen was written against before the server shipped", () => {
    // The frontend half read `config` and a top-level `tick_interval_seconds`.
    // Refusing that outright is what keeps this seam from silently reopening.
    const payload = defaultsPayload();
    payload.config = payload.defaults;
    delete payload.defaults;

    expect(() => parseRunDefaults(payload)).toThrow(/defaults/);
  });
});

describe("parseRunConfig", () => {
  it("round-trips through serialize without inventing keys", () => {
    const config = parseRunConfig(defaultsPayload().defaults);

    expect(serializeRunConfig(config)).toEqual({
      beings: [
        { name: "Joe", start_region: "warm_springs", energy: 100, materials: 45 },
        { name: "Mae", start_region: "warm_springs", energy: 100, materials: 45 },
        { name: "Dick", start_region: "nirvana", energy: 100, materials: 45 },
        { name: "Allen", start_region: "nirvana", energy: 100, materials: 45 },
      ],
      abundance: 1,
      seed: 7,
      duration_seconds: 1800,
      provider: "mlx",
      reflect_every_n_breaths: 12,
      max_offspring: 5,
    });
  });

  it("carries a persona only when one was written", () => {
    const raw = defaultsPayload().defaults as Record<string, unknown>;
    raw.beings = [
      { name: "Joe", start_region: "nirvana", energy: 100, materials: 45, persona: "  " },
      {
        name: "Mae",
        start_region: "nirvana",
        energy: 100,
        materials: 45,
        persona: "A keeper of fires.",
      },
    ];

    const serialized = serializeRunConfig(parseRunConfig(raw));

    expect(serialized.beings[0]).not.toHaveProperty("persona");
    expect(serialized.beings[1]?.persona).toBe("A keeper of fires.");
  });

  it("rejects a run with no beings", () => {
    const raw = defaultsPayload().defaults as Record<string, unknown>;
    raw.beings = [];

    expect(() => parseRunConfig(raw)).toThrow(/beings/);
  });

  it("accepts an unbounded run length", () => {
    const raw = defaultsPayload().defaults as Record<string, unknown>;
    raw.duration_seconds = null;

    expect(parseRunConfig(raw).duration_seconds).toBeNull();
  });
});

describe("parseRunConfigEnvelope", () => {
  it("unwraps the config a live run started with", () => {
    const envelope = {
      schema: 1,
      run_id: "run-3",
      status: "running",
      config: defaultsPayload().defaults,
      derived: { mating_proposal_timeout_seconds: 45 },
      warnings: ["The land regenerates about 0.12 energy a second."],
    };

    expect(parseRunConfigEnvelope(envelope).beings).toHaveLength(4);
  });

  it("still reads a bare config, so the two endpoints share one reader", () => {
    expect(parseRunConfigEnvelope(defaultsPayload().defaults).seed).toBe(7);
  });
});

describe("parseRunStartAcknowledgement", () => {
  it("reads the 202 body", () => {
    expect(parseRunStartAcknowledgement({ run_id: "run-9", status: "starting" })).toEqual({
      run_id: "run-9",
      status: "starting",
      warnings: [],
    });
  });

  it("carries the server's non-blocking cautions about a bleak-but-legal world", () => {
    const acknowledgement = parseRunStartAcknowledgement({
      run_id: "run-9",
      status: "starting",
      warnings: [
        "Every being begins alone in a different region.",
        "No being starts with the 30 materials a mating proposal costs.",
      ],
    });

    expect(acknowledgement.warnings).toHaveLength(2);
    expect(acknowledgement.warnings[0]).toContain("begins alone");
  });

  it("does not pretend an unknown status is running", () => {
    expect(parseRunStartAcknowledgement({ run_id: "run-9", status: "warming" }).status).toBe(
      "unknown",
    );
  });
});

describe("parseRunLifecycle", () => {
  it.each([
    ["starting", "starting"],
    ["running", "running"],
    ["stopping", "stopping"],
    ["stopped", "stopped"],
    ["failed", "failed"],
  ])("maps %s through unchanged", (raw, expected) => {
    expect(parseRunLifecycle({ run_id: "r", status: raw }).status).toBe(expected);
  });

  it("preserves the raw status so an older server can be diagnosed", () => {
    const lifecycle = parseRunLifecycle({ run_id: "r", status: "ready" });

    expect(lifecycle.status).toBe("unknown");
    expect(lifecycle.raw_status).toBe("ready");
  });

  it("tolerates the metadata a live run carries alongside status", () => {
    const lifecycle = parseRunLifecycle({
      schema: 1,
      run_id: "run-42",
      status: "running",
      seed: 7,
      world_time: 12.5,
    });

    expect(lifecycle).toEqual({ run_id: "run-42", status: "running", raw_status: "running" });
  });

  it("rejects a body with no run id", () => {
    expect(() => parseRunLifecycle({ status: "running" })).toThrow(/run_id/);
  });
});

describe("parseRunStartRejection", () => {
  it("reads the 422 body this server actually sends", () => {
    // `RunConfigError.to_detail()` nests a LIST of {field, message} under
    // FastAPI's `detail`. Neither the flat map nor FastAPI's own list shape
    // matches it, so the screen showed one generic banner and no bad field.
    expect(
      parseRunStartRejection({
        detail: {
          errors: [
            { field: "beings.1.energy", message: "Starting energy must be between 50 and 200." },
            { field: "abundance", message: "World abundance must be between 0.25x and 3.0x." },
          ],
        },
      }),
    ).toEqual([
      { field: "beings.1.energy", message: "Starting energy must be between 50 and 200." },
      { field: "abundance", message: "World abundance must be between 0.25x and 3.0x." },
    ]);
  });

  it("reads the same list unwrapped, in case it is ever sent at the top level", () => {
    expect(
      parseRunStartRejection({
        errors: [{ field: "seed", message: "The seed must be a whole number." }],
      }),
    ).toEqual([{ field: "seed", message: "The seed must be a whole number." }]);
  });

  it("reads the flat map shape", () => {
    expect(
      parseRunStartRejection({
        errors: { "beings[1].materials": "must be between 0 and 100", abundance: "too high" },
      }),
    ).toEqual([
      { field: "beings[1].materials", message: "must be between 0 and 100" },
      { field: "abundance", message: "too high" },
    ]);
  });

  it("reads FastAPI's detail list shape", () => {
    expect(
      parseRunStartRejection({
        detail: [{ loc: ["body", "beings", 1, "materials"], msg: "must be between 0 and 100" }],
      }),
    ).toEqual([{ field: "beings.1.materials", message: "must be between 0 and 100" }]);
  });

  it("returns nothing readable rather than guessing", () => {
    expect(parseRunStartRejection({ detail: "server exploded" })).toEqual([]);
    expect(parseRunStartRejection(null)).toEqual([]);
  });
});
