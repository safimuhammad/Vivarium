/**
 * The wire contract, pinned from the frontend's side.
 *
 * `runApiContract.json` is not written by hand: `tests/server/frontend_contract_test.py`
 * drives the real application object through every interaction this screen makes and
 * asserts that file still matches, so a server-side shape change turns the Python
 * suite red on its own. This file is the other half — it runs the **real parsers**
 * over those **real bodies**, so a parser that can no longer read them turns this
 * suite red instead. Between the two, a divergence fails loudly on whichever side
 * moved, which is precisely what did not happen when three mismatches shipped
 * between two halves that were each green in isolation.
 *
 * Two of those three were on error paths. The 422 body and the warnings path are
 * therefore first-class here, not an afterthought.
 */

import { describe, expect, it } from "vitest";

import CONTRACT from "./runApiContract.json";
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
import { parseRunMetadata, RUN_STATUSES } from "../schemas";

interface CapturedInteraction {
  readonly note: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly request?: unknown;
  readonly body: unknown;
}

const contract = CONTRACT as unknown as {
  readonly lifecycle_statuses: readonly string[];
  readonly interactions: Readonly<Record<string, CapturedInteraction>>;
};

function captured(name: string): CapturedInteraction {
  const interaction = contract.interactions[name];
  if (interaction === undefined) {
    throw new Error(`the capture has no interaction named ${name}`);
  }
  return interaction;
}

/** A fresh copy, so a parser that mutated its input could not hide it here. */
function body(name: string): unknown {
  return structuredClone(captured(name).body);
}

describe("the captured contract itself", () => {
  it("covers every interaction the screen makes", () => {
    expect(Object.keys(contract.interactions).sort()).toEqual([
      "run_config",
      "run_defaults",
      "run_metadata",
      "run_start_accepted",
      "run_start_rejected",
      "run_start_with_warnings",
      "run_stop",
    ]);
  });

  it("records the status each interaction really answered with", () => {
    expect(captured("run_defaults").status).toBe(200);
    expect(captured("run_start_accepted").status).toBe(202);
    expect(captured("run_start_with_warnings").status).toBe(202);
    expect(captured("run_start_rejected").status).toBe(422);
    expect(captured("run_metadata").status).toBe(200);
    expect(captured("run_config").status).toBe(200);
    expect(captured("run_stop").status).toBe(202);
  });
});

describe("the run status vocabulary", () => {
  it("is the same list on both sides", () => {
    // Mismatch #1: a closed three-value enum that threw the instant a viewer
    // pressed the button, because the server legitimately answers `starting`.
    expect([...RUN_STATUSES]).toEqual([...contract.lifecycle_statuses]);
  });

  it("parses run metadata carrying any of them", () => {
    const metadata = body("run_metadata") as Record<string, unknown>;

    for (const status of contract.lifecycle_statuses) {
      expect(parseRunMetadata({ ...metadata, status }).status).toBe(status);
    }
  });

  it("still refuses a status neither side knows", () => {
    const metadata = body("run_metadata") as Record<string, unknown>;

    expect(() => parseRunMetadata({ ...metadata, status: "warming" })).toThrow();
  });
});

describe("GET /api/run/defaults", () => {
  it("parses, with every knob the screen renders read from the real body", () => {
    const defaults = parseRunDefaults(body("run_defaults"));

    expect(defaults.config.beings).toHaveLength(4);
    expect(defaults.knobs.being_count.min).toBe(1);
    expect(defaults.knobs.being_count.max).toBe(12);
    expect(defaults.knobs.energy.min).toBe(50);
    expect(defaults.knobs.materials.markers.map((mark) => mark.value)).toEqual([30, 80]);
    expect(defaults.knobs.abundance.low_label).toBe("the land is dying");
    expect(defaults.knobs.seed.max).toBe(2_147_483_647);
    expect(defaults.knobs.provider.options.map((option) => option.value))
      .toEqual(["gemini", "ollama"]);
    expect(defaults.knobs.duration.options.length).toBeGreaterThanOrEqual(4);
    expect(defaults.knobs.reflect.options.map((option) => option.value)).toEqual([6, 12, 24]);
    expect(defaults.regions.map((region) => region.key)).toEqual([
      "nirvana",
      "nirvana_east",
      "warm_springs",
      "nirvana_west",
    ]);
    expect(defaults.tick_interval_seconds).toBe(5);
  });

  it("carries a rate and a cadence for every place the minds can run", () => {
    const options = parseRunDefaults(body("run_defaults")).knobs.provider.options;

    for (const option of options) {
      expect(option.cost_per_being_hour_usd).not.toBeNull();
      expect(option.cadence).not.toBeNull();
    }
  });

  it("carries the estimate's honesty caveat", () => {
    expect(parseRunDefaults(body("run_defaults")).cost_estimate_note)
      .toContain("Indicative, not a quote");
  });

  it("is exactly what the mock client serves, so the mock cannot drift", () => {
    // The mock is a capture too. Pinning it against this one is what makes a
    // re-capture propagate rather than leave a second, staler copy behind.
    expect(MOCK_RUN_DEFAULTS_PAYLOAD).toEqual(body("run_defaults"));
  });

  it("round-trips its own defaults through the wire shape unchanged", () => {
    const defaults = parseRunDefaults(body("run_defaults"));

    expect(parseRunConfig(serializeRunConfig(defaults.config))).toEqual(defaults.config);
  });

  it("parses the body the server itself accepted to the config the screen opens with", () => {
    // The screen omits `persona` where none was written; the server publishes it as
    // an explicit `null`. Both are accepted, and both mean the same world — which is
    // only checkable by parsing them, not by comparing bytes.
    const defaults = parseRunDefaults(body("run_defaults"));
    const request = structuredClone(captured("run_start_accepted").request);

    expect(parseRunConfig(request)).toEqual(defaults.config);
  });
});

describe("POST /api/run/start", () => {
  it("reads the 202 acknowledgement", () => {
    const ack = parseRunStartAcknowledgement(body("run_start_accepted"));

    expect(ack.status).toBe("starting");
    expect(ack.run_id).not.toBe("");
    expect(ack.warnings.every((warning) => typeof warning === "string")).toBe(true);
  });

  it("reads the cautions off a bleak-but-accepted world", () => {
    // Mismatch #3b: these were parsed and then dropped on the floor, which is the
    // whole non-blocking path — a world that is legal and grim, said out loud.
    const ack = parseRunStartAcknowledgement(body("run_start_with_warnings"));
    const ordinary = parseRunStartAcknowledgement(body("run_start_accepted"));

    expect(ack.status).toBe("starting");
    expect(ack.warnings.some((warning) => warning.includes("begins alone"))).toBe(true);
    // The world's own defaults are already lean enough to earn one caution; the
    // bleak draft earns strictly more, and is still accepted rather than refused.
    expect(ack.warnings.length).toBeGreaterThan(ordinary.warnings.length);
  });

  it("reads every per-field complaint out of the real 422 body", () => {
    // Mismatch #3: `{detail: {errors: [{field, message}]}}` matched neither branch
    // the parser had, so `fieldErrors` came back empty and no per-field message had
    // ever reached the screen. This is the assertion that could have caught it.
    const errors = parseRunStartRejection(body("run_start_rejected"));

    expect(errors.length).toBeGreaterThanOrEqual(3);
    const fields = errors.map((error) => error.field);
    expect(fields).toContain("beings.0.name");
    expect(fields).toContain("beings.1.start_region");
    expect(fields).toContain("beings.1.energy");
    for (const error of errors) {
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it("names the bad field in a path the screen can show beside a knob", () => {
    const errors = parseRunStartRejection(body("run_start_rejected"));

    for (const error of errors) {
      expect(error.field).toMatch(/^[a-z_]+(\.\d+)?(\.[a-z_]+)*$/);
    }
  });
});

describe("GET /api/run and /api/run/config", () => {
  it("reads the lifecycle off the real metadata body", () => {
    const lifecycle = parseRunLifecycle(body("run_metadata"));

    expect(lifecycle.status).toBe("running");
    expect(lifecycle.raw_status).toBe("running");
  });

  it("parses the whole metadata body the observer joins on", () => {
    const metadata = parseRunMetadata(body("run_metadata"));

    expect(metadata.schema).toBe(1);
    expect(metadata.status).toBe("running");
    expect(typeof metadata.artifacts.events).toBe("string");
  });

  it("unwraps the config envelope, which is not a bare config", () => {
    // Mismatch #4: `getConfig()` parsed this as a bare config and would have thrown.
    const config = parseRunConfigEnvelope(body("run_config"));
    const defaults = parseRunDefaults(body("run_defaults"));

    expect(config.beings).toHaveLength(4);
    expect(config.seed).toBe(7);
    // The run this was captured against was started from the server's own
    // defaults, so the config it reports back must be exactly those.
    expect(config).toEqual(defaults.config);
  });

  it("still accepts a bare config, so one reader serves both endpoints", () => {
    const envelope = body("run_config") as { readonly config: unknown };

    expect(parseRunConfig(envelope.config)).toEqual(parseRunConfigEnvelope(body("run_config")));
  });
});

describe("POST /api/run/stop", () => {
  it("reads the stop acknowledgement, which is not a terminal status", () => {
    const ack = parseRunStartAcknowledgement(body("run_stop"));

    expect(ack.status).toBe("stopping");
    expect(RUN_STATUSES).toContain(ack.status);
  });
});

describe("the run's seed persona", () => {
  it("is declared once on the run rather than repeated on every being", () => {
    // Measured: personas were 51.7% of a 5-being snapshot and 66.4% of a
    // 30-being one, byte-identical every time, re-written every world tick.
    const metadata = parseRunMetadata(body("run_metadata"));

    expect(metadata.seed_persona).not.toBeNull();
    expect(metadata.seed_persona).toContain("You have just awoken into this world");
  });

  it("reads as null, not as a guess, from a server that declares none", () => {
    const metadata = body("run_metadata") as Record<string, unknown>;
    const { seed_persona: _omitted, ...older } = metadata;

    expect(parseRunMetadata(older).seed_persona).toBeNull();
  });
});
