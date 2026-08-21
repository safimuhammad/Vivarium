/** Deterministic, raw-observation-backed Chronicle evidence oracles. */

import { lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARTIFACT_SCHEMA_VERSION,
  VIEWPORTS,
  assertChronicleId,
  assertObject,
  canonicalJson,
  readNormalizedJson,
  sha256Buffer,
  validateFileReference,
  validateMarkerDocument,
  validateMarkersAgainstRecordingFrames,
  validateRecordingFrameLedger,
  writeNormalizedJson,
} from "./recording-artifacts.mjs";
import { assertTimingParity, probeVideo } from "./record-2d-chronicles.mjs";

/** The full canonical Chronicle catalog (identity: what chronicles exist, and their order). */
export const CHRONICLE_IDS = Object.freeze([
  "C00", "C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08",
  "C09", "C10", "C11", "C12", "C13", "C14", "C15", "C16", "C17",
  "C18", "C19",
]);
/**
 * Chronicles with fully captured evidence (desktop + mobile sidecars for every file in
 * EVIDENCE_SIDECAR_FILES). This is a coverage list, not the catalog: it drives which
 * evidence artifacts are required/produced, nothing else.
 *
 * STALE BY DESIGN, TEMPORARILY: C18 and C19 are real, cataloged chronicles (see
 * CHRONICLE_IDS) but their evidence has not been captured yet. Capturing their sidecars
 * and adding "C18"/"C19" here is what moves them onto this list.
 */
export const EVIDENCE_CHRONICLE_IDS = Object.freeze([
  "C00", "C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08",
  "C09", "C10", "C11", "C12", "C13", "C14", "C15", "C16", "C17",
]);
assertOrderedSubset(EVIDENCE_CHRONICLE_IDS, CHRONICLE_IDS, "EVIDENCE_CHRONICLE_IDS", "CHRONICLE_IDS");

export const EVIDENCE_SIDECAR_FILES = Object.freeze([
  "semantic.json", "cursors.json", "motion.json", "performance.json", "network.json",
  "assets.json", "reduced-motion.json", "viewport.json", "source-revision.json",
]);

const SPECIAL_FINAL_CURSORS = Object.freeze({ C00: 0, C13: 120, C14: 0, C15: 0, C16: 4096 });
const EVENTLESS_PRESENTATION_CHRONICLES = new Set(["C00", "C14", "C15"]);
const C16_DENSITY_CURSORS = Object.freeze([1024, 2048, 3072, 4096]);
const EXPECTED_VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900 }),
  mobile: Object.freeze({ width: 390, height: 844 }),
});
const FORBIDDEN_ROUTE = /(?:three|renderer3d|WorldRenderer|\/3d(?:\/|\?|$)|demo|2d-slice|frozen[-_/]?slice)/i;
const FORBIDDEN_SOURCE_PATH = /(?:three|renderer3d|(?:^|[/_.-])3d(?:[/_.-]|$)|demo|2d-slice|frozen[-_/]?slice)/i;
const FORBIDDEN_SOURCE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'][^"']*(?:three|renderer3d|\/3d(?:\/|$)|demo|2d-slice|frozen[-_/]?slice)/i;
const MEBIBYTE = 1024 * 1024;
const PRODUCTION_RESOURCE_CAPS = Object.freeze({ maxWaiters: 64, maxInFlight: 16 });
const CHECKPOINT_HOLD_DURATION_MS = 800;
const CHECKPOINT_SAMPLE_INTERVAL_MS = 1_000 / 30;
const CHECKPOINT_TIMING_TOLERANCE_MS = 0.001;
export const PRODUCTION_ACTOR_VISUAL_ENVELOPE = readProductionActorVisualEnvelope();

function readProductionActorVisualEnvelope() {
  const source = JSON.parse(readFileSync(
    new URL("../src/assets/renderer2d/core/production-core-source.json", import.meta.url),
    "utf8",
  ));
  const envelope = source?.standingVisualEnvelopes?.withHeldForms;
  assertObject(envelope, "production actor visual envelope");
  for (const field of ["left", "top", "right", "bottom"]) {
    if (!Number.isSafeInteger(envelope[field])) {
      throw new Error(`production actor visual envelope ${field} must be a safe integer`);
    }
  }
  if (envelope.right <= envelope.left || envelope.bottom <= envelope.top) {
    throw new Error("production actor visual envelope must have positive dimensions");
  }
  return Object.freeze({
    left: envelope.left,
    top: envelope.top,
    right: envelope.right,
    bottom: envelope.bottom,
    width: envelope.right - envelope.left,
    height: envelope.bottom - envelope.top,
  });
}
const CHECKPOINT_HOLD_CONTRACTS = Object.freeze({
  C06: Object.freeze({
    lines: Object.freeze({
      1: Object.freeze(["home_b86b89df", "wanderer_001"]),
      2: Object.freeze(["home_b86b89df", "wanderer_001"]),
    }),
    focusTargets: Object.freeze({
      1: Object.freeze([
        Object.freeze({
          regionId: "warm_springs", kind: "home", entityId: "home_b86b89df", removed: false,
        }),
      ]),
      2: Object.freeze([
        Object.freeze({
          regionId: "warm_springs", kind: "home", entityId: "home_b86b89df", removed: false,
        }),
      ]),
    }),
  }),
  C07: Object.freeze({
    lines: Object.freeze({
      1: Object.freeze(["home_c07", "wanderer_002"]),
      2: Object.freeze([
        "home_c07", "nirvana", "nirvana_east", "nirvana_west",
        "wanderer_001", "warm_springs",
      ]),
      3: Object.freeze(["wanderer_002", "wanderer_004"]),
    }),
    focusTargets: Object.freeze({
      1: Object.freeze([
        Object.freeze({
          regionId: "warm_springs", kind: "home", entityId: "home_c07", removed: false,
        }),
      ]),
      2: Object.freeze([
        Object.freeze({
          regionId: "warm_springs", kind: "home", entityId: "home_c07", removed: false,
        }),
      ]),
      3: Object.freeze([
        Object.freeze({
          regionId: "warm_springs", kind: "region", entityId: null, removed: false,
        }),
      ]),
    }),
  }),
  C09: Object.freeze({
    lines: Object.freeze({
      1: Object.freeze([
        "home_c09", "home_repair", "home_zero", "nirvana", "nirvana_east",
        "nirvana_west", "wanderer_001", "warm_springs",
      ]),
      2: Object.freeze([
        "home_c09", "home_repair", "home_zero", "nirvana", "nirvana_east",
        "nirvana_west", "wanderer_001", "warm_springs",
      ]),
    }),
    focusTargets: Object.freeze({
      1: Object.freeze([
        Object.freeze({
          regionId: "warm_springs", kind: "home", entityId: "home_repair", removed: false,
        }),
        Object.freeze({
          regionId: "nirvana", kind: "ruin", entityId: "home_c09", removed: false,
        }),
        Object.freeze({
          regionId: "nirvana", kind: "ruin", entityId: "home_zero", removed: false,
        }),
      ]),
      2: Object.freeze([
        Object.freeze({
          regionId: "warm_springs", kind: "home", entityId: "home_repair", removed: false,
        }),
        Object.freeze({
          regionId: "nirvana", kind: "region", entityId: null, removed: true,
        }),
      ]),
    }),
  }),
});

/** Create an evidence oracle from authority supplied separately from raw capture facts. */
export function createChronicleEvidenceOracle(trustedConfig) {
  const authority = loadAuthority(trustedConfig);
  const build = (input) => buildViewportEvidenceWithAuthority(input, authority);
  const matrix = (inputs) => buildChronicleEvidenceMatrixWithAuthority(inputs, authority);
  const write = (directory, input) => writeViewportEvidenceWithAuthority(directory, input, authority);
  return Object.freeze({ buildViewportEvidence: build, buildChronicleEvidenceMatrix: matrix, writeViewportEvidence: write });
}

/** Create the repository-canonical provider-free oracle adapter. */
export function createCanonicalChronicleEvidenceOracle(options) {
  assertObject(options, "canonical oracle options");
  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
  return createChronicleEvidenceOracle({
    ...options,
    strictFixtureContracts: true,
    catalogRoot: repositoryRoot,
    catalogFile: "tests/frontend-app/fixtures/chronicles/data/catalog.json",
    fixtureDirectory: "tests/frontend-app/fixtures/chronicles/data",
    stageSource: "src/renderer2d/production/PresentationWorldStage.tsx",
  });
}

/** Convert the production fixture/capture ledger shape into raw oracle input. */
export function convertProductionCaptureToOracleInput(capture) {
  assertObject(capture, "production capture evidence");
  assertObject(capture.navigation, "production capture navigation");
  assertNonblankString(capture.applicationOrigin, "production capture applicationOrigin");
  const origin = new URL(capture.applicationOrigin);
  if (origin.origin !== capture.applicationOrigin) throw new Error("production capture applicationOrigin must be an origin");
  const routeLedger = capture.routeLedger ?? capture.requests?.routeLedger;
  const observedRoutes = capture.observedRoutes ?? capture.requests?.observedRoutes;
  if (!Array.isArray(routeLedger) || !Array.isArray(observedRoutes)) throw new Error("production capture requires routeLedger and observedRoutes");
  const observedById = new Map(observedRoutes.map((entry) => [entry.requestId, entry]));
  if (observedById.size !== observedRoutes.length || routeLedger.length !== observedRoutes.length) throw new Error("production route observations must be one-to-one");
  const routes = routeLedger.map((entry, index) => {
    assertObject(entry, `production route ledger ${index}`);
    const observed = observedById.get(entry.requestId);
    if (!observed || observed.sequence !== entry.sequence
      || observed.method !== entry.method || observed.path !== entry.path) {
      throw new Error(`production observed route mismatch request ${String(entry.requestId)}`);
    }
    if (entry.sequence !== index + 1) throw new Error("production route ledger sequence must be contiguous");
    const apiHandlers = new Set(["run", "world", "events-page", "replay-manifest", "replay-checkpoint-latest", "replay-checkpoints-page", "replay-events-page"]);
    let handler;
    let kind = "api";
    if (apiHandlers.has(entry.handler)) handler = "api-fixture";
    else if (entry.handler === "raw-artifact-reject") handler = "raw-artifact-rejection";
    else throw new Error(`production route handler ${String(entry.handler)} cannot certify evidence`);
    return {
      sequence: index + 2,
      kind,
      method: entry.method,
      url: new URL(entry.path, origin).href,
      handler,
      status: entry.status,
      disposition: entry.disposition,
      responseStatus: entry.disposition === "fulfilled" ? entry.status : null,
      terminal: entry.disposition === "fulfilled" ? "finished" : "failed",
      failureText: entry.disposition === "fulfilled" ? null : "route authority rejected request",
    };
  });
  const navigation = {
    sequence: 1,
    kind: "navigation",
    method: capture.navigation.method,
    url: new URL(capture.navigation.path, origin).href,
    handler: "vite-navigation",
    status: capture.navigation.status,
    disposition: capture.navigation.disposition,
    responseStatus: capture.navigation.status,
    terminal: "finished",
    failureText: null,
  };
  const runtimeRequests = capture.requests?.runtimeRequests;
  if (runtimeRequests !== undefined) {
    if (!Array.isArray(runtimeRequests) || runtimeRequests.length === 0) {
      throw new Error("production runtime request observations must be nonempty");
    }
    const normalizedRuntime = runtimeRequests.map((request, index) => {
      assertObject(request, `runtime request observation ${index}`);
      if (request.sequence !== index + 1) throw new Error("runtime request observation sequence must be contiguous");
      return { ...request };
    });
    const runtimeApi = normalizedRuntime.filter(({ kind }) => kind === "api");
    if (runtimeApi.length !== routes.length) {
      throw new Error("runtime API observation count does not bind production route ledger");
    }
    for (const [index, expected] of routes.entries()) {
      const observed = runtimeApi[index];
      if (observed.handler !== expected.handler
        || observed.method !== expected.method || observed.url !== expected.url
        || observed.status !== expected.status || observed.disposition !== expected.disposition) {
        throw new Error(`runtime API observation mismatch route ${index + 1}`);
      }
    }
    const runtimeNavigation = normalizedRuntime.filter(({ handler }) => handler === "vite-navigation");
    if (runtimeNavigation.length !== 1
      || canonicalJson({
        method: runtimeNavigation[0].method,
        path: `${new URL(runtimeNavigation[0].url).pathname}${new URL(runtimeNavigation[0].url).search}`,
        status: runtimeNavigation[0].status,
        disposition: runtimeNavigation[0].disposition,
      }) !== canonicalJson(capture.navigation)) {
      throw new Error("runtime navigation observation does not bind supplied navigation");
    }
    const { applicationOrigin: _origin, navigation: _navigation, routeLedger: _routes, observedRoutes: _observed, requests: _requests, ...facts } = capture;
    return deepCloneFreeze({ ...facts, network: { requests: normalizedRuntime } });
  }
  const { applicationOrigin: _origin, navigation: _navigation, routeLedger: _routes, observedRoutes: _observed, requests: _requests, ...facts } = capture;
  return deepCloneFreeze({ ...facts, network: { requests: [navigation, ...routes] } });
}

/** Build all nine sidecars with an explicit separately trusted configuration. */
export async function buildViewportEvidence(input, trustedConfig) {
  return createChronicleEvidenceOracle(trustedConfig).buildViewportEvidence(input);
}

async function buildViewportEvidenceWithAuthority(input, authority) {
  assertObject(input, "Chronicle evidence input");
  if (Object.hasOwn(input, "sourceRevision") || Object.hasOwn(input, "trustedRoot") || Object.hasOwn(input, "catalogFile")) throw new Error("trusted authority must not be supplied by raw evidence");
  const identity = validateIdentity(input.chronicleId, input.viewport);
  const revision = buildSourceRevisionEvidence(identity, authority);
  const expectedCursor = revision.fixtureContract.expectedFinalCursor;
  assertNonNegativeInteger(input.expectedFinalCursor, "expectedFinalCursor");
  if (input.expectedFinalCursor !== expectedCursor) {
    throw new Error(`${identity.chronicleId} expectedFinalCursor must be ${expectedCursor}`);
  }
  const specialCursor = SPECIAL_FINAL_CURSORS[identity.chronicleId];
  if (specialCursor !== undefined && expectedCursor !== specialCursor) {
    throw new Error(`${identity.chronicleId} trusted fixture cursor must be ${specialCursor}`);
  }

  const terminalAuthority = trustedTerminalAuthority(revision.fixtureContract, {
    strictEventless: authority.strictFixtureContracts,
  });
  const operationalAuthority = isEventlessPresentationAuthority(terminalAuthority);
  const cursors = buildCursorEvidence(
    identity,
    input.cursors,
    expectedCursor,
    terminalAuthority,
    input.semantic?.operationalWorkload,
  );
  const motion = buildMotionEvidence(identity, input.motion, cursors, revision.fixtureContract);
  const network = buildNetworkEvidence(identity, input.network, revision.sourceClosure, authority);
  const semantic = buildSemanticEvidence(
    identity,
    input.semantic,
    revision.fixtureContract,
    motion.verdict.semanticClaims,
    cursors.gaps,
    terminalAuthority,
    network,
    motion.markerFrames,
  );
  const assets = buildAssetEvidence(identity, input.assets);
  return deepCloneFreeze({
    "semantic.json": semantic,
    "cursors.json": cursors,
    "motion.json": motion,
    "performance.json": buildPerformanceEvidence(
      identity,
      input.performance,
      expectedCursor,
      revision.fixtureContract,
      assets,
      terminalAuthority,
      operationalAuthority ? semantic.operationalWorkload : null,
    ),
    "network.json": network,
    "assets.json": assets,
    "reduced-motion.json": await buildReducedMotionEvidence(
      identity,
      input.reducedMotion,
      semantic,
      motion,
      authority,
    ),
    "viewport.json": buildViewportDocument(identity, input.viewportMetrics),
    "source-revision.json": revision.document,
  });
}

/** Build the literal C00-C17 x desktop/mobile matrix in frozen review order. */
export async function buildChronicleEvidenceMatrix(inputs, trustedConfig) {
  return createChronicleEvidenceOracle(trustedConfig).buildChronicleEvidenceMatrix(inputs);
}

async function buildChronicleEvidenceMatrixWithAuthority(inputs, authority) {
  if (!Array.isArray(inputs)) throw new Error("Chronicle evidence matrix must be an array");
  const byIdentity = new Map();
  for (const input of inputs) {
    assertObject(input, "Chronicle evidence matrix entry");
    const identity = validateIdentity(input.chronicleId, input.viewport);
    const key = `${identity.chronicleId}/${identity.viewport}`;
    if (byIdentity.has(key)) throw new Error(`duplicate Chronicle viewport ${key}`);
    byIdentity.set(key, input);
  }
  const keys = EVIDENCE_CHRONICLE_IDS.flatMap((id) => ["desktop", "mobile"].map((viewport) => `${id}/${viewport}`));
  for (const key of keys) if (!byIdentity.has(key)) throw new Error(`missing Chronicle viewport ${key}`);
  if (byIdentity.size !== keys.length) throw new Error("extra Chronicle viewport in evidence matrix");
  return Promise.all(keys.map(async (key) => {
    const input = byIdentity.get(key);
    return deepCloneFreeze({ chronicleId: input.chronicleId, viewport: input.viewport, sidecars: await buildViewportEvidenceWithAuthority(input, authority) });
  }));
}

/** Validate then canonically write one viewport's sidecars. */
export async function writeViewportEvidence(directory, input, trustedConfig) {
  return createChronicleEvidenceOracle(trustedConfig).writeViewportEvidence(directory, input);
}

async function writeViewportEvidenceWithAuthority(directory, input, authority) {
  if (typeof directory !== "string" || directory.trim() === "") throw new Error("evidence directory must be nonblank");
  const sidecars = await buildViewportEvidenceWithAuthority(input, authority);
  mkdirSync(directory, { recursive: true });
  for (const filename of EVIDENCE_SIDECAR_FILES) await writeNormalizedJson(path.join(directory, filename), sidecars[filename]);
  return [...EVIDENCE_SIDECAR_FILES];
}

function validateIdentity(chronicleId, viewport) {
  assertChronicleId(chronicleId);
  if (!CHRONICLE_IDS.includes(chronicleId)) throw new Error(`invalid Chronicle id ${String(chronicleId)}`);
  if (!VIEWPORTS.includes(viewport)) throw new Error("viewport must be desktop or mobile");
  return { schemaVersion: ARTIFACT_SCHEMA_VERSION, chronicleId, viewport };
}

function loadAuthority(config) {
  assertObject(config, "Chronicle oracle trusted config");
  if (Object.hasOwn(config, "resourceCaps")) throw new Error("resourceCaps are oracle-owned production constants");
  const catalogRoot = trustedRoot(config.catalogRoot, "catalogRoot");
  const analysisRoot = trustedRoot(config.analysisRoot, "analysisRoot");
  const artifactRoot = trustedRoot(config.artifactRoot, "artifactRoot");
  const catalogFile = readTrustedFile(catalogRoot, { file: config.catalogFile }, "catalog");
  let catalog;
  try { catalog = JSON.parse(catalogFile.bytes.toString("utf8")); } catch { throw new Error("canonical catalog is not valid JSON"); }
  if (!Array.isArray(catalog.chronicles) || !arraysEqual(catalog.chronicles.map(({ id }) => id), CHRONICLE_IDS)) throw new Error("canonical catalog must equal CHRONICLE_IDS exactly, in order");
  const catalogById = {};
  for (const entry of catalog.chronicles) {
    assertObject(entry, "catalog Chronicle entry");
    assertNonblankString(entry.file, `catalog ${entry.id} fixture file`);
    if (Object.hasOwn(catalogById, entry.id)) throw new Error(`duplicate canonical catalog id ${entry.id}`);
    catalogById[entry.id] = entry;
  }
  const analysisManifestFile = readTrustedFile(analysisRoot, { file: config.analysisManifestFile }, "analysis manifest");
  let analysisManifest;
  try { analysisManifest = JSON.parse(analysisManifestFile.bytes.toString("utf8")); } catch { throw new Error("analysis manifest is not valid JSON"); }
  const closure = analysisClosure(analysisRoot, analysisManifest, config.stageSource);
  assertNonblankString(config.applicationOrigin, "trusted applicationOrigin");
  if (new URL(config.applicationOrigin).origin !== config.applicationOrigin) throw new Error("trusted applicationOrigin must be an origin");
  assertObject(config.requestSummaries, "trusted request summaries");
  return deepCloneFreeze({
    catalogRoot,
    fixtureDirectory: config.fixtureDirectory,
    catalogById,
    catalog: { file: catalogFile.file, bytes: catalogFile.bytes.length, sha256: sha256Buffer(catalogFile.bytes) },
    analysis: {
      manifest: { file: analysisManifestFile.file, bytes: analysisManifestFile.bytes.length, sha256: sha256Buffer(analysisManifestFile.bytes) },
      stageSource: config.stageSource,
      files: closure,
    },
    artifactRoot,
    applicationOrigin: config.applicationOrigin,
    requestSummaries: config.requestSummaries,
    resourceCaps: PRODUCTION_RESOURCE_CAPS,
    strictFixtureContracts: config.strictFixtureContracts === true,
  });
}

function trustedRoot(root, label) {
  assertNonblankString(root, label);
  if (lstatSync(root).isSymbolicLink()) throw new Error(`${label} may not be a symbolic link`);
  return realpathSync(root);
}

function analysisClosure(root, manifest, stageSource) {
  assertObject(manifest, "analysis manifest");
  assertNonblankString(stageSource, "analysis stageSource");
  const matches = Object.entries(manifest).filter(([key, record]) => key === stageSource || record?.src === stageSource);
  if (matches.length !== 1) throw new Error(`analysis manifest must contain one production Stage entry; found ${matches.length}`);
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    const record = manifest[key];
    if (record === null || typeof record !== "object" || Array.isArray(record)) throw new Error(`analysis manifest import ${key} is missing`);
    seen.add(key);
    for (const imported of [...(record.imports ?? []), ...(record.dynamicImports ?? [])]) visit(imported);
  };
  visit(matches[0][0]);
  return [...seen].map((key) => {
    const record = manifest[key];
    assertNonblankString(record.file, `analysis manifest file ${key}`);
    if (FORBIDDEN_SOURCE_PATH.test(`${key} ${record.src ?? ""} ${record.file}`)) throw new Error(`forbidden 3D/demo/slice analysis closure ${key}`);
    const built = readTrustedFile(root, { file: record.file }, "analysis closure");
    if (FORBIDDEN_SOURCE_IMPORT.test(built.bytes.toString("utf8"))) throw new Error(`forbidden 3D/demo/slice analysis closure ${record.file}`);
    return { file: built.file, bytes: built.bytes.length, sha256: sha256Buffer(built.bytes) };
  }).sort((left, right) => codeUnitCompare(left.file, right.file));
}

function buildSourceRevisionEvidence(identity, authority) {
  const entry = authority.catalogById[identity.chronicleId];
  if (entry === undefined) throw new Error(`canonical catalog is missing ${identity.chronicleId}`);
  const fixtureFile = path.posix.join(authority.fixtureDirectory, entry.file);
  const fixture = readTrustedFile(authority.catalogRoot, { file: fixtureFile }, "fixture");
  let fixtureContract;
  try {
    fixtureContract = JSON.parse(fixture.bytes.toString("utf8"));
  } catch {
    throw new Error(`${identity.chronicleId} fixture is not valid JSON`);
  }
  if (fixtureContract.id !== identity.chronicleId) throw new Error(`${identity.chronicleId} fixture identity mismatch`);
  assertNonNegativeInteger(fixtureContract.expectedFinalCursor, `${identity.chronicleId} fixture expectedFinalCursor`);
  if (entry.expectedFinalCursor !== fixtureContract.expectedFinalCursor) throw new Error(`${identity.chronicleId} catalog/fixture cursor mismatch`);
  assertObject(fixtureContract.expectedTerminal?.semanticOracle, `${identity.chronicleId} fixture semantic oracle`);
  const expectedMarkers = uniqueStrings(fixtureContract.expectedMarkers, "fixture expectedMarkers", false);
  const expectedPlacements = identity.chronicleId === "C16" ? canonicalC16Placements(fixtureContract) : [];
  const expectedPopulation = canonicalPopulation(fixtureContract);
  return {
    fixtureContract: { ...fixtureContract, expectedMarkers, expectedPlacements, expectedPopulation },
    sourceClosure: { files: authority.analysis.files.length, noThree: true, manifestSha256: authority.analysis.manifest.sha256 },
    document: {
      ...identity,
      catalog: authority.catalog,
      fixture: { file: fixture.file, bytes: fixture.bytes.length, sha256: sha256Buffer(fixture.bytes) },
      analysisManifest: authority.analysis.manifest,
      closure: { stageSource: authority.analysis.stageSource, files: authority.analysis.files, noThree: true },
    },
  };
}

function canonicalPopulation(fixture) {
  const terminal = fixture.expectedTerminal?.finalSnapshot;
  const checkpoint = Array.isArray(fixture.checkpoints)
    ? fixture.checkpoints.map((item) => item?.checkpoint?.snapshot).filter(Boolean).at(-1)
    : null;
  const snapshot = terminal ?? checkpoint ?? fixture.initialSnapshot;
  if (!snapshot || !Array.isArray(snapshot.agents) || !Array.isArray(snapshot.homes)) {
    throw new Error(`${fixture.id} canonical fixture lacks Graph population`);
  }
  if (snapshot.ruins !== undefined && !Array.isArray(snapshot.ruins)) {
    throw new Error(`${fixture.id} canonical fixture has malformed ruins population`);
  }
  const structures = [...snapshot.homes, ...(snapshot.ruins ?? [])];
  const graphLifecycleOracle = canonicalGraphLifecycleOracle(
    fixture.expectedTerminal?.graphLifecycleOracle,
    fixture.id,
  );
  const actorRegionTransitions = Array.isArray(fixture.entries)
    ? fixture.entries.filter((entry) => entry?.event?.type === "agent_entered_region").length
    : 0;
  const regionIds = [...new Set([
    ...snapshot.agents.map((agent) => agent?.position),
    ...structures.map((home) => home?.region),
    ...(snapshot.regions ?? []).map((region) => region?.name),
  ].filter((regionId) => typeof regionId === "string" && regionId.trim() !== ""))]
    .sort(codeUnitCompare);
  const regions = regionIds.map((regionId) => ({
    regionId,
    actors: snapshot.agents.filter((agent) => agent?.position === regionId).length,
    homes: structures.filter((home) => home?.region === regionId).length,
  }));
  let visibleRegionId = null;
  if (fixture.id === "C16") {
    const authoredRegions = [...new Set((fixture.entries ?? [])
      .map((entry) => entry?.event?.region)
      .filter((regionId) => typeof regionId === "string" && regionId.trim() !== ""))]
      .sort(codeUnitCompare);
    if (authoredRegions.length !== 1) throw new Error("C16 canonical fixture must author one visible Graph region");
    visibleRegionId = authoredRegions[0];
    if (!regions.some((region) => region.regionId === visibleRegionId)) {
      throw new Error("C16 canonical visible Graph region lacks terminal population");
    }
  } else if (EVENTLESS_PRESENTATION_CHRONICLES.has(fixture.id)) {
    const authoredRegions = (snapshot.regions ?? [])
      .map((region) => region?.name)
      .filter((regionId) => typeof regionId === "string" && regionId.trim() !== "")
      .sort(codeUnitCompare);
    if (authoredRegions.length === 0) {
      throw new Error(`${fixture.id} canonical fixture must author a visible Graph region`);
    }
    visibleRegionId = authoredRegions[0];
  }
  return {
    actors: snapshot.agents.length,
    homes: structures.length,
    actorRegionTransitions,
    graphLifecycleOracle,
    regions,
    visibleRegionId,
  };
}

function canonicalGraphLifecycleOracle(value, fixtureId) {
  if (value === undefined) return null;
  assertObject(value, `${fixtureId} Graph lifecycle oracle`);
  const families = ["actors", "homes"].filter((family) => value[family] !== undefined);
  assertExactObjectKeys(value, ["schema", ...families], `${fixtureId} Graph lifecycle oracle`);
  if (value.schema !== 1) throw new Error(`${fixtureId} Graph lifecycle oracle schema must be 1`);
  if (families.length === 0) throw new Error(`${fixtureId} Graph lifecycle oracle must author a family`);
  const result = { schema: 1 };
  for (const family of families) {
    const authored = value[family];
    assertObject(authored, `${fixtureId} Graph ${family} lifecycle oracle`);
    const hasVisibilitySegments = family === "homes"
      && authored.visibilitySegments !== undefined;
    assertExactObjectKeys(
      authored,
      ["created", "peak", ...(hasVisibilitySegments ? ["visibilitySegments"] : [])],
      `${fixtureId} Graph ${family} lifecycle oracle`,
    );
    assertNonNegativeInteger(authored.created, `${fixtureId} Graph ${family} created`);
    assertNonNegativeInteger(authored.peak, `${fixtureId} Graph ${family} peak`);
    if (authored.peak > authored.created) {
      throw new Error(`${fixtureId} Graph ${family} peak cannot exceed created`);
    }
    let visibilitySegments;
    if (hasVisibilitySegments) {
      if (!Array.isArray(authored.visibilitySegments)
        || authored.visibilitySegments.length === 0) {
        throw new Error(`${fixtureId} Graph homes visibilitySegments must be nonempty`);
      }
      visibilitySegments = authored.visibilitySegments.map((segment, segmentIndex) => {
        assertObject(segment, `${fixtureId} Graph homes visibility segment ${segmentIndex}`);
        assertExactObjectKeys(
          segment,
          ["regionId", "homeIds"],
          `${fixtureId} Graph homes visibility segment ${segmentIndex}`,
        );
        assertNonblankString(
          segment.regionId,
          `${fixtureId} Graph homes visibility segment ${segmentIndex} regionId`,
        );
        return {
          regionId: segment.regionId,
          homeIds: uniqueStrings(
            segment.homeIds,
            `${fixtureId} Graph homes visibility segment ${segmentIndex} homeIds`,
            false,
          ),
        };
      });
      const scheduledCreations = visibilitySegments.reduce(
        (total, segment) => total + segment.homeIds.length,
        0,
      );
      if (scheduledCreations !== authored.created) {
        throw new Error(
          `${fixtureId} Graph homes created must equal authored visibility occurrences`,
        );
      }
    }
    result[family] = {
      created: authored.created,
      peak: authored.peak,
      ...(visibilitySegments === undefined ? {} : { visibilitySegments }),
    };
  }
  return result;
}

function canonicalC16Placements(fixture) {
  if (!Array.isArray(fixture.checkpoints)) throw new Error("C16 canonical fixture has no checkpoints");
  let expected = null;
  for (const cursor of C16_DENSITY_CURSORS) {
    const checkpoint = fixture.checkpoints.find((item) => item?.checkpoint?.event_cursor === cursor)?.checkpoint;
    if (!checkpoint) throw new Error(`C16 canonical fixture is missing checkpoint ${cursor}`);
    const agents = checkpoint.snapshot?.agents;
    const homes = checkpoint.snapshot?.homes;
    if (!Array.isArray(agents) || !Array.isArray(homes)) throw new Error(`C16 canonical checkpoint ${cursor} lacks population`);
    const ids = [...agents.map(({ id }) => `actor:${id}`), ...homes.map(({ home_id }) => `home:${home_id}`)].sort(codeUnitCompare);
    if (ids.length !== 384 || new Set(ids).size !== 384) throw new Error(`C16 canonical checkpoint ${cursor} must contain 384 unique identities`);
    if (expected !== null && !arraysEqual(ids, expected)) throw new Error("C16 canonical fixture population changes across density checkpoints");
    expected = ids;
  }
  return expected;
}

function readTrustedFile(trustedRoot, reference, label) {
  assertObject(reference, `${label} file reference`);
  assertNonblankString(reference.file, `${label} file`);
  if (path.isAbsolute(reference.file) || reference.file.split(/[\\/]/).includes("..")) {
    throw new Error(`${label} file escapes trusted root`);
  }
  const components = reference.file.split(/[\\/]/).filter(Boolean);
  let candidate = trustedRoot;
  try {
    for (const component of components) {
      candidate = path.join(candidate, component);
      if (lstatSync(candidate).isSymbolicLink()) throw new Error(`${label} file path contains a symbolic link`);
    }
  } catch (error) {
    if (error instanceof Error && /symbolic link/.test(error.message)) throw error;
    throw new Error(`${label} file is missing ${reference.file}`);
  }
  const resolved = realpathSync(candidate);
  if (resolved !== trustedRoot && !resolved.startsWith(`${trustedRoot}${path.sep}`)) throw new Error(`${label} file escapes trusted root`);
  return { file: reference.file.replaceAll("\\", "/"), bytes: readFileSync(resolved) };
}

/** Derive the mechanic and visible terminal authorities from trusted fixture data. */
export function trustedTerminalAuthority(fixture, options = {}) {
  assertObject(fixture, "trusted Chronicle fixture");
  assertNonblankString(fixture.id, "trusted Chronicle fixture id");
  assertNonNegativeInteger(fixture.expectedFinalCursor, `${fixture.id} expectedFinalCursor`);
  const mechanicRunId = fixture.runId ?? fixture.initialSnapshot?.run_id ?? `${fixture.id.toLowerCase()}-run`;
  assertNonblankString(mechanicRunId, `${fixture.id} mechanic runId`);
  const mechanicSnapshot = fixture.expectedTerminal?.finalSnapshot ?? fixture.initialSnapshot;
  assertObject(mechanicSnapshot, `${fixture.id} mechanic terminal snapshot`);
  validateEventlessFixtureAuthority(
    fixture,
    mechanicRunId,
    options.strictEventless === true || fixture.runId !== undefined,
  );

  const authored = fixture.expectedTerminal?.presentationAuthority;
  const kind = authored?.kind ?? "mechanic-story";
  if (!["mechanic-story", "silent-checkpoint", "transport-recovery", "archive-live-isolation"].includes(kind)) {
    throw new Error(`${fixture.id} presentation authority kind is invalid`);
  }
  const rawTerminal = authored?.terminal ?? {
    source: "live",
    runId: mechanicRunId,
    sourceKey: `live:${mechanicRunId}`,
    cursor: fixture.expectedFinalCursor,
  };
  assertObject(rawTerminal, `${fixture.id} presentation terminal`);
  if (rawTerminal.source !== "live") throw new Error(`${fixture.id} presentation terminal must use Live authority`);
  assertNonblankString(rawTerminal.runId, `${fixture.id} presentation runId`);
  assertNonblankString(rawTerminal.sourceKey, `${fixture.id} presentation sourceKey`);
  assertNonNegativeInteger(rawTerminal.cursor, `${fixture.id} presentation cursor`);
  if (rawTerminal.sourceKey !== `live:${rawTerminal.runId}`) {
    throw new Error(`${fixture.id} presentation sourceKey must bind its Live run`);
  }
  if (kind === "mechanic-story" && (rawTerminal.runId !== mechanicRunId
    || rawTerminal.cursor !== fixture.expectedFinalCursor)) {
    throw new Error(`${fixture.id} mechanic-story presentation terminal must equal mechanic authority`);
  }
  const presentationSnapshot = kind === "mechanic-story" || kind === "silent-checkpoint"
    ? JSON.parse(canonicalJson(mechanicSnapshot))
    : {
        ...JSON.parse(canonicalJson(fixture.initialSnapshot)),
        run_id: rawTerminal.runId,
        event_cursor: rawTerminal.cursor,
        world_time: fixture.initialSnapshot.world_time + rawTerminal.cursor,
      };
  return deepCloneFreeze({
    mechanic: {
      runId: mechanicRunId,
      finalCursor: fixture.expectedFinalCursor,
      finalSnapshot: mechanicSnapshot,
    },
    presentation: {
      kind,
      terminal: { ...rawTerminal, snapshot: presentationSnapshot },
    },
  });
}

function validateEventlessFixtureAuthority(fixture, mechanicRunId, strict) {
  if (!strict || !["C00", "C14", "C15"].includes(fixture.id)) return;
  const terminal = fixture.expectedTerminal;
  assertObject(terminal, `${fixture.id} expectedTerminal`);
  if (fixture.expectedFinalCursor !== 0 || !Array.isArray(fixture.entries)
    || fixture.entries.length !== 0) {
    throw new Error(`${fixture.id} exact eventless presentation authority requires zero mechanic events`);
  }
  const authority = terminal.presentationAuthority;
  assertObject(authority, `${fixture.id} exact eventless presentation authority`);
  assertExactObjectKeys(authority, ["kind", "terminal"], `${fixture.id} presentationAuthority`);
  assertObject(authority.terminal, `${fixture.id} exact eventless presentation terminal`);
  assertExactObjectKeys(
    authority.terminal,
    ["cursor", "runId", "source", "sourceKey"],
    `${fixture.id} presentation terminal`,
  );
  const kind = fixture.id === "C00" ? "silent-checkpoint"
    : fixture.id === "C14" ? "transport-recovery" : "archive-live-isolation";
  const runId = fixture.id === "C14" ? `${mechanicRunId}-replacement` : mechanicRunId;
  const cursor = fixture.id === "C15" ? 4 : 0;
  const expectedAuthority = {
    kind,
    terminal: { cursor, runId, source: "live", sourceKey: `live:${runId}` },
  };
  if (canonicalJson(authority) !== canonicalJson(expectedAuthority)) {
    throw new Error(`${fixture.id} exact eventless presentation authority is malformed`);
  }
  const recordCount = fixture.id === "C00" ? 0 : fixture.id === "C14" ? 3 : 1;
  const expectedAuthorship = {
    handAuthoredEnvelopeCount: 0,
    labeled: true,
    mechanicEventsFabricated: false,
    recordCount,
  };
  if (canonicalJson(terminal.fixtureAuthorship) !== canonicalJson(expectedAuthorship)) {
    throw new Error(`${fixture.id} exact eventless fixture authorship is malformed`);
  }
  const expectedRecords = fixture.id === "C00" ? []
    : fixture.id === "C14" ? [
        { kind: "transport-fault", label: "cursor-gap", payload: { firstMissingCursor: 1, lastMissingCursor: 2 }, schema: 1 },
        { kind: "transport-fault", label: "oversized-record-413", payload: { retryable: false }, schema: 1 },
        { kind: "transport-fault", label: "run-replacement", payload: { staleRunRejected: true }, schema: 1 },
      ]
      : [{ kind: "session-edge", label: "archive-live-isolation", payload: { archiveCursor: 2, liveCursor: 4 }, schema: 1 }];
  if (canonicalJson(terminal.presentationRecords) !== canonicalJson(expectedRecords)) {
    throw new Error(`${fixture.id} exact eventless presentation records are malformed`);
  }
}

function assertExactObjectKeys(value, keys, label) {
  const actual = Object.keys(value).sort(codeUnitCompare);
  const expected = [...keys].sort(codeUnitCompare);
  if (!arraysEqual(actual, expected)) throw new Error(`${label} must contain exact keys`);
}

function isEventlessPresentationAuthority(authority) {
  return ["silent-checkpoint", "transport-recovery", "archive-live-isolation"]
    .includes(authority.presentation.kind);
}

/** Validate operational proof for the three intentionally mechanic-eventless Chronicles. */
export function validateEventlessOperationalAuthority(input) {
  assertObject(input, "eventless operational authority");
  if (!["C00", "C14", "C15"].includes(input.chronicleId)) {
    throw new Error("eventless operational authority only applies to C00, C14, and C15");
  }
  assertObject(input.fixture, `${input.chronicleId} trusted fixture`);
  const trusted = trustedTerminalAuthority(input.fixture);
  if (canonicalJson(input.authority) !== canonicalJson(trusted)) {
    throw new Error(`${input.chronicleId} supplied terminal authority differs from trusted fixture authority`);
  }
  if (trusted.mechanic.finalCursor !== 0 || (input.fixture.entries?.length ?? 0) !== 0) {
    throw new Error(`${input.chronicleId} eventless authority requires zero mechanic events`);
  }
  assertObject(input.workload, `${input.chronicleId} operational workload`);
  if (!Array.isArray(input.workload.trace)) throw new Error(`${input.chronicleId} operational workload trace must be an array`);
  assertObject(input.terminalObservation, `${input.chronicleId} presentation terminal observation`);
  const terminal = trusted.presentation.terminal;
  const observedTerminal = input.terminalObservation;
  assertNonNegativeInteger(observedTerminal.activeSceneCount, "presentation terminal activeSceneCount");
  assertNonNegativeInteger(observedTerminal.pendingMoments, "presentation terminal pendingMoments");
  assertNonNegativeInteger(observedTerminal.presentedCursor, "presentation terminal presentedCursor");
  assertObject(observedTerminal.observerFrameIdentity, "presentation terminal observerFrameIdentity");
  if (observedTerminal.activeSceneCount !== 0 || observedTerminal.pendingMoments !== 0
    || observedTerminal.presentedCursor !== terminal.cursor
    || observedTerminal.observerFrameIdentity.runId !== terminal.runId
    || observedTerminal.observerFrameIdentity.sourceKey !== terminal.sourceKey) {
    throw new Error(`${input.chronicleId} presentation terminal does not match visible authority`);
  }

  const initialRunId = input.fixture.initialSnapshot?.run_id ?? input.fixture.runId;
  assertNonblankString(initialRunId, `${input.chronicleId} initial runId`);
  const live = (runId, cursor) => ({ source: "live", runId, sourceKey: `live:${runId}`, cursor });
  const trace = (workload, label, selected, liveEndpoint, completed) => ({
    workload,
    label,
    mechanicFinalCursor: 0,
    selected,
    live: liveEndpoint,
    completed,
  });
  let expectedTrace;
  let positive;
  if (input.chronicleId === "C00") {
    const live0 = live(initialRunId, 0);
    expectedTrace = [
      trace("ambient", "live-0", live0, live0, false),
      trace("ambient", "terminal-live-0", live0, live0, true),
    ];
    validateC00Topology(input.fixture);
    validateC00TransportWitnesses(input.transportWitnesses, initialRunId);
    positive = ["four-region-topology", "observer-checkpoint"];
  } else if (input.chronicleId === "C14") {
    const old0 = live(initialRunId, 0);
    const old2 = live(initialRunId, 2);
    const old3 = live(initialRunId, 3);
    const replacement0 = live(terminal.runId, 0);
    expectedTrace = [
      trace("transport-recovery", "old-live-0", old0, old0, false),
      trace("transport-recovery", "old-live-2", old2, old2, false),
      trace("transport-recovery", "old-live-3", old3, old3, false),
      trace("transport-recovery", "replacement-live-0", replacement0, replacement0, false),
      trace("transport-recovery", "stale-old-run-rejected", replacement0, replacement0, true),
    ];
    validateC14TransportWitnesses(input.transportWitnesses, initialRunId, terminal.runId);
    validateC14NetworkWitnesses(input.network);
    positive = ["gap", "reconnect", "snapshot-retry", "413", "replacement", "stale-reject"];
  } else {
    const live0 = live(initialRunId, 0);
    const live2 = live(initialRunId, 2);
    const live4 = live(initialRunId, 4);
    const archive2 = {
      source: "archive",
      runId: initialRunId,
      sourceKey: `archive:${initialRunId}:line-1:window-2-2`,
      cursor: 2,
    };
    expectedTrace = [
      trace("archive-live-isolation", "live-0", live0, live0, false),
      trace("archive-live-isolation", "live-2", live2, live2, false),
      trace("archive-live-isolation", "archive-2", archive2, live2, false),
      trace("archive-live-isolation", "archive-2-live-4", archive2, live4, false),
      trace("archive-live-isolation", "terminal-live-4", live4, live4, true),
    ];
    validateC15TransportWitnesses(input.transportWitnesses, initialRunId);
    positive = ["observer-frame", "isolated-sessions", "bounded-live-ingestion"];
  }
  if (canonicalJson(input.workload.trace) !== canonicalJson(expectedTrace)) {
    throw new Error(`${input.chronicleId} operational workload must retain its exact ordered trace`);
  }
  const terminalClaims = ["final-checkpoint-aligned", "run-identity-preserved"];
  const authored = input.fixture.expectedTerminal?.semanticOracle;
  if (canonicalJson(authored?.positive) !== canonicalJson(positive)
    || canonicalJson(authored?.terminal) !== canonicalJson(terminalClaims)) {
    throw new Error(`${input.chronicleId} fixture claims differ from operationally proven claims`);
  }
  return deepCloneFreeze({ positive, terminal: terminalClaims, trace: expectedTrace, completed: true });
}

function validateC00Topology(fixture) {
  const regions = fixture.expectedTerminal?.finalSnapshot?.regions;
  if (!Array.isArray(regions)) throw new Error("C00 final topology must contain regions");
  const topology = Object.fromEntries(regions.map((region) => [region.name, [...region.connections].sort(codeUnitCompare)]));
  const expected = {
    nirvana: ["nirvana_east", "nirvana_west", "warm_springs"],
    nirvana_east: ["nirvana", "warm_springs"],
    nirvana_west: ["nirvana", "warm_springs"],
    warm_springs: ["nirvana", "nirvana_east", "nirvana_west"],
  };
  if (regions.length !== 4 || canonicalJson(topology) !== canonicalJson(expected)) {
    throw new Error("C00 silent topology must prove the exact four-region graph");
  }
}

function validateC00TransportWitnesses(witnesses, runId) {
  validateZeroEventTransportWitnesses(witnesses, "C00");
  if (canonicalJson(witnesses.map(({ kind }) => kind)) !== canonicalJson([
    "open", "close",
  ])) {
    throw new Error("C00 transport witnesses must retain the exact balanced Live lifecycle");
  }
  const [opened, closed] = witnesses;
  if (opened.sourceId !== closed.sourceId || opened.sourceRunId !== runId
    || closed.sourceRunId !== runId || opened.cursor !== 0 || closed.cursor !== 0) {
    throw new Error("C00 transport witnesses must prove balanced Live cursor-0 ownership");
  }
}

function validateZeroEventTransportWitnesses(witnesses, label) {
  if (!Array.isArray(witnesses)) throw new Error(`${label} transport witnesses must be an array`);
  const sourceById = new Map();
  for (const [index, witness] of witnesses.entries()) {
    assertObject(witness, `${label} transport witness ${index}`);
    assertExactObjectKeys(witness, [
      "sequence", "kind", "sourceId", "sourceRunId", "url", "cursor", "envelopeRunId",
      "overflow", "snapshotRequired", "eventCount", "envelope", "disposition",
    ], `${label} transport witness ${index}`);
    if (witness.sequence !== index + 1) {
      throw new Error(`${label} transport witness sequence must be contiguous and ordered`);
    }
    if (!["open", "envelope", "error", "close"].includes(witness.kind)) {
      throw new Error(`${label} transport witness kind is invalid`);
    }
    if (!Number.isSafeInteger(witness.sourceId) || witness.sourceId <= 0) {
      throw new Error(`${label} transport witness sourceId must be positive`);
    }
    assertNonblankString(witness.sourceRunId, `${label} transport sourceRunId`);
    assertNonblankString(witness.url, `${label} transport URL`);
    assertNonNegativeInteger(witness.cursor, `${label} transport cursor`);
    // Raw EventSource evidence retains the exact relative request target passed
    // by the production client.  Requiring that form prevents an arbitrary
    // origin or extra query parameter from being smuggled into authority while
    // still permitting URL parsing at this raw trust boundary.
    if (!/^\/api\/events\/stream\?cursor=(?:0|[1-9]\d*)$/.test(witness.url)) {
      throw new Error(`${label} transport witness URL must be an exact relative event-stream target`);
    }
    const url = new URL(witness.url, "http://capture.invalid");
    if (url.pathname !== "/api/events/stream" || [...url.searchParams.keys()].join("\0") !== "cursor"
      || !/^\d+$/.test(url.searchParams.get("cursor") ?? "")) {
      throw new Error(`${label} transport witness URL must be exact event-stream authority`);
    }
    if (witness.kind === "open" && Number(url.searchParams.get("cursor")) !== witness.cursor) {
      throw new Error(`${label} transport witness URL cursor must match its opened source cursor`);
    }
    if (witness.kind === "open") {
      if (sourceById.has(witness.sourceId)) throw new Error(`${label} transport source may open only once`);
      sourceById.set(witness.sourceId, {
        runId: witness.sourceRunId,
        url: witness.url,
        cursor: witness.cursor,
      });
    } else {
      const source = sourceById.get(witness.sourceId);
      if (source === undefined || source.runId !== witness.sourceRunId || source.url !== witness.url) {
        throw new Error(`${label} transport witness must follow its exact opened source lineage`);
      }
    }
    if (witness.kind === "envelope") {
      assertObject(witness.envelope, `${label} transport envelope ${index}`);
      assertExactObjectKeys(witness.envelope, [
        "schema", "cursor", "oldest_cursor", "next_cursor", "events", "overflow",
        "snapshot_required",
      ], `${label} transport envelope ${index}`);
      if (witness.envelope.schema !== 1 || witness.envelope.next_cursor !== witness.cursor
        || witness.envelopeRunId !== null || witness.eventCount !== 0
        || !Array.isArray(witness.envelope.events) || witness.envelope.events.length !== 0
        || witness.overflow !== witness.envelope.overflow
        || witness.snapshotRequired !== witness.envelope.snapshot_required) {
        throw new Error(`${label} transport envelope may not fabricate mechanic event witnesses`);
      }
    } else if (witness.envelope !== null || witness.envelopeRunId !== null
      || witness.eventCount !== null || witness.overflow !== null || witness.snapshotRequired !== null
      || witness.disposition !== "accepted") {
      throw new Error(`${label} non-envelope transport lifecycle is malformed`);
    }
  }
  return witnesses;
}

function validateC14TransportWitnesses(witnesses, oldRunId, replacementRunId) {
  validateZeroEventTransportWitnesses(witnesses, "C14");
  if (canonicalJson(witnesses.map(({ kind }) => kind)) !== canonicalJson([
    "open", "error", "close", "open", "envelope", "close", "open", "close", "open", "envelope", "close",
  ])) {
    throw new Error("C14 transport witnesses must retain the exact ordered lifecycle");
  }
  const opens = witnesses.filter(({ kind }) => kind === "open")
    .map(({ sourceId, cursor, sourceRunId }) => ({ sourceId, cursor, sourceRunId }));
  const [firstSource, gapSource, overflowSource, replacementSource] = opens.map(({ sourceId }) => sourceId);
  const expectedOpens = [
    { sourceId: firstSource, cursor: 0, sourceRunId: oldRunId },
    { sourceId: gapSource, cursor: 2, sourceRunId: oldRunId },
    { sourceId: overflowSource, cursor: 3, sourceRunId: oldRunId },
    { sourceId: replacementSource, cursor: 0, sourceRunId: replacementRunId },
  ];
  if (new Set(opens.map(({ sourceId }) => sourceId)).size !== 4
    || canonicalJson(opens) !== canonicalJson(expectedOpens)) {
    throw new Error("C14 transport opens must prove reconnect and exact replacement lineage");
  }
  const expectedLifecycle = [
    { index: 1, sourceId: firstSource, cursor: 0, disposition: "accepted" },
    { index: 2, sourceId: firstSource, cursor: 0, disposition: "accepted" },
    { index: 4, sourceId: gapSource, cursor: 3, disposition: "accepted" },
    { index: 5, sourceId: gapSource, cursor: 2, disposition: "accepted" },
    { index: 7, sourceId: overflowSource, cursor: 3, disposition: "accepted" },
    { index: 9, sourceId: overflowSource, cursor: 99, disposition: "forced-stale-callback" },
    { index: 10, sourceId: replacementSource, cursor: 0, disposition: "accepted" },
  ];
  for (const expected of expectedLifecycle) {
    const witness = witnesses[expected.index];
    if (witness.sourceId !== expected.sourceId || witness.cursor !== expected.cursor
      || witness.disposition !== expected.disposition) {
      throw new Error("C14 transport witnesses must retain the exact ordered lifecycle");
    }
  }
  for (const index of [4, 9]) {
    const witness = witnesses[index];
    if (witness.overflow !== true || witness.snapshotRequired !== true) {
      throw new Error("C14 recovery envelopes must require exact snapshots");
    }
  }
}

function validateC14NetworkWitnesses(network) {
  assertObject(network, "C14 network evidence");
  if (!Array.isArray(network.requests)) throw new Error("C14 network requests must be an array");
  const checkpoint = network.requests.findIndex((request) => {
    const url = new URL(request.url);
    return url.pathname === "/api/replay/checkpoints" && request.status === 413
      && request.disposition === "fulfilled";
  });
  const snapshotRetry = network.requests.findIndex((request, index) => index > checkpoint
    && new URL(request.url).pathname === "/api/world"
    && request.status === 200 && request.disposition === "fulfilled");
  const replacementRun = network.requests.findIndex((request, index) => index > snapshotRetry
    && new URL(request.url).pathname === "/api/run"
    && request.status === 200 && request.disposition === "fulfilled");
  const replacementWorld = network.requests.findIndex((request, index) => index > replacementRun
    && new URL(request.url).pathname === "/api/world"
    && request.status === 200 && request.disposition === "fulfilled");
  if (checkpoint < 0 || snapshotRetry < 0) {
    throw new Error("C14 network must prove ordered checkpoint 413 then replacement snapshot retry");
  }
  if (replacementRun < 0 || replacementWorld < 0) {
    throw new Error("C14 network must prove ordered replacement run/world acceptance");
  }
}

function validateC15TransportWitnesses(witnesses, runId) {
  validateZeroEventTransportWitnesses(witnesses, "C15");
  if (canonicalJson(witnesses.map(({ kind }) => kind)) !== canonicalJson([
    "open", "envelope", "close", "open", "envelope", "close", "open", "close",
  ])) {
    throw new Error("C15 transport witnesses must retain the exact ordered Live lifecycle");
  }
  const opens = witnesses.filter(({ kind }) => kind === "open");
  if (new Set(opens.map(({ sourceId }) => sourceId)).size !== 3
    || opens.some(({ sourceRunId }) => sourceRunId !== runId)
    || canonicalJson(opens.map(({ cursor }) => cursor)) !== canonicalJson([0, 2, 4])) {
    throw new Error("C15 transport opens must retain Live cursor lineage 0,2,4");
  }
  const [cursor0Source, cursor2Source, cursor4Source] = opens.map(({ sourceId }) => sourceId);
  const exactLifecycle = [
    { sourceId: cursor0Source, cursor: 0 },
    { sourceId: cursor0Source, cursor: 2 },
    { sourceId: cursor0Source, cursor: 0 },
    { sourceId: cursor2Source, cursor: 2 },
    { sourceId: cursor2Source, cursor: 4 },
    { sourceId: cursor2Source, cursor: 2 },
    { sourceId: cursor4Source, cursor: 4 },
    { sourceId: cursor4Source, cursor: 4 },
  ];
  if (witnesses.some((witness, index) => witness.sourceId !== exactLifecycle[index].sourceId
    || witness.cursor !== exactLifecycle[index].cursor)) {
    throw new Error("C15 transport lifecycle must remain bound to each exact Live source");
  }
  const acceptedOverflow = witnesses.filter((item) => item.kind === "envelope"
    && item.sourceRunId === runId && item.disposition === "accepted" && item.overflow === true
    && item.snapshotRequired === true)
    .map(({ cursor }) => cursor);
  if (canonicalJson(acceptedOverflow) !== canonicalJson([2, 4])) {
    throw new Error("C15 transport must prove bounded Live ingestion at cursors 2 and 4");
  }
}

function buildSemanticEvidence(
  identity,
  semantic,
  fixture,
  motionClaims,
  recoveredGaps,
  terminalAuthority,
  network,
  markerFrames,
) {
  assertObject(semantic, `${identity.chronicleId} semantic evidence`);
  const expected = {};
  for (const category of ["negative", "positive", "terminal"]) {
    expected[category] = uniqueStrings(fixture.expectedTerminal.semanticOracle[category], `fixture semantic ${category}`, true);
  }
  const operationalAuthority = isEventlessPresentationAuthority(terminalAuthority);
  if (canonicalJson(semantic.terminalAuthority) !== canonicalJson(terminalAuthority)) {
    throw new Error(`${identity.chronicleId} raw terminal authority differs from trusted fixture authority`);
  }
  assertObject(semantic.operationalWorkload, `${identity.chronicleId} raw operational workload`);
  if (!Array.isArray(semantic.operationalWorkload.trace)) {
    throw new Error(`${identity.chronicleId} raw operational workload trace must be an array`);
  }
  if (!Array.isArray(semantic.transportWitnesses)) {
    throw new Error(`${identity.chronicleId} raw transport witnesses must be an array`);
  }
  const terminalObservation = validateSemanticTerminalObservation(
    semantic.terminalObservation,
    fixture,
    terminalAuthority,
  );
  const terminalCameraWitness = validateTerminalCameraWitness(
    semantic.terminalCameraWitness,
    terminalObservation,
    markerFrames,
  );
  const eventEvidence = validateSemanticEventWitnesses(
    semantic.eventWitnesses,
    fixture,
    recoveredGaps,
  );
  let operational = null;
  if (operationalAuthority) {
    operational = validateEventlessOperationalAuthority({
      chronicleId: identity.chronicleId,
      fixture,
      authority: semantic.terminalAuthority,
      workload: semantic.operationalWorkload,
      transportWitnesses: semantic.transportWitnesses,
      terminalObservation,
      network,
    });
  }
  const observed = {};
  for (const category of ["negative", "positive", "terminal"]) {
    const claims = category === "positive" && operational !== null
      ? operational.positive
      : category === "terminal" && operational !== null
        ? operational.terminal
        : expected[category];
    observed[category] = claims.map((claim) => {
      if (isMotionBoundSemanticClaim(claim)
        && motionClaims?.[claim] !== true) {
        throw new Error(`semantic movement claim is not proven by motion evidence: ${claim}`);
      }
      return claim;
    });
  }
  const eventlessEvidence = operational === null
    ? []
    : [...operational.positive, ...operational.terminal].sort(codeUnitCompare);
  const endpoints = uniqueStrings(semantic.endpoints, "semantic endpoints", true);
  const consequences = uniqueStrings(semantic.consequences, "semantic consequences", true);
  const markers = orderedNonemptyStrings(semantic.markers, "semantic markers");
  const labels = markers.map(markerLabel);
  if (!arraysEqual([...fixture.expectedMarkers].sort(codeUnitCompare), [...markers].sort(codeUnitCompare))) {
    throw new Error("semantic markers must match trusted fixture markers");
  }
  if (!arraysEqual([...consequences].sort(codeUnitCompare), [...markers].sort(codeUnitCompare))) {
    throw new Error("semantic consequence witnesses must match trusted markers");
  }
  return {
    ...identity,
    terminalAuthority,
    operationalWorkload: operational === null
      ? deepCloneFreeze(semantic.operationalWorkload)
      : { trace: operational.trace, completed: operational.completed },
    transportWitnesses: deepCloneFreeze(semantic.transportWitnesses),
    terminalObservation,
    terminalCameraWitness,
    eventWitnesses: eventEvidence.eventWitnesses,
    eventProvenance: eventEvidence.eventProvenance,
    expected,
    observed,
    eventlessEvidence,
    endpoints,
    consequences,
    markers,
    labels,
    verdict: { passed: true },
  };
}

function validateTerminalCameraWitness(witness, terminalObservation, markerFrames) {
  assertObject(witness, "terminal camera witness");
  assertExactObjectKeys(
    witness,
    ["requiredConsecutiveSamples", "markerFrameIndex", "samples"],
    "terminal camera witness",
  );
  if (witness.requiredConsecutiveSamples !== 3) {
    throw new Error("terminal camera witness must require three consecutive terminal camera samples");
  }
  assertNonNegativeInteger(witness.markerFrameIndex, "terminal camera witness markerFrameIndex");
  if (markerFrames?.["checkpoint:final"] !== witness.markerFrameIndex) {
    throw new Error("terminal camera witness must end at the checkpoint:final marker frame");
  }
  if (!Array.isArray(witness.samples) || witness.samples.length !== 3) {
    throw new Error("terminal camera witness requires exactly three consecutive terminal camera samples");
  }

  const normalized = witness.samples.map((sample, index) => {
    const label = `terminal camera witness sample ${index}`;
    assertObject(sample, label);
    assertExactObjectKeys(sample, [
      "frameIndex", "presentationTimeMs", "frameIdentity", "presentation", "world", "region",
      "camera", "activeEffects", "actors",
    ], label);
    assertNonNegativeInteger(sample.frameIndex, `${label} frameIndex`);
    if (!Number.isFinite(sample.presentationTimeMs) || sample.presentationTimeMs < 0) {
      throw new Error(`${label} presentationTimeMs must be finite and non-negative`);
    }
    if (index > 0) {
      const previous = witness.samples[index - 1];
      if (sample.frameIndex !== previous.frameIndex + 1) {
        throw new Error("terminal camera witness requires consecutive frame indexes");
      }
      if (sample.presentationTimeMs <= previous.presentationTimeMs) {
        throw new Error("terminal camera witness presentation times must increase");
      }
    }

    assertObject(sample.frameIdentity, `${label} frameIdentity`);
    assertExactObjectKeys(
      sample.frameIdentity,
      ["runId", "sourceKey", "firstCursor", "lastCursor", "revision"],
      `${label} frameIdentity`,
    );
    assertNonblankString(sample.frameIdentity.runId, `${label} frameIdentity runId`);
    assertNonblankString(sample.frameIdentity.sourceKey, `${label} frameIdentity sourceKey`);
    for (const field of ["firstCursor", "lastCursor", "revision"]) {
      assertNonNegativeInteger(sample.frameIdentity[field], `${label} frameIdentity ${field}`);
    }
    if (canonicalJson(sample.frameIdentity)
      !== canonicalJson(terminalObservation.observerFrameIdentity)) {
      throw new Error("terminal camera witness frame identity must match semantic terminal identity");
    }

    assertObject(sample.presentation, `${label} presentation`);
    assertExactObjectKeys(sample.presentation, [
      "ingestedCursor", "presentedCursor", "canvasLastCursor",
      "activeSceneCount", "pendingMoments",
    ], `${label} presentation`);
    for (const field of [
      "ingestedCursor", "presentedCursor", "canvasLastCursor",
      "activeSceneCount", "pendingMoments",
    ]) {
      assertNonNegativeInteger(sample.presentation[field], `${label} presentation ${field}`);
    }
    if (sample.presentation.ingestedCursor !== terminalObservation.targetCursor
      || sample.presentation.presentedCursor !== terminalObservation.targetCursor
      || sample.presentation.canvasLastCursor !== terminalObservation.targetCursor
      || sample.presentation.activeSceneCount !== 0
      || sample.presentation.pendingMoments !== 0) {
      throw new Error("terminal camera witness terminal presentation counters are unsettled");
    }

    assertObject(sample.world, `${label} world`);
    assertExactObjectKeys(
      sample.world,
      ["exactBaseCursor", "projectedThroughCursor"],
      `${label} world`,
    );
    for (const field of ["exactBaseCursor", "projectedThroughCursor"]) {
      assertNonNegativeInteger(sample.world[field], `${label} world ${field}`);
    }
    if (sample.world.exactBaseCursor > sample.world.projectedThroughCursor
      || sample.world.projectedThroughCursor !== terminalObservation.targetCursor) {
      throw new Error("terminal camera witness world cursors are unsettled");
    }

    assertObject(sample.region, `${label} region`);
    assertExactObjectKeys(
      sample.region,
      ["activeRegionId", "visibleRegionId", "loadingRegionId"],
      `${label} region`,
    );
    assertNonblankString(sample.region.activeRegionId, `${label} activeRegionId`);
    assertNonblankString(sample.region.visibleRegionId, `${label} visibleRegionId`);
    if (sample.region.activeRegionId !== sample.region.visibleRegionId) {
      throw new Error("terminal camera witness active and visible region must match");
    }
    if (sample.region.loadingRegionId !== null) {
      throw new Error("terminal camera witness loading region must be clear");
    }

    assertObject(sample.camera, `${label} camera`);
    assertExactObjectKeys(sample.camera, [
      "mode", "center", "zoom", "rasterOrigin", "safeFrame", "viewport",
      "focusSelectionKey", "pendingStoryEntityId", "pendingStoryTarget",
    ], `${label} camera`);
    assertNonblankString(sample.camera.mode, `${label} camera mode`);
    const center = normalizeFiniteFields(sample.camera.center, ["x", "y"], `${label} camera center`);
    const rasterOrigin = normalizeFiniteFields(
      sample.camera.rasterOrigin,
      ["x", "y"],
      `${label} camera rasterOrigin`,
    );
    const safeFrame = normalizeFiniteFields(
      sample.camera.safeFrame,
      ["x", "y", "width", "height"],
      `${label} camera safeFrame`,
    );
    const viewport = normalizeFiniteFields(
      sample.camera.viewport,
      ["width", "height"],
      `${label} camera viewport`,
    );
    if (!Number.isFinite(sample.camera.zoom) || sample.camera.zoom <= 0
      || safeFrame.width <= 0 || safeFrame.height <= 0
      || viewport.width <= 0 || viewport.height <= 0) {
      throw new Error(`${label} camera geometry must be finite and positive`);
    }
    if (sample.camera.focusSelectionKey !== null) {
      assertNonblankString(sample.camera.focusSelectionKey, `${label} camera focusSelectionKey`);
    }
    if (sample.camera.pendingStoryEntityId !== null
      || sample.camera.pendingStoryTarget !== null) {
      throw new Error("terminal camera witness must not retain a pending story camera target");
    }

    assertNonNegativeInteger(sample.activeEffects, `${label} activeEffects`);
    if (sample.activeEffects !== 0) {
      throw new Error("terminal camera witness actors and effects must be idle");
    }
    if (!Array.isArray(sample.actors)) throw new Error(`${label} actors must be an array`);
    const actorIds = new Set();
    const actors = sample.actors.map((actor, actorIndex) => {
      const actorLabel = `${label} actor ${actorIndex}`;
      assertObject(actor, actorLabel);
      assertExactObjectKeys(actor, [
        "id", "instanceId", "position", "facing", "activeAction", "reposition",
      ], actorLabel);
      assertNonblankString(actor.id, `${actorLabel} id`);
      if (actorIds.has(actor.id)) throw new Error(`${label} actor IDs must be unique`);
      actorIds.add(actor.id);
      assertNonNegativeInteger(actor.instanceId, `${actorLabel} instanceId`);
      const position = normalizeFiniteFields(actor.position, ["x", "y"], `${actorLabel} position`);
      assertNonblankString(actor.facing, `${actorLabel} facing`);
      if (actor.activeAction !== null || actor.reposition !== null) {
        throw new Error("terminal camera witness actors must be idle without repositioning");
      }
      return {
        id: actor.id,
        instanceId: actor.instanceId,
        position,
        facing: actor.facing,
        activeAction: null,
        reposition: null,
      };
    });
    return {
      frameIndex: sample.frameIndex,
      presentationTimeMs: sample.presentationTimeMs,
      frameIdentity: { ...sample.frameIdentity },
      presentation: { ...sample.presentation },
      world: { ...sample.world },
      region: { ...sample.region },
      camera: {
        mode: sample.camera.mode,
        center,
        zoom: sample.camera.zoom,
        rasterOrigin,
        safeFrame,
        viewport,
        focusSelectionKey: sample.camera.focusSelectionKey,
        pendingStoryEntityId: null,
        pendingStoryTarget: null,
      },
      activeEffects: 0,
      actors,
    };
  });

  const first = normalized[0];
  for (const sample of normalized.slice(1)) {
    if (canonicalJson(sample.camera) !== canonicalJson(first.camera)) {
      throw new Error("terminal camera witness camera must remain stable");
    }
    if (sample.region.activeRegionId !== first.region.activeRegionId) {
      throw new Error("terminal camera witness region must remain stable");
    }
    if (canonicalJson(sample.actors) !== canonicalJson(first.actors)) {
      throw new Error("terminal camera witness actor state must remain stable");
    }
  }
  if (normalized.at(-1).frameIndex !== witness.markerFrameIndex) {
    throw new Error("terminal camera witness must end at the checkpoint:final marker frame");
  }
  return {
    requiredConsecutiveSamples: 3,
    markerFrameIndex: witness.markerFrameIndex,
    samples: normalized,
  };
}

function validateReducedTerminalCameraWitness(witness, terminalObservation, markerFrames) {
  try {
    return validateTerminalCameraWitness(witness, terminalObservation, markerFrames);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`reduced ${message}`);
  }
}

function isMotionBoundSemanticClaim(claim) {
  return [
    "local-movement",
    "travel",
    "no-forbidden-edge",
    "no-teleport",
    "all-directed-edges",
    "forbidden-shortcut",
  ].includes(claim) || claim.includes("shortcut");
}

function validateSemanticEventWitnesses(witnesses, fixture, recoveredGaps) {
  if (!Array.isArray(witnesses)) throw new Error("semantic event witnesses must be an array");
  if (!Array.isArray(fixture.entries)) throw new Error("trusted fixture event entries must be an array");
  if (!Array.isArray(recoveredGaps)) throw new Error("recovered semantic cursor gaps must be an array");
  const trustedByCursor = new Map();
  for (const entry of fixture.entries) {
    assertObject(entry, "trusted fixture event entry");
    if (!Number.isSafeInteger(entry.cursor) || entry.cursor <= 0) {
      throw new Error("trusted fixture event cursor must be positive");
    }
    if (entry.cursor > fixture.expectedFinalCursor) {
      throw new Error(`trusted fixture event cursor ${entry.cursor} exceeds expected final cursor`);
    }
    if (trustedByCursor.has(entry.cursor)) {
      throw new Error(`trusted fixture event cursor ${entry.cursor} must be unique`);
    }
    trustedByCursor.set(entry.cursor, canonicalJson(entry));
  }

  const acceptedByCursor = new Map();
  for (const [index, witness] of witnesses.entries()) {
    assertObject(witness, `semantic event witness ${index}`);
    if (witness.kind !== "envelope" || witness.disposition !== "accepted") continue;
    if (!Number.isSafeInteger(witness.cursor) || witness.cursor <= 0) {
      throw new Error("accepted semantic event witness cursor must be positive");
    }
    if (acceptedByCursor.has(witness.cursor)) {
      throw new Error(`duplicate accepted semantic event witness cursor ${witness.cursor}`);
    }
    const trusted = trustedByCursor.get(witness.cursor);
    if (trusted === undefined) {
      throw new Error(`unexpected accepted semantic event witness cursor ${witness.cursor}`);
    }
    assertObject(witness.envelope, "accepted semantic event envelope");
    if (witness.envelope.next_cursor !== witness.cursor) {
      throw new Error(`accepted semantic event witness cursor ${witness.cursor} differs from its envelope`);
    }
    if (!Array.isArray(witness.envelope.events)) throw new Error("accepted semantic event envelope lacks events");
    if (witness.envelope.events.length !== 1) {
      throw new Error(`accepted semantic event witness cursor ${witness.cursor} must contain one event`);
    }
    const entry = witness.envelope.events[0];
    assertObject(entry, "accepted semantic event entry");
    if (entry.cursor !== witness.cursor || canonicalJson(entry) !== trusted) {
      throw new Error(
        `accepted semantic event witnesses differ from trusted fixture cursor ${witness.cursor}`,
      );
    }
    acceptedByCursor.set(witness.cursor, trusted);
  }

  const recoveredCursors = new Set();
  for (const gap of recoveredGaps) {
    for (let cursor = gap.fromCursor; cursor <= gap.toCursor; cursor += 1) {
      if (!trustedByCursor.has(cursor)) {
        throw new Error(`recovered semantic gap contains untrusted cursor ${cursor}`);
      }
      if (recoveredCursors.has(cursor)) {
        throw new Error(`trusted fixture cursor ${cursor} has overlapping recovered provenance`);
      }
      recoveredCursors.add(cursor);
    }
  }
  for (const cursor of [...trustedByCursor.keys()].sort((left, right) => left - right)) {
    const accepted = acceptedByCursor.has(cursor);
    const recovered = recoveredCursors.has(cursor);
    if (accepted && recovered) {
      throw new Error(`trusted fixture cursor ${cursor} has overlapping semantic provenance`);
    }
    if (!accepted && !recovered) {
      throw new Error(`trusted fixture cursor ${cursor} has no semantic provenance`);
    }
  }

  const acceptedCursors = [...acceptedByCursor.keys()].sort((left, right) => left - right);
  const acceptedRanges = cursorRanges(acceptedCursors);
  const recoveredRanges = recoveredGaps.map(({ fromCursor, toCursor }) => ({
    fromCursor,
    toCursor,
  }));
  const eventWitnesses = acceptedCursors.map((cursor) => ({
    kind: "envelope",
    disposition: "accepted",
    cursor,
    envelope: {
      next_cursor: cursor,
      events: [JSON.parse(acceptedByCursor.get(cursor))],
    },
  }));
  return {
    eventWitnesses,
    eventProvenance: {
      trustedCursorCount: trustedByCursor.size,
      accepted: { count: acceptedCursors.length, ranges: acceptedRanges },
      recovered: { count: recoveredCursors.size, ranges: recoveredRanges },
    },
  };
}

function cursorRanges(cursors) {
  const ranges = [];
  for (const cursor of cursors) {
    const previous = ranges.at(-1);
    if (previous !== undefined && cursor === previous.toCursor + 1) {
      previous.toCursor = cursor;
    } else {
      ranges.push({ fromCursor: cursor, toCursor: cursor });
    }
  }
  return ranges;
}

function validateSemanticTerminalObservation(observation, fixture, terminalAuthority) {
  assertObject(observation, "semantic terminal observation");
  const operationalAuthority = isEventlessPresentationAuthority(terminalAuthority);
  const presentationTerminal = terminalAuthority.presentation.terminal;
  const expectedCursor = operationalAuthority
    ? presentationTerminal.cursor
    : fixture.expectedFinalCursor;
  for (const field of ["observerFrameIdentity", "canvasFrameIdentity"]) {
    assertObject(observation[field], `semantic ${field}`);
  }
  if (canonicalJson(observation.observerFrameIdentity) !== canonicalJson(observation.canvasFrameIdentity)) {
    throw new Error("terminal observer and Canvas frame identities differ");
  }
  for (const field of ["ingestedCursor", "presentedCursor", "targetCursor", "activeSceneCount", "pendingMoments"]) {
    assertNonNegativeInteger(observation[field], `semantic ${field}`);
  }
  if (observation.targetCursor !== expectedCursor
    || observation.ingestedCursor !== expectedCursor
    || observation.presentedCursor !== expectedCursor
    || observation.activeSceneCount !== 0
    || observation.pendingMoments !== 0) {
    throw new Error("measured semantic terminal counters do not match trusted fixture authority");
  }
  if (operationalAuthority
    && (observation.observerFrameIdentity.runId !== presentationTerminal.runId
      || observation.observerFrameIdentity.sourceKey !== presentationTerminal.sourceKey)) {
    throw new Error("semantic presentation terminal identity differs from trusted authority");
  }
  assertObject(observation.frame, "semantic terminal presented frame");
  const frame = observation.frame;
  if (frame.runId !== observation.observerFrameIdentity.runId
    || frame.sourceKey !== observation.observerFrameIdentity.sourceKey
    || frame.presentedCursor !== expectedCursor) {
    throw new Error("terminal presented frame identity is not preserved");
  }
  assertObject(frame.world, "semantic terminal presented world");
  const exactValues = (records, label) => {
    if (!Array.isArray(records) || records.some((record) => record?.completeness !== "exact")) {
      throw new Error(`terminal presented ${label} must be exact`);
    }
    return records.map(({ value }) => value);
  };
  const actual = {
    agents: exactValues(frame.world.agents, "agents"),
    event_cursor: frame.presentedCursor,
    homes: exactValues(frame.world.homes, "homes"),
    pending_proposals: frame.world.pendingProposals,
    regions: exactValues(frame.world.regions, "regions"),
    ruins: exactValues(frame.world.ruins, "ruins"),
    run_id: frame.runId,
    world_time: frame.world.worldTime,
  };
  const trusted = operationalAuthority
    ? presentationTerminal.snapshot
    : fixture.expectedTerminal?.finalSnapshot ?? fixture.initialSnapshot;
  assertObject(trusted, "trusted semantic terminal snapshot");
  const normalizedSnapshotValue = (key, value) => {
    if (!Array.isArray(value)) return value;
    const identity = key === "agents" ? "id"
      : key === "regions" ? "name"
        : ["homes", "ruins"].includes(key) ? "home_id" : null;
    if (identity === null) return value;
    return [...value].sort((left, right) => codeUnitCompare(String(left?.[identity]), String(right?.[identity])));
  };
  for (const key of Object.keys(trusted).filter((key) => key !== "schema")) {
    if (canonicalJson(normalizedSnapshotValue(key, actual[key]))
      !== canonicalJson(normalizedSnapshotValue(key, trusted[key]))) {
      throw new Error(`terminal presented world differs from trusted ${key}`);
    }
  }
  const normalizeIdentity = (identity, label) => {
    assertNonblankString(identity.runId, `${label} runId`);
    assertNonblankString(identity.sourceKey, `${label} sourceKey`);
    for (const field of ["firstCursor", "lastCursor", "revision"]) {
      assertNonNegativeInteger(identity[field], `${label} ${field}`);
    }
    return {
      runId: identity.runId,
      sourceKey: identity.sourceKey,
      firstCursor: identity.firstCursor,
      lastCursor: identity.lastCursor,
      revision: identity.revision,
    };
  };
  const exactRecords = (values) => values.map((value) => ({
    completeness: "exact",
    value: JSON.parse(canonicalJson(value)),
  }));
  return {
    observerFrameIdentity: normalizeIdentity(observation.observerFrameIdentity, "semantic observerFrameIdentity"),
    canvasFrameIdentity: normalizeIdentity(observation.canvasFrameIdentity, "semantic canvasFrameIdentity"),
    ingestedCursor: observation.ingestedCursor,
    presentedCursor: observation.presentedCursor,
    targetCursor: observation.targetCursor,
    activeSceneCount: observation.activeSceneCount,
    pendingMoments: observation.pendingMoments,
    frame: {
      runId: frame.runId,
      sourceKey: frame.sourceKey,
      presentedCursor: frame.presentedCursor,
      world: {
        worldTime: frame.world.worldTime,
        agents: exactRecords(actual.agents),
        homes: exactRecords(actual.homes),
        pendingProposals: JSON.parse(canonicalJson(frame.world.pendingProposals)),
        regions: exactRecords(actual.regions),
        ruins: exactRecords(actual.ruins),
      },
    },
  };
}

function markerLabel(marker) {
  return marker.replace(/@cursor:\d+$/, "").replace(/^event:/, "").replace(/^checkpoint:/, "Checkpoint ")
    .replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function buildCursorEvidence(
  identity,
  cursors,
  expectedFinalCursor,
  terminalAuthority,
  operationalWorkload,
) {
  assertObject(cursors, `${identity.chronicleId} cursor evidence`);
  const operationalAuthority = isEventlessPresentationAuthority(terminalAuthority);
  const presentationTerminal = terminalAuthority.presentation.terminal;
  const expectedPresentationCursor = operationalAuthority
    ? presentationTerminal.cursor
    : expectedFinalCursor;
  if (operationalAuthority) {
    assertObject(operationalWorkload, `${identity.chronicleId} operational cursor workload`);
    if (!Array.isArray(operationalWorkload.trace)) {
      throw new Error(`${identity.chronicleId} operational cursor workload requires an exact trace`);
    }
  }
  if (!Array.isArray(cursors.samples) || cursors.samples.length === 0) throw new Error("cursor samples must be nonempty");
  const samples = cursors.samples.map((sample, index) => {
    assertObject(sample, `cursor sample ${index}`);
    for (const field of ["frameIndex", "authoritativeCursor", "acceptedCursor", "presentedCursor", "publicCursor"]) {
      assertNonNegativeInteger(sample[field], `cursor sample ${field}`);
    }
    if (!["running", "paused", "recovering", "settled"].includes(sample.phase)) throw new Error(`invalid cursor phase ${sample.phase}`);
    // Mechanic-story captures accept only the authoritative event prefix.  The
    // eventless recovery Chronicles are different: a checkpoint may advance
    // visible presentation state without accepting any mechanic event.  Their
    // exact presentation lineage is validated against the operational trace
    // below instead of comparing unlike cursor domains here.
    if (!operationalAuthority && sample.acceptedCursor > sample.authoritativeCursor) {
      throw new Error("acceptedCursor exceeds authoritativeCursor");
    }
    if (sample.presentedCursor > sample.acceptedCursor || sample.publicCursor > sample.presentedCursor) {
      throw new Error(`future presented truth at frame ${sample.frameIndex}`);
    }
    if (operationalAuthority) {
      assertNonblankString(sample.runId, `cursor sample ${index} runId`);
      assertNonblankString(sample.sourceKey, `cursor sample ${index} sourceKey`);
    }
    if (index > 0) {
      const previous = cursors.samples[index - 1];
      if (sample.frameIndex <= previous.frameIndex) throw new Error("cursor frameIndex must be strictly monotonic");
      const cursorReset = ["authoritativeCursor", "acceptedCursor", "presentedCursor", "publicCursor"]
        .some((field) => sample[field] < previous[field]);
      if (cursorReset && !isExactC14ReplacementCursorReset(
        identity.chronicleId,
        previous,
        sample,
        terminalAuthority,
        operationalWorkload,
      )) {
        throw new Error("cursor reset is forbidden outside exact C14 replacement lineage");
      }
    }
    return {
      frameIndex: sample.frameIndex,
      authoritativeCursor: sample.authoritativeCursor,
      acceptedCursor: sample.acceptedCursor,
      presentedCursor: sample.presentedCursor,
      publicCursor: sample.publicCursor,
      phase: sample.phase,
      ...(operationalAuthority ? { runId: sample.runId, sourceKey: sample.sourceKey } : {}),
    };
  });
  if (operationalAuthority) {
    validateOperationalCursorTrace(samples, operationalWorkload.trace);
  }
  const terminal = samples.at(-1);
  for (const field of ["authoritativeCursor", "acceptedCursor", "presentedCursor", "publicCursor"]) {
    if (terminal[field] !== expectedPresentationCursor) {
      throw new Error(`terminal ${field} must equal visible presentation cursor ${expectedPresentationCursor}`);
    }
  }
  if (operationalAuthority && (terminal.runId !== presentationTerminal.runId
    || terminal.sourceKey !== presentationTerminal.sourceKey)) {
    throw new Error("terminal cursor sample must retain visible presentation identity");
  }
  if (terminal.phase !== "settled") throw new Error("terminal cursor sample must be settled");

  if (!Array.isArray(cursors.gaps)) throw new Error("cursor gaps must be an array");
  const gaps = cursors.gaps.map((gap, index) => validateGap(gap, index, samples, expectedFinalCursor))
    .sort((left, right) => left.fromCursor - right.fromCursor);
  for (let index = 1; index < gaps.length; index += 1) {
    if (gaps[index].fromCursor <= gaps[index - 1].toCursor) throw new Error("overlapping cursor gaps");
  }
  if (["C13", "C16"].includes(identity.chronicleId) && gaps.length === 0) throw new Error(`${identity.chronicleId} requires explicit gap recovery evidence`);
  if (identity.chronicleId === "C16") {
    for (const cursor of C16_DENSITY_CURSORS) {
      if (!samples.some(({ authoritativeCursor }) => authoritativeCursor === cursor)) throw new Error(`C16 missing authoritative cursor sample ${cursor}`);
    }
  }
  return {
    ...identity,
    expectedFinalCursor,
    expectedPresentationCursor,
    samples,
    gaps,
    verdict: {
      authoritative: true,
      monotonic: true,
      exactReplacementLineage: identity.chronicleId === "C14" ? true : null,
      noFutureTruth: true,
      terminalSettled: true,
    },
  };
}

function validateOperationalCursorTrace(samples, trace) {
  const compact = (values) => values.filter((value, index) => (
    index === 0 || canonicalJson(value) !== canonicalJson(values[index - 1])
  ));
  const expected = trace.map((entry, index) => {
    assertObject(entry, `operational cursor trace ${index}`);
    assertObject(entry.selected, `operational cursor trace ${index} selected endpoint`);
    assertObject(entry.live, `operational cursor trace ${index} live endpoint`);
    assertNonblankString(entry.selected.runId, `operational cursor trace ${index} selected runId`);
    assertNonblankString(entry.selected.sourceKey, `operational cursor trace ${index} selected sourceKey`);
    assertNonNegativeInteger(entry.selected.cursor, `operational cursor trace ${index} selected cursor`);
    assertNonNegativeInteger(entry.live.cursor, `operational cursor trace ${index} live cursor`);
    if (typeof entry.completed !== "boolean") {
      throw new Error(`operational cursor trace ${index} completed must be boolean`);
    }
    return {
      runId: entry.selected.runId,
      sourceKey: entry.selected.sourceKey,
      authoritativeCursor: entry.live.cursor,
      acceptedCursor: entry.selected.cursor,
      presentedCursor: entry.selected.cursor,
      publicCursor: entry.selected.cursor,
      phase: entry.completed ? "settled" : "running",
    };
  });
  const observed = compact(samples.map((sample) => ({
    runId: sample.runId,
    sourceKey: sample.sourceKey,
    authoritativeCursor: sample.authoritativeCursor,
    acceptedCursor: sample.acceptedCursor,
    presentedCursor: sample.presentedCursor,
    publicCursor: sample.publicCursor,
    phase: sample.phase,
  })));
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    throw new Error("eventless cursor samples must retain the exact operational presentation lineage");
  }
}

function isExactC14ReplacementCursorReset(
  chronicleId,
  previous,
  sample,
  authority,
  operationalWorkload,
) {
  if (chronicleId !== "C14" || authority.presentation.kind !== "transport-recovery") return false;
  const replacement = authority.presentation.terminal;
  const oldRunId = authority.mechanic.runId;
  const labels = operationalWorkload.trace.map(({ label }) => label);
  return canonicalJson(labels) === canonicalJson([
    "old-live-0", "old-live-2", "old-live-3", "replacement-live-0", "stale-old-run-rejected",
  ])
    && previous.runId === oldRunId
    && previous.sourceKey === `live:${oldRunId}`
    && previous.authoritativeCursor === 3
    && previous.acceptedCursor === 3
    && previous.presentedCursor === 3
    && previous.publicCursor === 3
    && sample.runId === replacement.runId
    && sample.sourceKey === replacement.sourceKey
    && sample.authoritativeCursor === 0
    && sample.acceptedCursor === 0
    && sample.presentedCursor === 0
    && sample.publicCursor === 0;
}

function validateGap(gap, index, samples, expectedFinalCursor) {
  assertObject(gap, `cursor gap ${index}`);
  for (const field of ["fromCursor", "toCursor", "detectedFrameIndex", "visibleFrameIndex", "recoveredFrameIndex", "resumedFrameIndex"]) {
    assertNonNegativeInteger(gap[field], `cursor gap ${field}`);
  }
  if (gap.fromCursor < 1 || gap.toCursor < gap.fromCursor) throw new Error("cursor gap range is invalid");
  if (gap.toCursor > expectedFinalCursor) throw new Error("cursor gap exceeds expected final cursor");
  if (gap.detectedFrameIndex !== gap.visibleFrameIndex
    || gap.visibleFrameIndex >= gap.recoveredFrameIndex
    || gap.recoveredFrameIndex !== gap.resumedFrameIndex) {
    throw new Error("cursor gap frame order is invalid");
  }
  const at = (frame) => samples.find(({ frameIndex }) => frameIndex === frame);
  const detected = at(gap.detectedFrameIndex);
  const visible = at(gap.visibleFrameIndex);
  const recovered = at(gap.recoveredFrameIndex);
  const resumed = at(gap.resumedFrameIndex);
  if (!detected || detected.authoritativeCursor !== gap.toCursor) throw new Error("cursor gap detection frame is invalid");
  if (!visible
    || visible.authoritativeCursor !== gap.toCursor
    || visible.acceptedCursor !== gap.fromCursor - 1
    || visible.presentedCursor >= gap.fromCursor
    || !["paused", "recovering"].includes(visible.phase)) {
    throw new Error("cursor gap is not visibly lagged");
  }
  if (!recovered
    || recovered.authoritativeCursor !== gap.toCursor
    || recovered.acceptedCursor !== gap.toCursor
    || recovered.presentedCursor !== gap.toCursor
    || recovered.publicCursor !== gap.toCursor
    || ["paused", "recovering"].includes(recovered.phase)) {
    throw new Error("cursor gap recovery frame is invalid");
  }
  if (!resumed
    || resumed.authoritativeCursor !== gap.toCursor
    || resumed.publicCursor !== gap.toCursor
    || ["paused", "recovering"].includes(resumed.phase)) {
    throw new Error("cursor gap resume frame is invalid");
  }
  return { fromCursor: gap.fromCursor, toCursor: gap.toCursor, detectedFrameIndex: gap.detectedFrameIndex, visibleFrameIndex: gap.visibleFrameIndex, recoveredFrameIndex: gap.recoveredFrameIndex, resumedFrameIndex: gap.resumedFrameIndex };
}

function buildMotionEvidence(identity, motion, cursors, fixture) {
  assertObject(motion, `${identity.chronicleId} motion evidence`);
  if (!Array.isArray(motion.frames) || motion.frames.length === 0) throw new Error("motion frames must be nonempty");
  const frames = motion.frames.map((frame, index) => {
    assertObject(frame, `motion frame ${index}`);
    for (const field of ["frameIndex", "cursor", "activeEffects"]) assertNonNegativeInteger(frame[field], `motion ${field}`);
    assertHash(frame.placementHash, "motion placementHash");
    return { frameIndex: frame.frameIndex, cursor: frame.cursor, activeEffects: frame.activeEffects, placementHash: frame.placementHash };
  });
  const markerFrames = normalizeMotionMarkerFrames(motion.markerFrames);
  const checkpointWitnesses = validateCheckpointHoldEvidence(
    identity.chronicleId,
    motion.checkpointWitnesses,
    fixture,
    frames,
    EXPECTED_VIEWPORTS[identity.viewport],
  );
  const trajectory = validateTrajectory(motion.trajectorySamples, fixture, markerFrames);
  const homeOwnershipSegments = validateHomeOwnershipSegments(
    motion.homeOwnershipSegments,
    fixture,
    frames,
  );
  const transitionEvidence = validateRegionTransitionWitnesses(
    identity.chronicleId,
    motion.regionTransitionWitnesses,
    fixture,
    trajectory.samples,
    markerFrames,
    checkpointWitnesses.standard.witnesses,
  );
  if (!Array.isArray(motion.placementCheckpoints)) throw new Error("placementCheckpoints must be an array");
  const checkpoints = motion.placementCheckpoints.map((checkpoint) => normalizePlacementCheckpoint(checkpoint));
  if (identity.chronicleId === "C16") {
    if (!arraysEqual(checkpoints.map(({ cursor }) => cursor), C16_DENSITY_CURSORS)) throw new Error("C16 density checkpoints must be 1024,2048,3072,4096");
    for (const checkpoint of checkpoints) {
      const ids = Object.keys(checkpoint.placements);
      const actors = ids.filter((id) => id.startsWith("actor:"));
      const homes = ids.filter((id) => id.startsWith("home:"));
      if (actors.length !== 256 || homes.length !== 128 || ids.length !== 384) throw new Error(`C16 density at ${checkpoint.cursor} must contain 256 actors and 128 homes`);
      if (!arraysEqual([...ids].sort(codeUnitCompare), fixture.expectedPlacements)) throw new Error("C16 placement identities must match canonical fixture");
      if (!cursors.samples.some(({ authoritativeCursor }) => authoritativeCursor === checkpoint.cursor)) throw new Error(`C16 density cursor ${checkpoint.cursor} lacks authoritative truth`);
      const expectedHash = sha256Buffer(Buffer.from(canonicalJson(checkpoint.placements)));
      const frame = frames.find(({ cursor }) => cursor === checkpoint.cursor);
      if (!frame || frame.placementHash !== expectedHash) throw new Error(`placement frame hash mismatch at cursor ${checkpoint.cursor}`);
    }
    for (let index = 1; index < checkpoints.length; index += 1) {
      for (const [id, placement] of Object.entries(checkpoints[index - 1].placements)) {
        if (!(id in checkpoints[index].placements)) throw new Error(`C16 missing pre-existing placement ${id}`);
        if (checkpoints[index].placements[id] !== placement) throw new Error(`C16 unstable placement ${id}`);
      }
    }
  }
  return {
    ...identity,
    frames,
    trajectory: trajectory.samples,
    homeOwnershipSegments,
    fallbackRepositions: trajectory.fallbackRepositions,
    regionTransitions: transitionEvidence.witnesses,
    markerFrames,
    checkpointWitnesses,
    placementCheckpoints: checkpoints,
    verdict: {
      c16MaxDensity: identity.chronicleId === "C16" ? true : null,
      appendStable: identity.chronicleId === "C16" ? true : null,
      travelLegs: transitionEvidence.travelLegs,
      semanticClaims: {
        ...trajectory.semanticClaims,
        ...transitionEvidence.semanticClaims,
      },
    },
  };
}

function validateHomeOwnershipSegments(rawSegments, fixture, frames) {
  const authored = fixture.expectedPopulation.graphLifecycleOracle
    ?.homes?.visibilitySegments;
  if (!Array.isArray(rawSegments)) {
    throw new Error("home ownership segments must be an array");
  }
  if (authored === undefined && rawSegments.length === 0) return [];
  if (rawSegments.length === 0) {
    throw new Error(`${fixture.id} home visibility segment schedule is missing`);
  }
  const instanceOwners = new Map();
  const normalized = rawSegments.map((segment, segmentIndex) => {
    const label = `${fixture.id} home ownership segment ${segmentIndex}`;
    assertObject(segment, label);
    assertExactObjectKeys(
      segment,
      ["firstFrameIndex", "lastFrameIndex", "regionId", "homes"],
      label,
    );
    assertNonNegativeInteger(segment.firstFrameIndex, `${label} firstFrameIndex`);
    assertNonNegativeInteger(segment.lastFrameIndex, `${label} lastFrameIndex`);
    if (segment.lastFrameIndex < segment.firstFrameIndex) {
      throw new Error(`${label} frame range is inverted`);
    }
    if (segment.regionId !== null) assertNonblankString(segment.regionId, `${label} regionId`);
    if (!Array.isArray(segment.homes)) throw new Error(`${label} homes must be an array`);
    const homes = segment.homes.map((home, homeIndex) => {
      const homeLabel = `${label} home ${homeIndex}`;
      assertObject(home, homeLabel);
      assertExactObjectKeys(home, ["id", "instanceId"], homeLabel);
      assertNonblankString(home.id, `${homeLabel} id`);
      assertNonNegativeInteger(home.instanceId, `${homeLabel} instanceId`);
      if (home.instanceId === 0) throw new Error(`${homeLabel} instanceId must be positive`);
      const priorOwner = instanceOwners.get(home.instanceId);
      if (priorOwner !== undefined && priorOwner !== home.id) {
        throw new Error(`${fixture.id} home ownership instance changed durable identity`);
      }
      instanceOwners.set(home.instanceId, home.id);
      return { id: home.id, instanceId: home.instanceId };
    }).sort((left, right) => (
      codeUnitCompare(left.id, right.id) || left.instanceId - right.instanceId
    ));
    if (new Set(homes.map(({ id }) => id)).size !== homes.length
      || new Set(homes.map(({ instanceId }) => instanceId)).size !== homes.length) {
      throw new Error(`${label} contains duplicate homes or instances`);
    }
    return {
      firstFrameIndex: segment.firstFrameIndex,
      lastFrameIndex: segment.lastFrameIndex,
      regionId: segment.regionId,
      homes,
    };
  });
  if (authored === undefined) return normalized;
  if (normalized[0].firstFrameIndex !== frames[0].frameIndex
    || normalized.at(-1).lastFrameIndex !== frames.at(-1).frameIndex) {
    throw new Error(`${fixture.id} home ownership segments do not cover the motion frame range`);
  }
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].firstFrameIndex !== normalized[index - 1].lastFrameIndex + 1) {
      throw new Error(`${fixture.id} home ownership segments must be contiguous`);
    }
  }
  const observedSchedule = normalized.map(({ regionId, homes }) => ({
    regionId,
    homeIds: homes.map(({ id }) => id),
  }));
  if (canonicalJson(observedSchedule) !== canonicalJson(authored)) {
    throw new Error(`${fixture.id} home visibility segment schedule differs from authored truth`);
  }
  if (instanceOwners.size !== fixture.expectedPopulation.graphLifecycleOracle.homes.created) {
    throw new Error(`${fixture.id} home ownership instances differ from authored lifecycle`);
  }
  return normalized;
}

function normalizeMotionMarkerFrames(markerFrames) {
  assertObject(markerFrames, "motion markerFrames");
  const normalized = {};
  for (const marker of Object.keys(markerFrames).sort(codeUnitCompare)) {
    assertNonblankString(marker, "motion markerFrames key");
    assertNonNegativeInteger(markerFrames[marker], `motion marker frame ${marker}`);
    normalized[marker] = markerFrames[marker];
  }
  return normalized;
}

function validateCheckpointHoldEvidence(
  chronicleId,
  rawEvidence,
  fixture,
  frames,
  expectedViewport,
) {
  assertObject(rawEvidence, `${chronicleId} checkpoint hold evidence`);
  assertExactObjectKeys(
    rawEvidence,
    ["standard", "reduced"],
    `${chronicleId} checkpoint hold evidence`,
  );
  const frameByIndex = new Map(frames.map((frame) => [frame.frameIndex, frame]));
  if (frameByIndex.size !== frames.length) {
    throw new Error(`${chronicleId} motion frames must have unique frameIndex values`);
  }
  const normalized = {};
  for (const mode of ["standard", "reduced"]) {
    const evidence = rawEvidence[mode];
    assertObject(evidence, `${chronicleId} ${mode} checkpoint hold evidence`);
    assertExactObjectKeys(
      evidence,
      ["witnesses", "markerFrames"],
      `${chronicleId} ${mode} checkpoint hold evidence`,
    );
    const modeMarkerFrames = normalizeMotionMarkerFrames(evidence.markerFrames);
    normalized[mode] = {
      witnesses: validateCheckpointHoldWitnesses(
        chronicleId,
        mode,
        evidence.witnesses,
        fixture,
        modeMarkerFrames,
        mode === "standard" ? frameByIndex : null,
        expectedViewport,
      ),
      markerFrames: modeMarkerFrames,
    };
  }
  const standardSemantics = checkpointHoldModeSemantics(normalized.standard.witnesses);
  const reducedSemantics = checkpointHoldModeSemantics(normalized.reduced.witnesses);
  if (canonicalJson(standardSemantics) !== canonicalJson(reducedSemantics)) {
    throw new Error(`${chronicleId} checkpoint hold standard/reduced semantic parity failed`);
  }
  return normalized;
}

function validateCheckpointHoldWitnesses(
  chronicleId,
  mode,
  rawWitnesses,
  fixture,
  markerFrames,
  frameByIndex,
  expectedViewport,
) {
  const evidenceLabel = `${chronicleId} ${mode}`;
  if (!Array.isArray(rawWitnesses)) {
    throw new Error(`${evidenceLabel} checkpoint holds must be an array`);
  }
  const contract = CHECKPOINT_HOLD_CONTRACTS[chronicleId];
  if (contract === undefined) {
    if (rawWitnesses.length !== 0) {
      throw new Error(`${evidenceLabel} checkpoint holds must be empty`);
    }
    return [];
  }
  const expectedLines = Object.keys(contract.lines).map(Number);
  if (rawWitnesses.length !== expectedLines.length) {
    const missing = expectedLines.find((line) => (
      !rawWitnesses.some((witness) => witness?.line === line)
    ));
    throw new Error(
      `${evidenceLabel} requires checkpoint hold line ${String(missing ?? expectedLines.at(-1))}`,
    );
  }
  const normalized = expectedLines.map((line, index) => {
    const witness = rawWitnesses[index];
    if (witness?.line !== line) {
      throw new Error(`${evidenceLabel} checkpoint holds must appear in exact line order`);
    }
    const record = fixture.checkpoints?.find((candidate) => candidate?.line === line);
    if (record === undefined) {
      throw new Error(`${chronicleId} trusted fixture is missing checkpoint line ${line}`);
    }
    return normalizeCheckpointHoldWitness(
      chronicleId,
      mode,
      witness,
      record,
      contract.lines[line],
      contract.focusTargets[line],
      frameByIndex,
      expectedViewport,
    );
  });
  validateCheckpointHoldCausalOrder(chronicleId, mode, normalized, markerFrames);
  return normalized;
}

function normalizeCheckpointHoldWitness(
  chronicleId,
  mode,
  witness,
  record,
  correctionEntityIds,
  focusTargets,
  frameByIndex,
  expectedViewport,
) {
  const label = `${chronicleId} ${mode} checkpoint hold line ${record.line}`;
  assertObject(witness, label);
  assertExactObjectKeys(witness, [
    "line", "eventCursor", "worldTime", "correctionEntityIds", "durationMs",
    "firstFrameIndex", "lastFrameIndex", "firstPresentationTimeMs",
    "lastPresentationTimeMs", "firstElapsedMs", "lastElapsedMs", "sampleCount",
    "presentedCursor", "firstFrameIdentity", "lastFrameIdentity", "samples", "world",
  ], label);
  const checkpoint = record.checkpoint;
  assertObject(checkpoint, `${label} trusted checkpoint`);
  const snapshot = checkpoint.snapshot;
  assertObject(snapshot, `${label} trusted snapshot`);
  if (checkpoint.event_cursor !== snapshot.event_cursor
    || checkpoint.world_time !== snapshot.world_time
    || checkpoint.run_id !== snapshot.run_id) {
    throw new Error(`${label} trusted checkpoint identity is inconsistent`);
  }
  if (witness.line !== record.line) throw new Error(`${label} line mismatch`);
  if (witness.eventCursor !== checkpoint.event_cursor) {
    throw new Error(`${label} eventCursor differs from trusted checkpoint`);
  }
  if (witness.worldTime !== checkpoint.world_time) {
    throw new Error(`${label} worldTime differs from trusted checkpoint`);
  }
  const observedCorrections = orderedStrings(
    witness.correctionEntityIds,
    `${label} correctionEntityIds`,
  );
  if (!arraysEqual(observedCorrections, correctionEntityIds)) {
    throw new Error(`${label} correctionEntityIds differ from the production contract`);
  }
  const expectedDurationMs = focusTargets.length * CHECKPOINT_HOLD_DURATION_MS;
  const expectedSampleCount = focusTargets.length * Math.ceil(
    CHECKPOINT_HOLD_DURATION_MS / CHECKPOINT_SAMPLE_INTERVAL_MS,
  );
  if (witness.durationMs !== expectedDurationMs) {
    throw new Error(`${label} durationMs must equal ${expectedDurationMs}`);
  }

  for (const field of ["firstFrameIndex", "lastFrameIndex", "sampleCount", "presentedCursor"]) {
    assertNonNegativeInteger(witness[field], `${label} ${field}`);
  }
  for (const field of [
    "firstPresentationTimeMs", "lastPresentationTimeMs", "firstElapsedMs", "lastElapsedMs",
  ]) {
    assertFiniteNonNegativeNumber(witness[field], `${label} ${field}`);
  }
  const frameSpan = witness.lastFrameIndex - witness.firstFrameIndex;
  if (frameSpan < 0
    || witness.lastPresentationTimeMs < witness.firstPresentationTimeMs
    || witness.lastElapsedMs < witness.firstElapsedMs) {
    throw new Error(`${label} frame, time, and elapsed ranges must be monotonic`);
  }
  if (witness.sampleCount !== frameSpan + 1
    || witness.sampleCount !== expectedSampleCount) {
    throw new Error(`${label} lacks credible 30Hz sample coverage`);
  }
  const expectedObservedSpanMs = frameSpan * CHECKPOINT_SAMPLE_INTERVAL_MS;
  if (Math.abs(
    witness.lastPresentationTimeMs
      - witness.firstPresentationTimeMs
      - expectedObservedSpanMs,
  ) > CHECKPOINT_TIMING_TOLERANCE_MS
    || Math.abs(
      witness.lastElapsedMs - witness.firstElapsedMs - expectedObservedSpanMs,
  ) > CHECKPOINT_TIMING_TOLERANCE_MS
    || witness.firstElapsedMs > CHECKPOINT_SAMPLE_INTERVAL_MS
      + CHECKPOINT_TIMING_TOLERANCE_MS
    || witness.lastElapsedMs >= expectedDurationMs
    || expectedDurationMs - witness.lastElapsedMs
      > CHECKPOINT_SAMPLE_INTERVAL_MS + CHECKPOINT_TIMING_TOLERANCE_MS) {
    throw new Error(`${label} lacks credible 30Hz sample coverage`);
  }
  if (witness.presentedCursor !== checkpoint.event_cursor) {
    throw new Error(`${label} presentedCursor differs from trusted checkpoint`);
  }
  if (frameByIndex !== null) {
    for (
      let frameIndex = witness.firstFrameIndex;
      frameIndex <= witness.lastFrameIndex;
      frameIndex += 1
    ) {
      if (frameByIndex.get(frameIndex)?.cursor !== witness.presentedCursor) {
        throw new Error(`${label} frame range is not contiguously bound to the held cursor`);
      }
    }
  }

  const firstFrameIdentity = normalizeCheckpointFrameIdentity(
    witness.firstFrameIdentity,
    checkpoint,
    `${label} first`,
  );
  const lastFrameIdentity = normalizeCheckpointFrameIdentity(
    witness.lastFrameIdentity,
    checkpoint,
    `${label} last`,
  );
  assertCheckpointFrameLineageStable(
    firstFrameIdentity,
    lastFrameIdentity,
    label,
  );
  const world = normalizeCheckpointWorld(witness.world, snapshot, label);
  const samples = normalizeCheckpointHoldSamples(
    chronicleId,
    witness.samples,
    witness,
    snapshot,
    observedCorrections,
    focusTargets,
    expectedViewport,
    firstFrameIdentity,
    label,
  );
  return {
    line: witness.line,
    eventCursor: witness.eventCursor,
    worldTime: witness.worldTime,
    correctionEntityIds: observedCorrections,
    durationMs: witness.durationMs,
    firstFrameIndex: witness.firstFrameIndex,
    lastFrameIndex: witness.lastFrameIndex,
    firstPresentationTimeMs: witness.firstPresentationTimeMs,
    lastPresentationTimeMs: witness.lastPresentationTimeMs,
    firstElapsedMs: witness.firstElapsedMs,
    lastElapsedMs: witness.lastElapsedMs,
    sampleCount: witness.sampleCount,
    presentedCursor: witness.presentedCursor,
    firstFrameIdentity,
    lastFrameIdentity,
    samples,
    world,
  };
}

function normalizeCheckpointFrameIdentity(identity, checkpoint, label) {
  assertObject(identity, `${label} frame identity`);
  assertExactObjectKeys(
    identity,
    ["runId", "sourceKey", "firstCursor", "lastCursor", "revision"],
    `${label} frame identity`,
  );
  assertNonblankString(identity.runId, `${label} frame identity runId`);
  assertNonblankString(identity.sourceKey, `${label} frame identity sourceKey`);
  for (const field of ["firstCursor", "lastCursor", "revision"]) {
    assertNonNegativeInteger(identity[field], `${label} frame identity ${field}`);
  }
  if (identity.runId !== checkpoint.run_id
    || !identity.sourceKey.endsWith(`:${checkpoint.run_id}`)
    || identity.firstCursor > checkpoint.event_cursor
    || identity.lastCursor !== checkpoint.event_cursor) {
    throw new Error(`${label} frame identity is inconsistent with the checkpoint`);
  }
  return {
    runId: identity.runId,
    sourceKey: identity.sourceKey,
    firstCursor: identity.firstCursor,
    lastCursor: identity.lastCursor,
    revision: identity.revision,
  };
}

function assertCheckpointFrameLineageStable(expected, observed, label) {
  if (observed.runId !== expected.runId
    || observed.sourceKey !== expected.sourceKey
    || observed.firstCursor !== expected.firstCursor
    || observed.lastCursor !== expected.lastCursor) {
    throw new Error(`${label} frame lineage must remain stable`);
  }
}

function normalizeCheckpointWorld(world, snapshot, label) {
  assertObject(world, `${label} world`);
  assertExactObjectKeys(world, [
    "runId", "exactBaseCursor", "projectedThroughCursor", "worldTime",
    "agents", "homes", "regions", "ruins", "pendingProposals",
  ], `${label} world`);
  assertNonblankString(world.runId, `${label} world runId`);
  for (const field of ["exactBaseCursor", "projectedThroughCursor"]) {
    assertNonNegativeInteger(world[field], `${label} world ${field}`);
  }
  assertFiniteNonNegativeNumber(world.worldTime, `${label} world worldTime`);
  if (world.runId !== snapshot.run_id
    || world.exactBaseCursor !== snapshot.event_cursor
    || world.projectedThroughCursor !== snapshot.event_cursor
    || world.worldTime !== snapshot.world_time) {
    throw new Error(`${label} world identity differs from trusted snapshot`);
  }
  const fields = [
    ["agents", "agents"],
    ["homes", "homes"],
    ["regions", "regions"],
    ["ruins", "ruins"],
    ["pendingProposals", "pending_proposals"],
  ];
  const normalized = {};
  for (const [observedField, trustedField] of fields) {
    if (!Array.isArray(world[observedField]) || !Array.isArray(snapshot[trustedField])) {
      throw new Error(`${label} ${observedField} must be a complete exact array`);
    }
    const observed = normalizeCheckpointWorldArray(observedField, world[observedField]);
    const trusted = normalizeCheckpointWorldArray(observedField, snapshot[trustedField]);
    if (canonicalJson(observed) !== canonicalJson(trusted)) {
      throw new Error(`${label} ${observedField} differs from trusted snapshot`);
    }
    normalized[observedField] = observed;
  }
  return {
    runId: world.runId,
    exactBaseCursor: world.exactBaseCursor,
    projectedThroughCursor: world.projectedThroughCursor,
    worldTime: world.worldTime,
    ...normalized,
  };
}

function normalizeCheckpointWorldArray(field, values) {
  const identityField = field === "agents" ? "id"
    : field === "regions" ? "name"
      : ["homes", "ruins"].includes(field) ? "home_id" : null;
  const cloned = JSON.parse(canonicalJson(values));
  return cloned.sort((left, right) => identityField === null
    ? codeUnitCompare(canonicalJson(left), canonicalJson(right))
    : codeUnitCompare(String(left?.[identityField]), String(right?.[identityField])));
}

function normalizeCheckpointHoldSamples(
  chronicleId,
  rawSamples,
  witness,
  snapshot,
  correctionEntityIds,
  focusTargets,
  expectedViewport,
  lineFrameIdentity,
  label,
) {
  if (!Array.isArray(rawSamples) || rawSamples.length !== witness.sampleCount) {
    throw new Error(`${label} samples must exactly equal sampleCount`);
  }
  const samplesPerSegment = Math.ceil(
    CHECKPOINT_HOLD_DURATION_MS / CHECKPOINT_SAMPLE_INTERVAL_MS,
  );
  const trustedStructures = [
    ...snapshot.homes.map((home) => ({ home, kind: "home" })),
    ...snapshot.ruins.map((home) => ({ home, kind: "ruin" })),
  ];
  const instanceByHome = new Map();
  const identityBySegment = new Map();
  const publicationBySegment = new Map();
  const normalized = rawSamples.map((sample, index) => {
    const sampleLabel = `${label} sample ${index}`;
    assertObject(sample, sampleLabel);
    assertExactObjectKeys(sample, [
      "frameIndex", "presentationTimeMs", "elapsedMs", "remainingMs",
      "presentedCursor", "frameIdentity", "publicationSerial", "activeRegionId",
      "focusTarget", "viewport", "camera", "safeFrame", "homes",
    ], sampleLabel);
    for (const field of ["frameIndex", "presentedCursor"]) {
      assertNonNegativeInteger(sample[field], `${sampleLabel} ${field}`);
    }
    for (const field of ["presentationTimeMs", "elapsedMs", "remainingMs"]) {
      assertFiniteNonNegativeNumber(sample[field], `${sampleLabel} ${field}`);
    }
    if (sample.frameIndex !== witness.firstFrameIndex + index
      || sample.presentedCursor !== witness.eventCursor) {
      throw new Error(`${sampleLabel} frame and presented cursor must be contiguous`);
    }
    const expectedPresentationTimeMs = witness.firstPresentationTimeMs
      + index * CHECKPOINT_SAMPLE_INTERVAL_MS;
    const expectedElapsedMs = witness.firstElapsedMs
      + index * CHECKPOINT_SAMPLE_INTERVAL_MS;
    if (Math.abs(sample.presentationTimeMs - expectedPresentationTimeMs)
        > CHECKPOINT_TIMING_TOLERANCE_MS
      || Math.abs(sample.elapsedMs - expectedElapsedMs)
        > CHECKPOINT_TIMING_TOLERANCE_MS
      || Math.abs(sample.elapsedMs + sample.remainingMs - witness.durationMs)
        > CHECKPOINT_TIMING_TOLERANCE_MS) {
      throw new Error(`${label} sample elapsed and remaining must be complementary and monotonic`);
    }
    if (index > 0) {
      const previous = rawSamples[index - 1];
      if (Math.abs(
        sample.presentationTimeMs - previous.presentationTimeMs
          - CHECKPOINT_SAMPLE_INTERVAL_MS,
      ) > CHECKPOINT_TIMING_TOLERANCE_MS
        || Math.abs(
          sample.elapsedMs - previous.elapsedMs - CHECKPOINT_SAMPLE_INTERVAL_MS,
        ) > CHECKPOINT_TIMING_TOLERANCE_MS
        || Math.abs(
          previous.remainingMs - sample.remainingMs - CHECKPOINT_SAMPLE_INTERVAL_MS,
        ) > CHECKPOINT_TIMING_TOLERANCE_MS) {
        throw new Error(`${label} sample elapsed and remaining must be complementary and monotonic`);
      }
    }
    const expectedSegmentIndex = Math.floor(index / samplesPerSegment);
    const expectedSegmentSampleIndex = index % samplesPerSegment;
    const expectedTarget = focusTargets[expectedSegmentIndex];
    const frameIdentity = normalizeCheckpointFrameIdentity(
      sample.frameIdentity,
      { run_id: snapshot.run_id, event_cursor: witness.eventCursor },
      `${sampleLabel}`,
    );
    assertCheckpointFrameLineageStable(lineFrameIdentity, frameIdentity, label);
    assertNonNegativeInteger(sample.publicationSerial, `${sampleLabel} publicationSerial`);
    if (sample.publicationSerial === 0) {
      throw new Error(`${sampleLabel} publicationSerial must be positive`);
    }
    const segmentIdentity = identityBySegment.get(expectedSegmentIndex);
    const segmentPublication = publicationBySegment.get(expectedSegmentIndex);
    if (segmentIdentity === undefined) {
      const previousIdentity = identityBySegment.get(expectedSegmentIndex - 1);
      const previousPublication = publicationBySegment.get(expectedSegmentIndex - 1);
      if (expectedSegmentIndex > 0
        && (frameIdentity.revision !== previousIdentity.revision + 1
          || sample.publicationSerial !== previousPublication + 1)) {
        throw new Error(
          `${label} boundary ${expectedSegmentIndex} must publish exactly one new revision and publication`,
        );
      }
      identityBySegment.set(expectedSegmentIndex, frameIdentity);
      publicationBySegment.set(expectedSegmentIndex, sample.publicationSerial);
    } else if (frameIdentity.revision !== segmentIdentity.revision
      || sample.publicationSerial !== segmentPublication) {
      throw new Error(
        `${label} segment ${expectedSegmentIndex} revision and publication must remain stable`,
      );
    }
    const focusTarget = normalizeCheckpointFocusTarget(
      sample.focusTarget,
      expectedTarget,
      expectedSegmentIndex,
      focusTargets.length,
      expectedSegmentSampleIndex,
      witness.firstElapsedMs,
      `${label} focus target ${expectedSegmentIndex}`,
    );
    if (sample.activeRegionId !== focusTarget.regionId) {
      throw new Error(`${sampleLabel} active region must be ${focusTarget.regionId}`);
    }
    const viewport = normalizeCheckpointViewport(sample.viewport, expectedViewport, sampleLabel);
    const camera = normalizeCheckpointCamera(sample.camera, sampleLabel);
    const safeFrame = normalizeCheckpointSafeFrame(sample.safeFrame, viewport, sampleLabel);
    const trustedVisible = trustedStructures
      .filter(({ home }) => home.region === focusTarget.regionId)
      .sort((left, right) => codeUnitCompare(left.home.home_id, right.home.home_id));
    if (!Array.isArray(sample.homes)) {
      throw new Error(`${sampleLabel} homes must be an array`);
    }
    const homes = sample.homes
      .map((home) => normalizeCheckpointRenderedHome(
        home,
        viewport,
        camera,
        safeFrame,
        sampleLabel,
      ))
      .sort((left, right) => codeUnitCompare(left.id, right.id));
    if (!arraysEqual(
      homes.map(({ id }) => id),
      trustedVisible.map(({ home }) => home.home_id),
    )) {
      throw new Error(`${label} renderer home partition differs from trusted checkpoint`);
    }
    for (const [homeIndex, rendered] of homes.entries()) {
      const trusted = trustedVisible[homeIndex];
      validateCheckpointRenderedHome(rendered, trusted, label);
      const priorInstance = instanceByHome.get(rendered.id);
      if (priorInstance !== undefined && priorInstance !== rendered.instanceId) {
        throw new Error(`${label} rendered ${rendered.id} changed instance during the hold`);
      }
      instanceByHome.set(rendered.id, rendered.instanceId);
    }
    if (focusTarget.kind === "region") {
      if (focusTarget.entityId !== null) {
        throw new Error(
          `${label} focus target ${expectedSegmentIndex} region entityId must be null`,
        );
      }
      if (focusTarget.removed && homes.length !== 0) {
        throw new Error(
          `${label} focus target ${expectedSegmentIndex} must continuously prove the removed region sweep`,
        );
      }
      if (!focusTarget.removed && chronicleId === "C07" && witness.line === 3
        && homes.length === 0) {
        throw new Error(
          `${label} focus target ${expectedSegmentIndex} must retain the trusted visible home partition`,
        );
      }
    } else {
      const renderedTarget = homes.find(({ id }) => id === focusTarget.entityId);
      if (renderedTarget === undefined
        || renderedTarget.kind !== focusTarget.kind
        || !correctionEntityIds.includes(renderedTarget.id)
        || !renderedTarget.screenVisible
        || !renderedTarget.safeFrameVisible) {
        throw new Error(
          `${label} continuous focus target ${String(focusTarget.entityId)} must be readable for all ${samplesPerSegment} samples`,
        );
      }
    }
    return {
      frameIndex: sample.frameIndex,
      presentationTimeMs: sample.presentationTimeMs,
      elapsedMs: sample.elapsedMs,
      remainingMs: sample.remainingMs,
      presentedCursor: sample.presentedCursor,
      frameIdentity,
      publicationSerial: sample.publicationSerial,
      activeRegionId: sample.activeRegionId,
      focusTarget,
      viewport,
      camera,
      safeFrame,
      homes,
    };
  });
  const first = normalized[0];
  const last = normalized.at(-1);
  if (first.frameIndex !== witness.firstFrameIndex
    || last.frameIndex !== witness.lastFrameIndex
    || Math.abs(first.presentationTimeMs - witness.firstPresentationTimeMs)
      > CHECKPOINT_TIMING_TOLERANCE_MS
    || Math.abs(last.presentationTimeMs - witness.lastPresentationTimeMs)
      > CHECKPOINT_TIMING_TOLERANCE_MS
    || Math.abs(first.elapsedMs - witness.firstElapsedMs) > CHECKPOINT_TIMING_TOLERANCE_MS
    || Math.abs(last.elapsedMs - witness.lastElapsedMs) > CHECKPOINT_TIMING_TOLERANCE_MS
    || canonicalJson(first.frameIdentity) !== canonicalJson(witness.firstFrameIdentity)
    || canonicalJson(last.frameIdentity) !== canonicalJson(witness.lastFrameIdentity)) {
    throw new Error(`${label} samples do not bind aggregate endpoints`);
  }
  for (const [segmentIndex, target] of focusTargets.entries()) {
    const segment = normalized.filter((sample) => (
      sample.focusTarget.segmentIndex === segmentIndex
    ));
    if (segment.length !== samplesPerSegment) {
      throw new Error(
        `${label} focus segment ${segmentIndex} must contain exactly ${samplesPerSegment} samples`,
      );
    }
    if (target.kind !== "region" && segment.some(({ homes }) => {
      const rendered = homes.find(({ id }) => id === target.entityId);
      return rendered === undefined || !rendered.screenVisible || !rendered.safeFrameVisible;
    })) {
      throw new Error(
        `${label} continuous focus target ${String(target.entityId)} must be readable for all ${samplesPerSegment} samples`,
      );
    }
  }
  return normalized;
}

function normalizeCheckpointFocusTarget(
  focusTarget,
  expected,
  segmentIndex,
  segmentCount,
  segmentSampleIndex,
  segmentPhaseOffsetMs,
  label,
) {
  assertObject(focusTarget, label);
  assertExactObjectKeys(focusTarget, [
    "regionId", "kind", "entityId", "removed", "segmentIndex", "segmentCount",
    "segmentDurationMs", "segmentElapsedMs", "segmentRemainingMs",
  ], label);
  assertNonblankString(focusTarget.regionId, `${label} regionId`);
  if (!["home", "ruin", "region"].includes(focusTarget.kind)) {
    throw new Error(`${label} kind is invalid`);
  }
  if (focusTarget.entityId !== null) {
    assertNonblankString(focusTarget.entityId, `${label} entityId`);
  }
  if (typeof focusTarget.removed !== "boolean") {
    throw new Error(`${label} removed must be boolean`);
  }
  for (const field of ["segmentIndex", "segmentCount"]) {
    assertNonNegativeInteger(focusTarget[field], `${label} ${field}`);
  }
  for (const field of ["segmentDurationMs", "segmentElapsedMs", "segmentRemainingMs"]) {
    assertFiniteNonNegativeNumber(focusTarget[field], `${label} ${field}`);
  }
  const expectedTarget = {
    ...expected,
    segmentIndex,
    segmentCount,
  };
  const observedTarget = {
    regionId: focusTarget.regionId,
    kind: focusTarget.kind,
    entityId: focusTarget.entityId,
    removed: focusTarget.removed,
    segmentIndex: focusTarget.segmentIndex,
    segmentCount: focusTarget.segmentCount,
  };
  if (canonicalJson(observedTarget) !== canonicalJson(expectedTarget)) {
    throw new Error(
      `${label} must be ${String(expected.kind)} ${String(expected.entityId)} in ${expected.regionId}`,
    );
  }
  const expectedSegmentElapsedMs = segmentPhaseOffsetMs
    + segmentSampleIndex * CHECKPOINT_SAMPLE_INTERVAL_MS;
  if (focusTarget.segmentDurationMs !== CHECKPOINT_HOLD_DURATION_MS
    || Math.abs(focusTarget.segmentElapsedMs - expectedSegmentElapsedMs)
      > CHECKPOINT_TIMING_TOLERANCE_MS
    || Math.abs(
      focusTarget.segmentElapsedMs + focusTarget.segmentRemainingMs
        - CHECKPOINT_HOLD_DURATION_MS,
    ) > CHECKPOINT_TIMING_TOLERANCE_MS
    || focusTarget.segmentElapsedMs >= CHECKPOINT_HOLD_DURATION_MS) {
    throw new Error(`${label} must provide complete 800ms segment timing`);
  }
  return {
    ...observedTarget,
    segmentDurationMs: focusTarget.segmentDurationMs,
    segmentElapsedMs: focusTarget.segmentElapsedMs,
    segmentRemainingMs: focusTarget.segmentRemainingMs,
  };
}

function normalizeCheckpointViewport(viewport, expectedViewport, label) {
  const normalized = normalizeFiniteFields(
    viewport,
    ["width", "height"],
    `${label} viewport`,
  );
  if (normalized.width <= 0 || normalized.height <= 0
    || canonicalJson(normalized) !== canonicalJson(expectedViewport)) {
    throw new Error(`${label} viewport differs from capture viewport geometry`);
  }
  return normalized;
}

function normalizeCheckpointCamera(camera, label) {
  assertObject(camera, `${label} camera`);
  assertExactObjectKeys(camera, ["zoom", "rasterOrigin"], `${label} camera`);
  assertFiniteNonNegativeNumber(camera.zoom, `${label} camera zoom`);
  if (camera.zoom <= 0) throw new Error(`${label} camera zoom must be positive`);
  return {
    zoom: camera.zoom,
    rasterOrigin: normalizeFiniteFields(
      camera.rasterOrigin,
      ["x", "y"],
      `${label} camera rasterOrigin`,
    ),
  };
}

function normalizeCheckpointSafeFrame(safeFrame, viewport, label) {
  const normalized = normalizeFiniteFields(
    safeFrame,
    ["x", "y", "width", "height"],
    `${label} safeFrame`,
  );
  if (normalized.x < 0 || normalized.y < 0
    || normalized.width <= 0 || normalized.height <= 0
    || normalized.x + normalized.width > viewport.width
    || normalized.y + normalized.height > viewport.height) {
    throw new Error(`${label} safeFrame must be contained by viewport geometry`);
  }
  return normalized;
}

function normalizeCheckpointRenderedHome(home, viewport, camera, safeFrame, label) {
  assertObject(home, `${label} rendered home`);
  assertExactObjectKeys(home, [
    "id", "instanceId", "kind", "status", "plot", "durable", "diagnostics",
    "geometry", "visual", "screenBounds", "screenVisible", "safeFrameVisible",
  ], `${label} rendered home`);
  assertNonblankString(home.id, `${label} rendered home id`);
  assertNonNegativeInteger(home.instanceId, `${label} rendered ${home.id} instanceId`);
  if (home.instanceId === 0) throw new Error(`${label} rendered ${home.id} instanceId must be positive`);
  if (!["home", "ruin"].includes(home.kind)) {
    throw new Error(`${label} rendered ${home.id} kind is invalid`);
  }
  if (!["standing", "ruin", "unknown"].includes(home.status)) {
    throw new Error(`${label} rendered ${home.id} status is invalid`);
  }
  const plot = normalizeFiniteFields(home.plot, ["x", "y"], `${label} rendered ${home.id} plot`);
  assertObject(home.durable, `${label} rendered ${home.id} durable`);
  assertExactObjectKeys(
    home.durable,
    ["status", "integrityRatio", "remnantMaterials"],
    `${label} rendered ${home.id} durable`,
  );
  if (!["standing", "ruin", "unknown"].includes(home.durable.status)) {
    throw new Error(`${label} rendered ${home.id} durable status is invalid`);
  }
  const integrityRatio = normalizeNullableFiniteNumber(
    home.durable.integrityRatio,
    `${label} rendered ${home.id} integrityRatio`,
  );
  if (integrityRatio !== null && (integrityRatio < 0 || integrityRatio > 1)) {
    throw new Error(`${label} rendered ${home.id} integrityRatio must be clamped`);
  }
  const remnantMaterials = normalizeNullableFiniteNumber(
    home.durable.remnantMaterials,
    `${label} rendered ${home.id} remnantMaterials`,
  );
  assertObject(home.diagnostics, `${label} rendered ${home.id} diagnostics`);
  assertExactObjectKeys(
    home.diagnostics,
    ["rawIntegrity", "rawMaxIntegrity", "integrityClamped"],
    `${label} rendered ${home.id} diagnostics`,
  );
  const rawIntegrity = normalizeNullableFiniteNumber(
    home.diagnostics.rawIntegrity,
    `${label} rendered ${home.id} rawIntegrity`,
  );
  const rawMaxIntegrity = normalizeNullableFiniteNumber(
    home.diagnostics.rawMaxIntegrity,
    `${label} rendered ${home.id} rawMaxIntegrity`,
  );
  if (typeof home.diagnostics.integrityClamped !== "boolean") {
    throw new Error(`${label} rendered ${home.id} integrityClamped must be boolean`);
  }
  assertObject(home.geometry, `${label} rendered ${home.id} geometry`);
  assertExactObjectKeys(
    home.geometry,
    ["logicalBounds", "worldBounds"],
    `${label} rendered ${home.id} geometry`,
  );
  const logicalBounds = normalizeFiniteFields(
    home.geometry.logicalBounds,
    ["width", "height"],
    `${label} rendered ${home.id} logicalBounds`,
  );
  if (logicalBounds.width <= 0 || logicalBounds.height <= 0) {
    throw new Error(`${label} rendered ${home.id} logical bounds must be positive`);
  }
  const worldBounds = normalizeFiniteFields(
    home.geometry.worldBounds,
    ["x", "y", "width", "height"],
    `${label} rendered ${home.id} worldBounds`,
  );
  if (worldBounds.width <= 0 || worldBounds.height <= 0
    || Math.abs(worldBounds.x - plot.x) > CHECKPOINT_TIMING_TOLERANCE_MS
    || Math.abs(worldBounds.y - plot.y) > CHECKPOINT_TIMING_TOLERANCE_MS
    || Math.abs(worldBounds.width - logicalBounds.width) > CHECKPOINT_TIMING_TOLERANCE_MS
    || Math.abs(worldBounds.height - logicalBounds.height) > CHECKPOINT_TIMING_TOLERANCE_MS) {
    throw new Error(`${label} rendered ${home.id} worldBounds differ from structure geometry`);
  }
  assertObject(home.visual, `${label} rendered ${home.id} visual`);
  assertExactObjectKeys(
    home.visual,
    ["backComponents", "frontComponents", "ruinFrameId"],
    `${label} rendered ${home.id} visual`,
  );
  const backComponents = orderedStrings(home.visual.backComponents, `${label} rendered ${home.id} backComponents`);
  const frontComponents = orderedStrings(home.visual.frontComponents, `${label} rendered ${home.id} frontComponents`);
  if (home.visual.ruinFrameId !== null) {
    assertNonblankString(home.visual.ruinFrameId, `${label} rendered ${home.id} ruinFrameId`);
  }
  const screenBounds = normalizeFiniteFields(
    home.screenBounds,
    ["x", "y", "width", "height"],
    `${label} rendered ${home.id} screenBounds`,
  );
  if (screenBounds.width <= 0 || screenBounds.height <= 0) {
    throw new Error(`${label} rendered ${home.id} screen bounds must be positive`);
  }
  for (const field of ["screenVisible", "safeFrameVisible"]) {
    if (typeof home[field] !== "boolean") {
      throw new Error(`${label} rendered ${home.id} ${field} must be boolean`);
    }
  }
  const expectedScreenBounds = {
    x: worldBounds.x * camera.zoom + camera.rasterOrigin.x,
    y: worldBounds.y * camera.zoom + camera.rasterOrigin.y,
    width: worldBounds.width * camera.zoom,
    height: worldBounds.height * camera.zoom,
  };
  if (Object.keys(expectedScreenBounds).some((field) => (
    Math.abs(screenBounds[field] - expectedScreenBounds[field])
      > CHECKPOINT_TIMING_TOLERANCE_MS
  ))) {
    throw new Error(`${label} rendered ${home.id} screenBounds differ from camera geometry`);
  }
  const expectedScreenVisible = screenBounds.x < viewport.width
    && screenBounds.x + screenBounds.width > 0
    && screenBounds.y < viewport.height
    && screenBounds.y + screenBounds.height > 0;
  if (home.screenVisible !== expectedScreenVisible) {
    throw new Error(`${label} rendered ${home.id} screenVisible differs from geometry`);
  }
  const expectedSafeFrameVisible = screenBounds.x >= safeFrame.x
    && screenBounds.y >= safeFrame.y
    && screenBounds.x + screenBounds.width <= safeFrame.x + safeFrame.width
    && screenBounds.y + screenBounds.height <= safeFrame.y + safeFrame.height;
  if (home.safeFrameVisible !== expectedSafeFrameVisible) {
    throw new Error(`${label} rendered ${home.id} safeFrameVisible differs from geometry`);
  }
  return {
    id: home.id,
    instanceId: home.instanceId,
    kind: home.kind,
    status: home.status,
    plot,
    durable: { status: home.durable.status, integrityRatio, remnantMaterials },
    diagnostics: {
      rawIntegrity,
      rawMaxIntegrity,
      integrityClamped: home.diagnostics.integrityClamped,
    },
    geometry: { logicalBounds, worldBounds },
    visual: {
      backComponents,
      frontComponents,
      ruinFrameId: home.visual.ruinFrameId,
    },
    screenBounds,
    screenVisible: home.screenVisible,
    safeFrameVisible: home.safeFrameVisible,
  };
}

function validateCheckpointRenderedHome(rendered, trusted, label) {
  const home = trusted.home;
  const rawRatio = home.max_integrity > 0 ? home.integrity / home.max_integrity : null;
  const expectedRatio = rawRatio === null ? null : Math.max(0, Math.min(1, rawRatio));
  const expected = {
    kind: trusted.kind,
    status: home.status,
    durableStatus: home.status,
    integrityRatio: expectedRatio,
    remnantMaterials: home.remnant_materials,
    rawIntegrity: home.integrity,
    rawMaxIntegrity: home.max_integrity,
    integrityClamped: rawRatio !== null && rawRatio !== expectedRatio,
  };
  const observed = {
    kind: rendered.kind,
    status: rendered.status,
    durableStatus: rendered.durable.status,
    integrityRatio: rendered.durable.integrityRatio,
    remnantMaterials: rendered.durable.remnantMaterials,
    rawIntegrity: rendered.diagnostics.rawIntegrity,
    rawMaxIntegrity: rendered.diagnostics.rawMaxIntegrity,
    integrityClamped: rendered.diagnostics.integrityClamped,
  };
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    throw new Error(`${label} rendered ${home.home_id} differs from trusted checkpoint`);
  }
  if (trusted.kind === "ruin") {
    if (rendered.visual.ruinFrameId === null) {
      throw new Error(`${label} rendered ${home.home_id} lacks ruin visuals`);
    }
  } else if (rendered.visual.backComponents.length + rendered.visual.frontComponents.length === 0) {
    throw new Error(`${label} rendered ${home.home_id} lacks shelter visuals`);
  }
}

function normalizeFiniteFields(value, fields, label) {
  assertObject(value, label);
  assertExactObjectKeys(value, fields, label);
  const normalized = {};
  for (const field of fields) {
    if (!Number.isFinite(value[field])) throw new Error(`${label} ${field} must be finite`);
    normalized[field] = value[field];
  }
  return normalized;
}

function normalizeNullableFiniteNumber(value, label) {
  if (value === null) return null;
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite or null`);
  return value;
}

function validateCheckpointHoldCausalOrder(chronicleId, mode, witnesses, markerFrames) {
  const label = `${chronicleId} ${mode}`;
  const [line1, line2, line3] = witnesses;
  if (line1.lastFrameIndex >= line2.firstFrameIndex) {
    throw new Error(`${label} checkpoint hold causal order is invalid`);
  }
  if (chronicleId === "C06") {
    const hearth = markerFrames["event:hearth_used"];
    const hoarding = markerFrames["event:home_started_hoarding"];
    const terminal = markerFrames["checkpoint:final"];
    if (![hearth, hoarding, terminal].every(Number.isSafeInteger)
      || hearth >= line1.firstFrameIndex
      || line2.lastFrameIndex >= hoarding
      || hoarding > terminal) {
      throw new Error(
        `${label} checkpoint hold causal order must be event:hearth_used < line1 `
        + "< line2 < event:home_started_hoarding <= checkpoint:final",
      );
    }
    return;
  }
  if (chronicleId === "C07") {
    const breached = markerFrames["event:home_breached"];
    const thieved = markerFrames["event:home_thieved"];
    const terminal = markerFrames["checkpoint:final"];
    if (![breached, thieved, terminal].every(Number.isSafeInteger)
      || line2.lastFrameIndex >= breached
      || breached > thieved
      || thieved >= line3.firstFrameIndex
      || terminal <= line3.lastFrameIndex) {
      throw new Error(
        `${label} checkpoint hold causal order must be line1 < line2 `
        + "< event:home_breached <= event:home_thieved < line3.first "
        + "<= line3.last < checkpoint:final",
      );
    }
    return;
  }
  const collapsedFirst = markerFrames["event:home_collapsed@cursor:1"];
  const collapsedSecond = markerFrames["event:home_collapsed@cursor:2"];
  const left = markerFrames["event:agent_left_region"];
  const scavengedFirst = markerFrames["event:ruins_scavenged@cursor:5"];
  const scavengedSecond = markerFrames["event:ruins_scavenged@cursor:6"];
  const terminal = markerFrames["checkpoint:final"];
  if (![collapsedFirst, collapsedSecond, left, scavengedFirst, scavengedSecond, terminal].every(Number.isSafeInteger)
    || collapsedFirst >= collapsedSecond
    || collapsedSecond >= line1.firstFrameIndex
    || line1.lastFrameIndex >= left
    || scavengedFirst >= scavengedSecond
    || scavengedSecond >= line2.firstFrameIndex
    || terminal <= line2.lastFrameIndex) {
    throw new Error(
      `${label} checkpoint hold causal order must be home_collapsed cursors 1 <= 2 < line1 `
      + "< event:agent_left_region and ruins_scavenged cursors 5 <= 6 < line2.first "
      + "<= line2.last < checkpoint:final",
    );
  }
}

function checkpointHoldModeSemantics(witnesses) {
  return witnesses.map((witness) => {
    const {
      firstFrameIndex: _firstFrameIndex,
      lastFrameIndex: _lastFrameIndex,
      firstPresentationTimeMs: _firstPresentationTimeMs,
      lastPresentationTimeMs: _lastPresentationTimeMs,
      firstElapsedMs: phaseOffsetMs,
      lastElapsedMs,
      firstFrameIdentity,
      lastFrameIdentity,
      samples,
      ...semantic
    } = witness;
    const { revision: _firstRevision, ...semanticFirstIdentity } = firstFrameIdentity;
    const { revision: _lastRevision, ...semanticLastIdentity } = lastFrameIdentity;
    return {
      ...semantic,
      firstElapsedMs: 0,
      lastElapsedMs: checkpointParityTiming(lastElapsedMs - phaseOffsetMs),
      firstFrameIdentity: semanticFirstIdentity,
      lastFrameIdentity: semanticLastIdentity,
      samples: samples.map((sample) => {
        const {
          frameIndex: _frameIndex,
          presentationTimeMs: _presentationTimeMs,
          viewport: _viewport,
          camera: _camera,
          safeFrame: _safeFrame,
          frameIdentity,
          publicationSerial: _publicationSerial,
          elapsedMs,
          remainingMs,
          focusTarget,
          homes,
          ...sampleSemantics
        } = sample;
        const { revision: _sampleRevision, ...semanticSampleIdentity } = frameIdentity;
        return {
          ...sampleSemantics,
          elapsedMs: checkpointParityTiming(elapsedMs - phaseOffsetMs),
          remainingMs: checkpointParityTiming(remainingMs + phaseOffsetMs),
          focusTarget: {
            ...focusTarget,
            segmentElapsedMs: checkpointParityTiming(
              focusTarget.segmentElapsedMs - phaseOffsetMs,
            ),
            segmentRemainingMs: checkpointParityTiming(
              focusTarget.segmentRemainingMs + phaseOffsetMs,
            ),
          },
          frameIdentity: semanticSampleIdentity,
          homes: homes.map((home) => {
            const {
              instanceId: _instanceId,
              plot: _plot,
              screenBounds: _screenBounds,
              screenVisible: _screenVisible,
              safeFrameVisible: _safeFrameVisible,
              geometry,
              ...homeSemantics
            } = home;
            const { worldBounds: _worldBounds, ...geometrySemantics } = geometry;
            return { ...homeSemantics, geometry: geometrySemantics };
          }),
        };
      }),
    };
  });
}

function checkpointParityTiming(value) {
  return Number(value.toFixed(9));
}

function trustedTravelLegs(fixture) {
  const events = (fixture.entries ?? []).filter(({ event }) => (
    event?.type === "agent_left_region" || event?.type === "agent_entered_region"
  ));
  if (events.length === 0) return { legs: [], topology: null };
  if (events.length % 2 !== 0) throw new Error("trusted travel events must form left/entered pairs");
  const topology = trustedRegionTopology(fixture);
  const legs = [];
  for (let index = 0; index < events.length; index += 2) {
    const left = events[index];
    const entered = events[index + 1];
    if (left.event.type !== "agent_left_region" || entered.event.type !== "agent_entered_region") {
      throw new Error("trusted travel events must preserve left/entered order");
    }
    const leftPayload = left.event.payload;
    const enteredPayload = entered.event.payload;
    for (const [label, payload] of [["left", leftPayload], ["entered", enteredPayload]]) {
      assertObject(payload, `trusted travel ${label} payload`);
      for (const field of ["agent_id", "from_region", "to_region"]) {
        assertNonblankString(payload[field], `trusted travel ${label} ${field}`);
      }
    }
    assertNonNegativeInteger(left.cursor, "trusted travel left cursor");
    assertNonNegativeInteger(entered.cursor, "trusted travel entered cursor");
    if (left.cursor >= entered.cursor
      || leftPayload.agent_id !== enteredPayload.agent_id
      || leftPayload.from_region !== enteredPayload.from_region
      || leftPayload.to_region !== enteredPayload.to_region) {
      throw new Error("trusted travel left/entered pair is incoherent");
    }
    if (!topology.connections.get(leftPayload.from_region)?.has(leftPayload.to_region)) {
      throw new Error(`trusted travel edge ${leftPayload.from_region} -> ${leftPayload.to_region} is not authorized by topology`);
    }
    legs.push({
      actorId: leftPayload.agent_id,
      fromRegion: leftPayload.from_region,
      toRegion: leftPayload.to_region,
      leftCursor: left.cursor,
      enteredCursor: entered.cursor,
    });
  }
  return { legs, topology };
}

function trustedRegionTopology(fixture) {
  const regions = fixture.expectedTerminal?.finalSnapshot?.regions ?? fixture.initialSnapshot?.regions;
  if (!Array.isArray(regions) || regions.length === 0) {
    throw new Error(`${fixture.id} trusted fixture lacks travel topology`);
  }
  const connections = new Map();
  for (const [index, region] of regions.entries()) {
    assertObject(region, `trusted region ${index}`);
    assertNonblankString(region.name, `trusted region ${index} name`);
    if (connections.has(region.name)) throw new Error(`duplicate trusted region ${region.name}`);
    if (!Array.isArray(region.connections)) throw new Error(`trusted region ${region.name} connections must be an array`);
    const destinations = new Set();
    for (const destination of region.connections) {
      assertNonblankString(destination, `trusted region ${region.name} destination`);
      if (destinations.has(destination)) throw new Error(`duplicate trusted edge ${region.name} -> ${destination}`);
      destinations.add(destination);
    }
    connections.set(region.name, destinations);
  }
  for (const [fromRegion, destinations] of connections) {
    for (const toRegion of destinations) {
      if (!connections.has(toRegion)) throw new Error(`trusted edge ${fromRegion} -> ${toRegion} has unknown destination`);
    }
  }
  const directedEdges = [...connections.entries()].flatMap(([fromRegion, destinations]) => (
    [...destinations].map((toRegion) => `${fromRegion}>${toRegion}`)
  )).sort(codeUnitCompare);
  return { connections, directedEdges };
}

function validateTrajectory(samples, fixture, markerFrames) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error("motion trajectory samples must be nonempty");
  const claims = new Set([
    ...(fixture.expectedTerminal.semanticOracle.negative ?? []),
    ...(fixture.expectedTerminal.semanticOracle.positive ?? []),
  ]);
  const travel = trustedTravelLegs(fixture);
  const travelActorIds = new Set(travel.legs.map(({ actorId }) => actorId));
  const movementContract = claims.has("local-movement") || travel.legs.length > 0;
  const normalized = samples.map((sample, index) => {
    assertObject(sample, `trajectory sample ${index}`);
    assertNonNegativeInteger(sample.frameIndex, "trajectory frameIndex");
    if (movementContract) {
      assertNonNegativeInteger(sample.cursor, "trajectory cursor");
      if (sample.cursor > fixture.expectedFinalCursor) {
        throw new Error(`trajectory cursor exceeds expected final cursor ${fixture.expectedFinalCursor}`);
      }
      if (index > 0 && sample.cursor < samples[index - 1].cursor) {
        throw new Error("trajectory cursor must not regress");
      }
    }
    if (index > 0 && sample.frameIndex <= samples[index - 1].frameIndex) throw new Error("trajectory frameIndex must increase");
    if (sample.regionId !== null) assertNonblankString(sample.regionId, "trajectory regionId");
    if (!Array.isArray(sample.actors)) throw new Error("trajectory actors must be an array");
    const pathFallbacks = sample.pathFallbacks === undefined ? 0 : sample.pathFallbacks;
    assertNonNegativeInteger(pathFallbacks, `trajectory sample ${index} pathFallbacks`);
    const recentMarkers = sample.recentMarkers === undefined ? [] : sample.recentMarkers;
    if (!Array.isArray(recentMarkers)) throw new Error(`trajectory sample ${index} recentMarkers must be an array`);
    const repositionMarkers = recentMarkers.flatMap((marker, markerIndex) => {
      assertObject(marker, `trajectory sample ${index} marker ${markerIndex}`);
      if (marker.marker !== "repositioned") return [];
      if (marker.kind !== "actor") throw new Error("repositioned trajectory marker must belong to an actor");
      assertNonblankString(marker.actorId, "repositioned trajectory marker actorId");
      if (!Number.isFinite(marker.atMs) || marker.atMs < 0) {
        throw new Error("repositioned trajectory marker atMs must be non-negative and finite");
      }
      return [{ actorId: marker.actorId, atMs: marker.atMs }];
    });
    if (movementContract) {
      assertNonblankString(sample.focusSelectionKey, "trajectory focusSelectionKey");
      validateMotionCamera(sample.camera, index);
    }
    const actors = sample.actors.map((actor) => {
      assertObject(actor, "trajectory actor");
      assertNonblankString(actor.id, "trajectory actor id");
      assertObject(actor.position, "trajectory actor position");
      if (!Number.isFinite(actor.position.x) || !Number.isFinite(actor.position.y)) throw new Error("trajectory actor position must be finite");
      const instanceId = actor.instanceId === undefined ? null : actor.instanceId;
      if (instanceId !== null) {
        assertNonNegativeInteger(instanceId, `trajectory ${actor.id} instanceId`);
        if (instanceId === 0) throw new Error(`trajectory ${actor.id} instanceId must be positive`);
      }
      const opacity = actor.opacity === undefined ? 1 : actor.opacity;
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
        throw new Error(`trajectory ${actor.id} opacity must be between zero and one`);
      }
      let reposition = null;
      if (actor.reposition !== undefined && actor.reposition !== null) {
        assertObject(actor.reposition, `trajectory ${actor.id} fallback reposition`);
        if (!["fade-out", "fade-in"].includes(actor.reposition.phase)) {
          throw new Error(`trajectory ${actor.id} fallback reposition phase is invalid`);
        }
        if (actor.reposition.reason !== "fallback") {
          throw new Error(`fallback reposition reason must be fallback for ${actor.id}`);
        }
        if (instanceId === null) {
          throw new Error(`fallback reposition lacks actor instance for ${actor.id}`);
        }
        if (pathFallbacks === 0) {
          throw new Error(`fallback reposition lacks its path fallback counter for ${actor.id}`);
        }
        reposition = {
          phase: actor.reposition.phase,
          reason: actor.reposition.reason,
          target: finitePointEvidence(actor.reposition.target, `trajectory ${actor.id} fallback target`),
        };
      } else if (Math.abs(opacity - 1) > 1e-6) {
        throw new Error(`trajectory ${actor.id} has partial opacity without a fallback reposition`);
      }
      const base = {
        id: actor.id,
        instanceId,
        position: { x: actor.position.x, y: actor.position.y },
        opacity,
        reposition,
      };
      if (!movementContract) return base;
      if (!["north", "east", "south", "west"].includes(actor.facing)) {
        throw new Error(`invalid movement facing for ${actor.id}`);
      }
      if (actor.activeAction !== null && typeof actor.activeAction !== "string") {
        throw new Error(`moving actor ${actor.id} action must be a string or null`);
      }
      if (actor.activeAction === "moving"
        && sample.focusSelectionKey === `agent:${actor.id}`
        && actor.safeFrameVisible !== true) {
        throw new Error(`focused moving actor ${actor.id} left the safe frame`);
      }
      const worldBounds = finiteRectEvidence(actor.worldBounds, `trajectory ${actor.id} worldBounds`);
      const screenBounds = finiteRectEvidence(actor.screenBounds, `trajectory ${actor.id} screenBounds`);
      const expectedWorld = {
        x: actor.position.x + PRODUCTION_ACTOR_VISUAL_ENVELOPE.left,
        y: actor.position.y + PRODUCTION_ACTOR_VISUAL_ENVELOPE.top,
        width: PRODUCTION_ACTOR_VISUAL_ENVELOPE.width,
        height: PRODUCTION_ACTOR_VISUAL_ENVELOPE.height,
      };
      if (!sameRectEvidence(worldBounds, expectedWorld)) throw new Error(`actor world bounds disagree with position for ${actor.id}`);
      const expectedScreen = {
        x: worldBounds.x * sample.camera.zoom + sample.camera.rasterOrigin.x,
        y: worldBounds.y * sample.camera.zoom + sample.camera.rasterOrigin.y,
        width: worldBounds.width * sample.camera.zoom,
        height: worldBounds.height * sample.camera.zoom,
      };
      if (!sameRectEvidence(screenBounds, expectedScreen)) throw new Error(`actor screen bounds disagree with camera for ${actor.id}`);
      const screenVisible = rectsIntersect(screenBounds, {
        x: 0,
        y: 0,
        width: sample.camera.viewport.width,
        height: sample.camera.viewport.height,
      });
      const safeFrameVisible = rectInside(screenBounds, sample.camera.safeFrame);
      if (actor.screenVisible !== screenVisible || actor.safeFrameVisible !== safeFrameVisible) {
        throw new Error(`actor screen/safe-frame visibility witness disagrees for ${actor.id}`);
      }
      return {
        ...base,
        facing: actor.facing,
        activeAction: actor.activeAction,
        worldBounds,
        screenBounds,
        screenVisible,
        safeFrameVisible,
      };
    }).sort((left, right) => codeUnitCompare(left.id, right.id));
    return {
      frameIndex: sample.frameIndex,
      ...(movementContract ? { cursor: sample.cursor } : {}),
      regionId: sample.regionId,
      ...(movementContract ? {
        focusSelectionKey: sample.focusSelectionKey,
        camera: {
          mode: sample.camera.mode,
          zoom: sample.camera.zoom,
          rasterOrigin: { ...sample.camera.rasterOrigin },
          safeFrame: { ...sample.camera.safeFrame },
          viewport: { ...sample.camera.viewport },
        },
      } : {}),
      pathFallbacks,
      repositionMarkers,
      actors,
    };
  });
  for (const actor of normalized[0].actors) {
    if (actor.reposition !== null) {
      throw new Error(`fallback reposition was already active at trajectory start for ${actor.id}`);
    }
  }
  let teleportFree = true;
  const fallbackRepositions = [];
  for (let index = 1; index < normalized.length; index += 1) {
    const priorSample = normalized[index - 1];
    const sample = normalized[index];
    const prior = new Map(priorSample.actors.map((actor) => [actor.id, actor]));
    const current = new Map(sample.actors.map((actor) => [actor.id, actor]));
    const fallbackStarts = sample.actors.filter((actor) => (
      actor.reposition?.phase === "fade-out"
      && prior.get(actor.id)?.reposition === null
    )).length;
    if (sample.pathFallbacks - priorSample.pathFallbacks !== fallbackStarts) {
      throw new Error("trajectory pathFallbacks must equal newly observed fallback starts");
    }
    const newRepositionMarkers = retainedMarkerAdditions(
      priorSample.repositionMarkers,
      sample.repositionMarkers,
    );
    for (const actor of priorSample.actors) {
      if (actor.reposition !== null && !current.has(actor.id)) {
        throw new Error(`fallback reposition actor disappeared before completion for ${actor.id}`);
      }
    }
    for (const actor of sample.actors) {
      const before = prior.get(actor.id);
      if (actor.reposition !== null && before === undefined) {
        throw new Error(`fallback reposition began outside the trajectory for ${actor.id}`);
      }
      if (before !== undefined && priorSample.regionId !== sample.regionId
        && (before.reposition !== null || actor.reposition !== null)) {
        throw new Error(`fallback reposition crossed a region boundary for ${actor.id}`);
      }
      const transparentRelocation = before === undefined
        ? false
        : validateFallbackRepositionTransition(before, actor);
      if (transparentRelocation) {
        const midpointMarker = newRepositionMarkers.find(({ actorId }) => actorId === actor.id);
        if (midpointMarker === undefined) {
          throw new Error(`fallback relocation lacks its midpoint marker for ${actor.id}`);
        }
        fallbackRepositions.push({
          actorId: actor.id,
          instanceId: actor.instanceId,
          frameIndex: sample.frameIndex,
          atMs: midpointMarker.atMs,
          target: { ...actor.position },
          pathFallbacks: sample.pathFallbacks,
        });
      }
      if (priorSample.regionId === sample.regionId
        && before !== undefined
        && Math.hypot(actor.position.x - before.position.x, actor.position.y - before.position.y) > 64
        && !transparentRelocation) {
        teleportFree = false;
        throw new Error(`trajectory teleport detected for ${actor.id}`);
      }
    }
  }
  for (const actor of normalized.at(-1).actors) {
    if (actor.reposition !== null) {
      throw new Error(`fallback reposition remains active at trajectory end for ${actor.id}`);
    }
  }
  let legalEdges = null;
  if (movementContract && [...claims].some((claim) => /(?:forbidden|shortcut|edge)/.test(claim))) {
    legalEdges = true;
    for (let index = 1; index < normalized.length; index += 1) {
      const before = normalized[index - 1].regionId;
      const after = normalized[index].regionId;
      if (before !== null && after !== null && before !== after && !travel.topology.connections.get(before)?.has(after)) {
        legalEdges = false;
        throw new Error(`trajectory forbidden region edge ${before} -> ${after}`);
      }
    }
  }
  if (movementContract) validateMovementContinuity(normalized, travelActorIds);
  if (claims.has("local-movement")) validateC01Movement(normalized, fixture, markerFrames);
  return {
    samples: normalized.map(({ repositionMarkers: _repositionMarkers, ...sample }) => sample),
    fallbackRepositions,
    semanticClaims: movementContract ? {
      "movement-continuity": true,
      ...(claims.has("local-movement") ? { "local-movement": true } : {}),
      ...(legalEdges === true ? { "no-forbidden-edge": true } : {}),
      "no-teleport": teleportFree,
    } : {},
    travelLegs: travel.legs,
    travelClaims: claims,
    travelTopology: travel.topology,
  };
}

function retainedMarkerAdditions(before, after) {
  const counts = new Map();
  for (const marker of before) {
    const key = `${marker.actorId}\0${marker.atMs}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const additions = [];
  for (const marker of after) {
    const key = `${marker.actorId}\0${marker.atMs}`;
    const retained = counts.get(key) ?? 0;
    if (retained > 0) {
      counts.set(key, retained - 1);
    } else {
      additions.push(marker);
    }
  }
  return additions;
}

function validateFallbackRepositionTransition(before, after) {
  const beforeState = before.reposition;
  const afterState = after.reposition;
  if (beforeState === null && afterState === null) return false;
  if (before.instanceId === null || after.instanceId === null || before.instanceId !== after.instanceId) {
    throw new Error(`fallback reposition changed actor instance for ${after.id}`);
  }
  if (beforeState === null && afterState?.phase === "fade-out") {
    requireStableFallbackPosition(before, after);
    if (after.opacity > before.opacity + 1e-6) {
      throw new Error(`fallback fade-out opacity increased for ${after.id}`);
    }
    return false;
  }
  if (beforeState?.phase === "fade-out" && afterState?.phase === "fade-out") {
    requireStableFallbackTarget(before, after);
    requireStableFallbackPosition(before, after);
    if (after.opacity > before.opacity + 1e-6) {
      throw new Error(`fallback fade-out opacity increased for ${after.id}`);
    }
    return false;
  }
  if (beforeState?.phase === "fade-out" && afterState?.phase === "fade-in") {
    requireStableFallbackTarget(before, after);
    if (Math.abs(after.opacity) > 1e-6) {
      throw new Error(`fallback relocation must occur at opacity zero for ${after.id}`);
    }
    if (!samePointEvidence(after.position, afterState.target)) {
      throw new Error(`fallback relocation missed its declared target for ${after.id}`);
    }
    return true;
  }
  if (beforeState?.phase === "fade-out" && afterState === null) {
    requireStableFallbackPosition(before, after);
    return false;
  }
  if (beforeState?.phase === "fade-in" && afterState?.phase === "fade-in") {
    requireStableFallbackTarget(before, after);
    requireStableFallbackPosition(before, after);
    if (after.opacity + 1e-6 < before.opacity) {
      throw new Error(`fallback fade-in opacity decreased for ${after.id}`);
    }
    return false;
  }
  if (beforeState?.phase === "fade-in" && afterState === null) {
    requireStableFallbackPosition(before, after);
    return false;
  }
  throw new Error(`invalid fallback reposition phase transition for ${after.id}`);
}

function requireStableFallbackTarget(before, after) {
  if (before.reposition === null || after.reposition === null
    || !samePointEvidence(before.reposition.target, after.reposition.target)) {
    throw new Error(`fallback reposition target changed for ${after.id}`);
  }
}

function requireStableFallbackPosition(before, after) {
  if (!samePointEvidence(before.position, after.position)) {
    throw new Error(`fallback reposition moved outside the transparent boundary for ${after.id}`);
  }
}

function validateMovementContinuity(samples, travelActorIds) {
  for (const actorId of travelActorIds) {
    let displacementCount = 0;
    for (let index = 1; index < samples.length; index += 1) {
      if (samples[index - 1].regionId !== samples[index].regionId) continue;
      const before = samples[index - 1].actors.find(({ id }) => id === actorId);
      const after = samples[index].actors.find(({ id }) => id === actorId);
      if (before === undefined || after === undefined) continue;
      const dx = after.position.x - before.position.x;
      const dy = after.position.y - before.position.y;
      if (dx === 0 && dy === 0) continue;
      displacementCount += 1;
      const expectedFacing = Math.abs(dx) >= Math.abs(dy)
        ? dx >= 0 ? "east" : "west"
        : dy >= 0 ? "south" : "north";
      if (before.activeAction !== "moving" || after.activeAction !== "moving") {
        throw new Error(`moving actor ${actorId} action is not active during displacement`);
      }
      if (before.facing !== expectedFacing || after.facing !== expectedFacing) {
        throw new Error(`movement-facing discontinuity for ${actorId}`);
      }
    }
    if (displacementCount === 0) {
      throw new Error(`travel actor ${actorId} has no visible locomotion displacement`);
    }
  }
}

function validateMotionCamera(camera, index) {
  assertObject(camera, `trajectory camera ${index}`);
  if (!['story', 'follow'].includes(camera.mode)) throw new Error("trajectory camera must own Story or Follow focus");
  if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) throw new Error("trajectory camera zoom must be positive");
  assertObject(camera.rasterOrigin, "trajectory camera rasterOrigin");
  if (!Number.isFinite(camera.rasterOrigin.x) || !Number.isFinite(camera.rasterOrigin.y)) {
    throw new Error("trajectory camera rasterOrigin must be finite");
  }
  finiteRectEvidence(camera.safeFrame, "trajectory camera safeFrame");
  assertObject(camera.viewport, "trajectory camera viewport");
  if (!Number.isFinite(camera.viewport.width) || camera.viewport.width <= 0
    || !Number.isFinite(camera.viewport.height) || camera.viewport.height <= 0) {
    throw new Error("trajectory camera viewport must be positive");
  }
}

function validateC01Movement(samples, fixture, markerFrames) {
  const movementEntry = (fixture.entries ?? []).find(({ event }) => event?.type === "agent_entered_region");
  const payload = movementEntry?.event?.payload;
  const actorId = payload?.agent_id;
  const fromRegion = payload?.from_region;
  const toRegion = payload?.to_region;
  assertNonblankString(actorId, "C01 movement actor");
  assertNonblankString(fromRegion, "C01 movement source");
  assertNonblankString(toRegion, "C01 movement destination");
  const actorAt = (sample) => sample.actors.find(({ id }) => id === actorId);
  const firstDestination = samples.findIndex(({ regionId }) => regionId === toRegion);
  if (firstDestination < 0 || !samples.some(({ regionId }) => regionId === fromRegion)) {
    throw new Error("C01 local movement must show source and destination regions");
  }
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const actor = actorAt(sample);
    if (actor === undefined) {
      if (index >= firstDestination) throw new Error("destination movement subject is missing");
      throw new Error("focused movement subject is missing");
    }
    if (sample.focusSelectionKey !== `agent:${actorId}`) throw new Error("Story focus does not own the movement subject");
    if (actor.activeAction === "moving" && !actor.safeFrameVisible) {
      throw new Error("focused moving actor left the safe frame");
    }
  }
  const stableTailStart = samples.length - 3;
  if (stableTailStart < 0) throw new Error("C01 requires three consecutive stable idle safe-frame-visible samples");
  const stableTail = samples.slice(stableTailStart);
  const tailActors = stableTail.map(actorAt);
  const tailPosition = tailActors[0]?.position;
  if (tailPosition === undefined || tailActors.some((actor) => actor === undefined
    || actor.activeAction !== null || actor.safeFrameVisible !== true
    || actor.facing === undefined
    || actor.position.x !== tailPosition.x || actor.position.y !== tailPosition.y)) {
    throw new Error("C01 requires three consecutive stable idle correctly faced safe-frame-visible samples");
  }
  assertObject(markerFrames, "C01 markerFrames");
}

function validateTravelLegEvidence(witnesses, fixture, trajectory, checkpointHolds = []) {
  const { legs, topology } = trustedTravelLegs(fixture);
  if (legs.length === 0) {
    return {
      witnesses: witnesses.map((witness) => ({ ...witness })),
      travelLegs: [],
      semanticClaims: {},
    };
  }
  const normalized = [];
  const consumed = new Set();
  for (const leg of legs) {
    const label = `travel leg ${leg.leftCursor}-${leg.enteredCursor}`;
    const matches = witnesses.map((witness, index) => ({ witness, index })).filter(({ witness }) => (
      witness?.actorId === leg.actorId
      && witness?.fromRegion === leg.fromRegion
      && witness?.toRegion === leg.toRegion
      && Number.isInteger(witness?.frameIdentity?.firstCursor)
      && Number.isInteger(witness?.frameIdentity?.lastCursor)
      && witness.frameIdentity.firstCursor <= leg.enteredCursor
      && witness.frameIdentity.lastCursor >= leg.enteredCursor
    ));
    if (matches.length !== 1) {
      throw new Error(`${label} requires exactly one region-transition witness`);
    }
    const { witness, index } = matches[0];
    if (consumed.has(index)) throw new Error(`${label} reuses a region-transition witness`);
    consumed.add(index);
    assertObject(witness, `${label} region-transition witness`);
    if (witness.reason !== "region-transition") throw new Error(`${label} transition reason is invalid`);
    assertNonblankString(witness.commandId, `${label} transition commandId`);
    assertNonNegativeInteger(witness.sceneToken, `${label} transition sceneToken`);
    if (!Number.isFinite(witness.atMs) || witness.atMs < 0) throw new Error(`${label} transition time is invalid`);
    assertNonNegativeInteger(witness.observedFrameIndex, `${label} observed frame`);
    if (!Number.isFinite(witness.observedPresentationTimeMs) || witness.observedPresentationTimeMs < 0) {
      throw new Error(`${label} observed presentation time is invalid`);
    }
    const position = finitePointEvidence(witness.position, `${label} arrival position`);
    const actorPosition = finitePointEvidence(witness.actorPosition, `${label} arrival actor position`);
    assertObject(witness.gate, `${label} arrival gate`);
    if (witness.gate.role !== "arrival" || witness.gate.tileSize !== 32) {
      throw new Error(`${label} arrival gate metadata is invalid`);
    }
    assertObject(witness.gate.tile, `${label} arrival gate tile`);
    for (const field of ["column", "row"]) {
      assertNonNegativeInteger(witness.gate.tile[field], `${label} arrival gate tile ${field}`);
    }
    const gatePoint = finitePointEvidence(witness.gate.point, `${label} arrival gate point`);
    if (!samePointEvidence(position, gatePoint) || !samePointEvidence(actorPosition, gatePoint)) {
      throw new Error(`${label} transition position differs from its arrival gate`);
    }
    assertObject(witness.frameIdentity, `${label} frame identity`);
    assertNonblankString(witness.frameIdentity.runId, `${label} frame runId`);
    assertNonblankString(witness.frameIdentity.sourceKey, `${label} frame sourceKey`);
    for (const field of ["firstCursor", "lastCursor", "revision"]) {
      assertNonNegativeInteger(witness.frameIdentity[field], `${label} frame ${field}`);
    }
    const observed = trajectory.find(({ frameIndex }) => frameIndex === witness.observedFrameIndex);
    const observedActor = observed?.actors.find(({ id }) => id === leg.actorId);
    if (observedActor === undefined) throw new Error(`${label} traveler ${leg.actorId} is missing`);
    if (observed === undefined || observed.cursor !== leg.enteredCursor - 1
      || observed.regionId !== leg.toRegion || observed.focusSelectionKey !== `agent:${leg.actorId}`
      || observedActor.safeFrameVisible !== true) {
      throw new Error(`${label} transition is not visibly bound to its trusted event`);
    }
    const distanceFromGate = Math.hypot(
      observedActor.position.x - actorPosition.x,
      observedActor.position.y - actorPosition.y,
    );
    if (distanceFromGate > 64 || (distanceFromGate > 1e-6 && observedActor.activeAction !== "moving")) {
      throw new Error(`${label} trajectory disagrees with its arrival gate`);
    }
    const precedingCheckpointEnd = checkpointHolds
      .filter((hold) => (
        hold.eventCursor < leg.leftCursor
        && hold.lastFrameIndex < witness.observedFrameIndex
      ))
      .reduce((latest, hold) => Math.max(latest, hold.lastFrameIndex), -1);
    const window = trajectory.filter(({ cursor, frameIndex }) => (
      frameIndex > precedingCheckpointEnd
      && cursor >= leg.leftCursor - 1 && cursor <= leg.enteredCursor - 1
    ));
    if (window.length === 0) throw new Error(`${label} has no trajectory window`);
    let displacementCount = 0;
    for (let sampleIndex = 0; sampleIndex < window.length; sampleIndex += 1) {
      const sample = window[sampleIndex];
      const actor = sample.actors.find(({ id }) => id === leg.actorId);
      if (actor === undefined) throw new Error(`${label} traveler ${leg.actorId} is missing`);
      if (sample.focusSelectionKey !== `agent:${leg.actorId}` || actor.safeFrameVisible !== true) {
        throw new Error(`${label} traveler ${leg.actorId} is not visibly Story-focused`);
      }
      if (sampleIndex === 0 || window[sampleIndex - 1].regionId !== sample.regionId) continue;
      const before = window[sampleIndex - 1].actors.find(({ id }) => id === leg.actorId);
      if (before === undefined) throw new Error(`${label} traveler ${leg.actorId} is missing`);
      if (actor.position.x !== before.position.x || actor.position.y !== before.position.y) {
        displacementCount += 1;
      }
    }
    if (displacementCount === 0) {
      throw new Error(`${label} has no visible locomotion displacement`);
    }
    normalized.push({
      ...witness,
      position,
      actorPosition,
      gate: {
        role: witness.gate.role,
        tile: { column: witness.gate.tile.column, row: witness.gate.tile.row },
        tileSize: witness.gate.tileSize,
        point: gatePoint,
      },
      frameIdentity: { ...witness.frameIdentity },
    });
  }
  if (consumed.size !== witnesses.length) {
    throw new Error("region-transition witnesses contain an untrusted travel transition");
  }
  const claims = new Set([
    ...(fixture.expectedTerminal.semanticOracle.negative ?? []),
    ...(fixture.expectedTerminal.semanticOracle.positive ?? []),
  ]);
  if (claims.has("all-directed-edges")) {
    const actualEdges = legs.map(({ fromRegion, toRegion }) => `${fromRegion}>${toRegion}`)
      .sort(codeUnitCompare);
    if (!arraysEqual(actualEdges, topology.directedEdges)) {
      throw new Error("all-directed-edges travel legs do not cover the trusted topology");
    }
  }
  const semanticClaims = { "travel-legs": true };
  for (const claim of claims) {
    if (claim === "travel" || claim === "all-directed-edges"
      || claim === "forbidden-shortcut" || claim.includes("shortcut")) {
      semanticClaims[claim] = true;
    }
  }
  return {
    witnesses: normalized,
    travelLegs: legs.map((leg) => ({ ...leg })),
    semanticClaims,
  };
}

function validateRegionTransitionWitnesses(
  chronicleId,
  witnesses,
  fixture,
  trajectory,
  markerFrames,
  checkpointHolds,
) {
  if (!Array.isArray(witnesses)) throw new Error("region-transition witnesses must be an array");
  if (chronicleId !== "C01") {
    return validateTravelLegEvidence(witnesses, fixture, trajectory, checkpointHolds);
  }
  const movementEntry = (fixture.entries ?? []).find(({ event }) => event?.type === "agent_entered_region");
  const payload = movementEntry?.event?.payload;
  const actorId = payload?.agent_id;
  const fromRegion = payload?.from_region;
  const toRegion = payload?.to_region;
  assertNonblankString(actorId, "C01 movement actor");
  assertNonblankString(fromRegion, "C01 movement source");
  assertNonblankString(toRegion, "C01 movement destination");
  if (witnesses.length !== 1) throw new Error("C01 requires exactly one production region-transition witness");
  const witness = witnesses[0];
  assertObject(witness, "C01 region-transition witness");
  if (witness.reason !== "region-transition") throw new Error("C01 arrival transition reason is invalid");
  if (witness.actorId !== actorId) throw new Error("C01 arrival transition subject differs from event payload");
  if (witness.fromRegion !== fromRegion || witness.toRegion !== toRegion) {
    throw new Error("C01 arrival transition edge differs from event payload");
  }
  assertNonblankString(witness.commandId, "C01 arrival transition commandId");
  assertNonNegativeInteger(witness.sceneToken, "C01 arrival transition sceneToken");
  if (!Number.isFinite(witness.atMs) || witness.atMs < 0) throw new Error("C01 arrival transition time is invalid");
  assertNonNegativeInteger(witness.observedFrameIndex, "C01 arrival transition observed frame");
  if (!Number.isFinite(witness.observedPresentationTimeMs) || witness.observedPresentationTimeMs < 0) {
    throw new Error("C01 arrival transition presentation time is invalid");
  }
  const position = finitePointEvidence(witness.position, "C01 arrival gate position");
  const actorPosition = finitePointEvidence(witness.actorPosition, "C01 arrival transition actor position");
  assertObject(witness.gate, "C01 arrival gate");
  if (witness.gate.role !== "arrival" || witness.gate.tileSize !== 32) {
    throw new Error("C01 arrival gate metadata is invalid");
  }
  assertObject(witness.gate.tile, "C01 arrival gate tile");
  for (const field of ["column", "row"]) {
    assertNonNegativeInteger(witness.gate.tile[field], `C01 arrival gate tile ${field}`);
  }
  const gatePoint = finitePointEvidence(witness.gate.point, "C01 arrival gate point");
  const expectedGate = trustedDirectedArrivalGate(fixture, fromRegion, toRegion);
  const computedGate = {
    x: (witness.gate.tile.column + 0.5) * witness.gate.tileSize,
    y: (witness.gate.tile.row + 0.5) * witness.gate.tileSize,
  };
  if (witness.gate.tileSize !== expectedGate.tileSize
    || witness.gate.tile.column !== expectedGate.tile.column
    || witness.gate.tile.row !== expectedGate.tile.row
    || !samePointEvidence(gatePoint, expectedGate.point)) {
    throw new Error("C01 directed arrival gate differs from the trusted production map recipe");
  }
  if (!samePointEvidence(gatePoint, computedGate) || !samePointEvidence(position, gatePoint)
    || !samePointEvidence(actorPosition, gatePoint)) {
    throw new Error("C01 arrival gate position disagrees with the validated production gate");
  }
  assertObject(witness.frameIdentity, "C01 arrival transition frame identity");
  assertNonblankString(witness.frameIdentity.runId, "C01 arrival transition runId");
  assertNonblankString(witness.frameIdentity.sourceKey, "C01 arrival transition sourceKey");
  for (const field of ["firstCursor", "lastCursor", "revision"]) {
    assertNonNegativeInteger(witness.frameIdentity[field], `C01 arrival transition ${field}`);
  }
  if (witness.frameIdentity.firstCursor > movementEntry.cursor
    || witness.frameIdentity.lastCursor < movementEntry.cursor) {
    throw new Error("C01 arrival transition frame does not contain the entered event cursor");
  }
  const sample = trajectory.find(({ frameIndex }) => frameIndex === witness.observedFrameIndex);
  const actor = sample?.actors.find(({ id }) => id === actorId);
  if (sample === undefined || actor === undefined || sample.regionId !== toRegion
    || sample.focusSelectionKey !== `agent:${actorId}` || actor.safeFrameVisible !== true) {
    throw new Error("C01 arrival transition is not visibly bound to the event subject");
  }
  const distanceFromGate = Math.hypot(actor.position.x - position.x, actor.position.y - position.y);
  if (distanceFromGate > 64 || (distanceFromGate > 1e-6 && actor.activeAction !== "moving")) {
    throw new Error("C01 arrival gate position disagrees with the trajectory actor position");
  }
  assertObject(markerFrames, "C01 markerFrames");
  const leftFrame = markerFrames["event:agent_left_region"];
  const enteredFrame = markerFrames["event:agent_entered_region"];
  assertNonNegativeInteger(leftFrame, "C01 left marker frame");
  assertNonNegativeInteger(enteredFrame, "C01 entered marker frame");
  if (leftFrame > witness.observedFrameIndex) throw new Error("left marker follows the arrival transition");
  if (enteredFrame < witness.observedFrameIndex) throw new Error("entered marker precedes the arrival transition");
  const travelEvidence = validateTravelLegEvidence(witnesses, fixture, trajectory);
  return {
    ...travelEvidence,
    witnesses: [{
    ...witness,
    position,
    actorPosition,
    gate: {
      role: witness.gate.role,
      tile: { column: witness.gate.tile.column, row: witness.gate.tile.row },
      tileSize: witness.gate.tileSize,
      point: gatePoint,
    },
      frameIdentity: { ...witness.frameIdentity },
    }],
  };
}

function trustedDirectedArrivalGate(fixture, fromRegion, toRegion) {
  const productionMapColumns = 96;
  const productionMapRows = 96;
  const mechanicsCoreOrigin = 16;
  const mechanicsCoreSize = 64;
  const tileSize = 32;
  const regions = fixture.initialSnapshot?.regions ?? fixture.expectedTerminal?.finalSnapshot?.regions;
  if (!Array.isArray(regions) || regions.length === 0) {
    throw new Error("C01 trusted fixture lacks production map regions");
  }
  const uniqueEdges = new Map();
  for (const [index, region] of regions.entries()) {
    assertObject(region, `C01 trusted region ${index}`);
    assertNonblankString(region.name, `C01 trusted region ${index} name`);
    if (!Array.isArray(region.connections)) {
      throw new Error(`C01 trusted region ${region.name} connections must be an array`);
    }
    for (const destination of region.connections) {
      assertNonblankString(destination, `C01 trusted region ${region.name} destination`);
      if (destination === region.name) continue;
      uniqueEdges.set(`${region.name}\u0000${destination}`, { from: region.name, to: destination });
    }
  }
  const edges = [...uniqueEdges.values()].sort(compareDirectedEdges);
  if (!edges.some(({ from, to }) => from === fromRegion && to === toRegion)) {
    throw new Error("C01 trusted fixture does not authorize the directed movement edge");
  }
  const touching = edges.flatMap((edge) => {
    const roles = [];
    if (edge.to === toRegion) roles.push("arrival");
    if (edge.from === toRegion) roles.push("departure");
    return roles.map((role) => ({ edge, role }));
  }).sort((left, right) => compareDirectedEdges(left.edge, right.edge)
    || codeUnitCompare(left.role, right.role));
  const slots = productionPerimeterSlots(mechanicsCoreSize, mechanicsCoreSize);
  if (touching.length > slots.length) throw new Error("C01 trusted destination has too many map gates");
  const used = new Set();
  for (const { edge, role } of touching) {
    let slotIndex = productionStableHash(`${edge.from}>${edge.to}:${role}`) % slots.length;
    while (used.has(slotIndex)) slotIndex = (slotIndex + 1) % slots.length;
    used.add(slotIndex);
    if (role === "arrival" && edge.from === fromRegion && edge.to === toRegion) {
      const coreTile = slots[slotIndex];
      const tile = {
        column: coreTile.column + mechanicsCoreOrigin,
        row: coreTile.row + mechanicsCoreOrigin,
      };
      if (tile.column >= productionMapColumns || tile.row >= productionMapRows) {
        throw new Error("C01 trusted production gate falls outside the canonical map");
      }
      return {
        tile: { column: tile.column, row: tile.row },
        tileSize,
        point: {
          x: (tile.column + 0.5) * tileSize,
          y: (tile.row + 0.5) * tileSize,
        },
      };
    }
  }
  throw new Error("C01 trusted production map recipe lacks the directed arrival gate");
}

function compareDirectedEdges(left, right) {
  return codeUnitCompare(left.from, right.from) || codeUnitCompare(left.to, right.to);
}

function productionPerimeterSlots(columns, rows) {
  const slots = [];
  for (let column = 2; column <= columns - 3; column += 1) slots.push({ column, row: 1 });
  for (let row = 2; row <= rows - 3; row += 1) slots.push({ column: columns - 2, row });
  for (let column = columns - 3; column >= 2; column -= 1) slots.push({ column, row: rows - 2 });
  for (let row = rows - 3; row >= 2; row -= 1) slots.push({ column: 1, row });
  return slots;
}

function productionStableHash(value) {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function finitePointEvidence(point, label) {
  assertObject(point, label);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error(`${label} must be finite`);
  return { x: point.x, y: point.y };
}

function samePointEvidence(left, right) {
  return Math.abs(left.x - right.x) <= 1e-6 && Math.abs(left.y - right.y) <= 1e-6;
}

function finiteRectEvidence(rect, label) {
  assertObject(rect, label);
  for (const field of ["x", "y", "width", "height"]) {
    if (!Number.isFinite(rect[field])) throw new Error(`${label} must be finite`);
  }
  if (rect.width <= 0 || rect.height <= 0) throw new Error(`${label} must have positive extent`);
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function sameRectEvidence(left, right) {
  return ["x", "y", "width", "height"].every((field) => Math.abs(left[field] - right[field]) <= 1e-6);
}

function rectsIntersect(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

function rectInside(inner, outer) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function normalizePlacementCheckpoint(checkpoint) {
  assertObject(checkpoint, "placement checkpoint");
  assertNonNegativeInteger(checkpoint.cursor, "placement checkpoint cursor");
  assertObject(checkpoint.placements, "placement checkpoint placements");
  const placements = {};
  for (const id of Object.keys(checkpoint.placements).sort(codeUnitCompare)) {
    assertHash(checkpoint.placements[id], `placement ${id}`);
    placements[id] = checkpoint.placements[id];
  }
  return { cursor: checkpoint.cursor, placements };
}

function buildPerformanceEvidence(
  identity,
  performance,
  expectedFinalCursor,
  fixture,
  assets,
  terminalAuthority,
  operationalWorkload,
) {
  assertObject(performance, `${identity.chronicleId} performance evidence`);
  const drawSamples = finiteNumbers(performance.drawSamplesMs, "drawSamplesMs", true);
  const longTasks = finiteNumbers(performance.longTasksMs, "longTasksMs", false);
  if (!drawSamples.some((sample) => sample > 0)) {
    throw new Error("draw samples must include a positive measured duration");
  }
  const sortedDraw = [...drawSamples].sort((a, b) => a - b);
  const p95Ms = sortedDraw[Math.ceil(sortedDraw.length * 0.95) - 1];
  const maxMs = sortedDraw.at(-1);
  const maxLongTaskMs = longTasks.length === 0 ? 0 : Math.max(...longTasks);
  if (maxMs > 50) throw new Error(`draw maximum ${maxMs} ms exceeds 50 ms`);
  if (p95Ms > 4) throw new Error(`draw p95 ${p95Ms} ms exceeds 4 ms`);
  if (maxLongTaskMs > 50) throw new Error(`long task ${maxLongTaskMs} ms exceeds 50 ms`);
  const cadence = validateCadence(performance.cadenceWindows);
  const runtimeSamples = validateRuntimeSamples(
    identity.chronicleId,
    performance.runtimeSamples,
    expectedFinalCursor,
    terminalAuthority,
    operationalWorkload,
  );
  const scheduler = validateScheduler(
    performance.schedulerSamples,
    isEventlessPresentationAuthority(terminalAuthority)
      ? terminalAuthority.presentation.terminal.cursor
      : expectedFinalCursor,
    terminalAuthority,
  );
  const archive = validateArchiveObservations(identity.chronicleId, performance.archiveObservations, runtimeSamples);
  const lifecycle = validateLifecycle(identity.chronicleId, performance.lifecycle, fixture, assets);
  return { ...identity, draw: { samplesMs: drawSamples, p95Ms, maxMs }, longTasks: { samplesMs: longTasks, maxMs: maxLongTaskMs }, cadence, runtimeSamples, scheduler, archive, lifecycle, verdict: { passed: true } };
}

function validateCadence(windows) {
  if (!Array.isArray(windows) || windows.length !== 3) throw new Error("cadence requires visible, reduced, and hidden windows");
  const maximum = { visible: 60, reduced: 30, hidden: 0 };
  const normalized = windows.map((window) => {
    assertObject(window, "cadence window");
    assertNonNegativeInteger(window.frameCount, "cadence frameCount");
    if (!Number.isFinite(window.durationMs) || window.durationMs <= 0) throw new Error("cadence durationMs must be positive");
    if (!(window.mode in maximum)) throw new Error(`unknown cadence mode ${window.mode}`);
    const observedHz = window.frameCount * 1000 / window.durationMs;
    if (observedHz > maximum[window.mode] + 1e-9
      || (window.mode !== "hidden" && observedHz <= 0)) {
      throw new Error(`cadence ${window.mode} must be positive and at most ${maximum[window.mode]} Hz`);
    }
    return { mode: window.mode, frameCount: window.frameCount, durationMs: window.durationMs, observedHz };
  }).sort((a, b) => codeUnitCompare(a.mode, b.mode));
  if (new Set(normalized.map(({ mode }) => mode)).size !== 3) throw new Error("cadence modes must be unique");
  return normalized;
}

function validateRuntimeSamples(
  chronicleId,
  samples,
  expectedFinalCursor,
  terminalAuthority,
  operationalWorkload,
) {
  if (!Array.isArray(samples) || samples.length < 2) throw new Error("runtime samples must include active and settled phases");
  const operationalAuthority = isEventlessPresentationAuthority(terminalAuthority);
  if (operationalAuthority) {
    assertObject(operationalWorkload, `${chronicleId} runtime operational workload`);
    if (!Array.isArray(operationalWorkload.trace)) {
      throw new Error(`${chronicleId} runtime operational workload requires an exact trace`);
    }
  }
  const normalized = samples.map((sample) => {
    assertObject(sample, "runtime sample");
    for (const field of ["frameIndex", "authoritativeCursor", "ingressAccepted", "directorPending", "chroniclePrevious", "chronicleUpcoming", "retainedSafeCheckpoints", "activeSceneCount", "liveSessions", "archiveSessions", "stageCount", "canvasCount"]) assertNonNegativeInteger(sample[field], `runtime ${field}`);
    if (!["active", "operational", "pressure", "terminal"].includes(sample.phase)) throw new Error(`invalid runtime phase ${sample.phase}`);
    assertNonblankString(sample.stageId, "runtime stageId");
    assertNonblankString(sample.canvasId, "runtime canvasId");
    if (!operationalAuthority && sample.authoritativeCursor > expectedFinalCursor) throw new Error("runtime authoritative cursor exceeds terminal truth");
    if (sample.ingressAccepted > sample.authoritativeCursor) throw new Error("runtime ingress pending exceeds authoritative truth");
    if (sample.directorPending > 48) throw new Error("director pending exceeds production bound 48");
    if (sample.chroniclePrevious > 48 || sample.chronicleUpcoming > 48) throw new Error("Chronicle window exceeds production bound 48");
    if (sample.retainedSafeCheckpoints > 64) throw new Error("checkpoint retention exceeds production bound 64");
    if (sample.activeSceneCount > 1) throw new Error("exactly one active scene may exist");
    if (operationalAuthority && sample.activeSceneCount !== 0) {
      throw new Error(`${chronicleId} eventless runtime evidence fabricated an active scene`);
    }
    if (sample.stageCount !== 1 || sample.canvasCount !== 1) throw new Error("runtime must retain one Stage and Canvas");
    if (sample.liveSessions > 1 || sample.archiveSessions > 1) throw new Error("session ownership exceeds one Live/Archive session");
    return { ...sample };
  });
  if (operationalAuthority) {
    if (canonicalJson(normalized.map(({ workload }) => workload))
      !== canonicalJson(operationalWorkload.trace)) {
      throw new Error(`${chronicleId} runtime samples must retain the exact operational workload trace`);
    }
    for (const [index, sample] of normalized.entries()) {
      const workload = operationalWorkload.trace[index];
      const expectedPhase = workload.completed ? "terminal" : "operational";
      if (sample.phase !== expectedPhase || sample.authoritativeCursor !== workload.live.cursor) {
        throw new Error(`${chronicleId} runtime workload phase/cursor differs from operational semantics`);
      }
    }
  }
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].frameIndex <= normalized[index - 1].frameIndex
      || (!operationalAuthority || chronicleId !== "C14")
        && normalized[index].authoritativeCursor < normalized[index - 1].authoritativeCursor) {
      throw new Error("runtime samples must be monotonic within one Live lineage");
    }
  }
  if (chronicleId === "C16" && !arraysEqual(normalized.map(({ authoritativeCursor }) => authoritativeCursor), C16_DENSITY_CURSORS)) throw new Error("C16 runtime samples must cover 1024,2048,3072,4096");
  if (!operationalAuthority
    && !normalized.some(({ phase, activeSceneCount }) => phase === "active" && activeSceneCount === 1)) {
    throw new Error("runtime requires an active presentation phase with exactly one scene");
  }
  if (new Set(normalized.map(({ stageId }) => stageId)).size !== 1 || new Set(normalized.map(({ canvasId }) => canvasId)).size !== 1) throw new Error("runtime samples must share one Stage and Canvas identity");
  const terminal = normalized.at(-1);
  const terminalCursor = operationalAuthority
    ? terminalAuthority.presentation.terminal.cursor
    : expectedFinalCursor;
  if (terminal.phase !== "terminal" || terminal.authoritativeCursor !== terminalCursor || terminal.ingressAccepted !== 0 || terminal.directorPending !== 0 || terminal.chronicleUpcoming !== 0 || terminal.activeSceneCount !== 0) throw new Error("runtime terminal queues and scene must settle");
  return normalized;
}

function validateArchiveObservations(chronicleId, observations, runtimeSamples) {
  if (!Array.isArray(observations)) throw new Error("Archive observations must be an array");
  if (chronicleId !== "C16") return { cycles: observations.length, observations: observations.map((item) => ({ ...item })) };
  if (observations.length !== 25) throw new Error("C16 must prove 25 real Archive cycle observations");
  const stageId = runtimeSamples[0].stageId;
  const canvasId = runtimeSamples[0].canvasId;
  const normalized = observations.map((observation, index) => {
    assertObject(observation, `Archive observation ${index + 1}`);
    if (observation.cycle !== index + 1) throw new Error("Archive cycle numbers must be contiguous 1-25");
    if (observation.source !== "archive" || observation.archiveSessions !== 1 || observation.liveSessions !== 1) throw new Error("Archive cycle must observe one Archive and one Live session");
    for (const field of ["liveCursorBefore", "liveCursorAfter"]) assertNonNegativeInteger(observation[field], `Archive ${field}`);
    for (const field of ["liveStateHashBefore", "liveStateHashAfter"]) assertHash(observation[field], `Archive ${field}`);
    if (observation.liveCursorBefore !== observation.liveCursorAfter || observation.liveStateHashBefore !== observation.liveStateHashAfter) throw new Error("Archive cycle altered Live truth");
    if (observation.stageId !== stageId || observation.canvasId !== canvasId) throw new Error("Archive cycles must share one Stage and Canvas");
    assertObject(observation.archiveSpatialBinding, "Archive spatial binding");
    assertObject(observation.restoredLiveSpatialBinding, "restored Live spatial binding");
    for (const binding of [observation.archiveSpatialBinding, observation.restoredLiveSpatialBinding]) {
      if (typeof binding.placementRebound !== "boolean" || typeof binding.recipesRebound !== "boolean") {
        throw new Error("Archive spatial binding fields must be raw booleans");
      }
    }
    if (
      observation.archiveSpatialBinding.placementRebound !== true
      || observation.archiveSpatialBinding.recipesRebound !== true
    ) throw new Error("Archive Graph must use rebound spatial resources");
    if (
      observation.restoredLiveSpatialBinding.placementRebound !== false
      || observation.restoredLiveSpatialBinding.recipesRebound !== false
    ) throw new Error("restored Live Graph must use initial spatial resources");
    return { ...observation };
  });
  return { cycles: normalized.length, observations: normalized, liveTruthPreserved: true, sharedStageCanvas: true };
}

function validateScheduler(samples, expectedFinalCursor, terminalAuthority) {
  if (!Array.isArray(samples) || samples.length < 5) {
    throw new Error("scheduler samples require visible, reduced-active, terminal-static, hidden, and disposed modes");
  }
  const ownersByRoute = new Map();
  const byMode = new Map();
  const operationalAuthority = isEventlessPresentationAuthority(terminalAuthority);
  const expectedWorkload = terminalAuthority.presentation.kind === "silent-checkpoint"
    ? "ambient"
    : terminalAuthority.presentation.kind;
  const expectedSemantics = {
    visible: { phase: "ambient", routeId: "standard" },
    "reduced-active": { phase: operationalAuthority ? "operational" : "active", routeId: "reduced" },
    "terminal-static": { phase: "terminal-static", routeId: "reduced" },
    hidden: { phase: "hidden", routeId: "standard" },
    disposed: { phase: "disposed", routeId: "standard" },
  };
  for (const sample of samples) {
    assertObject(sample, "scheduler sample");
    assertNonblankString(sample.ownerId, "scheduler ownerId");
    assertNonblankString(sample.phase, "scheduler phase");
    if (!["visible", "reduced-active", "terminal-static", "hidden", "disposed"].includes(sample.mode)) {
      throw new Error(`unknown scheduler mode ${sample.mode}`);
    }
    if (byMode.has(sample.mode)) throw new Error(`duplicate scheduler mode ${sample.mode}`);
    if (typeof sample.dirty !== "boolean") throw new Error("scheduler dirty must be a raw boolean");
    if (typeof sample.rafScheduled !== "boolean" || typeof sample.wakeScheduled !== "boolean") throw new Error("scheduler flags must be raw booleans");
    if (!Object.hasOwn(sample, "nextDeadlineMs")
      || (sample.nextDeadlineMs !== null && !Number.isFinite(sample.nextDeadlineMs))) {
      throw new Error("scheduler nextDeadlineMs must be finite or null");
    }
    if (!Number.isFinite(sample.observedAtMs) || sample.observedAtMs < 0) throw new Error("scheduler observedAtMs must be finite");
    assertNonNegativeInteger(sample.drawTotal, "scheduler drawTotal");
    if (sample.reason !== null && (typeof sample.reason !== "string" || sample.reason.trim().length === 0)) {
      throw new Error("scheduler reason must be nonblank or null");
    }
    if (sample.rafScheduled && sample.wakeScheduled) throw new Error("scheduler cannot own simultaneous RAF and wake handles");
    const semantics = expectedSemantics[sample.mode];
    if (sample.phase !== semantics.phase) {
      throw new Error(`${sample.mode} scheduler phase must be ${semantics.phase}`);
    }
    if (operationalAuthority) {
      assertNonblankString(sample.workload, `${sample.mode} scheduler workload`);
      const workload = sample.mode === "reduced-active" ? expectedWorkload
        : sample.mode === "terminal-static" ? "terminal"
          : sample.mode === "visible" ? "ambient" : sample.mode;
      if (sample.workload !== workload) {
        throw new Error(`${sample.mode} scheduler workload must retain operational semantics`);
      }
    }
    const routeId = sample.routeId;
    assertNonblankString(routeId, "scheduler routeId");
    if (routeId !== semantics.routeId) {
      throw new Error(`${sample.mode} scheduler route must be ${semantics.routeId}`);
    }
    const routeOwners = ownersByRoute.get(routeId) ?? new Set();
    routeOwners.add(sample.ownerId);
    ownersByRoute.set(routeId, routeOwners);
    byMode.set(sample.mode, sample);
  }
  const visible = byMode.get("visible");
  const reducedActive = byMode.get("reduced-active");
  const terminal = byMode.get("terminal-static");
  const hidden = byMode.get("hidden");
  const disposed = byMode.get("disposed");
  if (!visible || !reducedActive || !terminal || !hidden || !disposed) {
    throw new Error("scheduler samples require visible, reduced-active, terminal-static, hidden, and disposed modes");
  }
  if (visible.dirty || visible.rafScheduled || !visible.wakeScheduled) {
    throw new Error("visible ambience must retain exactly one wake handle");
  }
  if (visible.nextDeadlineMs === null || visible.nextDeadlineMs <= visible.observedAtMs) {
    throw new Error("scheduler wake requires a future visible deadline");
  }
  if (visible.reason !== "graph-deadline") throw new Error("scheduler wake requires a reason-bound graph deadline");
  if (visible.ownerId !== hidden.ownerId || visible.ownerId !== disposed.ownerId) {
    throw new Error("standard visible, hidden, and disposed samples must share one scheduler owner");
  }
  if (reducedActive.ownerId !== terminal.ownerId) {
    throw new Error("reduced active and terminal samples must share one scheduler owner");
  }
  if (reducedActive.wakeScheduled
    && (reducedActive.nextDeadlineMs === null || reducedActive.nextDeadlineMs <= reducedActive.observedAtMs
      || reducedActive.reason === null)) {
    throw new Error("reduced active wake requires a future reason-bound deadline");
  }
  if (!reducedActive.wakeScheduled && reducedActive.nextDeadlineMs !== null) {
    throw new Error("reduced active deadline requires an owned wake handle");
  }
  if (terminal.dirty || terminal.rafScheduled || terminal.wakeScheduled
    || terminal.nextDeadlineMs !== null || terminal.reason !== null) {
    throw new Error("terminal-static scheduler must be zero");
  }
  validateTerminalQuietWitness(terminal.quiet, expectedFinalCursor);
  if (hidden.dirty || hidden.rafScheduled || hidden.wakeScheduled || hidden.nextDeadlineMs !== null) {
    throw new Error("hidden scheduler must settle RAF, wake, and deadline ownership");
  }
  if (hidden.reason !== null) throw new Error("hidden scheduler reason must be null");
  if (disposed.dirty || disposed.rafScheduled || disposed.wakeScheduled || disposed.nextDeadlineMs !== null) {
    throw new Error("disposed scheduler must settle RAF, wake, and deadline ownership");
  }
  if (disposed.reason !== null) throw new Error("disposed scheduler reason must be null");
  return {
    samples: samples.map((sample) => ({ ...sample })),
    owners: Object.fromEntries([...ownersByRoute].map(([routeId, owners]) => [routeId, [...owners][0]])),
  };
}

function validateTerminalQuietWitness(quiet, expectedFinalCursor) {
  assertObject(quiet, "terminal-static quiet witness");
  if (!Number.isFinite(quiet.durationMs) || quiet.durationMs < 1_000) {
    throw new Error("terminal-static quiet window must cover at least 1000ms");
  }
  for (const field of ["drawDelta", "reactCommitDelta"]) {
    assertNonNegativeInteger(quiet[field], `quiet ${field}`);
  }
  if (quiet.drawDelta !== 0) throw new Error("quiet draw delta must be zero");
  if (quiet.reactCommitDelta !== 0) throw new Error("quiet React commit delta must be zero");
  for (const field of ["cursorBefore", "cursorAfter"]) assertNonNegativeInteger(quiet[field], `quiet ${field}`);
  if (quiet.cursorBefore !== expectedFinalCursor || quiet.cursorAfter !== quiet.cursorBefore) {
    throw new Error("quiet cursor identity must remain at final truth");
  }
  for (const field of ["frameIdentityBefore", "frameIdentityAfter", "stateHashBefore", "stateHashAfter"]) {
    assertHash(quiet[field], `quiet ${field}`);
  }
  if (quiet.frameIdentityBefore !== quiet.frameIdentityAfter) throw new Error("quiet frame identity must remain unchanged");
  if (quiet.stateHashBefore !== quiet.stateHashAfter) throw new Error("quiet accepted state must remain unchanged");
}

function validateLifecycle(chronicleId, lifecycle, fixture, assets) {
  assertObject(lifecycle, "performance lifecycle");
  const counters = {};
  for (const field of ["stage", "canvas", "graph", "graphActors", "graphHomes", "graphEnvironments"]) counters[field] = validateSettledCounter(lifecycle[field], field);
  for (const field of ["stage", "canvas", "graph"]) {
    if (counters[field].created !== 1 || counters[field].peak !== 1) throw new Error(`${field} lifecycle must create one owner`);
  }
  if (fixture.expectedPopulation.visibleRegionId !== null) {
    assertNonblankString(lifecycle.visibleRegionId, "visible Graph region");
    if (lifecycle.visibleRegionId !== fixture.expectedPopulation.visibleRegionId) {
      throw new Error("visible Graph region must match canonical fixture");
    }
    const visiblePopulation = fixture.expectedPopulation.regions
      .find(({ regionId }) => regionId === lifecycle.visibleRegionId);
    if (!visiblePopulation) throw new Error("visible Graph region lacks canonical population");
    if (counters.graphActors.created !== visiblePopulation.actors
      || counters.graphActors.peak !== visiblePopulation.actors) {
      throw new Error("Graph actor activity must match canonical fixture");
    }
    if (counters.graphHomes.created !== visiblePopulation.homes
      || counters.graphHomes.peak !== visiblePopulation.homes) {
      throw new Error("Graph home activity must match canonical fixture");
    }
    if (counters.graphEnvironments.created !== 1 || counters.graphEnvironments.peak !== 1) {
      throw new Error("Graph environment activity must match canonical fixture");
    }
  } else {
    const graphLifecycleOracle = fixture.expectedPopulation.graphLifecycleOracle;
    if (graphLifecycleOracle?.actors !== undefined) {
      if (counters.graphActors.created !== graphLifecycleOracle.actors.created
        || counters.graphActors.peak !== graphLifecycleOracle.actors.peak) {
        throw new Error("Graph actor ownership must match authored Graph actor lifecycle oracle");
      }
    } else {
      if (counters.graphActors.created < fixture.expectedPopulation.actors) throw new Error("Graph actor activity must match canonical fixture population");
      if (counters.graphActors.created > fixture.expectedPopulation.actors + fixture.expectedPopulation.actorRegionTransitions) {
        throw new Error("Graph actor recreation exceeds canonical transition allowance");
      }
      if (counters.graphActors.peak > fixture.expectedPopulation.actors) throw new Error("Graph actor peak exceeds canonical fixture population");
    }
    if (graphLifecycleOracle?.homes !== undefined) {
      if (counters.graphHomes.created !== graphLifecycleOracle.homes.created
        || counters.graphHomes.peak !== graphLifecycleOracle.homes.peak) {
        throw new Error("Graph home ownership must match authored Graph home lifecycle oracle");
      }
    } else if (counters.graphHomes.created !== fixture.expectedPopulation.homes) {
      throw new Error("Graph home activity must match canonical fixture");
    }
  }
  if (counters.graphEnvironments.created < 1) throw new Error("Graph environment activity must be non-vacuous");
  assertObject(lifecycle.cache, "cache lifecycle");
  const cache = { ...validateSettledCounter(lifecycle.cache, "cache"), rebuildReasons: uniqueStrings(lifecycle.cache.rebuildReasons, "cache rebuildReasons", false) };
  for (const reason of cache.rebuildReasons) if (!/^(?:map|topology|region-identity)$/.test(reason)) throw new Error(`cache rebuild reason is not static ${reason}`);
  assertObject(lifecycle.atlas, "atlas lifecycle");
  for (const field of ["decodeStarts", "bitmapsClosed", "acquireCalls", "releaseCalls", "leasesCreated", "leasesReleased"]) assertNonNegativeInteger(lifecycle.atlas[field], `atlas ${field}`);
  if (lifecycle.atlas.acquireCalls !== lifecycle.atlas.releaseCalls) throw new Error("atlas acquisitions must settle");
  if (lifecycle.atlas.leasesCreated !== lifecycle.atlas.leasesReleased) throw new Error("atlas leases must settle");
  if (lifecycle.atlas.decodeStarts !== lifecycle.atlas.bitmapsClosed) throw new Error("atlas bitmaps must settle");
  if (lifecycle.atlas.decodeStarts === 0 || lifecycle.atlas.acquireCalls === 0 || lifecycle.atlas.leasesCreated === 0) throw new Error("atlas lifecycle must be non-vacuous");
  const pressureAtlas = assets.atlasSamples.filter(({ phase }) => phase !== "settled");
  if (!pressureAtlas.some(({ decodedBytes, leases }) => decodedBytes > 0 && leases > 0)) throw new Error("atlas lifecycle must bind active asset samples");
  const peakObservedLeases = Math.max(...pressureAtlas.map(({ leases }) => leases));
  if (lifecycle.atlas.leasesCreated < peakObservedLeases || lifecycle.atlas.acquireCalls < peakObservedLeases) throw new Error("atlas lifecycle counts do not cover observed leases");
  assertObject(lifecycle.react, "React lifecycle");
  for (const field of ["initialCommitCount", "finalCommitCount", "frameDrivenCommitCount"]) assertNonNegativeInteger(lifecycle.react[field], `React ${field}`);
  if (lifecycle.react.finalCommitCount < lifecycle.react.initialCommitCount) throw new Error("React commit count regressed");
  if (lifecycle.react.frameDrivenCommitCount !== 0) throw new Error("frame-driven React commits are forbidden");
  const heap = validateHeap(chronicleId, lifecycle.heap);
  return {
    visibleRegionId: lifecycle.visibleRegionId ?? null,
    ...counters,
    cache,
    atlas: { ...lifecycle.atlas },
    react: { ...lifecycle.react },
    heap,
  };
}

function validateSettledCounter(counter, label) {
  assertObject(counter, `${label} ownership counter`);
  for (const field of ["created", "disposed", "live", "outstanding", "peak"]) assertNonNegativeInteger(counter[field], `${label} ${field}`);
  if (counter.live !== counter.outstanding) throw new Error(`${label} live must equal outstanding ownership`);
  if (counter.created !== counter.disposed || counter.outstanding !== 0 || counter.peak > counter.created) throw new Error(`${label} ownership must settle exactly`);
  return { created: counter.created, disposed: counter.disposed, live: counter.live, outstanding: counter.outstanding, peak: counter.peak };
}

function validateHeap(chronicleId, heap) {
  assertObject(heap, "heap evidence");
  assertObject(heap.supportProbe, "heap support probe");
  if (heap.supportProbe.api !== "CDP HeapProfiler.collectGarbage" || typeof heap.supportProbe.supported !== "boolean") throw new Error("heap support probe is invalid");
  assertNonNegativeInteger(heap.collections, "heap collections");
  const gcSupported = heap.supportProbe.supported;
  if (gcSupported && heap.collections < 2) throw new Error("supported GC probe requires two forced collections");
  if (!gcSupported) {
    assertNonblankString(heap.supportProbe.reason, "unsupported GC reason");
    if (heap.collections !== 0) throw new Error("unsupported GC probe cannot report collections");
    if (heap.baseline !== null || heap.tail !== null) throw new Error("unsupported GC probe cannot report heap plateau samples");
    for (const field of ["domBaseline", "domTail"]) assertObject(heap[field], `heap ${field}`);
    validateDomPlateau(heap.domBaseline, heap.domTail);
    return { supportProbe: { ...heap.supportProbe }, collections: 0, gcSupported: false, baseline: null, tail: null, domBaseline: { ...heap.domBaseline }, domTail: { ...heap.domTail } };
  }
  for (const field of ["baseline", "tail", "domBaseline", "domTail"]) assertObject(heap[field], `heap ${field}`);
  for (const field of ["usedSize", "embedderHeapUsedSize", "backingStorageSize"]) {
    assertNonNegativeInteger(heap.baseline[field], `heap baseline ${field}`);
    assertNonNegativeInteger(heap.tail[field], `heap tail ${field}`);
  }
  if (heap.tail.usedSize - heap.baseline.usedSize > 4 * MEBIBYTE) throw new Error("heap usedSize plateau exceeds 4 MiB");
  if (heap.tail.embedderHeapUsedSize - heap.baseline.embedderHeapUsedSize > 8 * MEBIBYTE) throw new Error("heap embedder plateau exceeds 8 MiB");
  if (heap.tail.backingStorageSize - heap.baseline.backingStorageSize > 4 * MEBIBYTE) throw new Error("heap backing storage plateau exceeds 4 MiB");
  validateDomPlateau(heap.domBaseline, heap.domTail);
  return { ...heap, supportProbe: { ...heap.supportProbe }, gcSupported: true };
}

function validateDomPlateau(baseline, tail) {
  for (const field of ["nodes", "listeners"]) {
    assertNonNegativeInteger(baseline[field], `DOM baseline ${field}`);
    assertNonNegativeInteger(tail[field], `DOM tail ${field}`);
  }
  if (tail.nodes - baseline.nodes > 500) throw new Error("DOM node plateau exceeds 500");
  if (tail.listeners - baseline.listeners > 25) throw new Error("listener plateau exceeds 25");
}

function buildNetworkEvidence(identity, network, sourceClosure, authority) {
  assertObject(network, `${identity.chronicleId} network evidence`);
  const key = `${identity.chronicleId}/${identity.viewport}`;
  const trustedSummary = authority.requestSummaries[key];
  assertObject(trustedSummary, `trusted request summary ${key}`);
  assertNonNegativeInteger(trustedSummary.observedCount, "trusted request observedCount");
  assertHash(trustedSummary.ledgerSha256, "trusted request ledgerSha256");
  if (!Array.isArray(network.requests) || network.requests.length !== trustedSummary.observedCount || network.requests.length === 0) throw new Error("trusted request ledger count mismatch");
  let navigationCount = 0;
  let rawArtifactRejectionCount = 0;
  const requests = network.requests.map((request, index) => {
    assertObject(request, `request ledger ${index}`);
    if (request.sequence !== index + 1) throw new Error("request ledger sequence must be contiguous");
    assertNonblankString(request.kind, "request kind");
    assertNonblankString(request.handler, "request handler");
    assertNonblankString(request.disposition, "request disposition");
    assertNonNegativeInteger(request.status, "request status");
    if (!Object.hasOwn(request, "responseStatus")
      || !Object.hasOwn(request, "terminal")
      || !Object.hasOwn(request, "failureText")) {
      throw new Error("request terminal lifecycle is incomplete");
    }
    const responseStatus = request.responseStatus;
    if (responseStatus !== null) {
      assertNonNegativeInteger(responseStatus, "request responseStatus");
      if (responseStatus < 100 || responseStatus > 599
        || request.status !== responseStatus
        || request.disposition !== "fulfilled") {
        throw new Error("runtime response authority disagrees with canonical request outcome");
      }
    } else if (request.status !== 0 || request.disposition !== "rejected") {
      throw new Error("response-less request must retain rejected transport authority");
    }
    if (!["finished", "failed"].includes(request.terminal)) {
      throw new Error("request terminal lifecycle is invalid");
    }
    if (request.terminal === "finished") {
      if (responseStatus === null || request.failureText !== null) {
        throw new Error("finished request lifecycle requires a response and no failure");
      }
    } else if (typeof request.failureText !== "string" || request.failureText.trim() === "") {
      throw new Error("failed request lifecycle requires failure text");
    }
    const url = new URL(request.url);
    if (url.origin !== authority.applicationOrigin) throw new Error(`external origin request ${request.url}`);
    const method = String(request.method).toUpperCase();
    if (!["GET", "HEAD"].includes(method)) throw new Error(`mutation method ${method} is forbidden`);
    const encoded = `${url.pathname}${url.search}`;
    let decoded;
    try { decoded = decodeURIComponent(encoded); } catch { throw new Error(`malformed encoded request ${request.url}`); }
    let decodedTwice;
    try { decodedTwice = decodeURIComponent(decoded); } catch { throw new Error(`malformed double-encoded request ${request.url}`); }
    if (decodedTwice !== decoded) throw new Error(`double-encoded request ${request.url}`);
    if (FORBIDDEN_ROUTE.test(decoded)) throw new Error(`forbidden 3D/demo/slice request ${request.url}`);
    if (request.handler === "vite-navigation") {
      const exactNavigation = `${authority.applicationOrigin}/?renderer=2d`;
      if (request.url !== exactNavigation || url.pathname !== "/" || url.search !== "?renderer=2d" || url.hash !== "" || url.username !== "" || url.password !== "") {
        throw new Error("production navigation must be exact /?renderer=2d");
      }
      if (request.kind !== "navigation" || method !== "GET" || request.disposition !== "fulfilled"
        || request.status !== 200 || request.terminal !== "finished") {
        throw new Error("production navigation request has invalid disposition");
      }
      navigationCount += 1;
    } else if (request.handler === "raw-artifact-rejection") {
      const transportAbort = request.status === 0 && request.disposition === "rejected"
        && responseStatus === null && request.terminal === "failed";
      if (!url.pathname.startsWith("/api/replay/artifacts/")
        || !transportAbort) {
        throw new Error("raw artifact request must be rejected without a response");
      }
      rawArtifactRejectionCount += 1;
    } else if (request.handler === "api-fixture") {
      const optionalMissingCheckpoint = url.pathname === "/api/replay/checkpoints/latest"
        && url.search === "" && request.status === 404;
      const boundedCheckpointPage = url.pathname === "/api/replay/checkpoints"
        && request.status === 413;
      const successful = request.status === 200 && request.terminal === "finished";
      const authoredOptional = (optionalMissingCheckpoint || boundedCheckpointPage)
        && ["finished", "failed"].includes(request.terminal);
      if (request.kind !== "api" || request.disposition !== "fulfilled"
        || (!successful && !authoredOptional)) {
        throw new Error("API fixture request has invalid disposition");
      }
    } else if (request.handler === "production-source" || request.handler === "production-asset") {
      const expectedKind = request.handler === "production-source" ? "source" : "asset";
      if (request.kind !== expectedKind || request.disposition !== "fulfilled"
        || request.status < 200 || request.status >= 300 || request.terminal !== "finished") {
        throw new Error(`${request.handler} request has invalid disposition`);
      }
    } else {
      throw new Error(`unhandled request ${request.url}`);
    }
    return {
      sequence: request.sequence,
      kind: request.kind,
      method,
      url: request.url,
      handler: request.handler,
      status: request.status,
      disposition: request.disposition,
      responseStatus,
      terminal: request.terminal,
      failureText: request.failureText,
    };
  });
  if (navigationCount < 1) throw new Error("request ledger must contain a production navigation request");
  if (rawArtifactRejectionCount < 1) throw new Error("request ledger must contain rejected raw-artifact access");
  if (sha256Buffer(Buffer.from(canonicalJson(requests))) !== trustedSummary.ledgerSha256) throw new Error("trusted request ledger hash mismatch");
  if (!sourceClosure.noThree) throw new Error("source closure is not production-2D-only");
  return { ...identity, allowedOrigin: authority.applicationOrigin, trustedObservedCount: trustedSummary.observedCount, requests, sourceClosure, verdict: { accounted: true, production2dOnly: true } };
}

function buildAssetEvidence(identity, assets) {
  const resourceCaps = PRODUCTION_RESOURCE_CAPS;
  assertObject(assets, `${identity.chronicleId} asset evidence`);
  assertObject(assets.raster, "asset raster evidence");
  if (!Array.isArray(assets.raster.imageSmoothingSamples)
    || assets.raster.imageSmoothingSamples.length === 0
    || assets.raster.imageSmoothingSamples.some((value) => value !== false)) {
    throw new Error("image smoothing must be disabled");
  }
  if (!Array.isArray(assets.raster.coordinates)
    || assets.raster.coordinates.length === 0
    || assets.raster.coordinates.some((value) => !Number.isFinite(value) || !Number.isInteger(value))) {
    throw new Error("final raster must be integer aligned");
  }
  const environmentSamples = validateCapacitySamples(assets.environmentSamples, "environment", ["activeEffects"]);
  for (const sample of environmentSamples) if (sample.activeEffects > sample.capacity) throw new Error("active effects exceed environment capacity");
  const poolSamples = validateCapacitySamples(assets.poolSamples, "pool", ["inFlightCount", "waiterCount"]);
  for (const sample of poolSamples) {
    if (sample.waiterCount > resourceCaps.maxWaiters) throw new Error(`pool waiter capacity ${resourceCaps.maxWaiters} exceeded`);
    if (sample.inFlightCount > resourceCaps.maxInFlight) throw new Error(`pool in-flight capacity ${resourceCaps.maxInFlight} exceeded`);
  }
  const settledPool = poolSamples.at(-1);
  if (settledPool.allocated !== 0 || settledPool.inFlightCount !== 0 || settledPool.waiterCount !== 0) throw new Error("pool must settle allocations, flights, and waiters");
  if (!Array.isArray(assets.atlasSamples) || assets.atlasSamples.length < 2) throw new Error("atlas samples require warm and settled phases");
  const atlasSamples = assets.atlasSamples.map((sample) => {
    assertObject(sample, "atlas sample");
    assertNonblankString(sample.phase, "atlas phase");
    for (const field of ["decodedBytes", "leases", "waiterCount", "inFlightCount"]) assertNonNegativeInteger(sample[field], `atlas ${field}`);
    if (sample.waiterCount > resourceCaps.maxWaiters) throw new Error(`atlas waiter capacity ${resourceCaps.maxWaiters} exceeded`);
    if (sample.inFlightCount > resourceCaps.maxInFlight) throw new Error(`atlas in-flight capacity ${resourceCaps.maxInFlight} exceeded`);
    return { ...sample };
  });
  const settledAtlas = atlasSamples.at(-1);
  if (settledAtlas.decodedBytes !== 0 || settledAtlas.leases !== 0 || settledAtlas.waiterCount !== 0 || settledAtlas.inFlightCount !== 0) throw new Error("atlas must settle bytes, leases, waiters, and flights");
  if (identity.chronicleId === "C16") {
    const expectedPressurePhases = C16_DENSITY_CURSORS.map((cursor) => `pressure-${cursor}`);
    if (!arraysEqual(environmentSamples.map(({ phase }) => phase), expectedPressurePhases)) throw new Error("C16 environment pressure phases must cover 1024,2048,3072,4096");
    if (!arraysEqual(poolSamples.map(({ phase }) => phase), [...expectedPressurePhases, "settled"])) throw new Error("C16 pool pressure phases must cover 1024,2048,3072,4096");
    if (!arraysEqual(atlasSamples.map(({ phase }) => phase), [...expectedPressurePhases, "settled"])) throw new Error("C16 atlas pressure phases must cover 1024,2048,3072,4096");
    const pressureAtlas = atlasSamples.slice(0, -1);
    if (new Set(pressureAtlas.map(({ decodedBytes }) => decodedBytes)).size !== 1 || new Set(pressureAtlas.map(({ leases }) => leases)).size !== 1) throw new Error("atlas pressure plateau is unstable");
    if (new Set(poolSamples.slice(0, -1).map(({ capacity }) => capacity)).size !== 1) throw new Error("pool pressure capacity is unstable");
    if (new Set(environmentSamples.map(({ capacity }) => capacity)).size !== 1) throw new Error("environment pressure capacity is unstable");
    const pressurePool = poolSamples.slice(0, -1);
    if (new Set(pressurePool.map(({ waiterCount }) => waiterCount)).size !== 1 || new Set(pressurePool.map(({ inFlightCount }) => inFlightCount)).size !== 1) throw new Error("pool pressure waiter/in-flight plateau is unstable");
    if (new Set(pressureAtlas.map(({ waiterCount }) => waiterCount)).size !== 1 || new Set(pressureAtlas.map(({ inFlightCount }) => inFlightCount)).size !== 1) throw new Error("atlas pressure waiter/in-flight plateau is unstable");
  }
  return {
    ...identity,
    raster: {
      imageSmoothingSamples: [...assets.raster.imageSmoothingSamples],
      coordinates: [...assets.raster.coordinates],
      imageSmoothingEnabled: false,
      integerAligned: true,
    },
    capacities: { ...resourceCaps },
    environmentSamples,
    poolSamples,
    atlasSamples,
    verdict: { bounded: true, settled: true },
  };
}

function validateCapacitySamples(samples, label, extraFields = []) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error(`${label} samples must be nonempty`);
  return samples.map((sample) => {
    assertObject(sample, `${label} sample`);
    for (const field of ["capacity", "allocated", ...extraFields]) assertNonNegativeInteger(sample[field], `${label} ${field}`);
    if (sample.allocated > sample.capacity) throw new Error(`${label} allocation exceeds capacity`);
    return { ...sample };
  });
}

async function buildReducedMotionEvidence(identity, reducedMotion, semantic, motion, authority) {
  assertObject(reducedMotion, `${identity.chronicleId} reduced-motion evidence`);
  const standard = await normalizeMotionMode(
    identity,
    reducedMotion.standard,
    "standard",
    authority.artifactRoot,
    {
      terminalAuthority: semantic.terminalAuthority,
      terminalObservation: semantic.terminalObservation,
      terminalCameraWitness: semantic.terminalCameraWitness,
      semanticMarkerFrames: motion.markerFrames,
    },
  );
  const reduced = await normalizeMotionMode(
    identity,
    reducedMotion.reduced,
    "reduced",
    authority.artifactRoot,
    { terminalAuthority: semantic.terminalAuthority },
  );
  if (standard.captureId === reduced.captureId) throw new Error("reduced-motion modes require distinct capture IDs");
  if (standard.recording.file === reduced.recording.file || standard.recording.sha256 === reduced.recording.sha256) throw new Error("reduced-motion modes require distinct recording artifacts");
  if (standard.markers.file === reduced.markers.file) throw new Error("reduced-motion modes require distinct marker artifacts");
  for (const mode of [standard, reduced]) {
    if ([mode.endpoints, mode.consequences, mode.markerOrder, mode.labels, mode.readingHoldsMs].some((values) => values.length === 0)) {
      throw new Error("nonempty independent reduced-motion evidence is required");
    }
    if (!arraysEqual([...mode.endpoints].sort(codeUnitCompare), semantic.endpoints)) throw new Error("reduced-motion endpoints must bind semantic evidence");
    if (!arraysEqual([...mode.consequences].sort(codeUnitCompare), semantic.consequences)) throw new Error("reduced-motion consequences must bind semantic evidence");
    if (!arraysEqual(mode.markerOrder, semantic.markers)) throw new Error("reduced-motion markers must bind semantic evidence");
    if (!arraysEqual(mode.labels, semantic.labels)) throw new Error("reduced-motion labels must bind semantic evidence");
  }
  for (const field of ["endpoints", "consequences", "markerOrder", "labels", "readingHoldsMs"]) {
    if (!arraysEqual(standard[field], reduced[field])) throw new Error(`reduced-motion ${field} parity failed`);
  }
  return { ...identity, standard, reduced, verdict: { endpointParity: true, independentlyBound: true } };
}

async function normalizeMotionMode(identity, mode, label, artifactRoot, terminalContext = null) {
  assertObject(mode, `${label} motion mode`);
  assertNonblankString(mode.captureId, `${label} captureId`);
  if (mode.mode !== label) throw new Error(`${label} capture mode must be ${label}`);
  if ([mode.endpoints, mode.consequences, mode.markerOrder, mode.labels, mode.readingHoldsMs]
    .some((values) => !Array.isArray(values) || values.length === 0)) {
    throw new Error("nonempty independent reduced-motion evidence is required");
  }
  const directory = resolveTrustedDirectory(artifactRoot, mode.artifactDirectory, `${label} artifact directory`);
  const recordingName = label === "standard" ? "recording.json" : "reduced-recording.json";
  const markersName = label === "standard" ? "markers.json" : "reduced-markers.json";
  const recordingPath = path.join(directory.absolute, recordingName);
  const markersPath = path.join(directory.absolute, markersName);
  const [recordingDocument, markerDocument] = await Promise.all([
    readNormalizedJson(recordingPath),
    readNormalizedJson(markersPath),
  ]);
  for (const [name, document] of [["recording", recordingDocument], ["markers", markerDocument]]) {
    if (document.schemaVersion !== ARTIFACT_SCHEMA_VERSION || document.chronicleId !== identity.chronicleId || document.viewport !== identity.viewport) {
      throw new Error(`${label} ${name} identity mismatch`);
    }
  }
  if (recordingDocument.fps !== 30 || !Number.isSafeInteger(recordingDocument.frameCount) || recordingDocument.frameCount <= 0) {
    throw new Error(`${label} recording must contain positive exact-30-fps frames`);
  }
  const expectedDuration = recordingDocument.frameCount * 1000 / 30;
  if (!Number.isFinite(recordingDocument.durationMs) || Math.abs(recordingDocument.durationMs - expectedDuration) > 1e-6) {
    throw new Error(`${label} recording duration must derive from frames`);
  }
  const frames = validateRecordingFrameLedger(recordingDocument, { label: `${label} recording`, fps: 30 });
  const [webmFile, mp4File] = await Promise.all([
    validateFileReference(recordingDocument.video?.webm, directory.absolute, `${label} WebM`),
    validateFileReference(recordingDocument.video?.mp4, directory.absolute, `${label} MP4`),
  ]);
  const [webmProbe, mp4Probe] = await Promise.all([probeVideo(webmFile), probeVideo(mp4File)]);
  assertProbeMatches(webmProbe, recordingDocument.video.webm.probe, `${label} WebM probe`);
  assertProbeMatches(mp4Probe, recordingDocument.video.mp4.probe, `${label} MP4 probe`);
  if (webmProbe.frameCount !== recordingDocument.frameCount || mp4Probe.frameCount !== recordingDocument.frameCount) {
    throw new Error(`${label} recording frame count drift`);
  }
  assertTimingParity(webmProbe, mp4Probe, 30);
  await validateMarkerDocument(markerDocument, { directory: directory.absolute, frameCount: recordingDocument.frameCount, fps: 30 });
  validateMarkersAgainstRecordingFrames(markerDocument, frames, `${label} recording`);
  const markerOrder = orderedStrings(mode.markerOrder, `${label} markerOrder`);
  if (!arraysEqual(markerDocument.observed.map(({ expectedMarker }) => expectedMarker), markerOrder)) {
    throw new Error(`${label} markers artifact order must bind captured marker order`);
  }
  if (!arraysEqual([...markerDocument.expected].sort(codeUnitCompare), [...markerOrder].sort(codeUnitCompare))) {
    throw new Error(`${label} markers artifact expected set mismatch`);
  }
  assertObject(terminalContext, `${label} terminal camera context`);
  assertObject(terminalContext.terminalAuthority, `${label} terminal camera authority`);
  const markerFrames = namedMarkerFrames(markerDocument, label);
  const finalMarkerFrame = markerFrames["checkpoint:final"];
  const finalRetainedFrame = frames.find(({ frameIndex }) => frameIndex === finalMarkerFrame);
  if (finalRetainedFrame === undefined) {
    throw new Error(`${label} terminal camera witness final marker lacks a retained recording frame`);
  }
  const presentationTerminal = terminalContext.terminalAuthority.presentation?.terminal;
  assertObject(presentationTerminal, `${label} presentation terminal authority`);
  if (finalRetainedFrame.observerFrameIdentity.runId !== presentationTerminal.runId
    || finalRetainedFrame.observerFrameIdentity.sourceKey !== presentationTerminal.sourceKey
    || finalRetainedFrame.observerFrameIdentity.lastCursor !== presentationTerminal.cursor) {
    throw new Error(`${label} retained recording terminal identity differs from terminal authority`);
  }
  if (label === "standard") {
    if (mode.terminalCameraWitness === undefined
      || canonicalJson(mode.terminalCameraWitness)
        !== canonicalJson(terminalContext.terminalCameraWitness)) {
      throw new Error("standard terminal camera witness is required for retained recording lineage");
    }
  } else if (mode.terminalCameraWitness === undefined) {
    throw new Error("reduced terminal camera witness is required for retained recording lineage");
  }
  if (label === "standard") {
    validateSemanticMarkerFrameBinding(
      markerDocument,
      terminalContext.semanticMarkerFrames,
      label,
    );
  }
  validateTerminalWitnessRetainedLineage(
    mode.terminalCameraWitness,
    frames,
    label,
  );
  const targetCursor = label === "standard"
    ? terminalContext.terminalObservation?.targetCursor
    : presentationTerminal.cursor;
  assertNonNegativeInteger(targetCursor, `${label} terminal camera target cursor`);
  const validateWitness = label === "reduced"
    ? validateReducedTerminalCameraWitness
    : validateTerminalCameraWitness;
  const terminalCameraWitness = validateWitness(
    mode.terminalCameraWitness,
    {
      targetCursor,
      observerFrameIdentity: finalRetainedFrame.observerFrameIdentity,
    },
    markerFrames,
  );
  const recordingBytes = readFileSync(recordingPath);
  const markerBytes = readFileSync(markersPath);
  return {
    captureId: mode.captureId,
    mode: label,
    recording: { file: `${directory.relative}/${recordingName}`, bytes: recordingBytes.length, sha256: sha256Buffer(recordingBytes), video: recordingDocument.video },
    markers: { file: `${directory.relative}/${markersName}`, bytes: markerBytes.length, sha256: sha256Buffer(markerBytes), observed: markerDocument.observed },
    endpoints: uniqueStrings(mode.endpoints, `${label} endpoints`, false),
    consequences: uniqueStrings(mode.consequences, `${label} consequences`, false),
    markerOrder,
    labels: orderedStrings(mode.labels, `${label} labels`),
    readingHoldsMs: finiteNumbers(mode.readingHoldsMs, `${label} readingHoldsMs`, false),
    terminalCameraWitness,
  };
}

function namedMarkerFrames(markerDocument, label) {
  const markerFrames = {};
  for (const marker of markerDocument.observed) {
    if (Object.hasOwn(markerFrames, marker.expectedMarker)) {
      throw new Error(`${label} retained named marker ledger contains duplicates`);
    }
    markerFrames[marker.expectedMarker] = marker.frameIndex;
  }
  return markerFrames;
}

function validateTerminalWitnessRetainedLineage(
  witness,
  frames,
  label,
) {
  const retainedByFrameIndex = new Map(frames.map((frame) => [frame.frameIndex, frame]));
  if (!Array.isArray(witness.samples)) {
    throw new Error(`${label} terminal camera witness is required for retained recording lineage`);
  }
  for (const [index, sample] of witness.samples.entries()) {
    const retained = retainedByFrameIndex.get(sample?.frameIndex);
    const mismatch = retained === undefined ? "frame index"
      : Math.abs(retained.presentationTimeMs - sample.presentationTimeMs) > 1e-9 ? "presentation time"
        : canonicalJson(retained.observerFrameIdentity) !== canonicalJson(sample.frameIdentity) ? "frame identity"
          : retained.presentedCursor !== sample.presentation?.presentedCursor ? "presented cursor"
            : retained.exactBaseCursor !== sample.world?.exactBaseCursor ? "exact base cursor"
              : retained.projectedThroughCursor !== sample.world?.projectedThroughCursor ? "projected cursor"
                : canonicalJson(retained.region) !== canonicalJson(sample.region) ? "region" : null;
    if (mismatch !== null) {
      throw new Error(
        `${label} terminal camera witness sample ${index} differs from retained recording lineage for ${mismatch}`,
      );
    }
  }
}

function validateSemanticMarkerFrameBinding(markerDocument, semanticMarkerFrames, label) {
  assertObject(semanticMarkerFrames, `${label} semantic marker frames`);
  for (const marker of markerDocument.observed) {
    if (semanticMarkerFrames[marker.expectedMarker] !== marker.frameIndex) {
      throw new Error(
        `${label} recording marker ${marker.expectedMarker} differs from semantic marker frame`,
      );
    }
  }
}

function resolveTrustedDirectory(root, relative, label) {
  assertNonblankString(relative, label);
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new Error(`${label} escapes trusted root`);
  let candidate = root;
  for (const component of relative.split(/[\\/]/).filter(Boolean)) {
    candidate = path.join(candidate, component);
    if (lstatSync(candidate).isSymbolicLink()) throw new Error(`${label} contains a symbolic link`);
  }
  const absolute = realpathSync(candidate);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) throw new Error(`${label} escapes trusted root`);
  return { absolute, relative: relative.replaceAll("\\", "/") };
}

function assertProbeMatches(observed, recorded, label) {
  assertObject(recorded, label);
  for (const field of ["codec", "width", "height", "frameCount", "fpsNumerator", "fpsDenominator", "durationSeconds", "timeBase", "startTimeSeconds"]) {
    if (observed[field] !== recorded[field]) throw new Error(`${label} mismatch for ${field}`);
  }
}

function buildViewportDocument(identity, metrics) {
  assertObject(metrics, `${identity.viewport} viewport evidence`);
  const expected = EXPECTED_VIEWPORTS[identity.viewport];
  if (metrics.width !== expected.width || metrics.height !== expected.height) throw new Error(`${identity.viewport} viewport must be ${expected.width}x${expected.height}`);
  if (!Number.isFinite(metrics.devicePixelRatio) || metrics.devicePixelRatio <= 0) throw new Error("devicePixelRatio must be positive and finite");
  return { ...identity, width: metrics.width, height: metrics.height, devicePixelRatio: metrics.devicePixelRatio };
}

function uniqueStrings(values, label, requireNonempty) {
  const ordered = orderedStrings(values, label);
  if (requireNonempty && ordered.length === 0) throw new Error(`${label} must be nonempty`);
  const sorted = [...ordered].sort(codeUnitCompare);
  if (new Set(sorted).size !== sorted.length) throw new Error(`${label} contains duplicates`);
  return sorted;
}

function orderedNonemptyStrings(values, label) {
  const result = orderedStrings(values, label);
  if (result.length === 0) throw new Error(`${label} must be nonempty`);
  return result;
}

function orderedStrings(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.trim() === "")) throw new Error(`${label} must contain nonblank strings`);
  return [...values];
}

function finiteNumbers(values, label, requireNonempty) {
  if (!Array.isArray(values) || (requireNonempty && values.length === 0) || values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error(`${label} must contain finite non-negative numbers`);
  return [...values];
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
}

function assertFiniteNonNegativeNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
}

function assertNonblankString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be nonblank`);
}

function assertHash(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256 hash`);
}

function arraysEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Throw loudly unless every id in `subset` appears in `superset`, in the same relative
 * order. Catches both an id captured-but-not-cataloged and an id typo, without requiring
 * `subset` to be a contiguous prefix of `superset`.
 */
function assertOrderedSubset(subset, superset, subsetLabel, supersetLabel) {
  let cursor = 0;
  for (const id of subset) {
    const foundAt = superset.indexOf(id, cursor);
    if (foundAt === -1) {
      throw new Error(`${subsetLabel} entry ${id} is missing from ${supersetLabel} (or out of catalog order)`);
    }
    cursor = foundAt + 1;
  }
}

function codeUnitCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepCloneFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map((item) => deepCloneFreeze(item)));
  const clone = {};
  for (const key of Object.keys(value)) clone[key] = deepCloneFreeze(value[key]);
  return Object.freeze(clone);
}
