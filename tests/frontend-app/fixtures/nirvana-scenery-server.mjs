/** Loopback-only provider-free HTTP server for the real Nirvana observer route. */

import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  NIRVANA_SCENERY_CHECKPOINT,
  NIRVANA_SCENERY_RUN,
  NIRVANA_SCENERY_RUN_ID,
  NIRVANA_SCENERY_WORLD,
} from "./nirvana-scenery-data.mjs";

const DEFAULT_PORT = 18002;
const DEFAULT_HOST = "127.0.0.1";
const JSON_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
});

/** Start an isolated HTTP fixture. Port zero is supported for tests only. */
export async function startNirvanaSceneryServer(options = {}) {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  assertHost(host);
  assertPort(port, true);

  const streams = new Set();
  const sockets = new Set();
  const server = createServer((request, response) => {
    try {
      routeRequest(request, response, streams);
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      sendJson(response, 500, {
        error: "nirvana scenery fixture failed",
      });
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  await new Promise((accept, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      accept();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Nirvana scenery fixture did not acquire a TCP port");
  }
  let stopped = false;
  const fixture = Object.freeze({
    server,
    host,
    port: address.port,
    origin: `http://${host}:${address.port}`,
    activeStreamCount: () => streams.size,
    async stop() {
      if (stopped) return;
      stopped = true;
      for (const stream of streams) stream.end();
      streams.clear();
      const closed = new Promise((accept, reject) => {
        server.close((error) => error ? reject(error) : accept());
      });
      server.closeIdleConnections?.();
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  });
  return fixture;
}

/** Stop a fixture returned by startNirvanaSceneryServer; safe to call twice. */
export async function stopNirvanaSceneryServer(fixture) {
  if (fixture === null || typeof fixture !== "object" || typeof fixture.stop !== "function") {
    throw new TypeError("Nirvana scenery fixture must expose stop()");
  }
  await fixture.stop();
}

/** Parse the narrow CLI surface. The persistent human-review default is port 18002. */
export function parseNirvanaSceneryPort(arguments_) {
  let port = DEFAULT_PORT;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--port") {
      const value = arguments_[index + 1];
      if (value === undefined) throw new Error("--port requires an integer value");
      port = parseCliPort(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--port=")) {
      port = parseCliPort(argument.slice("--port=".length));
      continue;
    }
    throw new Error(`unknown Nirvana scenery fixture argument: ${argument}`);
  }
  return port;
}

function routeRequest(request, response, streams) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? DEFAULT_HOST}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Headers": "Accept, Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    response.end();
    return;
  }
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET, OPTIONS");
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  if (url.pathname === "/api/run" && url.search === "") {
    sendJson(response, 200, NIRVANA_SCENERY_RUN);
    return;
  }
  if (url.pathname === "/api/world" && url.search === "") {
    sendJson(response, 200, NIRVANA_SCENERY_WORLD);
    return;
  }
  if (url.pathname === "/api/events") {
    const cursor = exactNonNegativeIntegerQuery(url, "cursor");
    if (cursor === null) {
      sendJson(response, 400, { error: "cursor must be one non-negative integer" });
      return;
    }
    sendJson(response, 200, emptyEnvelope(cursor));
    return;
  }
  if (url.pathname === "/api/events/stream") {
    const cursor = exactNonNegativeIntegerQuery(url, "cursor");
    if (cursor === null) {
      sendJson(response, 400, { error: "cursor must be one non-negative integer" });
      return;
    }
    openIdleEventStream(response, streams);
    return;
  }
  if (url.pathname === "/api/replay/manifest" && url.search === "") {
    sendJson(response, 200, replayManifest());
    return;
  }
  if (url.pathname === "/api/replay/checkpoints/latest" && url.search === "") {
    sendJson(response, 200, {
      schema: 1,
      run_id: NIRVANA_SCENERY_RUN_ID,
      line: 1,
      checkpoint: NIRVANA_SCENERY_CHECKPOINT,
    });
    return;
  }
  if (url.pathname === "/api/replay/checkpoints") {
    const before = exactPositiveInteger(url.searchParams.get("before"));
    const limit = exactPositiveInteger(url.searchParams.get("limit"));
    if (url.searchParams.size !== 2 || before === null || limit === null) {
      sendJson(response, 400, { error: "before and limit must be exact positive integers" });
      return;
    }
    const includesSeed = before > 1 && limit > 0;
    sendJson(response, 200, {
      schema: 1,
      run_id: NIRVANA_SCENERY_RUN_ID,
      before,
      next_before: includesSeed ? 1 : null,
      has_more: false,
      checkpoints: includesSeed
        ? [{ line: 1, checkpoint: NIRVANA_SCENERY_CHECKPOINT }]
        : [],
    });
    return;
  }
  if (url.pathname === "/api/replay/events") {
    const after = exactNonNegativeIntegerQuery(url, "after", ["after", "limit"]);
    const limit = exactPositiveInteger(url.searchParams.get("limit"));
    if (after === null || limit === null) {
      sendJson(response, 400, { error: "after and limit must be exact bounded integers" });
      return;
    }
    sendJson(response, 200, {
      schema: 1,
      run_id: NIRVANA_SCENERY_RUN_ID,
      after,
      next_after: after,
      has_more: false,
      events: [],
    });
    return;
  }
  sendJson(response, 404, { error: "not found" });
}

function emptyEnvelope(cursor) {
  return {
    schema: 1,
    cursor,
    oldest_cursor: 0,
    next_cursor: cursor,
    events: [],
    overflow: false,
    snapshot_required: false,
  };
}

function replayManifest() {
  return {
    schema: 1,
    run_id: NIRVANA_SCENERY_RUN_ID,
    events: { count: 0, first_cursor: null, last_cursor: null },
    checkpoints: {
      count: 1,
      first_line: 1,
      last_line: 1,
      first_event_cursor: 0,
      last_event_cursor: 0,
    },
    bootstrap: { event_after: 0, event_limit: 512 },
  };
}

function openIdleEventStream(response, streams) {
  response.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
  });
  streams.add(response);
  response.once("close", () => streams.delete(response));
  response.write(": nirvana-scenery-idle\n\n");
}

function sendJson(response, status, value) {
  response.writeHead(status, JSON_HEADERS);
  response.end(`${JSON.stringify(value)}\n`);
}

function exactNonNegativeIntegerQuery(url, name, expectedNames = [name]) {
  if (url.searchParams.size !== expectedNames.length
      || expectedNames.some((expected) => !url.searchParams.has(expected))) return null;
  const values = url.searchParams.getAll(name);
  if (values.length !== 1) return null;
  const value = values[0];
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function exactPositiveInteger(value) {
  if (value === null || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseCliPort(value) {
  if (!/^[1-9]\d*$/.test(value)) throw new Error("port must be an integer from 1 through 65535");
  const port = Number(value);
  assertPort(port, false);
  return port;
}

function assertPort(port, allowZero) {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(port) || port < minimum || port > 65535) {
    throw new RangeError(`Nirvana scenery fixture port must be ${minimum} through 65535`);
  }
}

function assertHost(host) {
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("Nirvana scenery fixture must bind to a loopback host");
  }
}

const invokedPath = process.argv[1] === undefined
  ? null
  : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  const port = parseNirvanaSceneryPort(process.argv.slice(2));
  const fixture = await startNirvanaSceneryServer({ port });
  process.stdout.write(`Nirvana scenery fixture listening at ${fixture.origin}\n`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await fixture.stop();
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}
