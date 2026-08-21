/**
 * HTTP client for the run-lifecycle contract (spec §9).
 *
 * ```
 * POST /api/run/start   body: SerializedRunConfig -> 202 { run_id, status, warnings }
 * POST /api/run/stop                              -> 202 { run_id, status: "stopping" }
 * GET  /api/run                                   -> RunMetadata (read via parseRunLifecycle)
 * GET  /api/run/config                            -> { run_id, status, config, warnings }
 * GET  /api/run/defaults                          -> { defaults, knobs, regions, locked }
 * ```
 *
 * `RunLifecycleClient` is the typed surface a run-configuration screen drives. This
 * module's `createHttpRunLifecycleClient` is the implementation that talks to the
 * real server; `./mockRunLifecycleClient` implements the identical interface as an
 * in-memory stand-in, so the screen can be built and demonstrated before the server
 * endpoints exist. Swapping one factory for the other is meant to be the only
 * difference.
 */

import { assertHttpResponseOk } from "../client";
import {
  parseRunConfigEnvelope,
  parseRunDefaults,
  parseRunLifecycle,
  parseRunStartAcknowledgement,
  parseRunStartRejection,
  serializeRunConfig,
  type RunConfig,
  type RunConfigFieldError,
  type RunDefaults,
  type RunLifecycle,
  type RunStartAcknowledgement,
} from "./runConfig";

const START_PATH = "/api/run/start";
const STOP_PATH = "/api/run/stop";
const RUN_PATH = "/api/run";
const CONFIG_PATH = "/api/run/config";
const DEFAULTS_PATH = "/api/run/defaults";

/** Longest chunk of a non-JSON rejection body kept in a fallback error message. */
const REJECTION_DETAIL_CHAR_LIMIT = 200;

/**
 * The typed surface a run-configuration screen drives.
 *
 * Implemented by `createHttpRunLifecycleClient` (this module, talks to the real
 * server) and by `createMockRunLifecycleClient` (`./mockRunLifecycleClient`, an
 * in-memory stand-in for a server that does not exist yet). A screen written
 * against this interface does not know or care which one it holds.
 */
export interface RunLifecycleClient {
  /** Reads `GET /api/run/defaults`: every default value and every knob bound. */
  getDefaults(): Promise<RunDefaults>;
  /** Reads `GET /api/run/config`: the config the current run started with. */
  getConfig(): Promise<RunConfig>;
  /** Reads `GET /api/run`: the current run's lifecycle status. */
  getLifecycle(): Promise<RunLifecycle>;
  /**
   * Sends `POST /api/run/start` with `config`, serialized on the wire.
   *
   * @throws RunStartRejectedError - When the server refuses the config; carries
   *   the server's per-field complaints so the screen can point at the offending
   *   knob.
   */
  start(config: RunConfig): Promise<RunStartAcknowledgement>;
  /** Sends `POST /api/run/stop` for the current run. */
  stop(): Promise<RunStartAcknowledgement>;
}

/** Constructor options for `createHttpRunLifecycleClient`. */
export interface HttpRunLifecycleClientOptions {
  readonly baseUrl?: string;
  readonly fetcher?: typeof globalThis.fetch;
}

/**
 * Raised when `POST /api/run/start` refuses a config.
 *
 * Carries the server's per-field complaints (spec §9) so a screen can highlight
 * the offending knob instead of showing one generic failure banner. `fieldErrors`
 * is empty when the rejection body said nothing per-field (or could not be read
 * as JSON at all) — the screen then falls back to `message`.
 */
export class RunStartRejectedError extends Error {
  readonly status: number;
  readonly fieldErrors: readonly RunConfigFieldError[];

  constructor(status: number, fieldErrors: readonly RunConfigFieldError[], message: string) {
    super(message);
    this.name = "RunStartRejectedError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

/** Creates the `RunLifecycleClient` that talks to the real server over HTTP. */
export function createHttpRunLifecycleClient(
  options: HttpRunLifecycleClientOptions = {},
): RunLifecycleClient {
  return new HttpRunLifecycleClient(
    options.baseUrl ?? "",
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );
}

class HttpRunLifecycleClient implements RunLifecycleClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof globalThis.fetch,
  ) {}

  async getDefaults(): Promise<RunDefaults> {
    return parseRunDefaults(await this.fetchJson(DEFAULTS_PATH));
  }

  async getConfig(): Promise<RunConfig> {
    return parseRunConfigEnvelope(await this.fetchJson(CONFIG_PATH));
  }

  async getLifecycle(): Promise<RunLifecycle> {
    return parseRunLifecycle(await this.fetchJson(RUN_PATH));
  }

  async start(config: RunConfig): Promise<RunStartAcknowledgement> {
    const response = await this.fetcher(this.url(START_PATH), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(serializeRunConfig(config)),
    });
    if (!response.ok) {
      throw await readRejection(response, START_PATH);
    }
    return parseRunStartAcknowledgement(await response.json());
  }

  async stop(): Promise<RunStartAcknowledgement> {
    const response = await this.fetcher(this.url(STOP_PATH), {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    await assertHttpResponseOk(response, STOP_PATH);
    return parseRunStartAcknowledgement(await response.json());
  }

  private async fetchJson(path: string): Promise<unknown> {
    const response = await this.fetcher(this.url(path), {
      headers: { Accept: "application/json" },
    });
    await assertHttpResponseOk(response, path);
    return response.json();
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }
}

/**
 * Builds the typed rejection error from a non-ok start response.
 *
 * Reads the body exactly once via `response.text()`, so a non-JSON body never
 * throws a parse error out of this path — it just yields no per-field errors and
 * a message built from the status and the trimmed text.
 *
 * @param response - The non-ok response from `POST /api/run/start`.
 * @param path - Request path, folded into the fallback message.
 * @returns A `RunStartRejectedError` ready to throw.
 */
async function readRejection(response: Response, path: string): Promise<RunStartRejectedError> {
  const text = await response.text();
  const parsed = parseJsonOrUndefined(text);
  const fieldErrors = parsed === undefined ? [] : parseRunStartRejection(parsed);
  const message = fieldErrors.length > 0
    ? `${path} rejected the config: ${fieldErrors
      .map((error) => `${error.field}: ${error.message}`)
      .join("; ")}`
    : fallbackRejectionMessage(path, response.status, text);
  return new RunStartRejectedError(response.status, fieldErrors, message);
}

function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function fallbackRejectionMessage(path: string, status: number, text: string): string {
  const trimmed = text.trim();
  const suffix = trimmed.length > 0 ? `: ${trimRejectionDetail(trimmed)}` : "";
  return `${path} returned HTTP ${status}${suffix}`;
}

function trimRejectionDetail(detail: string): string {
  const compact = detail.replace(/\s+/g, " ");
  return compact.length > REJECTION_DETAIL_CHAR_LIMIT
    ? `${compact.slice(0, REJECTION_DETAIL_CHAR_LIMIT - 3)}...`
    : compact;
}
