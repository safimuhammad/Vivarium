import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Page, Request, Route } from "@playwright/test";

import type { EventEnvelope, RunMetadata, WorldSnapshot } from "../../../frontend/src/app/schemas";
import {
  chronicleTerminalAuthority,
  type ChronicleManifest,
} from "../../../frontend/src/presentation/fixtures/chronicleCatalog";
import type { ProductionMountedRunControl } from "../../../frontend/src/app/observer2d/productionCaptureTestSeam";

export type VirtualSseLedgerEntry = Readonly<{
  sequence: number;
  kind: "open" | "envelope" | "error" | "close";
  sourceId: number;
  sourceRunId: string;
  url: string;
  cursor: number;
  envelopeRunId: string | null;
  overflow: boolean | null;
  snapshotRequired: boolean | null;
  eventCount: number | null;
  envelope: EventEnvelope | null;
  disposition: "accepted" | "rejected-closed" | "forced-stale-callback";
}>;

export type ProductionRouteHandler =
  | "run"
  | "world"
  | "events-page"
  | "replay-manifest"
  | "replay-checkpoint-latest"
  | "replay-checkpoints-page"
  | "replay-events-page"
  | "raw-artifact-reject"
  | "api-reject"
  | "external-reject";

export interface ProductionRouteLedgerEntry {
  readonly requestId: number;
  readonly sequence: number;
  readonly handler: ProductionRouteHandler;
  readonly method: string;
  readonly path: string;
  readonly disposition: "fulfilled" | "rejected";
  readonly status: number;
}

export interface ProductionObservedRouteEntry {
  readonly requestId: number;
  readonly sequence: number;
  readonly method: string;
  readonly path: string;
}

export interface ProductionChronicleRequestMetrics {
  readonly api: string[];
  readonly external: string[];
  readonly rawArtifacts: string[];
  readonly unhandledApi: string[];
  readonly routeLedger: ProductionRouteLedgerEntry[];
  readonly observedRoutes: ProductionObservedRouteEntry[];
  worldRequests: number;
}

export interface EventlessPresentationRecord {
  readonly kind: "transport-fault" | "session-edge";
  readonly label: string;
  readonly mechanicEventsFabricated: false;
}

export interface C14PresentationRecord extends EventlessPresentationRecord {
  readonly kind: "transport-fault";
  readonly label: "cursor-gap" | "oversized-record-413" | "run-replacement";
  readonly evidence: C14PresentationEvidence;
}

export interface C14PresentationEvidence {
  readonly routeLedgerSequences: readonly number[];
  readonly sseLedgerSequences: readonly number[];
  readonly presentedRunId: string;
  readonly presentedCursor: number;
  readonly canvasRunId: string;
  readonly gapRange: Readonly<{ firstCursor: number; lastCursor: number }> | null;
  readonly mechanicEnvelopeCount: 0;
}

export interface C15PresentationRecord extends EventlessPresentationRecord {
  readonly kind: "session-edge";
  readonly label: "archive-live-isolation";
  readonly archiveCursor: number;
  readonly liveCursor: number;
}

export type ProductionCaptureWorkload =
  | "ambient"
  | "transport-recovery"
  | "archive-live-isolation";

export interface ProductionCaptureAuthorityEndpoint {
  readonly source: "live" | "archive";
  readonly runId: string;
  readonly sourceKey: string;
  readonly cursor: number;
}

export interface ProductionCaptureAuthorityTraceEntry {
  readonly workload: ProductionCaptureWorkload;
  readonly label: string;
  readonly mechanicFinalCursor: number;
  readonly selected: ProductionCaptureAuthorityEndpoint;
  readonly live: ProductionCaptureAuthorityEndpoint & Readonly<{ source: "live" }>;
  readonly completed: boolean;
}

export interface C00ScenarioController {
  readonly kind: "C00";
  readonly records: readonly [];
  authorityTrace(): readonly ProductionCaptureAuthorityTraceEntry[];
  completeAmbientObservation(): void;
}

export interface C14ScenarioController {
  readonly kind: "C14";
  readonly records: readonly C14PresentationRecord[];
  authorityTrace(): readonly ProductionCaptureAuthorityTraceEntry[];
  recoverFromStreamErrorAndCheckpoint413(): Promise<void>;
  recoverOnceFromOverflow(): Promise<void>;
  replaceRun(): Promise<Readonly<{
    previousRunId: string;
    replacementRunId: string;
    supersededSourceId: number;
    acceptance: "typed-live-client";
  }>>;
  deliverStaleOldRun(): Promise<"rejected">;
}

export interface C15ScenarioController {
  readonly kind: "C15";
  readonly records: readonly C15PresentationRecord[];
  authorityTrace(): readonly ProductionCaptureAuthorityTraceEntry[];
  primeArchiveCursor(): Promise<void>;
  enterArchive(): Promise<void>;
  advanceLiveWhileArchived(): Promise<void>;
  returnToLive(): Promise<void>;
}

export interface NoEventlessScenarioController {
  readonly kind: "none";
  readonly records: readonly [];
}

export type ProductionChronicleScenarioController =
  | C00ScenarioController
  | C14ScenarioController
  | C15ScenarioController
  | NoEventlessScenarioController;

export interface ProductionChronicleDispatchOptions {
  readonly completion?: "await-recovery" | "bounded-prefix";
}

export interface ProductionChronicleFixture {
  readonly manifest: ChronicleManifest;
  readonly fixtureSha256: string;
  readonly requests: ProductionChronicleRequestMetrics;
  readonly scenario: ProductionChronicleScenarioController;
  dispatchRange(
    firstCursor: number,
    lastCursor: number,
    options?: ProductionChronicleDispatchOptions,
  ): Promise<void>;
  dispatchOverflow(nextCursor: number): Promise<void>;
  virtualSseLedger(): Promise<readonly VirtualSseLedgerEntry[]>;
  dispose(): Promise<ProductionFixtureTerminalLedger>;
}

export interface ProductionFixtureTerminalLedger {
  readonly activeStreams: number;
  readonly balancedSseLifecycle: boolean;
  readonly unmatchedRouteCount: number;
  readonly missingAcceptedRoutes: readonly ProductionRouteHandler[];
  readonly missingScenarioRoutes: readonly ProductionRouteHandler[];
  readonly routeReconciliationErrors: readonly string[];
}

export interface ChronicleEnvelopeTableAudit {
  readonly sourceFixtureSha256: string;
  readonly tableSha256: string;
  readonly envelopeCount: number;
  readonly firstCursor: number;
  readonly lastCursor: number;
  readonly deepFrozen: boolean;
}

interface VirtualSseControl {
  ledger(): readonly VirtualSseLedgerEntry[];
  emitError(): number;
  dispatchToSource(sourceId: number, body: unknown): "accepted" | "rejected-closed";
  forceDispatchToSource(sourceId: number, body: unknown): "forced-stale-callback" | "missing";
  setRunId(runId: string): void;
}

declare global {
  interface Window {
    __vivariumChronicleDispatch?: (body: unknown) => number;
    __vivariumChronicleDispatchRange?: (
      firstCursor: number,
      lastCursor: number,
    ) => Promise<number>;
    __vivariumChronicleEnvelopeTableAudit?: () => Promise<ChronicleEnvelopeTableAudit>;
    __vivariumChronicleActiveStreams?: () => number;
    __vivariumChronicleSseControl?: VirtualSseControl;
    __vivariumEnableProductionCaptureClockForTest?: boolean;
    __vivariumProductionMountedRunForTest?: ProductionMountedRunControl;
    __vivariumEnableProductionDiagnosticsForTest?: boolean;
    __vivariumProductionDiagnosticsForTest?: Readonly<{
      snapshot(surface: Element): unknown | null;
    }>;
  }
}

/** Install one provider-free production Chronicle behind the real HTTP/EventSource clients. */
export async function installProductionChronicleFixture(
  page: Page,
  manifest: ChronicleManifest,
  fixtureFile: string,
): Promise<ProductionChronicleFixture> {
  if (manifest.id === "C00" || manifest.id === "C14" || manifest.id === "C15") {
    validateEventlessScenarioManifest(manifest);
  }
  const terminalAuthority = chronicleTerminalAuthority(manifest);
  let deliveredCursor = manifest.initialSnapshot.event_cursor;
  let recoveryTargetCursor = deliveredCursor;
  let recoverySnapshotOverride: WorldSnapshot | null = null;
  let activeRunId = manifest.runId;
  let activeSeed = manifest.seed;
  let activeCheckpoints = [...manifest.checkpoints];
  let checkpointPage413Remaining = 0;
  let applicationOrigin: string | null = null;
  let routeSequence = 0;
  let requestSequence = 0;
  const requestIds = new WeakMap<Request, number>();
  const requests: ProductionChronicleRequestMetrics = {
    api: [],
    external: [],
    rawArtifacts: [],
    unhandledApi: [],
    routeLedger: [],
    observedRoutes: [],
    worldRequests: 0,
  };
  const fixtureSha256 = createHash("sha256")
    .update(readFileSync(resolve(fixtureFile)))
    .digest("hex");
  const canonicalEnvelopeJson = JSON.stringify(manifest.entries.map(({ cursor }) => ({
    cursor,
    body: envelopeFor(manifest, cursor, cursor),
  })));
  const envelopeTableSha256 = createHash("sha256")
    .update(canonicalEnvelopeJson)
    .digest("hex");

  const recordRoute = (
    route: Route,
    handler: ProductionRouteHandler,
    disposition: ProductionRouteLedgerEntry["disposition"],
    status: number,
  ): void => {
    const url = new URL(route.request().url());
    const requestId = observeRoutedRequest(route.request());
    requests.routeLedger.push(Object.freeze({
      requestId,
      sequence: ++routeSequence,
      handler,
      method: route.request().method(),
      path: `${url.pathname}${url.search}`,
      disposition,
      status,
    }));
  };

  function observeRoutedRequest(request: Request): number {
    const prior = requestIds.get(request);
    if (prior !== undefined) return prior;
    const requestId = ++requestSequence;
    requestIds.set(request, requestId);
    const url = new URL(request.url());
    requests.observedRoutes.push(Object.freeze({
      requestId,
      sequence: requestId,
      method: request.method(),
      path: `${url.pathname}${url.search}`,
    }));
    return requestId;
  }

  await page.addInitScript(({
    initialRunId,
    canonicalEnvelopeJson,
    sourceFixtureSha256,
    envelopeTableSha256,
  }) => {
    const maxCallbacksPerMacrotask = 1;
    const nextMacrotask = (): Promise<void> => new Promise((resolveTask) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (): void => {
        channel.port1.close();
        channel.port2.close();
        resolveTask();
      };
      channel.port2.postMessage(undefined);
    });
    window.__vivariumEnableProductionDiagnosticsForTest = true;
    const parsedEnvelopeTable = JSON.parse(canonicalEnvelopeJson) as unknown;
    if (!Array.isArray(parsedEnvelopeTable)) {
      throw new Error("canonical Chronicle envelope table must be an array");
    }
    const envelopeTable = new Map<number, EventEnvelope>();
    for (const candidate of parsedEnvelopeTable) {
      if (candidate === null || typeof candidate !== "object") {
        throw new Error("canonical Chronicle envelope table contains an invalid record");
      }
      const record = candidate as { cursor?: unknown; body?: unknown };
      if (typeof record.cursor !== "number" || !Number.isSafeInteger(record.cursor)
        || record.cursor <= 0 || record.body === null || typeof record.body !== "object") {
        throw new Error("canonical Chronicle envelope table contains an invalid cursor or body");
      }
      const envelope = record.body as EventEnvelope;
      if (envelope.next_cursor !== record.cursor || envelope.cursor !== record.cursor - 1
        || envelope.oldest_cursor !== record.cursor || envelope.overflow !== false
        || envelope.snapshot_required !== false || envelope.events.length !== 1
        || envelope.events[0]?.cursor !== record.cursor || envelopeTable.has(record.cursor)) {
        throw new Error(`canonical Chronicle envelope ${record.cursor} failed integrity validation`);
      }
      envelopeTable.set(record.cursor, envelope);
    }
    const deepFreeze = (value: unknown, seen = new WeakSet<object>()): void => {
      if (value === null || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      for (const child of Object.values(value)) deepFreeze(child, seen);
      Object.freeze(value);
    };
    deepFreeze(parsedEnvelopeTable);
    const isDeepFrozen = (value: unknown, seen = new WeakSet<object>()): boolean => {
      if (value === null || typeof value !== "object" || seen.has(value)) return true;
      if (!Object.isFrozen(value)) return false;
      seen.add(value);
      return Object.values(value).every((child) => isDeepFrozen(child, seen));
    };
    const tableIsDeepFrozen = isDeepFrozen(parsedEnvelopeTable);
    let verifiedTableSha256: Promise<string> | null = null;
    const verifyTableSha256 = (): Promise<string> => {
      verifiedTableSha256 ??= crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalEnvelopeJson),
      ).then((digest) => [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""))
        .then((actual) => {
          if (actual !== envelopeTableSha256) {
            throw new Error("canonical Chronicle envelope table hash mismatch");
          }
          return actual;
        });
      return verifiedTableSha256;
    };
    window.__vivariumChronicleEnvelopeTableAudit = async () => Object.freeze({
      sourceFixtureSha256,
      tableSha256: await verifyTableSha256(),
      envelopeCount: envelopeTable.size,
      firstCursor: envelopeTable.size === 0 ? 0 : Math.min(...envelopeTable.keys()),
      lastCursor: envelopeTable.size === 0 ? 0 : Math.max(...envelopeTable.keys()),
      deepFrozen: tableIsDeepFrozen,
    });
    let nextSourceId = 0;
    let nextSequence = 0;
    let currentRunId = initialRunId;
    const ledger: VirtualSseLedgerEntry[] = [];
    const activeSources = new Set<QuietChronicleEventSource>();
    const allSources = new Map<number, QuietChronicleEventSource>();
    const envelopeCursor = (body: unknown): number => {
      if (body === null || typeof body !== "object") return -1;
      const value = (body as { next_cursor?: unknown }).next_cursor;
      return typeof value === "number" && Number.isSafeInteger(value) ? value : -1;
    };
    const append = (
      source: QuietChronicleEventSource,
      kind: VirtualSseLedgerEntry["kind"],
      cursor: number,
      disposition: VirtualSseLedgerEntry["disposition"] = "accepted",
      body?: unknown,
    ): void => {
      const envelope = body !== null && typeof body === "object"
        ? body as Record<string, unknown>
        : null;
      ledger.push(Object.freeze({
        sequence: ++nextSequence,
        kind,
        sourceId: source.sourceId,
        sourceRunId: source.runId,
        url: source.url,
        cursor,
        envelopeRunId: typeof envelope?.run_id === "string" ? envelope.run_id : null,
        overflow: typeof envelope?.overflow === "boolean" ? envelope.overflow : null,
        snapshotRequired: typeof envelope?.snapshot_required === "boolean"
          ? envelope.snapshot_required
          : null,
        eventCount: Array.isArray(envelope?.events) ? envelope.events.length : null,
        envelope: kind === "envelope" ? structuredClone(body) as EventEnvelope : null,
        disposition,
      }));
    };
    class QuietChronicleEventSource {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly sourceId = ++nextSourceId;
      readonly runId = currentRunId;
      readonly url: string;
      readonly withCredentials = false;
      readonly cursor: number;
      readyState = QuietChronicleEventSource.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      private readonly listeners = new Map<string, EventListener[]>();

      constructor(url: string | URL) {
        this.url = String(url);
        const parsed = new URL(this.url, window.location.href);
        if (
          parsed.origin !== window.location.origin
          || parsed.pathname !== "/api/events/stream"
          || parsed.hash !== ""
          || [...parsed.searchParams.keys()].join("\0") !== "cursor"
        ) throw new Error("virtual EventSource requires exact GET /api/events/stream?cursor=<integer>");
        const rawCursor = parsed.searchParams.get("cursor");
        if (rawCursor === null || !/^\d+$/.test(rawCursor) || !Number.isSafeInteger(Number(rawCursor))) {
          throw new Error("virtual EventSource cursor must be a non-negative safe integer");
        }
        this.cursor = Number(rawCursor);
        activeSources.add(this);
        allSources.set(this.sourceId, this);
        append(this, "open", this.cursor);
        queueMicrotask(() => this.onopen?.(new Event("open")));
      }

      addEventListener(type: string, listener: EventListener): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
      }

      dispatch(body: unknown): "accepted" | "rejected-closed" {
        const cursor = envelopeCursor(body);
        if (this.readyState !== QuietChronicleEventSource.OPEN) {
          append(this, "envelope", cursor, "rejected-closed", body);
          return "rejected-closed";
        }
        append(this, "envelope", cursor, "accepted", body);
        const event = { data: JSON.stringify(body) } as MessageEvent;
        for (const listener of this.listeners.get("events") ?? []) listener(event);
        return "accepted";
      }

      forceStaleCallback(body: unknown): "forced-stale-callback" {
        append(this, "envelope", envelopeCursor(body), "forced-stale-callback", body);
        const event = { data: JSON.stringify(body) } as MessageEvent;
        for (const listener of this.listeners.get("events") ?? []) listener(event);
        return "forced-stale-callback";
      }

      emitError(): void {
        if (this.readyState !== QuietChronicleEventSource.OPEN) return;
        append(this, "error", this.cursor);
        this.onerror?.(new Event("error"));
      }

      close(): void {
        if (this.readyState === QuietChronicleEventSource.CLOSED) return;
        this.readyState = QuietChronicleEventSource.CLOSED;
        activeSources.delete(this);
        append(this, "close", this.cursor);
      }
    }
    window.__vivariumChronicleDispatch = (body: unknown): number => {
      const sources = [...activeSources];
      for (const source of sources) source.dispatch(body);
      return sources.length;
    };
    window.__vivariumChronicleActiveStreams = (): number => activeSources.size;
    window.__vivariumChronicleDispatchRange = async (firstCursor, lastCursor): Promise<number> => {
      if (!Number.isSafeInteger(firstCursor) || !Number.isSafeInteger(lastCursor)
        || firstCursor <= 0 || lastCursor < firstCursor) {
        throw new Error("Chronicle dispatch requires safe positive integer bounds");
      }
      for (let cursor = firstCursor; cursor <= lastCursor; cursor += 1) {
        if (!envelopeTable.has(cursor)) {
          throw new Error(`Chronicle envelope ${cursor} is not installed`);
        }
      }
      let lastDeliveredCursor = -1;
      let callbacksSinceYield = 0;
      for (let cursor = firstCursor; cursor <= lastCursor; cursor += 1) {
        const envelope = envelopeTable.get(cursor);
        if (envelope === undefined) {
          throw new Error(`Chronicle envelope ${cursor} is not installed`);
        }
        if ((window.__vivariumChronicleActiveStreams?.() ?? 0) === 0) break;
        if ((window.__vivariumChronicleDispatch?.(envelope) ?? 0) === 0) break;
        lastDeliveredCursor = cursor;
        callbacksSinceYield += 1;
        if ((window.__vivariumChronicleActiveStreams?.() ?? 0) === 0) break;
        if (callbacksSinceYield >= maxCallbacksPerMacrotask && cursor < lastCursor) {
          await nextMacrotask();
          callbacksSinceYield = 0;
        }
      }
      return lastDeliveredCursor;
    };
    window.__vivariumChronicleSseControl = Object.freeze({
      ledger: () => structuredClone(ledger),
      emitError(): number {
        const source = [...activeSources].at(-1);
        if (source === undefined) return -1;
        source.emitError();
        return source.sourceId;
      },
      dispatchToSource(sourceId: number, body: unknown): "accepted" | "rejected-closed" {
        return allSources.get(sourceId)?.dispatch(body) ?? "rejected-closed";
      },
      forceDispatchToSource(sourceId: number, body: unknown): "forced-stale-callback" | "missing" {
        return allSources.get(sourceId)?.forceStaleCallback(body) ?? "missing";
      },
      setRunId(runId: string): void {
        if (runId.trim() === "") throw new Error("virtual EventSource run identity is required");
        currentRunId = runId;
      },
    });
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: QuietChronicleEventSource,
    });
  }, {
    initialRunId: manifest.runId,
    canonicalEnvelopeJson,
    sourceFixtureSha256: fixtureSha256,
    envelopeTableSha256,
  });

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (applicationOrigin === null
      && request.isNavigationRequest()
      && request.frame() === page.mainFrame()) applicationOrigin = url.origin;
    if (applicationOrigin !== null && url.origin !== applicationOrigin) {
      requests.external.push(request.url());
      observeRoutedRequest(request);
    }
    if (url.pathname.startsWith("/api/")) {
      requests.api.push(`${request.method()} ${url.pathname}${url.search}`);
      observeRoutedRequest(request);
    }
  });

  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (applicationOrigin === null
      && route.request().isNavigationRequest()
      && route.request().frame() === page.mainFrame()) applicationOrigin = url.origin;
    if (applicationOrigin !== null && url.origin !== applicationOrigin) {
      recordRoute(route, "external-reject", "rejected", 0);
      return route.abort("blockedbyclient");
    }
    if (url.pathname.startsWith("/api/")) return rejectApi(route);
    return route.fallback();
  });
  await page.route("**/api/replay/artifacts/**", (route) => {
    const url = new URL(route.request().url());
    if (!["/api/replay/artifacts/events", "/api/replay/artifacts/snapshots"].includes(url.pathname)
      || url.search !== "") return rejectApi(route);
    requests.rawArtifacts.push(route.request().url());
    recordRoute(route, "raw-artifact-reject", "rejected", 0);
    return route.abort("blockedbyclient");
  });
  await page.route("**/api/run*", (route) => exactGet(route, "run", (url) => (
    url.pathname === "/api/run" && url.search === ""
  ), () => fulfillJson(route, runMetadata(manifest, activeRunId, activeSeed, currentWorld()))));
  await page.route("**/api/world*", (route) => exactGet(route, "world", (url) => (
    url.pathname === "/api/world" && url.search === ""
  ), () => {
    requests.worldRequests += 1;
    return fulfillJson(route, currentWorld());
  }));
  await page.route("**/api/events?*", (route) => exactGet(route, "events-page", (url) => (
    url.pathname === "/api/events" && exactIntegerQuery(url, ["cursor"])
  ), () => fulfillJson(route, envelopeFor(
    manifest,
    Math.max(1, deliveredCursor + 1),
    deliveredCursor,
  ))));
  await page.route("**/api/replay/manifest*", (route) => exactGet(
    route,
    "replay-manifest",
    (url) => url.pathname === "/api/replay/manifest" && url.search === "",
    () => {
      const eligible = eligibleActiveCheckpoints();
      const artifactCursor = manifest.entries.length === 0 ? 0 : deliveredCursor;
      return fulfillJson(route, {
        schema: 1,
        run_id: activeRunId,
        events: {
          count: artifactCursor,
          first_cursor: artifactCursor === 0 ? null : 1,
          last_cursor: artifactCursor === 0 ? null : artifactCursor,
        },
        checkpoints: {
          count: eligible.length,
          first_line: eligible[0]?.line ?? null,
          last_line: eligible.at(-1)?.line ?? null,
          first_event_cursor: eligible[0]?.checkpoint.event_cursor ?? null,
          last_event_cursor: eligible.at(-1)?.checkpoint.event_cursor ?? null,
        },
        bootstrap: {
          event_after: Math.max(0, artifactCursor - 512),
          event_limit: 512,
        },
      });
    },
  ));
  await page.route("**/api/replay/checkpoints/latest*", (route) => exactGet(
    route,
    "replay-checkpoint-latest",
    (url) => url.pathname === "/api/replay/checkpoints/latest" && url.search === "",
    () => {
      const record = eligibleActiveCheckpoints().at(-1);
      return record === undefined
        ? fulfillStatus(route, 404)
        : fulfillJson(route, { schema: 1, run_id: activeRunId, ...record });
    },
  ));
  await page.route("**/api/replay/checkpoints?*", (route) => exactGet(
    route,
    "replay-checkpoints-page",
    (url) => url.pathname === "/api/replay/checkpoints"
      && exactIntegerQuery(url, ["before", "limit"], true),
    () => {
      if (checkpointPage413Remaining > 0) {
        checkpointPage413Remaining -= 1;
        return fulfillStatus(route, 413, "checkpoint record exceeds bounded fixture page");
      }
      const url = new URL(route.request().url());
      const before = Number(url.searchParams.get("before"));
      const limit = Number(url.searchParams.get("limit"));
      const eligible = eligibleActiveCheckpoints().filter(({ line }) => line < before);
      const records = eligible.slice(Math.max(0, eligible.length - limit));
      return fulfillJson(route, {
        schema: 1,
        run_id: activeRunId,
        before,
        next_before: records[0]?.line ?? before,
        has_more: records[0] !== undefined && records[0].line > 1,
        checkpoints: records,
      });
    },
  ));
  await page.route("**/api/replay/events?*", (route) => exactGet(
    route,
    "replay-events-page",
    (url) => url.pathname === "/api/replay/events"
      && exactIntegerQuery(url, ["after", "limit"]),
    () => {
      const url = new URL(route.request().url());
      const after = Number(url.searchParams.get("after"));
      const limit = Number(url.searchParams.get("limit"));
      const events = manifest.entries
        .filter(({ cursor }) => cursor > after && cursor <= deliveredCursor)
        .slice(0, limit);
      const artifactCursor = manifest.entries.length === 0 ? 0 : deliveredCursor;
      return fulfillJson(route, {
        schema: 1,
        run_id: activeRunId,
        after,
        next_after: events.at(-1)?.cursor ?? after,
        has_more: events.at(-1)?.cursor !== artifactCursor,
        events,
      });
    },
  ));

  const bootstrapPageErrors: string[] = [];
  const recordBootstrapPageError = (error: Error): void => {
    bootstrapPageErrors.push(error.message);
  };
  page.on("pageerror", recordBootstrapPageError);
  try {
    await page.goto("/?renderer=2d");
    await bootstrapTypedCaptureStageAtInitialTime(page, bootstrapPageErrors);
    await page.waitForFunction(() => (
      document.querySelector(".vivarium-2d-app")?.getAttribute("data-presented-cursor") === "0"
      && document.querySelector(".presentation-world-stage")?.getAttribute("data-ready") === "true"
    ));
  } finally {
    page.off("pageerror", recordBootstrapPageError);
  }
  const installedEnvelopeTable = await page.evaluate(() => (
    window.__vivariumChronicleEnvelopeTableAudit?.() ?? null
  ));
  if (installedEnvelopeTable === null
    || installedEnvelopeTable.sourceFixtureSha256 !== fixtureSha256
    || installedEnvelopeTable.tableSha256 !== envelopeTableSha256
    || installedEnvelopeTable.envelopeCount !== manifest.entries.length
    || installedEnvelopeTable.deepFrozen !== true) {
    throw new Error("page-side Chronicle envelope table failed installation integrity checks");
  }

  const virtualSseLedger = (): Promise<readonly VirtualSseLedgerEntry[]> => page.evaluate(() => (
    window.__vivariumChronicleSseControl?.ledger() ?? []
  ));
  const dispatchOverflow = async (nextCursor: number): Promise<void> => {
    const priorCursor = deliveredCursor;
    recoverySnapshotOverride = activeRunId === terminalAuthority.presentation.terminal.runId
      && nextCursor === terminalAuthority.presentation.terminal.cursor
      ? structuredClone(terminalAuthority.presentation.terminal.snapshot)
      : snapshotAtCursor(manifest.initialSnapshot, activeRunId, nextCursor);
    deliveredCursor = nextCursor;
    recoveryTargetCursor = nextCursor;
    await page.evaluate((body) => window.__vivariumChronicleDispatch?.(body), {
      schema: 1,
      cursor: priorCursor,
      oldest_cursor: priorCursor,
      next_cursor: nextCursor,
      events: [],
      overflow: true,
      snapshot_required: true,
    } satisfies EventEnvelope);
  };
  const scenario = createScenarioController();

  return {
    manifest,
    fixtureSha256,
    requests,
    scenario,
    virtualSseLedger,
    async dispatchRange(firstCursor, lastCursor, options = {}): Promise<void> {
      if (firstCursor > lastCursor) return;
      const completion = options.completion ?? "await-recovery";
      // Keep replay/checkpoint routes on accepted truth while the page-side burst runs.
      // Recovery may still fetch the known authoritative terminal snapshot immediately.
      recoveryTargetCursor = Math.max(recoveryTargetCursor, lastCursor);
      await page.waitForFunction(() => (window.__vivariumChronicleActiveStreams?.() ?? 0) > 0);
      const lastDeliveredCursor = await page.evaluate(([first, last]) => (
        window.__vivariumChronicleDispatchRange?.(first, last) ?? Promise.resolve(-1)
      ), [firstCursor, lastCursor] as const);
      deliveredCursor = Math.max(deliveredCursor, lastCursor);
      if (lastDeliveredCursor < lastCursor) {
        if (completion === "bounded-prefix") {
          if (lastDeliveredCursor < firstCursor) {
            throw new Error("bounded-prefix dispatch requires at least one accepted envelope");
          }
          return;
        }
        try {
          await page.waitForFunction(
            () => (window.__vivariumChronicleActiveStreams?.() ?? 0) > 0,
            undefined,
            { timeout: 15_000 },
          );
        } catch (error) {
          const state = await page.evaluate(() => {
            const app = document.querySelector(".vivarium-2d-app");
            const stage = document.querySelector(".presentation-world-stage");
            const accessor = window.__vivariumProductionDiagnosticsForTest;
            const observer = app === null ? null : accessor?.snapshot(app) as any;
            const renderer = stage === null ? null : accessor?.snapshot(stage) as any;
            return {
              activeStreams: window.__vivariumChronicleActiveStreams?.() ?? -1,
              presentedSource: app?.getAttribute("data-presented-source") ?? null,
              presentedCursor: app?.getAttribute("data-presented-cursor") ?? null,
              observerFrameIdentity: observer?.frameIdentity ?? null,
              rendererFrameIdentity: renderer?.frameIdentity ?? null,
              session: {
                recovery: observer?.session?.recovery ?? null,
                settlement: observer?.session?.settlement ?? null,
                director: observer?.session?.director ?? null,
                ingress: observer?.session?.ingress ?? null,
                paused: observer?.session?.paused ?? null,
                held: observer?.session?.held ?? null,
              },
            };
          });
          const ledger = await virtualSseLedger();
          throw new Error(`Chronicle recovery did not reopen its production stream: ${JSON.stringify({
            firstCursor,
            lastCursor,
            lastDeliveredCursor,
            worldRequests: requests.worldRequests,
            state,
            ledgerTail: ledger.slice(-12),
          })}`, { cause: error });
        }
      }
    },
    dispatchOverflow,
    async dispose(): Promise<ProductionFixtureTerminalLedger> {
      await page.evaluate(() => {
        history.pushState({}, "", "/?renderer=2d-slice");
        dispatchEvent(new PopStateEvent("popstate"));
      });
      await page.waitForFunction(() => (
        document.querySelectorAll(".vivarium-2d-app").length === 0
        && (window.__vivariumChronicleActiveStreams?.() ?? -1) === 0
      ));
      const sse = await virtualSseLedger();
      const sources = new Map<number, { opens: number; closes: number }>();
      for (const entry of sse) {
        const counts = sources.get(entry.sourceId) ?? { opens: 0, closes: 0 };
        if (entry.kind === "open") counts.opens += 1;
        if (entry.kind === "close") counts.closes += 1;
        sources.set(entry.sourceId, counts);
      }
      const fulfilled = new Set(requests.routeLedger
        .filter(({ disposition, status }) => disposition === "fulfilled" && status < 400)
        .map(({ handler }) => handler));
      const acceptedHandlers: readonly ProductionRouteHandler[] = [
        "run", "world", "events-page", "replay-manifest", "replay-checkpoint-latest",
        "replay-checkpoints-page", "replay-events-page",
      ];
      const scenarioHandlers: readonly ProductionRouteHandler[] = manifest.id === "C14"
        ? ["run", "world", "replay-checkpoint-latest", "replay-checkpoints-page"]
        : manifest.id === "C15"
          ? ["run", "world", "replay-manifest", "replay-checkpoint-latest", "replay-events-page"]
          : ["run", "world"];
      const routeReconciliationErrors = reconcileRouteTerminalLedger(
        requests.observedRoutes,
        requests.routeLedger,
      );
      return Object.freeze({
        activeStreams: await page.evaluate(() => window.__vivariumChronicleActiveStreams?.() ?? -1),
        balancedSseLifecycle: [...sources.values()].every(({ opens, closes }) => (
          opens === 1 && closes === 1
        )),
        unmatchedRouteCount: routeReconciliationErrors.length,
        missingAcceptedRoutes: acceptedHandlers.filter((handler) => !fulfilled.has(handler)),
        missingScenarioRoutes: scenarioHandlers.filter((handler) => !fulfilled.has(handler)),
        routeReconciliationErrors: Object.freeze(routeReconciliationErrors),
      });
    },
  };

  function currentWorld(): WorldSnapshot {
    return structuredClone(
      recoverySnapshotOverride
      ?? snapshotAt(manifest, recoveryTargetCursor)
    );
  }

  function eligibleActiveCheckpoints() {
    return activeCheckpoints.filter((record) => (
      record.checkpoint.run_id === activeRunId
      && record.checkpoint.event_cursor <= deliveredCursor
    ));
  }

  function rejectApi(route: Route): Promise<void> {
    requests.unhandledApi.push(route.request().url());
    recordRoute(route, "api-reject", "rejected", 0);
    return route.abort("blockedbyclient");
  }

  function exactGet(
    route: Route,
    handler: ProductionRouteHandler,
    matches: (url: URL) => boolean,
    fulfill: () => Promise<void>,
  ): Promise<void> {
    if (route.request().method() !== "GET" || !matches(new URL(route.request().url()))) {
      return rejectApi(route);
    }
    const before = requests.routeLedger.length;
    return fulfill().then(() => {
      if (requests.routeLedger.length === before) recordRoute(route, handler, "fulfilled", 200);
    });
  }

  function fulfillJson(route: Route, value: unknown): Promise<void> {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(value),
    }).then(() => {
      const url = new URL(route.request().url());
      const handler = handlerFor(url.pathname);
      recordRoute(route, handler, "fulfilled", 200);
    });
  }

  function fulfillStatus(route: Route, status: number, body = ""): Promise<void> {
    return route.fulfill({ status, body }).then(() => {
      recordRoute(route, handlerFor(new URL(route.request().url()).pathname), "fulfilled", status);
    });
  }

  function createScenarioController(): ProductionChronicleScenarioController {
    if (manifest.id === "C00") {
      const trace: ProductionCaptureAuthorityTraceEntry[] = [authorityTraceEntry(
        "ambient",
        "live-0",
        liveEndpoint(manifest.runId, 0),
        liveEndpoint(manifest.runId, 0),
        false,
      )];
      let completed = false;
      return {
        kind: "C00",
        records: [] as const,
        authorityTrace: () => deepFreezeClone(trace),
        completeAmbientObservation(): void {
          if (completed) throw new Error("C00 ambient observation can complete only once");
          completed = true;
          trace.push(authorityTraceEntry(
            "ambient",
            "terminal-live-0",
            liveEndpoint(manifest.runId, 0),
            liveEndpoint(manifest.runId, 0),
            true,
          ));
        },
      };
    }
    if (manifest.id === "C14") {
      const expectations = c14Expectations(manifest);
      const records: C14PresentationRecord[] = [];
      const trace: ProductionCaptureAuthorityTraceEntry[] = [authorityTraceEntry(
        "transport-recovery",
        "old-live-0",
        liveEndpoint(manifest.runId, 0),
        liveEndpoint(manifest.runId, 0),
        false,
      )];
      let staleSourceId: number | null = null;
      let stage: "initial" | "gap-recovered" | "overflow-recovered" | "replaced" | "complete"
        = "initial";
      return {
        kind: "C14",
        get records(): readonly C14PresentationRecord[] {
          return deepFreezeClone(records);
        },
        authorityTrace: () => deepFreezeClone(trace),
        async recoverFromStreamErrorAndCheckpoint413(): Promise<void> {
          if (stage !== "initial") throw new Error("C14 gap/413 recovery must be the first stage");
          recoverySnapshotOverride = snapshotAtCursor(
            manifest.initialSnapshot,
            activeRunId,
            expectations.lastMissingCursor,
          );
          deliveredCursor = expectations.lastMissingCursor;
          activeCheckpoints = [
            ...manifest.checkpoints,
            checkpointAt(manifest, 2, activeRunId, expectations.lastMissingCursor),
          ];
          checkpointPage413Remaining = 1;
          await page.evaluate(() => (
            window.__vivariumChronicleSseControl?.emitError() ?? -1
          ));
          await page.waitForFunction((cursor) => (
            document.querySelector(".vivarium-2d-app")?.getAttribute("data-presented-cursor")
              === String(cursor)
            && (window.__vivariumChronicleSseControl?.ledger() ?? [])
              .filter(({ kind }) => kind === "open").length >= 2
          ), expectations.lastMissingCursor);
          await page.locator("#observer-chronicle-trigger").click();
          const gapText = await page.locator(".chronicle-drawer__gap").textContent();
          if (!gapText?.includes("Shown range 1–2")) {
            throw new Error("C14 production Chronicle did not retain authoritative gap 1-2");
          }
          await page.getByLabel("Close Chronicle").click();
          const evidence = await c14Evidence({ firstCursor: 1, lastCursor: 2 });
          if (!requests.routeLedger.some(({ status }) => status === 413)
            || !requests.routeLedger.some(({ handler }) => handler === "world")) {
            throw new Error("C14 gap evidence requires one 413 and authoritative world retry");
          }
          records.push(eventlessC14Record("cursor-gap", evidence));
          records.push(eventlessC14Record("oversized-record-413", evidence));
          trace.push(authorityTraceEntry(
            "transport-recovery",
            "old-live-2",
            liveEndpoint(activeRunId, expectations.lastMissingCursor),
            liveEndpoint(activeRunId, expectations.lastMissingCursor),
            false,
          ));
          stage = "gap-recovered";
        },
        async recoverOnceFromOverflow(): Promise<void> {
          if (stage !== "gap-recovered") {
            throw new Error("C14 overflow recovery requires completed gap/413 recovery");
          }
          const nextCursor = expectations.lastMissingCursor + 1;
          await dispatchOverflow(nextCursor);
          await page.waitForFunction((cursor) => (
            document.querySelector(".vivarium-2d-app")?.getAttribute("data-presented-cursor")
              === String(cursor)
            && (window.__vivariumChronicleSseControl?.ledger() ?? [])
              .filter(({ kind }) => kind === "open").some((entry) => entry.cursor === cursor)
          ), nextCursor);
          trace.push(authorityTraceEntry(
            "transport-recovery",
            "old-live-3",
            liveEndpoint(activeRunId, nextCursor),
            liveEndpoint(activeRunId, nextCursor),
            false,
          ));
          stage = "overflow-recovered";
        },
        async replaceRun(): Promise<Readonly<{
          previousRunId: string;
          replacementRunId: string;
          supersededSourceId: number;
          acceptance: "typed-live-client";
        }>> {
          if (stage !== "overflow-recovered") {
            throw new Error("C14 replacement requires gap/413 and overflow recovery");
          }
          const previousRunId = activeRunId;
          const beforeLedger = await virtualSseLedger();
          const closed = new Set(beforeLedger.filter(({ kind }) => kind === "close")
            .map(({ sourceId }) => sourceId));
          const superseded = beforeLedger.filter(({ kind, sourceId }) => (
            kind === "open" && !closed.has(sourceId)
          )).at(-1);
          if (superseded === undefined || superseded.cursor !== 3) {
            throw new Error("C14 replacement requires the active cursor-3 old-run source");
          }
          staleSourceId = superseded.sourceId;
          activeRunId = `${manifest.runId}-replacement`;
          activeSeed = manifest.seed + 1;
          deliveredCursor = 0;
          recoveryTargetCursor = 0;
          recoverySnapshotOverride = structuredClone(
            terminalAuthority.presentation.terminal.snapshot,
          );
          activeCheckpoints = [checkpointAt(manifest, 1, activeRunId, 0)];
          const accepted = await page.evaluate(async () => {
            const loadClient = new Function(
              "return import('/src/app/client.ts')",
            ) as () => Promise<Readonly<{
              createHttpLiveApiClient(): Readonly<{
                getRun(): Promise<RunMetadata>;
                getWorld(): Promise<WorldSnapshot>;
              }>;
            }>>;
            const client = (await loadClient()).createHttpLiveApiClient();
            const [run, world] = await Promise.all([client.getRun(), client.getWorld()]);
            const control = window.__vivariumProductionMountedRunForTest;
            if (control === undefined) throw new Error("mounted production replacement seam is unavailable");
            window.__vivariumChronicleSseControl?.setRunId(run.run_id);
            control.replaceMountedRunForTest(run, world);
            return { run, world };
          });
          if (accepted.run.run_id !== activeRunId || accepted.world.run_id !== activeRunId) {
            throw new Error("replacement /api/run and /api/world must share one identity");
          }
          await page.waitForFunction((input) => {
            const app = document.querySelector(".vivarium-2d-app");
            const stage = document.querySelector(".presentation-world-stage");
            const accessor = window.__vivariumProductionDiagnosticsForTest;
            const observer = app === null ? null : accessor?.snapshot(app) as any;
            const renderer = stage === null ? null : accessor?.snapshot(stage) as any;
            return observer?.frameIdentity?.runId === input.runId
              && observer.frameIdentity.sourceKey === `live:${input.runId}`
              && renderer?.frameIdentity?.runId === input.runId
              && renderer.frameIdentity.sourceKey === `live:${input.runId}`
              && (window.__vivariumChronicleSseControl?.ledger() ?? []).some((entry) => (
                entry.kind === "open"
                && entry.cursor === 0
                && entry.sourceId !== input.supersededSourceId
              ));
          }, { runId: activeRunId, supersededSourceId: superseded.sourceId });
          records.push(eventlessC14Record("run-replacement", await c14Evidence(null)));
          trace.push(authorityTraceEntry(
            "transport-recovery",
            "replacement-live-0",
            liveEndpoint(activeRunId, 0),
            liveEndpoint(activeRunId, 0),
            false,
          ));
          stage = "replaced";
          return Object.freeze({
            previousRunId,
            replacementRunId: activeRunId,
            supersededSourceId: superseded.sourceId,
            acceptance: "typed-live-client",
          });
        },
        async deliverStaleOldRun(): Promise<"rejected"> {
          if (stage !== "replaced" || staleSourceId === null || staleSourceId < 0) {
            throw new Error("C14 stale delivery requires completed replacement setup");
          }
          await page.waitForFunction(() => {
            const app = document.querySelector(".vivarium-2d-app");
            const observer = app === null
              ? null
              : window.__vivariumProductionDiagnosticsForTest?.snapshot(app) as any;
            return observer?.session?.checkpoint?.polling === false
              && observer?.session?.recovery?.status === "idle"
              && (window.__vivariumChronicleActiveStreams?.() ?? 0) === 1;
          });
          const before = await mountedIdentity();
          const beforeWorldRequests = requests.worldRequests;
          const beforeSse = await virtualSseLedger();
          const disposition = await page.evaluate(({ sourceId, body }) => (
            window.__vivariumChronicleSseControl?.forceDispatchToSource(sourceId, body)
              ?? "missing"
          ), {
            sourceId: staleSourceId,
            body: staleOverflowEnvelope(),
          });
          await page.evaluate(async () => {
            const turn = (): Promise<void> => new Promise((resolveTurn) => {
              const channel = new MessageChannel();
              channel.port1.onmessage = (): void => {
                channel.port1.close();
                channel.port2.close();
                resolveTurn();
              };
              channel.port2.postMessage(undefined);
            });
            await turn();
            await turn();
          });
          const after = await mountedIdentity();
          const afterSse = await virtualSseLedger();
          if (disposition !== "forced-stale-callback"
            || JSON.stringify(before) !== JSON.stringify(after)
            || requests.worldRequests !== beforeWorldRequests
            || afterSse.length !== beforeSse.length + 1
            || afterSse.at(-1)?.disposition !== "forced-stale-callback"
            || after.observerRunId !== activeRunId
            || after.canvasRunId !== activeRunId) {
            throw new Error("production generation did not reject stale old-run callback");
          }
          trace.push(authorityTraceEntry(
            "transport-recovery",
            "stale-old-run-rejected",
            liveEndpoint(activeRunId, 0),
            liveEndpoint(activeRunId, 0),
            true,
          ));
          stage = "complete";
          return "rejected";
        },
      };
    }
    if (manifest.id === "C15") {
      const expectation = c15Expectation(manifest);
      const records: C15PresentationRecord[] = [];
      const trace: ProductionCaptureAuthorityTraceEntry[] = [authorityTraceEntry(
        "archive-live-isolation",
        "live-0",
        liveEndpoint(manifest.runId, 0),
        liveEndpoint(manifest.runId, 0),
        false,
      )];
      let primed = false;
      let entered = false;
      let advanced = false;
      let returned = false;
      return {
        kind: "C15",
        get records(): readonly C15PresentationRecord[] {
          return deepFreezeClone(records);
        },
        authorityTrace: () => deepFreezeClone(trace),
        async primeArchiveCursor(): Promise<void> {
          if (primed) throw new Error("C15 Archive cursor can be primed only once");
          primed = true;
          activeCheckpoints = [checkpointAt(manifest, 1, activeRunId, expectation.archiveCursor)];
          await dispatchOverflow(expectation.archiveCursor);
          await page.waitForFunction((cursor) => (
            document.querySelector(".vivarium-2d-app")?.getAttribute("data-presented-cursor")
              === String(cursor)
          ), expectation.archiveCursor);
          trace.push(authorityTraceEntry(
            "archive-live-isolation",
            "live-2",
            liveEndpoint(activeRunId, expectation.archiveCursor),
            liveEndpoint(activeRunId, expectation.archiveCursor),
            false,
          ));
        },
        async enterArchive(): Promise<void> {
          if (!primed || entered) throw new Error("C15 Archive entry requires one primed cursor");
          entered = true;
          await page.locator("#observer-archive-trigger").click();
          await page.getByRole("heading", { name: "Archive", exact: true }).waitFor();
          await page.locator(".archive-drawer__checkpoints button").first().click();
          await page.waitForFunction((cursor) => {
            const app = document.querySelector(".vivarium-2d-app");
            return app?.getAttribute("data-presented-source") === "archive"
              && app.getAttribute("data-presented-cursor") === String(cursor);
          }, expectation.archiveCursor);
          trace.push(authorityTraceEntry(
            "archive-live-isolation",
            "archive-2",
            archiveEndpoint(activeRunId, 1, expectation.archiveCursor),
            liveEndpoint(activeRunId, expectation.archiveCursor),
            false,
          ));
        },
        async advanceLiveWhileArchived(): Promise<void> {
          if (!entered || advanced) throw new Error("C15 isolated Live advance requires Archive");
          advanced = true;
          await dispatchOverflow(expectation.liveCursor);
          await page.waitForFunction((input) => {
            const app = document.querySelector(".vivarium-2d-app");
            const ledger = window.__vivariumChronicleSseControl?.ledger() ?? [];
            return app?.getAttribute("data-presented-source") === "archive"
              && app.getAttribute("data-presented-cursor") === String(input.archiveCursor)
              && ledger.some(({ kind, cursor }) => kind === "open" && cursor === input.liveCursor);
          }, expectation);
          trace.push(authorityTraceEntry(
            "archive-live-isolation",
            "archive-2-live-4",
            archiveEndpoint(activeRunId, 1, expectation.archiveCursor),
            liveEndpoint(activeRunId, expectation.liveCursor),
            false,
          ));
        },
        async returnToLive(): Promise<void> {
          if (!advanced || returned) throw new Error("C15 return requires one retained Live advancement");
          returned = true;
          await page.getByRole("button", { name: "Return to Live" }).click();
          await page.waitForFunction((cursor) => {
            const app = document.querySelector(".vivarium-2d-app");
            return app?.getAttribute("data-presented-source") === "live"
              && app.getAttribute("data-presented-cursor") === String(cursor);
          }, expectation.liveCursor);
          records.push(Object.freeze({
            kind: "session-edge",
            label: "archive-live-isolation",
            archiveCursor: expectation.archiveCursor,
            liveCursor: expectation.liveCursor,
            mechanicEventsFabricated: false,
          }));
          trace.push(authorityTraceEntry(
            "archive-live-isolation",
            "terminal-live-4",
            liveEndpoint(activeRunId, expectation.liveCursor),
            liveEndpoint(activeRunId, expectation.liveCursor),
            true,
          ));
        },
      };
    }
    return Object.freeze({ kind: "none", records: [] as const });
  }

  async function mountedIdentity(): Promise<Readonly<{
    observerRunId: string | null;
    observerSourceKey: string | null;
    observerCursor: number | null;
    canvasRunId: string | null;
    canvasSourceKey: string | null;
    frameIdentity: unknown;
    ingress: unknown;
    recovery: unknown;
    checkpoint: unknown;
  }>> {
    return page.evaluate(() => {
      const app = document.querySelector(".vivarium-2d-app");
      const stage = document.querySelector(".presentation-world-stage");
      const accessor = window.__vivariumProductionDiagnosticsForTest;
      const observer = app === null ? null : accessor?.snapshot(app) as any;
      const renderer = stage === null ? null : accessor?.snapshot(stage) as any;
      return {
        observerRunId: observer?.frameIdentity?.runId ?? null,
        observerSourceKey: observer?.frameIdentity?.sourceKey ?? null,
        observerCursor: observer?.presentedCursor ?? null,
        canvasRunId: renderer?.frameIdentity?.runId ?? null,
        canvasSourceKey: renderer?.frameIdentity?.sourceKey ?? null,
        frameIdentity: structuredClone(observer?.frameIdentity ?? null),
        ingress: structuredClone(observer?.session?.ingress ?? null),
        recovery: structuredClone(observer?.session?.recovery ?? null),
        checkpoint: structuredClone(observer?.session?.checkpoint ?? null),
      };
    });
  }

  async function c14Evidence(
    gapRange: C14PresentationEvidence["gapRange"],
  ): Promise<C14PresentationEvidence> {
    const identity = await mountedIdentity();
    const sse = await virtualSseLedger();
    if (identity.observerRunId === null || identity.canvasRunId === null) {
      throw new Error("C14 evidence requires mounted observer and Canvas identities");
    }
    return Object.freeze({
      routeLedgerSequences: Object.freeze(requests.routeLedger.map(({ sequence }) => sequence)),
      sseLedgerSequences: Object.freeze(sse.map(({ sequence }) => sequence)),
      presentedRunId: identity.observerRunId,
      presentedCursor: identity.observerCursor ?? -1,
      canvasRunId: identity.canvasRunId,
      gapRange: gapRange === null ? null : Object.freeze({ ...gapRange }),
      mechanicEnvelopeCount: 0,
    });
  }
}

const CAPTURE_BOOTSTRAP_MAX_STEPS = 64;
const CAPTURE_BOOTSTRAP_MOUNT_TIMEOUT_MS = 5_000;

/** Drives only opted-in renderer work at time zero until the initial Stage is ready. */
async function bootstrapTypedCaptureStageAtInitialTime(
  page: Page,
  pageErrors: readonly string[],
): Promise<void> {
  const captureControlPresent = await page.evaluate(() => (
    window.__vivariumProductionCaptureClockForTest !== undefined
  ));
  if (!captureControlPresent) return;

  try {
    await page.waitForFunction(() => (
      document.querySelector(".vivarium-2d-app")?.getAttribute("data-presented-cursor") === "0"
      && document.querySelector(".presentation-world-stage") !== null
    ), undefined, { timeout: CAPTURE_BOOTSTRAP_MOUNT_TIMEOUT_MS });
  } catch {
    // The bounded diagnostics below own the failure if the capture Stage never mounts.
  }

  for (let step = 0; step < CAPTURE_BOOTSTRAP_MAX_STEPS; step += 1) {
    const state = await page.evaluate(() => {
      const app = document.querySelector(".vivarium-2d-app");
      const stage = document.querySelector(".presentation-world-stage");
      const ready = app?.getAttribute("data-presented-cursor") === "0"
        && stage?.getAttribute("data-ready") === "true";
      const control = window.__vivariumProductionCaptureClockForTest;
      if (!ready && control !== undefined) control.advanceRendererTo(control.now());
      return Object.freeze({ controlPresent: control !== undefined, ready });
    });
    if (state.ready) return;
    if (!state.controlPresent) break;
    await settleCaptureBootstrapTurns(page);
    const readyAfterTurns = await page.evaluate(() => (
      document.querySelector(".vivarium-2d-app")?.getAttribute("data-presented-cursor") === "0"
      && document.querySelector(".presentation-world-stage")?.getAttribute("data-ready") === "true"
    ));
    if (readyAfterTurns) return;
  }

  const diagnostics = await page.evaluate(() => {
    const app = document.querySelector(".vivarium-2d-app");
    const stage = document.querySelector(".presentation-world-stage");
    const control = window.__vivariumProductionCaptureClockForTest;
    const accessor = window.__vivariumProductionDiagnosticsForTest;
    const debugSnapshot = (surface: Element | null): unknown => {
      if (surface === null || accessor === undefined) return null;
      try {
        const snapshot = accessor.snapshot(surface);
        return snapshot === undefined ? null : JSON.parse(JSON.stringify(snapshot)) as unknown;
      } catch (error) {
        return Object.freeze({
          diagnosticError: error instanceof Error ? error.message : String(error),
        });
      }
    };
    return Object.freeze({
      controlPresent: control !== undefined,
      pendingCount: control?.pendingCount() ?? null,
      now: control?.now() ?? null,
      cursor: app?.getAttribute("data-presented-cursor") ?? null,
      stageReady: stage?.getAttribute("data-ready") ?? null,
      alert: document.querySelector("[role='alert']")?.textContent?.trim() || null,
      appDebug: debugSnapshot(app),
      stageDebug: debugSnapshot(stage),
    });
  });
  throw new Error(
    `typed capture Stage bootstrap did not reach cursor 0 readiness within ${CAPTURE_BOOTSTRAP_MAX_STEPS} renderer-only steps: ${JSON.stringify({
      ...diagnostics,
      pageErrors,
    })}`,
  );
}

async function settleCaptureBootstrapTurns(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const turn = (): Promise<void> => new Promise((resolveTurn) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (): void => {
        channel.port1.close();
        channel.port2.close();
        resolveTurn();
      };
      channel.port2.postMessage(undefined);
    });
    await turn();
    await turn();
  });
}

/** Reconcile every observed routed request with one exact terminal handler outcome. */
export function reconcileRouteTerminalLedger(
  observed: readonly ProductionObservedRouteEntry[],
  terminal: readonly ProductionRouteLedgerEntry[],
): string[] {
  const errors: string[] = [];
  const observedIds = new Set(observed.map(({ requestId }) => requestId));
  for (const request of observed) {
    const matches = terminal.filter(({ requestId }) => requestId === request.requestId);
    if (matches.length !== 1) {
      errors.push(`request ${request.requestId} has ${matches.length} terminal records`);
      continue;
    }
    const record = matches[0]!;
    const expected = [
      request.method,
      request.path,
    ].join("\0");
    const actual = [
      record.method,
      record.path,
    ].join("\0");
    if (actual !== expected) errors.push(`request ${request.requestId} terminal key mismatch`);
  }
  for (const record of terminal) {
    if (!observedIds.has(record.requestId)) {
      errors.push(`terminal record ${record.requestId} has no observed request`);
    }
  }
  return errors;
}

function envelopeFor(
  manifest: ChronicleManifest,
  firstCursor: number,
  lastCursor: number,
): EventEnvelope {
  const events = firstCursor > lastCursor
    ? []
    : manifest.entries.slice(firstCursor - 1, lastCursor);
  return {
    schema: 1,
    cursor: Math.max(0, firstCursor - 1),
    oldest_cursor: events[0]?.cursor ?? Math.max(0, firstCursor - 1),
    next_cursor: lastCursor,
    events,
    overflow: false,
    snapshot_required: false,
  };
}

function staleOverflowEnvelope(): EventEnvelope {
  return {
    schema: 1,
    cursor: 3,
    oldest_cursor: 4,
    next_cursor: 99,
    events: [],
    overflow: true,
    snapshot_required: true,
  };
}

function snapshotAt(manifest: ChronicleManifest, cursor: number): WorldSnapshot {
  return structuredClone(
    manifest.checkpoints
      .filter((record) => record.checkpoint.event_cursor <= cursor)
      .at(-1)?.checkpoint.snapshot
    ?? manifest.initialSnapshot
  );
}

function snapshotAtCursor(snapshot: WorldSnapshot, runId: string, cursor: number): WorldSnapshot {
  return {
    ...structuredClone(snapshot),
    run_id: runId,
    event_cursor: cursor,
    world_time: snapshot.world_time + cursor,
  };
}

function checkpointAt(
  manifest: ChronicleManifest,
  line: number,
  runId: string,
  cursor: number,
): ChronicleManifest["checkpoints"][number] {
  const snapshot = snapshotAtCursor(manifest.initialSnapshot, runId, cursor);
  return {
    line,
    safety: "safe-world-tick",
    checkpoint: {
      ...structuredClone(manifest.checkpoints[0]!.checkpoint),
      reason: "world_tick",
      run_id: runId,
      world_time: snapshot.world_time,
      event_cursor: cursor,
      snapshot,
    },
  };
}

function runMetadata(
  manifest: ChronicleManifest,
  runId: string,
  seed: number,
  snapshot: WorldSnapshot,
): RunMetadata {
  return {
    schema: 1,
    run_id: runId,
    seed,
    started_at: snapshot.world_time,
    status: "running",
    event_cursor: snapshot.event_cursor,
    world_time: snapshot.world_time,
    config_hash: `fixture:${manifest.id}:v${manifest.version}`,
    constants: {},
    provider: "fixture",
    model: "fixture",
    context_window: null,
    timing: {},
    artifacts: { events: "fixture", usage: "fixture", snapshots: "fixture", memory_root: "fixture" },
  };
}

function exactIntegerQuery(url: URL, keys: readonly string[], positive = false): boolean {
  if ([...url.searchParams.keys()].sort().join("\0") !== [...keys].sort().join("\0")) return false;
  return keys.every((key) => {
    const raw = url.searchParams.get(key);
    if (raw === null || !/^\d+$/.test(raw)) return false;
    const value = Number(raw);
    return Number.isSafeInteger(value) && (positive ? value > 0 : value >= 0);
  });
}

function handlerFor(pathname: string): ProductionRouteHandler {
  switch (pathname) {
    case "/api/run": return "run";
    case "/api/world": return "world";
    case "/api/events": return "events-page";
    case "/api/replay/manifest": return "replay-manifest";
    case "/api/replay/checkpoints/latest": return "replay-checkpoint-latest";
    case "/api/replay/checkpoints": return "replay-checkpoints-page";
    case "/api/replay/events": return "replay-events-page";
    default: return "api-reject";
  }
}

function liveEndpoint(
  runId: string,
  cursor: number,
): ProductionCaptureAuthorityEndpoint & Readonly<{ source: "live" }> {
  return Object.freeze({
    source: "live",
    runId,
    sourceKey: `live:${runId}`,
    cursor,
  });
}

function archiveEndpoint(
  runId: string,
  line: number,
  cursor: number,
): ProductionCaptureAuthorityEndpoint {
  return Object.freeze({
    source: "archive",
    runId,
    sourceKey: `archive:${encodeURIComponent(runId)}:line-${line}:window-${cursor}-${cursor}`,
    cursor,
  });
}

function authorityTraceEntry(
  workload: ProductionCaptureWorkload,
  label: string,
  selected: ProductionCaptureAuthorityEndpoint,
  live: ProductionCaptureAuthorityEndpoint & Readonly<{ source: "live" }>,
  completed: boolean,
): ProductionCaptureAuthorityTraceEntry {
  return Object.freeze({
    workload,
    label,
    mechanicFinalCursor: 0,
    selected,
    live,
    completed,
  });
}

function eventlessC14Record(
  label: C14PresentationRecord["label"],
  evidence: C14PresentationEvidence,
): C14PresentationRecord {
  return deepFreeze({
    kind: "transport-fault",
    label,
    mechanicEventsFabricated: false,
    evidence,
  });
}

/** Fail closed if an eventless scenario manifest claims authored mechanic truth. */
export function validateEventlessScenarioManifest(manifest: ChronicleManifest): void {
  if (manifest.id !== "C00" && manifest.id !== "C14" && manifest.id !== "C15") {
    throw new Error("eventless scenario validation is restricted to C00/C14/C15");
  }
  if (manifest.entries.length !== 0 || manifest.expectedFinalCursor !== 0) {
    throw new Error(`${manifest.id} requires zero mechanic entries and final cursor zero`);
  }
  if (manifest.initialSnapshot.event_cursor !== 0
    || manifest.checkpoints.some(({ checkpoint }) => checkpoint.event_cursor !== 0)) {
    throw new Error(`${manifest.id} authored checkpoints must remain at event cursor zero`);
  }
  const records = presentationRecords(manifest);
  const authorship = manifest.expectedTerminal.fixtureAuthorship;
  if (authorship === null || typeof authorship !== "object" || Array.isArray(authorship)) {
    throw new Error(`${manifest.id} fixtureAuthorship is required`);
  }
  const claims = authorship as Record<string, unknown>;
  if (claims.handAuthoredEnvelopeCount !== 0) {
    throw new Error(`${manifest.id} handAuthoredEnvelopeCount must be zero`);
  }
  if (claims.mechanicEventsFabricated !== false) {
    throw new Error(`${manifest.id} mechanicEventsFabricated must be false`);
  }
  if (claims.labeled !== true || claims.recordCount !== records.length) {
    throw new Error(`${manifest.id} fixtureAuthorship recordCount must match labeled records`);
  }
  const authority = chronicleTerminalAuthority(manifest);
  const terminal = authority.presentation.terminal;
  if (terminal.snapshot.run_id !== terminal.runId
    || terminal.snapshot.event_cursor !== terminal.cursor) {
    throw new Error(`${manifest.id} presentation snapshot must equal its terminal authority`);
  }
}

function presentationRecords(manifest: ChronicleManifest): readonly Record<string, unknown>[] {
  const records = manifest.expectedTerminal.presentationRecords;
  if (!Array.isArray(records)) throw new Error(`${manifest.id} presentationRecords are required`);
  return records.map((record) => {
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`${manifest.id} presentation record must be an object`);
    }
    return record as Record<string, unknown>;
  });
}

function c14Expectations(manifest: ChronicleManifest): Readonly<{ lastMissingCursor: number }> {
  const records = presentationRecords(manifest);
  const labels = records.map(({ label }) => label);
  if (JSON.stringify(labels) !== JSON.stringify([
    "cursor-gap",
    "oversized-record-413",
    "run-replacement",
  ])) throw new Error("C14 presentation record labels are invalid");
  if (records.some(({ kind }) => kind !== "transport-fault")) {
    throw new Error("C14 presentation records must be transport faults");
  }
  const record = records[0];
  const payload = record?.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("C14 cursor-gap payload is required");
  }
  const first = (payload as Record<string, unknown>).firstMissingCursor;
  const last = (payload as Record<string, unknown>).lastMissingCursor;
  if (first !== 1 || !Number.isSafeInteger(last) || typeof last !== "number" || last < first) {
    throw new Error("C14 cursor-gap range is invalid");
  }
  const oversizedPayload = records[1]?.payload;
  const replacementPayload = records[2]?.payload;
  if (oversizedPayload === null || typeof oversizedPayload !== "object"
    || Array.isArray(oversizedPayload)
    || (oversizedPayload as Record<string, unknown>).retryable !== false) {
    throw new Error("C14 oversized-record-413 expectation is invalid");
  }
  if (replacementPayload === null || typeof replacementPayload !== "object"
    || Array.isArray(replacementPayload)
    || (replacementPayload as Record<string, unknown>).staleRunRejected !== true) {
    throw new Error("C14 run-replacement expectation is invalid");
  }
  return Object.freeze({ lastMissingCursor: last });
}

function deepFreezeClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function c15Expectation(
  manifest: ChronicleManifest,
): Readonly<{ archiveCursor: number; liveCursor: number }> {
  const records = presentationRecords(manifest);
  const record = records
    .find(({ label }) => label === "archive-live-isolation");
  if (records.length !== 1 || record?.kind !== "session-edge") {
    throw new Error("C15 must contain one archive-live-isolation session-edge record");
  }
  const payload = record?.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("C15 archive-live-isolation payload is required");
  }
  const archiveCursor = (payload as Record<string, unknown>).archiveCursor;
  const liveCursor = (payload as Record<string, unknown>).liveCursor;
  if (typeof archiveCursor !== "number" || !Number.isSafeInteger(archiveCursor)
    || typeof liveCursor !== "number" || !Number.isSafeInteger(liveCursor)
    || archiveCursor < 0 || liveCursor <= archiveCursor) {
    throw new Error("C15 Archive/Live cursors are invalid");
  }
  return Object.freeze({ archiveCursor, liveCursor });
}
