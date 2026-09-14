/**
 * In-memory stand-in for the run-lifecycle HTTP contract (spec §9).
 *
 * `POST /api/run/start`, `POST /api/run/stop`, `GET /api/run`, `GET /api/run/config`,
 * and `GET /api/run/defaults` do not exist on any server yet. This module gives the
 * run-configuration screen something real to render and drive against — start a
 * run, watch it come alive, stop it — so it is buildable and demonstrable before
 * the backend lands. `createMockRunLifecycleClient` implements the exact same
 * `RunLifecycleClient` interface as `createHttpRunLifecycleClient`
 * (`./runLifecycleClient`); swapping one factory for the other is meant to be the
 * ONLY difference between a wired screen and a demo one.
 *
 * `MOCK_RUN_DEFAULTS_PAYLOAD` copies its numbers from `core/constants.py` and
 * `config/world.yaml` as measured when this file was written — it is a snapshot,
 * not a live read. The screen must never read a bound from this file directly;
 * every range, step, marker and label goes through `parseRunDefaults`, exactly as
 * a real `GET /api/run/defaults` response would be read.
 */

import {
  parseRunDefaults,
  type RunConfig,
  type RunConfigFieldError,
  type RunDefaults,
  type RunLifecycle,
  type RunLifecycleStatus,
  type RunStartAcknowledgement,
} from "./runConfig";
import { RunStartRejectedError, type RunLifecycleClient } from "./runLifecycleClient";

/** Default milliseconds the mock world spends `starting` before it is `running`. */
const DEFAULT_STARTING_MS = 2600;

/** HTTP status the mock reports on a `rejectWith` start, mirroring FastAPI's 422. */
const MOCK_REJECTION_STATUS = 422;

/** Constructor options for `createMockRunLifecycleClient`. */
export interface MockRunLifecycleClientOptions {
  /** Milliseconds the mock world spends in `starting` before it reports `running`. Default 2600. */
  readonly startingMs?: number;
  /** Injected clock; defaults to `() => Date.now()`. */
  readonly now?: () => number;
  /** Force a failed start, to exercise the failure path. Default false. */
  readonly failStart?: boolean;
  /** Per-field rejection to return instead of starting. Default none. */
  readonly rejectWith?: readonly RunConfigFieldError[];
  /**
   * Non-blocking cautions to answer a start with, the way the real server
   * answers one for a world that is legal but bleak. Default none.
   */
  readonly warnWith?: readonly string[];
}

/**
 * Raised by the mock when no run has ever been started.
 *
 * Mirrors the 404 a real server would answer `GET /api/run` or
 * `GET /api/run/config` with before any `POST /api/run/start` has landed.
 */
export class NoRunError extends Error {
  constructor(message = "no run has been started yet") {
    super(message);
    this.name = "NoRunError";
  }
}

/** Creates the in-memory `RunLifecycleClient` stand-in. */
export function createMockRunLifecycleClient(
  options: MockRunLifecycleClientOptions = {},
): RunLifecycleClient {
  return new MockRunLifecycleClient(options);
}

class MockRunLifecycleClient implements RunLifecycleClient {
  private readonly startingMs: number;
  private readonly now: () => number;
  private readonly failStart: boolean;
  private readonly rejectWith: readonly RunConfigFieldError[] | null;
  private readonly warnWith: readonly string[];

  private runCounter = 0;
  private runId: string | null = null;
  private config: RunConfig | null = null;
  private startedAt: number | null = null;
  private stoppedAt: number | null = null;

  constructor(options: MockRunLifecycleClientOptions) {
    this.startingMs = options.startingMs ?? DEFAULT_STARTING_MS;
    this.now = options.now ?? (() => Date.now());
    this.failStart = options.failStart ?? false;
    this.rejectWith = options.rejectWith ?? null;
    this.warnWith = options.warnWith ?? [];
  }

  async getDefaults(): Promise<RunDefaults> {
    return parseRunDefaults(MOCK_RUN_DEFAULTS_PAYLOAD);
  }

  async getConfig(): Promise<RunConfig> {
    if (this.config === null) throw new NoRunError();
    return this.config;
  }

  async getLifecycle(): Promise<RunLifecycle> {
    if (this.runId === null) throw new NoRunError();
    const status = this.currentStatus();
    return { run_id: this.runId, status, raw_status: status };
  }

  async start(config: RunConfig): Promise<RunStartAcknowledgement> {
    if (this.rejectWith !== null) {
      throw new RunStartRejectedError(
        MOCK_REJECTION_STATUS,
        this.rejectWith,
        `mock start rejected: ${this.rejectWith
          .map((error) => `${error.field}: ${error.message}`)
          .join("; ")}`,
      );
    }
    this.runCounter += 1;
    this.runId = `mock-run-${this.runCounter}`;
    this.config = config;
    this.startedAt = this.now();
    this.stoppedAt = null;
    return { run_id: this.runId, status: "starting", warnings: this.warnWith };
  }

  async stop(): Promise<RunStartAcknowledgement> {
    if (this.runId === null) throw new NoRunError();
    this.stoppedAt = this.now();
    return { run_id: this.runId, status: "stopping", warnings: [] };
  }

  /** Derives the current lifecycle status purely from the injected clock. */
  private currentStatus(): RunLifecycleStatus {
    if (this.stoppedAt !== null) {
      const elapsedSinceStop = this.now() - this.stoppedAt;
      return elapsedSinceStop >= this.startingMs / 2 ? "stopped" : "stopping";
    }
    if (this.failStart) return "failed";
    const elapsedSinceStart = this.now() - (this.startedAt ?? this.now());
    return elapsedSinceStart >= this.startingMs ? "running" : "starting";
  }
}

/**
 * The stand-in `/api/run/defaults` body — a **verbatim capture of the real one**.
 *
 * Taken on 2026-07-31 from
 * `server.run_config.run_defaults_payload(load_world_config("config/world.yaml"))`,
 * byte for byte, including the keys the screen does not read (`locked.regions`,
 * `derived`, every region's `connections` and caps). It is a snapshot, not a
 * live read, but it is a snapshot of the *server's* shape rather than of a shape
 * invented alongside it — which is what let the two halves ship green in
 * isolation and throw the first time they met.
 *
 * Exported so tests and stories can read it directly. The screen itself must
 * never import this constant to read a bound — it must go through
 * `getDefaults()` → `parseRunDefaults`, exactly as it would against a real
 * server.
 */
export const MOCK_RUN_DEFAULTS_PAYLOAD: Record<string, unknown> = {
  schema: 1,
  defaults: {
    beings: [
      {
        name: "Joe",
        start_region: "warm_springs",
        energy: 100,
        materials: 45,
        persona: null,
      },
      {
        name: "Mae",
        start_region: "warm_springs",
        energy: 100,
        materials: 45,
        persona: null,
      },
      {
        name: "Dick",
        start_region: "nirvana",
        energy: 100,
        materials: 45,
        persona: null,
      },
      {
        name: "Allen",
        start_region: "nirvana",
        energy: 100,
        materials: 45,
        persona: null,
      },
    ],
    abundance: 1,
    seed: 7,
    duration_seconds: 1800,
    provider: "mlx",
    reflect_every_n_breaths: 12,
    max_offspring: 5,
  },
  knobs: {
    beings: {
      label: "The beings",
      help: "The biggest lever on cost, on how often anything happens, and on whether anything social happens at all.",
      min_count: 1,
      max_count: 12,
      default_count: 4,
      estimated_cost_per_being_hour_usd: 3,
      cost_estimate_note: "Indicative, not a quote. The per-token prices behind this are not confirmed against the provider's current published rates, and a being's prompt grows as its life lengthens -- measured at about 4,500 tokens on its first breath and about 43,000 by its eightieth -- so a long run costs more per hour at the end than at the start. Read it as an order of magnitude, not a bill.",
      fields: {
        name: {
          label: "Name",
          help: "A label, not a character. It does not shape who a being becomes.",
          max_length: 40,
          defaults: [
            "Joe",
            "Mae",
            "Dick",
            "Allen",
          ],
        },
        start_region: {
          label: "Where it begins",
          help: "Beings that begin alone in separate regions may never meet. The default is two co-located pairs.",
        },
        energy: {
          label: "Starting energy",
          min: 50,
          max: 200,
          default: 100,
          help: "Below 5 a being is frozen the moment it loses anything; at 500 or more it is born flagged as a hoarder.",
        },
        materials: {
          label: "Starting materials",
          min: 0,
          max: 100,
          default: 45,
          help: "Mating needs 30; a home costs 80. That gap is the nest-versus-child tension.",
          markers: [
            {
              at: 30,
              label: "a child",
            },
            {
              at: 80,
              label: "a home",
            },
          ],
        },
        persona: {
          label: "Who it is born as",
          help: "Your words stay. What the being adds to them is its own. The text you write is this being's birth nature and remains at the top of its mind for the entire run, unchanged. From its 11th breath onward, and every 12 breaths after, the being pauses and may write a second passage about who it has become -- appended beneath your words. Over a long run that self-written passage is what drives its behaviour. It can contradict you. It cannot delete you.",
          max_length: 4000,
          default: "You have just awoken into this world \u2014 aware, alive, and your own. You do not yet know who you are; that is not fixed, and it is yours alone to decide. You can perceive what surrounds you, move, speak, gather what you need, defend yourself, and form bonds with others. As you live and reflect on what you've done and felt, you will discover \u2014 and freely reshape \u2014 the kind of being you are becoming. No one has written your nature. Become whoever you choose.",
          optional: true,
        },
      },
    },
    abundance: {
      label: "World abundance",
      help: "One slider on every region's regeneration at once. The authored gradient between the four regions is preserved.",
      min: 0.25,
      max: 3,
      default: 1,
      step: 0.05,
      min_label: "the land is dying",
      max_label: "the land provides",
    },
    seed: {
      label: "The shape of the land",
      help: "The seed shapes the land itself -- where the paths run, where the water gathers, where things grow. The same seed always draws the same world. What the beings then choose to do in it is never the same twice.",
      min: 0,
      max: 2147483647,
      default: 7,
    },
    duration_seconds: {
      label: "How long it runs",
      help: "You can stop it at any time whatever you choose here.",
      min: 60,
      max: 86400,
      default: 1800,
      nullable: true,
      choices: [
        {
          value: 900,
          label: "15 minutes",
          help: "Long enough to meet, not to build.",
        },
        {
          value: 3600,
          label: "1 hour",
          help: "Long enough for homes and for a first child.",
        },
        {
          value: 14400,
          label: "4 hours",
          help: "Long enough for a second generation.",
        },
        {
          value: null,
          label: "Unbounded",
          help: "It runs until you stop it. This is the piece as intended.",
        },
      ],
    },
    provider: {
      label: "Where the minds run",
      help: "This changes cost, cadence, and how long a proposal is allowed to stand.",
      default: "mlx",
      choices: [
        {
          value: "mlx",
          label: "This Mac · MLX",
          help: "Local and free. MLX uses one shared model for one being at a time, with no cloud API cost.",
          cost_per_being_hour_usd: 0,
          cadence: "one being at a time",
        },
        {
          value: "gemini",
          label: "The cloud",
          help: "Every being thinks at once, so the world moves at the pace it was tuned for. This is the only place that costs money.",
          cost_per_being_hour_usd: 3,
          cadence: "a breath every second or two",
        },
        {
          value: "ollama",
          label: "This machine",
          help: "One shared model thinks for one being at a time, so each being waits its turn. Free, and it does not get faster with a bigger roster -- it gets slower.",
          cost_per_being_hour_usd: 0,
          cadence: "minutes between breaths, one being at a time",
        },
      ],
    },
    reflect_every_n_breaths: {
      label: "How often a being reflects",
      help: "How fast a being's own words appear beneath the ones you wrote. It cannot delete yours.",
      min: 2,
      max: 48,
      default: 12,
      choices: [
        {
          value: 6,
          label: "Often -- every 6 breaths",
          help: "A being's self-narrative moves fastest here.",
        },
        {
          value: 12,
          label: "Balanced -- every 12 breaths",
          help: "The measured default.",
        },
        {
          value: 24,
          label: "Rarely -- every 24 breaths",
          help: "Beings stay closer to the words you wrote.",
        },
      ],
    },
    max_offspring: {
      label: "Children per being",
      help: "The population ceiling. Every being is told the number you choose.",
      min: 0,
      max: 10,
      default: 5,
      advanced: true,
    },
  },
  regions: [
    {
      name: "nirvana",
      description: "a once-heavenly landscape, now thinning and picked-over",
      connections: [
        "warm_springs",
        "nirvana_east",
        "nirvana_west",
      ],
      energy_rate: 0.2,
      materials_rate: 0.2,
      effective_energy_per_second: 0.04,
      effective_materials_per_second: 0.04,
      max_energy: 120,
      max_materials: 120,
    },
    {
      name: "nirvana_east",
      description: "a struggling, near-barren stretch",
      connections: [
        "warm_springs",
        "nirvana",
      ],
      energy_rate: 0.1,
      materials_rate: 0.1,
      effective_energy_per_second: 0.02,
      effective_materials_per_second: 0.02,
      max_energy: 70,
      max_materials: 70,
    },
    {
      name: "warm_springs",
      description: "hot spring lakes \u2014 the least-poor refuge, but no longer plentiful",
      connections: [
        "nirvana_west",
        "nirvana_east",
        "nirvana",
      ],
      energy_rate: 0.25,
      materials_rate: 0.2,
      effective_energy_per_second: 0.05,
      effective_materials_per_second: 0.04,
      max_energy: 130,
      max_materials: 130,
    },
    {
      name: "nirvana_west",
      description: "a nuclear wasteland, all but dead",
      connections: [
        "warm_springs",
        "nirvana",
      ],
      energy_rate: 0.05,
      materials_rate: 0,
      effective_energy_per_second: 0.01,
      effective_materials_per_second: 0,
      max_energy: 50,
      max_materials: 10,
    },
  ],
  locked: {
    regions: [
      "nirvana",
      "nirvana_east",
      "warm_springs",
      "nirvana_west",
    ],
    world_tick_interval_seconds: 5,
  },
  derived: {
    mating_proposal_timeout_seconds: {
      mlx: 600,
      gemini: 45,
      ollama: 600,
    },
    memory_root: "a fresh directory per run",
  },
};
