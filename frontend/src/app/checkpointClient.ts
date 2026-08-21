import { assertHttpResponseOk } from "./client";
import {
  parseSnapshotCheckpoint,
  type SnapshotCheckpoint,
} from "./replayArtifacts";

const MANIFEST_PATH = "/api/replay/manifest";
const LATEST_CHECKPOINT_PATH = "/api/replay/checkpoints/latest";
const CHECKPOINTS_PAGE_PATH = "/api/replay/checkpoints";
const MAX_CHECKPOINT_PAGE_LIMIT = 64;

export interface CheckpointRecord {
  readonly line: number;
  readonly checkpoint: SnapshotCheckpoint;
}

export interface ReplayManifestSummary {
  readonly runId: string;
  readonly checkpointCount: number;
  readonly lastCheckpointLine: number | null;
}

export interface CheckpointRecordPage {
  readonly runId: string;
  readonly before: number;
  readonly nextBefore: number | null;
  readonly hasMore: boolean;
  /**
   * The server dropped older records from this page to fit its own byte budget.
   *
   * The page is still contiguous and still ends at `before - 1`; `nextBefore`
   * names the oldest survivor, so paging backwards from it reaches everything
   * dropped. Reading this is what lets a client tell a designed clamp from a
   * corrupt page.
   */
  readonly truncated: boolean;
  readonly records: readonly CheckpointRecord[];
}

export interface CheckpointApiClient {
  getReplayManifest(): Promise<ReplayManifestSummary>;
  getLatestCheckpoint(): Promise<CheckpointRecord | null>;
  getCheckpointPage(before: number, limit: number): Promise<CheckpointRecordPage>;
}

export interface HttpCheckpointApiClientOptions {
  readonly baseUrl?: string;
  readonly fetcher?: typeof globalThis.fetch;
  readonly expectedRunId?: string;
  readonly signal?: AbortSignal;
}

/** Identifies a response that crossed a run-generation boundary. */
export class CheckpointRunMismatchError extends Error {
  readonly line: number | null;

  constructor(message: string, line: number | null) {
    super(message);
    this.name = "CheckpointRunMismatchError";
    this.line = line;
  }
}

/** Creates a checkpoint-only HTTP client; no raw artifact methods are exposed. */
export function createHttpCheckpointApiClient(
  options: HttpCheckpointApiClientOptions = {},
): CheckpointApiClient {
  return new HttpCheckpointApiClient(
    options.baseUrl ?? "",
    options.fetcher ?? globalThis.fetch.bind(globalThis),
    options.expectedRunId,
    options.signal,
  );
}

class HttpCheckpointApiClient implements CheckpointApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof globalThis.fetch,
    private readonly expectedRunId: string | undefined,
    private readonly signal: AbortSignal | undefined,
  ) {}

  async getReplayManifest(): Promise<ReplayManifestSummary> {
    const input = objectOf(await this.fetchJson(MANIFEST_PATH), MANIFEST_PATH);
    expectSchemaOne(input, MANIFEST_PATH);
    const runId = runIdOf(input.run_id, `${MANIFEST_PATH}.run_id`);
    this.expectRun(runId, null, MANIFEST_PATH);
    const checkpoints = objectOf(input.checkpoints, `${MANIFEST_PATH}.checkpoints`);
    return {
      runId,
      checkpointCount: nonNegativeIntegerOf(
        checkpoints.count,
        `${MANIFEST_PATH}.checkpoints.count`,
      ),
      lastCheckpointLine: nullablePositiveIntegerOf(
        checkpoints.last_line,
        `${MANIFEST_PATH}.checkpoints.last_line`,
      ),
    };
  }

  async getLatestCheckpoint(): Promise<CheckpointRecord | null> {
    const value = await this.fetchJson(LATEST_CHECKPOINT_PATH, true);
    if (value === undefined) return null;
    const input = objectOf(value, LATEST_CHECKPOINT_PATH);
    expectSchemaOne(input, LATEST_CHECKPOINT_PATH);
    const line = positiveIntegerOf(input.line, `${LATEST_CHECKPOINT_PATH}.line`);
    const runId = runIdOf(input.run_id, `${LATEST_CHECKPOINT_PATH}.run_id`);
    this.expectRun(runId, line, LATEST_CHECKPOINT_PATH);
    return parseRecord(input, line, runId, LATEST_CHECKPOINT_PATH);
  }

  async getCheckpointPage(before: number, limit: number): Promise<CheckpointRecordPage> {
    positiveIntegerOf(before, "checkpoint page before");
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CHECKPOINT_PAGE_LIMIT) {
      throw new RangeError(`checkpoint page limit must be between 1 and ${MAX_CHECKPOINT_PAGE_LIMIT}`);
    }
    const path = `${CHECKPOINTS_PAGE_PATH}?before=${before}&limit=${limit}`;
    const value = await this.fetchJson(path, true);
    if (value === undefined) {
      return {
        runId: this.expectedRunId ?? "unknown",
        before,
        nextBefore: null,
        hasMore: false,
        truncated: false,
        records: [],
      };
    }

    const input = objectOf(value, path);
    expectSchemaOne(input, path);
    const runId = runIdOf(input.run_id, `${path}.run_id`);
    this.expectRun(runId, null, path);
    const parsedBefore = positiveIntegerOf(input.before, `${path}.before`);
    if (parsedBefore !== before) {
      throw new Error(`${path}.before does not match requested line`);
    }
    const values = arrayOf(input.checkpoints, `${path}.checkpoints`);
    if (values.length > limit) {
      throw new Error(`${path}.records exceeds requested limit ${limit}`);
    }
    const records = values.map((value, index) => {
      const row = objectOf(value, `${path}.records[${index}]`);
      const line = positiveIntegerOf(row.line, `${path}.records[${index}].line`);
      if (line >= before) {
        throw new Error(`${path}.records[${index}].line must be before ${before}`);
      }
      return parseRecord(row, line, runId, `${path}.records[${index}]`);
    });
    assertStrictRecordOrder(records, path);
    const nextBefore = nullablePositiveIntegerOf(input.next_before, `${path}.next_before`);
    const hasMore = booleanOf(input.has_more, `${path}.has_more`);
    // Legacy servers predate the clamp and simply never truncate.
    const truncated = input.truncated === undefined
      ? false
      : booleanOf(input.truncated, `${path}.truncated`);
    assertCheckpointPageCoherence(
      records,
      parsedBefore,
      limit,
      nextBefore,
      hasMore,
      truncated,
      path,
    );
    return {
      runId,
      before: parsedBefore,
      nextBefore,
      hasMore,
      truncated,
      records,
    };
  }

  private async fetchJson(path: string, allowNotFound = false): Promise<unknown | undefined> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        headers: { Accept: "application/json" },
        signal: this.signal,
      });
    } catch (error) {
      if (this.signal?.aborted) throw error;
      throw new Error(`${path} request failed: ${errorMessage(error)}`);
    }
    if (allowNotFound && response.status === 404) return undefined;
    await assertHttpResponseOk(response, path);
    try {
      return await response.json() as unknown;
    } catch (error) {
      throw new Error(`${path} returned malformed JSON: ${errorMessage(error)}`);
    }
  }

  private expectRun(runId: string, line: number | null, path: string): void {
    if (this.expectedRunId !== undefined && runId !== this.expectedRunId) {
      throw new CheckpointRunMismatchError(
        `${path}.run_id does not match expected run`,
        line,
      );
    }
  }
}

function parseRecord(
  input: Record<string, unknown>,
  line: number,
  responseRunId: string,
  path: string,
): CheckpointRecord {
  const checkpoint = parseSnapshotCheckpoint(input.checkpoint, { lineNumber: line });
  if (checkpoint.run_id !== responseRunId) {
    throw new CheckpointRunMismatchError(
      `${path}.checkpoint.run_id does not match response run_id`,
      line,
    );
  }
  return { line, checkpoint };
}

function assertStrictRecordOrder(records: readonly CheckpointRecord[], path: string): void {
  for (let index = 1; index < records.length; index += 1) {
    if (records[index].line <= records[index - 1].line) {
      throw new Error(`${path}.records[${index}].line must be strictly increasing`);
    }
  }
}

/**
 * Rejects any page that is not a contiguous window ending at `before - 1`.
 *
 * A page may be SHORTER than `limit` only when the server says `truncated` — its
 * byte clamp drops records from the oldest end, which keeps the window contiguous
 * and keeps `next_before` a usable backwards cursor. Anything else short is a
 * hole, and a hole in checkpoint reconciliation is silent world drift.
 */
function assertCheckpointPageCoherence(
  records: readonly CheckpointRecord[],
  before: number,
  limit: number,
  nextBefore: number | null,
  hasMore: boolean,
  truncated: boolean,
  path: string,
): void {
  const firstExpectedLine = Math.max(1, before - limit);
  const requestedLength = before - firstExpectedLine;
  if (records.length > requestedLength) {
    throw new Error(`${path}.records must cover every line ${firstExpectedLine} through ${before - 1}`);
  }
  if (records.length < requestedLength && !truncated) {
    throw new Error(
      `${path}.records is short of lines ${firstExpectedLine} through ${before - 1}`
      + " without reporting truncated",
    );
  }
  // Whatever survived must still be the NEWEST contiguous run of the window.
  const firstReturnedLine = records.length === 0 ? before : before - records.length;
  records.forEach((record, index) => {
    if (record.line !== firstReturnedLine + index) {
      throw new Error(
        `${path}.records must cover every line ${firstReturnedLine} through ${before - 1}`,
      );
    }
  });
  const expectedNextBefore = records[0]?.line ?? before;
  if (nextBefore !== expectedNextBefore) {
    throw new Error(`${path}.next_before must identify the first returned line`);
  }
  const expectedHasMore = records.length > 0 && expectedNextBefore > 1;
  if (hasMore !== expectedHasMore) {
    throw new Error(`${path}.has_more does not match the returned page`);
  }
}

function expectSchemaOne(input: Record<string, unknown>, path: string): void {
  if (input.schema !== 1) throw new Error(`${path} must use schema 1`);
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayOf(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function runIdOf(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function booleanOf(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function nonNegativeIntegerOf(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function positiveIntegerOf(value: unknown, label: string): number {
  const parsed = nonNegativeIntegerOf(value, label);
  if (parsed === 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function nullablePositiveIntegerOf(value: unknown, label: string): number | null {
  return value === null ? null : positiveIntegerOf(value, label);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
