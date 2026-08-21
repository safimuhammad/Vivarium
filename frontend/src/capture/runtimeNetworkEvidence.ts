export type RuntimeNetworkTerminal = "finished" | "failed";

export interface RuntimeNetworkObservation {
  readonly sequence: number;
  readonly method: string;
  readonly url: string;
  readonly resourceType: string;
  readonly navigation: boolean;
  responseStatus: number | null;
  terminal: RuntimeNetworkTerminal | null;
  failureText: string | null;
}

export interface RuntimeRouteAuthority {
  readonly requestId: number;
  readonly sequence: number;
  readonly handler: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly disposition: "fulfilled" | "rejected";
}

export interface NormalizedRuntimeRequest {
  readonly sequence: number;
  readonly kind: "navigation" | "api" | "source" | "asset";
  readonly method: string;
  readonly url: string;
  readonly handler: string;
  readonly status: number;
  readonly disposition: "fulfilled" | "rejected";
  readonly responseStatus: number | null;
  readonly terminal: RuntimeNetworkTerminal;
  readonly failureText: string | null;
}

/** Create one mutable observation whose response and terminal lifecycle remain independent. */
export function createRuntimeNetworkObservation(
  identity: Pick<
    RuntimeNetworkObservation,
    "sequence" | "method" | "url" | "resourceType" | "navigation"
  >,
): RuntimeNetworkObservation {
  return {
    ...identity,
    responseStatus: null,
    terminal: null,
    failureText: null,
  };
}

/** Retain HTTP response authority without treating response arrival as transport completion. */
export function recordRuntimeNetworkResponse(
  observation: RuntimeNetworkObservation,
  status: number,
): void {
  if (observation.responseStatus !== null) {
    throw new Error(`runtime request ${observation.sequence} response already recorded`);
  }
  if (observation.terminal !== null) {
    throw new Error(`runtime request ${observation.sequence} response followed terminal lifecycle`);
  }
  if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
    throw new Error(`runtime request ${observation.sequence} response status is invalid`);
  }
  observation.responseStatus = status;
}

/** Record exactly one requestfinished/requestfailed terminal without overwriting a response. */
export function recordRuntimeNetworkTerminal(
  observation: RuntimeNetworkObservation,
  terminal: RuntimeNetworkTerminal,
  failureText: string | null,
): void {
  if (observation.terminal !== null) {
    throw new Error(`runtime request ${observation.sequence} terminal lifecycle already recorded`);
  }
  if (terminal === "finished" && failureText !== null) {
    throw new Error(`runtime request ${observation.sequence} finished lifecycle cannot carry failure text`);
  }
  if (terminal === "failed" && (failureText === null || failureText.trim() === "")) {
    throw new Error(`runtime request ${observation.sequence} failed lifecycle requires failure text`);
  }
  observation.terminal = terminal;
  observation.failureText = failureText;
}

/** Normalize captured requests while preserving response and transport terminal truth. */
export function normalizeRuntimeRequests(
  observations: readonly RuntimeNetworkObservation[],
  routeLedger: readonly RuntimeRouteAuthority[],
  applicationOrigin: string,
): readonly NormalizedRuntimeRequest[] {
  const unmatchedRoutes = [...routeLedger];
  const normalized = observations.map((observation, index): NormalizedRuntimeRequest => {
    const outcome = canonicalOutcome(observation);
    const url = new URL(observation.url);
    const pathAndQuery = `${url.pathname}${url.search}`;
    let kind: NormalizedRuntimeRequest["kind"];
    let handler: string;
    if (observation.navigation) {
      if (url.origin !== applicationOrigin || pathAndQuery !== "/?renderer=2d") {
        throw new Error(`runtime navigation is not exact production 2D ${url.href}`);
      }
      kind = "navigation";
      handler = "vite-navigation";
    } else if (url.pathname.startsWith("/api/")) {
      const routeIndex = unmatchedRoutes.findIndex((route) => (
        route.method === observation.method
        && route.path === pathAndQuery
        && route.status === outcome.status
        && route.disposition === outcome.disposition
      ));
      if (routeIndex < 0) {
        throw new Error(`runtime API request lacks route authority ${observation.method} ${pathAndQuery}`);
      }
      const [route] = unmatchedRoutes.splice(routeIndex, 1);
      kind = "api";
      handler = route!.handler === "raw-artifact-reject"
        ? "raw-artifact-rejection"
        : "api-fixture";
    } else if (["image", "font", "media"].includes(observation.resourceType)) {
      kind = "asset";
      handler = "production-asset";
    } else {
      kind = "source";
      handler = "production-source";
    }
    return Object.freeze({
      sequence: index + 1,
      kind,
      method: observation.method,
      url: url.href,
      handler,
      ...outcome,
      responseStatus: observation.responseStatus,
      terminal: observation.terminal!,
      failureText: observation.failureText,
    });
  });
  if (unmatchedRoutes.length > 0) {
    throw new Error("route authority contains requests absent from runtime network observations");
  }
  return Object.freeze(normalized);
}

function canonicalOutcome(
  observation: RuntimeNetworkObservation,
): Readonly<{ status: number; disposition: "fulfilled" | "rejected" }> {
  if (observation.terminal === null) {
    throw new Error(`runtime request ${observation.sequence} is missing terminal lifecycle`);
  }
  if (observation.terminal === "finished") {
    if (observation.responseStatus === null) {
      throw new Error(`runtime request ${observation.sequence} finished without a response`);
    }
    if (observation.failureText !== null) {
      throw new Error(`runtime request ${observation.sequence} finished with failure text`);
    }
  } else if (observation.failureText === null || observation.failureText.trim() === "") {
    throw new Error(`runtime request ${observation.sequence} failed without failure text`);
  }
  return observation.responseStatus === null
    ? Object.freeze({ status: 0, disposition: "rejected" as const })
    : Object.freeze({ status: observation.responseStatus, disposition: "fulfilled" as const });
}
