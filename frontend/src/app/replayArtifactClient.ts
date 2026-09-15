import {
  buildCheckpointIndex,
  parseReplayEventLine,
  parseSnapshotCheckpoint,
  parseSnapshotCheckpointLine,
  type CheckpointIndexEntry,
  type SnapshotCheckpoint,
} from "./replayArtifacts";
import { assertHttpResponseOk } from "./client";
import {
  parseEventEnvelope,
  type EventEnvelopeEntry,
  type WorldSnapshot,
} from "./schemas";
import type { ReplaySessionCheckpointSelector } from "./replaySession";
import {
  REPLAY_CHECKPOINT_PAGE_LIMIT,
  REPLAY_CHECKPOINT_WORKING_SET_LIMIT,
  REPLAY_EVENT_BOOTSTRAP_LIMIT,
  REPLAY_EVENT_WORKING_SET_LIMIT,
  boundReplayArtifacts,
} from "./replayWorkingSet";

export {
  REPLAY_CHECKPOINT_PAGE_LIMIT,
  REPLAY_CHECKPOINT_WORKING_SET_LIMIT,
  REPLAY_EVENT_BOOTSTRAP_LIMIT,
  REPLAY_EVENT_WORKING_SET_LIMIT,
  boundReplayArtifacts,
} from "./replayWorkingSet";

const MANIFEST_PATH = "/api/replay/manifest";
const LATEST_CHECKPOINT_PATH = "/api/replay/checkpoints/latest";
const EVENTS_PAGE_PATH = "/api/replay/events";
const CHECKPOINTS_PAGE_PATH = "/api/replay/checkpoints";
const RAW_EVENTS_PATH = "/api/replay/artifacts/events";
const RAW_SNAPSHOTS_PATH = "/api/replay/artifacts/snapshots";
const NDJSON_ACCEPT = "application/x-ndjson";
const JSON_ACCEPT = "application/json";

export interface ReplayArtifactClientOptions {
  baseUrl?: string;
  fetcher?: typeof globalThis.fetch;
}

export interface ReplayArtifacts {
  events: EventEnvelopeEntry[];
  checkpoints: SnapshotCheckpoint[];
  checkpointIndex: CheckpointIndexEntry[];
  runId?: string;
  eventTotalCount?: number;
  checkpointTotalCount?: number;
  firstCheckpointLine?: number | null;
  nextCheckpointBefore?: number | null;
  hasOlderCheckpoints?: boolean;
}

export interface ReplayPresentationWindow {
  readonly sourceKey: string;
  readonly checkpointIndex: number;
  readonly checkpointLineNumber: number | null;
  readonly checkpointReason: string;
  readonly checkpointWorldTime: number;
  readonly firstCursor: number;
  readonly lastCursor: number;
  readonly snapshot: WorldSnapshot;
  readonly entries: readonly EventEnvelopeEntry[];
  /**
   * A historical card replay establishes the prefix synchronously, then releases
   * this suffix only when its independently sampled replay clock reaches each
   * recorded event timestamp. Ordinary archive checkpoint windows omit it.
   */
  readonly historical?: Readonly<{
    /** Cursor and recorded simulation time represented by the established prefix. */
    readonly targetCursor: number;
    readonly targetWorldTime: number;
    /** Contiguous evidence after `targetCursor`, kept out of the initial world. */
    readonly continuation: readonly EventEnvelopeEntry[];
  }>;
}

export interface ReplayArtifactClient {
  /** Fetch the bounded startup window used by the observer UI. */
  fetchArtifacts(): Promise<ReplayArtifacts>;
  /** Fetch a bounded startup window that belongs to the expected live run. */
  fetchForRun(expectedRunId: string): Promise<ReplayArtifacts>;
  /** Shift the bounded working set to an explicitly requested older page. */
  fetchOlderArtifacts(artifacts: ReplayArtifacts): Promise<ReplayArtifacts>;
  /** Preserve an explicit checkpoint selection across a shifted older page. */
  reconcileSelector(
    previous: ReplayArtifacts,
    next: ReplayArtifacts,
    selector: ReplaySessionCheckpointSelector | null,
  ): Promise<ReplaySessionCheckpointSelector | null>;
  /** Download the complete event artifact for an explicit export operation. */
  exportEvents(): Promise<EventEnvelopeEntry[]>;
  /** Download the complete snapshot artifact for an explicit export operation. */
  exportSnapshots(): Promise<SnapshotCheckpoint[]>;
  /** Backward-compatible explicit raw event export alias. */
  fetchEvents(): Promise<EventEnvelopeEntry[]>;
  /** Backward-compatible explicit raw snapshot export alias. */
  fetchSnapshots(): Promise<SnapshotCheckpoint[]>;
}

export async function fetchReplayArtifactsForRun(
  client: ReplayArtifactClient,
  expectedRunId: string,
): Promise<ReplayArtifacts> {
  let lastRunId: string | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const artifacts = await client.fetchArtifacts();
      lastRunId = artifacts.runId;
      if (lastRunId === undefined || lastRunId === expectedRunId) {
        return artifacts;
      }
    } catch (error) {
      if (!(error instanceof ReplayRunCoherenceError) || attempt === 2) {
        throw error;
      }
    }
  }
  throw new Error(
    `Replay artifacts remained on run ${lastRunId ?? "unknown"} while live run is ${expectedRunId}`,
  );
}

export function reconcileReplaySelectorAfterArtifactShift(
  previous: ReplayArtifacts,
  next: ReplayArtifacts,
  selector: ReplaySessionCheckpointSelector | null,
): ReplaySessionCheckpointSelector | null {
  if (!selector || next.checkpoints.length === 0) {
    return null;
  }
  const previousCheckpoint = checkpointForSelector(previous.checkpoints, selector);
  if (previousCheckpoint) {
    const retainedIndex = next.checkpoints.findIndex((checkpoint) => (
      checkpointIdentity(checkpoint) === checkpointIdentity(previousCheckpoint)
    ));
    if (retainedIndex >= 0) {
      const retained = selectorForCheckpoint(next.checkpoints[retainedIndex], retainedIndex);
      return sameReplaySelector(selector, retained) ? null : retained;
    }
  }
  const latestIndex = next.checkpoints.length - 1;
  const latest = selectorForCheckpoint(next.checkpoints[latestIndex], latestIndex);
  return sameReplaySelector(selector, latest) ? null : latest;
}

interface ReplayManifest {
  runId: string;
  eventCount: number;
  checkpointCount: number;
  firstCheckpointLine: number | null;
  lastCheckpointLine: number | null;
  bootstrapAfter: number;
  bootstrapLimit: number;
}

interface EventPage {
  runId: string;
  after: number;
  nextAfter: number;
  hasMore: boolean;
  /**
   * The server clamped this page to its byte budget rather than refusing it.
   *
   * `false` for a server that does not say — an older one never truncated, it
   * answered 413 and stopped the replay permanently. A truncated page is a page:
   * it is still contiguous from `after`, and `nextAfter` walks forward over what
   * was left out.
   */
  truncated: boolean;
  events: EventEnvelopeEntry[];
}

interface CheckpointPage {
  runId: string;
  before: number;
  nextBefore: number | null;
  hasMore: boolean;
  checkpoints: SnapshotCheckpoint[];
}

class ReplayRunCoherenceError extends Error {}

export function createReplayArtifactClient(
  options: ReplayArtifactClientOptions = {},
): ReplayArtifactClient {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  return new HttpReplayArtifactClient(options.baseUrl ?? "", fetcher);
}

export function fetchReplayArtifactEvents(
  options: ReplayArtifactClientOptions = {},
): Promise<EventEnvelopeEntry[]> {
  return createReplayArtifactClient(options).exportEvents();
}

export function fetchReplayArtifactSnapshots(
  options: ReplayArtifactClientOptions = {},
): Promise<SnapshotCheckpoint[]> {
  return createReplayArtifactClient(options).exportSnapshots();
}

export function fetchReplayArtifacts(
  options: ReplayArtifactClientOptions = {},
): Promise<ReplayArtifacts> {
  return createReplayArtifactClient(options).fetchArtifacts();
}

class HttpReplayArtifactClient implements ReplayArtifactClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof globalThis.fetch,
  ) {}

  async fetchArtifacts(): Promise<ReplayArtifacts> {
    const manifest = parseManifest(await this.fetchJson(MANIFEST_PATH), MANIFEST_PATH);
    if (manifest.bootstrapLimit !== REPLAY_EVENT_BOOTSTRAP_LIMIT) {
      throw new Error(
        `${MANIFEST_PATH} bootstrap.event_limit must be ${REPLAY_EVENT_BOOTSTRAP_LIMIT}`,
      );
    }

    const [latestCheckpoint, eventPage] = await Promise.all([
      this.fetchLatestCheckpoint(manifest.runId),
      this.fetchEventPage(
        manifest.bootstrapAfter,
        REPLAY_EVENT_BOOTSTRAP_LIMIT,
        manifest.runId,
      ),
    ]);
    if (manifest.checkpointCount > 0 && latestCheckpoint === null) {
      throw new ReplayRunCoherenceError(
        "replay manifest has checkpoints but latest checkpoint is missing",
      );
    }
    const checkpoints = latestCheckpoint ? [latestCheckpoint] : [];
    return finalizeArtifacts(
      {
        events: [],
        checkpoints: [],
        checkpointIndex: [],
        runId: manifest.runId,
        eventTotalCount: manifest.eventCount,
        checkpointTotalCount: manifest.checkpointCount,
        firstCheckpointLine: manifest.firstCheckpointLine,
        nextCheckpointBefore:
          latestCheckpoint?.lineNumber ?? manifest.lastCheckpointLine,
        hasOlderCheckpoints: manifest.checkpointCount > checkpoints.length,
      },
      retainEvents(eventPage.events, "newest"),
      checkpoints,
    );
  }

  fetchForRun(expectedRunId: string): Promise<ReplayArtifacts> {
    return fetchReplayArtifactsForRun(this, expectedRunId);
  }

  async fetchOlderArtifacts(artifacts: ReplayArtifacts): Promise<ReplayArtifacts> {
    const current = boundReplayArtifacts(artifacts);
    const oldestLine = minimumCheckpointLine(current.checkpoints)
      ?? current.nextCheckpointBefore
      ?? null;
    if (!current.hasOlderCheckpoints || oldestLine === null) {
      return current;
    }

    const page = await this.fetchCheckpointPage(
      oldestLine,
      REPLAY_CHECKPOINT_PAGE_LIMIT,
      current.runId,
    );
    if (page.checkpoints.length === 0) {
      return { ...current, hasOlderCheckpoints: false };
    }

    const earliestEventCursor = Math.min(
      ...page.checkpoints.map((checkpoint) => checkpoint.event_cursor),
    );
    const eventPage = await this.fetchEventPage(
      Math.max(0, earliestEventCursor - 1),
      REPLAY_EVENT_BOOTSTRAP_LIMIT,
      page.runId,
    );
    const checkpoints = retainCheckpoints(
      [...page.checkpoints, ...current.checkpoints],
      "oldest",
    );
    const events = retainEvents([...eventPage.events, ...current.events], "oldest");
    return finalizeArtifacts(
      {
        ...current,
        runId: page.runId,
        nextCheckpointBefore: page.nextBefore,
        hasOlderCheckpoints: page.hasMore,
      },
      events,
      checkpoints,
    );
  }

  async reconcileSelector(
    previous: ReplayArtifacts,
    next: ReplayArtifacts,
    selector: ReplaySessionCheckpointSelector | null,
  ): Promise<ReplaySessionCheckpointSelector | null> {
    return reconcileReplaySelectorAfterArtifactShift(previous, next, selector);
  }

  async exportEvents(): Promise<EventEnvelopeEntry[]> {
    return parseReplayEventNdjson(
      await this.fetchText(RAW_EVENTS_PATH),
      RAW_EVENTS_PATH,
    );
  }

  async exportSnapshots(): Promise<SnapshotCheckpoint[]> {
    return parseSnapshotCheckpointNdjson(
      await this.fetchText(RAW_SNAPSHOTS_PATH),
      RAW_SNAPSHOTS_PATH,
    );
  }

  fetchEvents(): Promise<EventEnvelopeEntry[]> {
    return this.exportEvents();
  }

  fetchSnapshots(): Promise<SnapshotCheckpoint[]> {
    return this.exportSnapshots();
  }

  private async fetchLatestCheckpoint(
    expectedRunId: string,
  ): Promise<SnapshotCheckpoint | null> {
    const value = await this.fetchJson(LATEST_CHECKPOINT_PATH, true);
    if (value === undefined) {
      return null;
    }
    const input = objectOf(value, LATEST_CHECKPOINT_PATH);
    expectSchemaOne(input, LATEST_CHECKPOINT_PATH);
    expectRunId(input, expectedRunId, LATEST_CHECKPOINT_PATH);
    const line = positiveIntegerOf(input.line, `${LATEST_CHECKPOINT_PATH}.line`);
    const checkpoint = parseSnapshotCheckpoint(input.checkpoint, { lineNumber: line });
    expectCheckpointRun(checkpoint, expectedRunId, LATEST_CHECKPOINT_PATH);
    return checkpoint;
  }

  private async fetchEventPage(
    after: number,
    limit: number,
    expectedRunId?: string,
  ): Promise<EventPage> {
    const path = `${EVENTS_PAGE_PATH}?after=${after}&limit=${limit}`;
    const input = objectOf(await this.fetchJson(path), path);
    expectSchemaOne(input, path);
    const runId = stringOf(input.run_id, `${path}.run_id`);
    if (expectedRunId !== undefined && runId !== expectedRunId) {
      throw new ReplayRunCoherenceError(
        `${path}.run_id does not match replay manifest`,
      );
    }
    const parsedAfter = nonNegativeIntegerOf(input.after, `${path}.after`);
    if (parsedAfter !== after) {
      throw new Error(`${path}.after does not match requested cursor`);
    }
    const nextAfter = nonNegativeIntegerOf(input.next_after, `${path}.next_after`);
    const hasMore = booleanOf(input.has_more, `${path}.has_more`);
    const rawEvents = arrayOf(input.events, `${path}.events`);
    if (rawEvents.length > limit) {
      throw new Error(`${path}.events exceeds requested limit ${limit}`);
    }
    const truncated = input.truncated === undefined
      ? false
      : booleanOf(input.truncated, `${path}.truncated`);
    const events = parseEventEntries(rawEvents, parsedAfter, nextAfter);
    assertStrictEventOrder(events, parsedAfter, path);
    assertEventPageContiguity(events, parsedAfter, path);
    return { runId, after: parsedAfter, nextAfter, hasMore, truncated, events };
  }

  private async fetchCheckpointPage(
    before: number,
    limit: number,
    expectedRunId?: string,
  ): Promise<CheckpointPage> {
    const path = `${CHECKPOINTS_PAGE_PATH}?before=${before}&limit=${limit}`;
    const input = objectOf(await this.fetchJson(path), path);
    expectSchemaOne(input, path);
    const runId = stringOf(input.run_id, `${path}.run_id`);
    if (expectedRunId !== undefined && runId !== expectedRunId) {
      throw new ReplayRunCoherenceError(
        `${path}.run_id does not match replay bootstrap`,
      );
    }
    const parsedBefore = positiveIntegerOf(input.before, `${path}.before`);
    if (parsedBefore !== before) {
      throw new Error(`${path}.before does not match requested line`);
    }
    const nextBefore = nullablePositiveIntegerOf(
      input.next_before,
      `${path}.next_before`,
    );
    const hasMore = booleanOf(input.has_more, `${path}.has_more`);
    const rawCheckpoints = arrayOf(input.checkpoints, `${path}.checkpoints`);
    if (rawCheckpoints.length > limit) {
      throw new Error(`${path}.checkpoints exceeds requested limit ${limit}`);
    }
    const checkpoints = rawCheckpoints.map((value, index) => {
      const row = objectOf(value, `${path}.checkpoints[${index}]`);
      const line = positiveIntegerOf(row.line, `${path}.checkpoints[${index}].line`);
      if (line >= before) {
        throw new Error(`${path}.checkpoints[${index}].line must be before ${before}`);
      }
      const checkpoint = parseSnapshotCheckpoint(row.checkpoint, { lineNumber: line });
      expectCheckpointRun(checkpoint, runId, path);
      return checkpoint;
    });
    assertStrictCheckpointOrder(checkpoints, path);
    return { runId, before: parsedBefore, nextBefore, hasMore, checkpoints };
  }

  private async fetchJson(
    path: string,
    allowNotFound = false,
  ): Promise<unknown | undefined> {
    const response = await this.request(path, JSON_ACCEPT);
    if (allowNotFound && response.status === 404) {
      return undefined;
    }
    await assertHttpResponseOk(response, path);
    try {
      return await response.json() as unknown;
    } catch (error) {
      throw new Error(`${path} returned malformed JSON: ${errorMessage(error)}`);
    }
  }

  private async fetchText(path: string): Promise<string> {
    const response = await this.request(path, NDJSON_ACCEPT);
    await assertHttpResponseOk(response, path);
    return response.text();
  }

  private async request(path: string, accept: string): Promise<Response> {
    try {
      return await this.fetcher(this.url(path), { headers: { Accept: accept } });
    } catch (error) {
      throw new Error(`${path} request failed: ${errorMessage(error)}`);
    }
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }
}

function parseManifest(value: unknown, path: string): ReplayManifest {
  const input = objectOf(value, path);
  expectSchemaOne(input, path);
  const events = objectOf(input.events, `${path}.events`);
  const checkpoints = objectOf(input.checkpoints, `${path}.checkpoints`);
  const bootstrap = objectOf(input.bootstrap, `${path}.bootstrap`);
  return {
    runId: stringOf(input.run_id, `${path}.run_id`),
    eventCount: nonNegativeIntegerOf(events.count, `${path}.events.count`),
    checkpointCount: nonNegativeIntegerOf(
      checkpoints.count,
      `${path}.checkpoints.count`,
    ),
    firstCheckpointLine: nullablePositiveIntegerOf(
      checkpoints.first_line,
      `${path}.checkpoints.first_line`,
    ),
    lastCheckpointLine: nullablePositiveIntegerOf(
      checkpoints.last_line,
      `${path}.checkpoints.last_line`,
    ),
    bootstrapAfter: nonNegativeIntegerOf(
      bootstrap.event_after,
      `${path}.bootstrap.event_after`,
    ),
    bootstrapLimit: positiveIntegerOf(
      bootstrap.event_limit,
      `${path}.bootstrap.event_limit`,
    ),
  };
}

function parseEventEntries(
  values: unknown[],
  after: number,
  nextAfter: number,
): EventEnvelopeEntry[] {
  return parseEventEnvelope({
    schema: 1,
    cursor: after,
    oldest_cursor: values.length === 0 ? after : after + 1,
    next_cursor: nextAfter,
    events: values,
    overflow: false,
    snapshot_required: false,
  }).events;
}

function finalizeArtifacts(
  metadata: ReplayArtifacts,
  events: EventEnvelopeEntry[],
  checkpoints: SnapshotCheckpoint[],
): ReplayArtifacts {
  return {
    ...metadata,
    events,
    checkpoints,
    checkpointIndex: buildCheckpointIndex(checkpoints),
  };
}

function retainEvents(
  events: readonly EventEnvelopeEntry[],
  side: "oldest" | "newest",
): EventEnvelopeEntry[] {
  const ordered = [...new Map(events.map((entry) => [entry.cursor, entry])).values()]
    .sort((left, right) => left.cursor - right.cursor);
  return side === "oldest"
    ? ordered.slice(0, REPLAY_EVENT_WORKING_SET_LIMIT)
    : ordered.slice(-REPLAY_EVENT_WORKING_SET_LIMIT);
}

function retainCheckpoints(
  checkpoints: readonly SnapshotCheckpoint[],
  side: "oldest" | "newest",
): SnapshotCheckpoint[] {
  const withoutDuplicateLines: SnapshotCheckpoint[] = [];
  const lineIndexes = new Map<number, number>();
  checkpoints.forEach((checkpoint) => {
    if (checkpoint.lineNumber === undefined) {
      withoutDuplicateLines.push(checkpoint);
      return;
    }
    const existingIndex = lineIndexes.get(checkpoint.lineNumber);
    if (existingIndex === undefined) {
      lineIndexes.set(checkpoint.lineNumber, withoutDuplicateLines.length);
      withoutDuplicateLines.push(checkpoint);
      return;
    }
    withoutDuplicateLines[existingIndex] = checkpoint;
  });
  withoutDuplicateLines.sort((left, right) => {
    if (left.lineNumber === undefined || right.lineNumber === undefined) {
      return 0;
    }
    return left.lineNumber - right.lineNumber;
  });
  return side === "oldest"
    ? withoutDuplicateLines.slice(0, REPLAY_CHECKPOINT_WORKING_SET_LIMIT)
    : withoutDuplicateLines.slice(-REPLAY_CHECKPOINT_WORKING_SET_LIMIT);
}

function minimumCheckpointLine(checkpoints: readonly SnapshotCheckpoint[]): number | null {
  const lines = checkpoints.flatMap((checkpoint) =>
    checkpoint.lineNumber === undefined ? [] : [checkpoint.lineNumber]
  );
  return lines.length === 0 ? null : Math.min(...lines);
}

function checkpointForSelector(
  checkpoints: readonly SnapshotCheckpoint[],
  selector: ReplaySessionCheckpointSelector,
): SnapshotCheckpoint | undefined {
  return typeof selector.index === "number"
    ? checkpoints[selector.index]
    : checkpoints.find((checkpoint) => checkpoint.lineNumber === selector.lineNumber);
}

function checkpointIdentity(checkpoint: SnapshotCheckpoint): string {
  return checkpoint.lineNumber === undefined
    ? `${checkpoint.run_id}:${checkpoint.event_cursor}:${checkpoint.world_time}:${checkpoint.reason}`
    : `line:${checkpoint.lineNumber}`;
}

function selectorForCheckpoint(
  checkpoint: SnapshotCheckpoint,
  index: number,
): ReplaySessionCheckpointSelector {
  return checkpoint.lineNumber === undefined
    ? { index }
    : { lineNumber: checkpoint.lineNumber };
}

function sameReplaySelector(
  left: ReplaySessionCheckpointSelector,
  right: ReplaySessionCheckpointSelector,
): boolean {
  return typeof left.index === "number"
    ? left.index === right.index
    : left.lineNumber === right.lineNumber;
}

function assertStrictEventOrder(
  events: readonly EventEnvelopeEntry[],
  after: number,
  path: string,
): void {
  let previous = after;
  events.forEach((entry, index) => {
    if (!Number.isInteger(entry.cursor) || entry.cursor <= previous) {
      throw new Error(`${path}.events[${index}].cursor must be strictly increasing`);
    }
    previous = entry.cursor;
  });
}

/**
 * Rejects a page that starts past the cursor it was asked after.
 *
 * A page may be SHORTER than `limit` — the server clamps an over-budget page to
 * the oldest records that fit rather than answering 413, and says so with
 * `truncated`. What it may never be is *offset*: the window has to begin at
 * `after + 1` or the events between are gone with nothing left pointing at them.
 * A hole in a replay is silent world drift, so it is a loud failure here instead.
 */
function assertEventPageContiguity(
  events: readonly EventEnvelopeEntry[],
  after: number,
  path: string,
): void {
  const first = events[0];
  if (first !== undefined && first.cursor !== after + 1) {
    throw new Error(
      `${path}.events must begin at cursor ${after + 1}, not ${first.cursor}`,
    );
  }
}

function assertStrictCheckpointOrder(
  checkpoints: readonly SnapshotCheckpoint[],
  path: string,
): void {
  let previous = 0;
  checkpoints.forEach((checkpoint, index) => {
    const line = checkpoint.lineNumber ?? 0;
    if (line <= previous) {
      throw new Error(`${path}.checkpoints[${index}].line must be strictly increasing`);
    }
    previous = line;
  });
}

function expectCheckpointRun(
  checkpoint: SnapshotCheckpoint,
  expectedRunId: string,
  path: string,
): void {
  if (checkpoint.run_id !== expectedRunId) {
    throw new ReplayRunCoherenceError(
      `${path} checkpoint run_id does not match response run_id`,
    );
  }
}

function expectSchemaOne(input: Record<string, unknown>, label: string): void {
  if (input.schema !== 1) {
    throw new Error(`${label} must use schema 1`);
  }
}

function expectRunId(
  input: Record<string, unknown>,
  expectedRunId: string,
  label: string,
): void {
  if (stringOf(input.run_id, `${label}.run_id`) !== expectedRunId) {
    throw new ReplayRunCoherenceError(
      `${label}.run_id does not match replay manifest`,
    );
  }
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayOf(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function stringOf(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function booleanOf(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
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
  if (parsed === 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function nullablePositiveIntegerOf(value: unknown, label: string): number | null {
  if (value === null) {
    return null;
  }
  return positiveIntegerOf(value, label);
}

function parseReplayEventNdjson(
  text: string,
  path: string,
): EventEnvelopeEntry[] {
  return parseNdjsonLines(text, path, parseReplayEventLine);
}

function parseSnapshotCheckpointNdjson(
  text: string,
  path: string,
): SnapshotCheckpoint[] {
  return parseNdjsonLines(text, path, parseSnapshotCheckpointLine);
}

function parseNdjsonLines<T>(
  text: string,
  path: string,
  parseLine: (line: string, lineNumber: number) => T,
): T[] {
  const parsed: T[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (line.trim() === "") {
      return;
    }

    try {
      parsed.push(parseLine(line, lineNumber));
    } catch (error) {
      throw new Error(`${path} line ${lineNumber}: ${errorMessage(error)}`);
    }
  });

  return parsed;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
