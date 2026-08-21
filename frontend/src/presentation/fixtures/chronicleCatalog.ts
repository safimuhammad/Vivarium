import rawCatalog from "../../../../tests/frontend-app/fixtures/chronicles/data/catalog.json";
import rawC00 from "../../../../tests/frontend-app/fixtures/chronicles/data/C00-world-four-regions-topology.json";
import rawC01 from "../../../../tests/frontend-app/fixtures/chronicles/data/C01-movement-local-path.json";
import rawC02 from "../../../../tests/frontend-app/fixtures/chronicles/data/C02-travel-all-regions.json";
import rawC03 from "../../../../tests/frontend-app/fixtures/chronicles/data/C03-resources-harvest-hoard-transfer.json";
import rawC04 from "../../../../tests/frontend-app/fixtures/chronicles/data/C04-mating-proposal-birth.json";
import rawC05 from "../../../../tests/frontend-app/fixtures/chronicles/data/C05-mating-failure-branches.json";
import rawC06 from "../../../../tests/frontend-app/fixtures/chronicles/data/C06-home-build-hearth-stake-vault.json";
import rawC07 from "../../../../tests/frontend-app/fixtures/chronicles/data/C07-home-contest-thieve.json";
import rawC08 from "../../../../tests/frontend-app/fixtures/chronicles/data/C08-home-contest-colonize.json";
import rawC09 from "../../../../tests/frontend-app/fixtures/chronicles/data/C09-home-silent-repair-collapse-ruin.json";
import rawC10 from "../../../../tests/frontend-app/fixtures/chronicles/data/C10-combat-hit-paralyze-recover.json";
import rawC11 from "../../../../tests/frontend-app/fixtures/chronicles/data/C11-combat-lethal-death-decay.json";
import rawC12 from "../../../../tests/frontend-app/fixtures/chronicles/data/C12-cross-region-causal-life-story.json";
import rawC13 from "../../../../tests/frontend-app/fixtures/chronicles/data/C13-presentation-backlog-pause-resume.json";
import rawC14 from "../../../../tests/frontend-app/fixtures/chronicles/data/C14-transport-reconnect-checkpoint-recovery.json";
import rawC15 from "../../../../tests/frontend-app/fixtures/chronicles/data/C15-archive-live-isolation.json";
import rawC16 from "../../../../tests/frontend-app/fixtures/chronicles/data/C16-pressure-4096-envelopes.json";
import rawC17 from "../../../../tests/frontend-app/fixtures/chronicles/data/C17-communication-perception-privacy.json";
import rawC18 from "../../../../tests/frontend-app/fixtures/chronicles/data/C18-grand-tour-all-events.json";
import rawC19 from "../../../../tests/frontend-app/fixtures/chronicles/data/C19-two-beings.json";

import {
  parseEventEnvelope,
  parseWorldSnapshot,
  type EventEnvelopeEntry,
  type WorldSnapshot,
} from "../../app/schemas";
import { parseSnapshotCheckpoint } from "../../app/replayArtifacts";
import { parsePresentedEvent } from "../eventPayloads";
import type { ClassifiedCheckpointRecord, PresentationSource } from "../contracts";

export const FIXTURE_PRESENTATION_SOURCE = "fixture" satisfies PresentationSource;

export const CHRONICLE_IDS = [
  "C00", "C01", "C02", "C03", "C04", "C05",
  "C06", "C07", "C08", "C09", "C10", "C11",
  "C12", "C13", "C14", "C15", "C16", "C17",
  "C18", "C19",
] as const;

export type ChronicleId = (typeof CHRONICLE_IDS)[number];

export type ChroniclePresentationAuthorityKind =
  | "mechanic-story"
  | "silent-checkpoint"
  | "transport-recovery"
  | "archive-live-isolation";

export interface ChroniclePresentationTerminalAuthority {
  readonly source: "live";
  readonly runId: string;
  readonly sourceKey: string;
  readonly cursor: number;
}

export interface ChroniclePresentationAuthority {
  readonly kind: ChroniclePresentationAuthorityKind;
  readonly terminal: ChroniclePresentationTerminalAuthority;
}

export interface ChronicleTerminalAuthority {
  readonly mechanic: Readonly<{
    runId: string;
    finalCursor: number;
    finalSnapshot: WorldSnapshot;
  }>;
  readonly presentation: Readonly<{
    kind: ChroniclePresentationAuthorityKind;
    terminal: ChroniclePresentationTerminalAuthority & Readonly<{
      snapshot: WorldSnapshot;
    }>;
  }>;
}

export type ChronicleExpectedTerminal = Readonly<Record<string, unknown> & {
  readonly finalSnapshot: WorldSnapshot;
  readonly presentationAuthority: ChroniclePresentationAuthority;
}>;

const CHRONICLE_SLUGS: Readonly<Record<ChronicleId, string>> = Object.freeze({
  C00: "world-four-regions-topology",
  C01: "movement-local-path",
  C02: "travel-all-regions",
  C03: "resources-harvest-hoard-transfer",
  C04: "mating-proposal-birth",
  C05: "mating-failure-branches",
  C06: "home-build-hearth-stake-vault",
  C07: "home-contest-thieve",
  C08: "home-contest-colonize",
  C09: "home-silent-repair-collapse-ruin",
  C10: "combat-hit-paralyze-recover",
  C11: "combat-lethal-death-decay",
  C12: "cross-region-causal-life-story",
  C13: "presentation-backlog-pause-resume",
  C14: "transport-reconnect-checkpoint-recovery",
  C15: "archive-live-isolation",
  C16: "pressure-4096-envelopes",
  C17: "communication-perception-privacy",
  C18: "grand-tour-all-events",
  C19: "two-beings",
});

const CHRONICLE_POSITIVE_ORACLES: Readonly<Record<ChronicleId, readonly string[]>> =
  Object.freeze({
    C00: ["four-region-topology", "observer-checkpoint"],
    C01: ["local-movement"],
    C02: ["all-directed-edges", "forbidden-shortcut"],
    C03: ["harvest", "transfer", "hoard-threshold"],
    C04: ["local-proposal", "remote-proposal", "escrow", "birth-at-acceptor", "newborn"],
    C05: ["reject", "invalidation", "timeout-refund", "cooldown", "population-cap"],
    C06: [
      "component-build", "shelter-scale", "hearth", "pledge-leave", "vault",
      "owner-promotion", "hoard-transition",
    ],
    C07: [
      "partial-damage", "repair-pressure", "breach", "recipient-split",
      "standing-zero-integrity",
    ],
    C08: [
      "coordinated-damage", "breach", "ownership-transition",
      "stakeholder-replacement", "no-theft",
    ],
    C09: [
      "checkpoint-only-repair", "checkpoint-only-upkeep", "collapse",
      "zero-remnant", "nonzero-remnant", "scavenge", "silent-sweep",
    ],
    C10: ["nonlethal-hit", "paralysis", "rescue-order", "recovery", "exact-balances"],
    C11: ["lethal-priority", "loot", "corpse", "terminal-death", "decay-removal"],
    C12: ["travel", "social", "resources", "shelter", "birth", "rescue", "rare-drama"],
    C13: ["120-envelopes", "pause", "bounded-queue", "safe-cancel", "chronology-digest"],
    C14: ["gap", "reconnect", "snapshot-retry", "413", "replacement", "stale-reject"],
    C15: ["observer-frame", "isolated-sessions", "bounded-live-ingestion"],
    C16: ["4096-envelopes", "256-agents", "128-homes", "stable-placement", "closure"],
    C17: [
      "look-around", "local-speech", "remote-whisper", "private-self-talk",
      "cost-validation", "attribution", "no-invented-delivery",
    ],
    C18: [
      "gather-and-hoard", "court-three-branches-plus-invalidated", "home-lifecycle",
      "contest-thieve-then-colonize", "nonlethal-attack-then-rescue",
      "lethal-attack-then-decay", "collapse-then-scavenge", "closing-travel-and-privacy",
    ],
    C19: [
      "solitary-gather-and-shared-hearth", "courtship-rejected-then-accepted",
      "theft-then-seizure", "violence-then-mercy", "death-decay-collapse-and-scavenge",
    ],
  });

export interface ChronicleManifest {
  readonly id: ChronicleId;
  readonly slug: string;
  readonly version: 1;
  readonly seed: number;
  readonly runId: string;
  readonly initialSnapshot: WorldSnapshot;
  readonly entries: readonly EventEnvelopeEntry[];
  readonly checkpoints: readonly ClassifiedCheckpointRecord[];
  readonly expectedMarkers: readonly string[];
  readonly expectedFinalCursor: number;
  readonly expectedTerminal: ChronicleExpectedTerminal;
  readonly negativeAssertions: readonly string[];
}

export interface ChronicleCatalogEntry {
  readonly id: ChronicleId;
  readonly slug: string;
  readonly file: string;
  readonly version: 1;
  readonly seed: number;
  readonly runId: string;
  readonly expectedFinalCursor: number;
}

const RAW_MANIFESTS: readonly unknown[] = [
  rawC00, rawC01, rawC02, rawC03, rawC04, rawC05,
  rawC06, rawC07, rawC08, rawC09, rawC10, rawC11,
  rawC12, rawC13, rawC14, rawC15, rawC16, rawC17,
  rawC18, rawC19,
];

const parsedManifests = RAW_MANIFESTS.map(parseChronicleManifest);

export const CHRONICLE_CATALOG = Object.freeze(
  Object.fromEntries(
    parsedManifests.map((manifest) => [manifest.id, manifest]),
  ) as Record<ChronicleId, ChronicleManifest>,
);

export const CHRONICLE_CATALOG_INDEX = parseCatalogIndex(rawCatalog);

/** Returns one validated, generated Chronicle manifest by its frozen ID. */
export function getChronicleManifest(id: ChronicleId): ChronicleManifest {
  return CHRONICLE_CATALOG[id];
}

/** Resolves independent mechanic and visible-terminal truth for one Chronicle. */
export function chronicleTerminalAuthority(
  manifest: ChronicleManifest,
): ChronicleTerminalAuthority {
  const finalSnapshot = deepFreezeClone(manifest.expectedTerminal.finalSnapshot);
  const presentation = manifest.expectedTerminal.presentationAuthority;
  const presentationSnapshot = chroniclePresentationSnapshot(manifest);
  return Object.freeze({
    mechanic: Object.freeze({
      runId: manifest.runId,
      finalCursor: manifest.expectedFinalCursor,
      finalSnapshot,
    }),
    presentation: Object.freeze({
      kind: presentation.kind,
      terminal: Object.freeze({
        ...presentation.terminal,
        snapshot: presentationSnapshot,
      }),
    }),
  });
}

/** Derives the exact visible terminal snapshot without aliasing catalog state. */
export function chroniclePresentationSnapshot(manifest: ChronicleManifest): WorldSnapshot {
  const presentation = manifest.expectedTerminal.presentationAuthority;
  const snapshot = presentation.kind === "mechanic-story"
    || presentation.kind === "silent-checkpoint"
    ? structuredClone(manifest.expectedTerminal.finalSnapshot)
    : {
      ...structuredClone(manifest.initialSnapshot),
      run_id: presentation.terminal.runId,
      event_cursor: presentation.terminal.cursor,
      world_time: manifest.initialSnapshot.world_time + presentation.terminal.cursor,
    };
  return deepFreeze(snapshot);
}

/** Creates the source key used when fixture evidence enters production ingress. */
export function fixtureSourceKey(runId: string): string {
  if (runId.trim() === "") throw new Error("fixture runId must not be empty");
  return `${FIXTURE_PRESENTATION_SOURCE}:${runId}`;
}

/** Validates one generated manifest through the production payload parsers. */
export function parseChronicleManifest(value: unknown): ChronicleManifest {
  const input = objectOf(value, "Chronicle manifest");
  assertExactKeys(input, [
    "id",
    "slug",
    "version",
    "seed",
    "runId",
    "initialSnapshot",
    "entries",
    "checkpoints",
    "expectedMarkers",
    "expectedFinalCursor",
    "expectedTerminal",
    "negativeAssertions",
  ]);

  const id = chronicleIdOf(input.id);
  const slug = stringOf(input.slug, "manifest slug");
  if (slug !== CHRONICLE_SLUGS[id]) {
    throw new Error("manifest slug must match its frozen Chronicle id");
  }
  if (input.version !== 1) throw new Error("Chronicle manifest must use version 1");
  const seed = safeIntegerOf(input.seed, "manifest seed");
  if (seed !== 30_000 + Number(id.slice(1))) {
    throw new Error("manifest seed must match its frozen Chronicle id");
  }
  const runId = stringOf(input.runId, "manifest runId");
  if (runId !== `mock-${id.toLowerCase()}-v1`) {
    throw new Error("manifest runId must match its frozen Chronicle id");
  }
  const initialSnapshot = parseWorldSnapshot(input.initialSnapshot);
  if (initialSnapshot.event_cursor !== 0) {
    throw new Error("manifest initialSnapshot.event_cursor must be zero");
  }
  if (runId !== initialSnapshot.run_id) {
    throw new Error("manifest runId must match initialSnapshot.run_id");
  }

  if (!Array.isArray(input.entries)) throw new Error("manifest entries must be an array");
  const expectedFinalCursor = safeIntegerOf(
    input.expectedFinalCursor,
    "manifest expectedFinalCursor",
  );
  const entries = parseEventEnvelope({
    schema: 1,
    cursor: 0,
    oldest_cursor: input.entries.length === 0 ? 0 : 1,
    next_cursor: expectedFinalCursor,
    events: input.entries,
    overflow: false,
    snapshot_required: false,
  }).events;
  entries.forEach((entry, index) => {
    if (entry.cursor !== index + 1) {
      throw new Error("manifest entries must have contiguous cursors starting at 1");
    }
    const previous = entries[index - 1];
    if (previous !== undefined && entry.event.timestamp < previous.event.timestamp) {
      throw new Error("manifest event timestamps must be nondecreasing");
    }
    const parsed = parsePresentedEvent(entry);
    if (!parsed.known) {
      throw new Error("manifest event type must belong to the canonical 28-event catalog");
    }
  });
  if (
    entries[0] !== undefined
    && entries[0].event.timestamp < initialSnapshot.world_time
  ) {
    throw new Error("manifest first event cannot precede initialSnapshot.world_time");
  }
  const finalEntryCursor = entries.at(-1)?.cursor ?? 0;
  if (expectedFinalCursor !== finalEntryCursor) {
    throw new Error("manifest expectedFinalCursor must equal its final entry cursor");
  }

  if (!Array.isArray(input.checkpoints)) {
    throw new Error("manifest checkpoints must be an array");
  }
  if (input.checkpoints.length === 0) {
    throw new Error("manifest must contain at least one checkpoint");
  }
  const checkpoints = input.checkpoints.map((value, index) => {
    const record = objectOf(value, `manifest checkpoint ${index + 1}`);
    assertExactKeys(record, ["line", "checkpoint", "safety"]);
    const line = positiveSafeIntegerOf(record.line, "checkpoint line");
    const safety = checkpointSafetyOf(record.safety);
    const checkpoint = parseSnapshotCheckpoint(record.checkpoint);
    if (safety !== checkpointSafetyForReason(checkpoint.reason)) {
      throw new Error("checkpoint safety must match its reason");
    }
    if (checkpoint.run_id !== runId) {
      throw new Error("manifest checkpoint run_id must match manifest runId");
    }
    return { line, checkpoint, safety } satisfies ClassifiedCheckpointRecord;
  });
  checkpoints.forEach((record, index) => {
    const previous = checkpoints[index - 1];
    if (previous !== undefined && record.line <= previous.line) {
      throw new Error("manifest checkpoint lines must be strictly increasing");
    }
    if (
      previous !== undefined
      && record.checkpoint.event_cursor < previous.checkpoint.event_cursor
    ) {
      throw new Error("manifest checkpoint cursors must be nondecreasing");
    }
    if (
      previous !== undefined
      && record.checkpoint.world_time < previous.checkpoint.world_time
    ) {
      throw new Error("manifest checkpoint world times must be nondecreasing");
    }
    if (record.checkpoint.event_cursor > expectedFinalCursor) {
      throw new Error("manifest checkpoint cursor cannot exceed expectedFinalCursor");
    }
    const causalEntry = entries[record.checkpoint.event_cursor - 1];
    if (
      causalEntry !== undefined
      && record.checkpoint.world_time < causalEntry.event.timestamp
    ) {
      throw new Error("manifest checkpoint time cannot precede its cursor event");
    }
  });
  if (checkpoints.at(-1)?.checkpoint.event_cursor !== expectedFinalCursor) {
    throw new Error("manifest final checkpoint must align with expectedFinalCursor");
  }

  const expectedMarkers = stringArrayOf(input.expectedMarkers, "expectedMarkers");
  const eventTypeCounts = new Map<string, number>();
  for (const entry of entries) {
    eventTypeCounts.set(entry.event.type, (eventTypeCounts.get(entry.event.type) ?? 0) + 1);
  }
  const occurrenceQualifiedTypes = new Set(expectedMarkers.flatMap((marker) => {
    const match = /^event:([^@]+)@cursor:\d+$/.exec(marker);
    return match?.[1] === undefined ? [] : [match[1]];
  }));
  const requiredMarkers = [...new Set(entries.map((entry) => (
    eventTypeCounts.get(entry.event.type) === 1
      || !occurrenceQualifiedTypes.has(entry.event.type)
      ? `event:${entry.event.type}`
      : `event:${entry.event.type}@cursor:${entry.cursor}`
  )))].sort();
  requiredMarkers.push("checkpoint:final");
  if (JSON.stringify(expectedMarkers) !== JSON.stringify(requiredMarkers)) {
    throw new Error("manifest expectedMarkers must exactly describe its event types");
  }
  const negativeAssertions = stringArrayOf(
    input.negativeAssertions,
    "negativeAssertions",
  );
  const expectedTerminalInput = objectOf(
    input.expectedTerminal,
    "manifest expectedTerminal",
  );
  const expectedTerminal: Record<string, unknown> = { ...expectedTerminalInput };
  validateSemanticOracle(id, expectedTerminalInput.semanticOracle, negativeAssertions);
  if (expectedTerminalInput.finalSnapshot === undefined) {
    throw new Error("manifest expectedTerminal.finalSnapshot is required");
  }
  const finalSnapshot = parseWorldSnapshot(expectedTerminalInput.finalSnapshot);
  if (finalSnapshot.run_id !== runId) {
    throw new Error("terminal finalSnapshot run_id must match manifest runId");
  }
  expectedTerminal.finalSnapshot = finalSnapshot;
  const finalCheckpoint = checkpoints.at(-1)?.checkpoint;
  if (
    finalCheckpoint === undefined
    || finalSnapshot.event_cursor !== expectedFinalCursor
    || finalSnapshot.world_time !== finalCheckpoint.world_time
    || JSON.stringify(finalSnapshot) !== JSON.stringify(finalCheckpoint.snapshot)
  ) {
    throw new Error("terminal finalSnapshot must equal the final checkpoint snapshot");
  }
  expectedTerminal.presentationAuthority = parsePresentationAuthority(
    id,
    runId,
    expectedFinalCursor,
    expectedTerminalInput.presentationAuthority,
  );
  validateEventlessManifestAuthority(
    id,
    entries,
    expectedFinalCursor,
    checkpoints,
    expectedTerminal,
  );

  return deepFreeze({
    id,
    slug,
    version: 1,
    seed,
    runId,
    initialSnapshot,
    entries: Object.freeze(entries),
    checkpoints: Object.freeze(checkpoints),
    expectedMarkers: Object.freeze(expectedMarkers),
    expectedFinalCursor,
    expectedTerminal: Object.freeze(expectedTerminal) as ChronicleExpectedTerminal,
    negativeAssertions: Object.freeze(negativeAssertions),
  });
}

function validateEventlessManifestAuthority(
  id: ChronicleId,
  entries: readonly EventEnvelopeEntry[],
  expectedFinalCursor: number,
  checkpoints: readonly ClassifiedCheckpointRecord[],
  terminal: Record<string, unknown>,
): void {
  if (id !== "C00" && id !== "C14" && id !== "C15") return;
  if (entries.length !== 0 || expectedFinalCursor !== 0
    || checkpoints.some(({ checkpoint }) => checkpoint.event_cursor !== 0)) {
    throw new Error(`${id} eventless authority requires zero mechanic entries, final cursor, and checkpoints`);
  }
  const authorship = objectOf(terminal.fixtureAuthorship, `${id} fixtureAuthorship`);
  assertExactKeys(authorship, [
    "handAuthoredEnvelopeCount", "labeled", "mechanicEventsFabricated", "recordCount",
  ]);
  if (authorship.handAuthoredEnvelopeCount !== 0) {
    throw new Error(`${id} handAuthoredEnvelopeCount must be zero`);
  }
  if (authorship.labeled !== true || authorship.mechanicEventsFabricated !== false) {
    throw new Error(`${id} fixtureAuthorship must label zero fabricated mechanic events`);
  }
  if (!Array.isArray(terminal.presentationRecords)) {
    throw new Error(`${id} presentationRecords must be an array`);
  }
  const records = terminal.presentationRecords.map((value, index) => {
    const record = objectOf(value, `${id} presentation record ${index + 1}`);
    assertExactKeys(record, ["kind", "label", "payload", "schema"]);
    if (record.schema !== 1) throw new Error(`${id} presentation record schema must be 1`);
    return record;
  });
  if (authorship.recordCount !== records.length) {
    throw new Error(`${id} fixtureAuthorship recordCount must match presentationRecords`);
  }
  if (id === "C00") {
    if (records.length !== 0) throw new Error("C00 must not fabricate presentation records");
    return;
  }
  if (id === "C14") {
    const expected = [
      ["transport-fault", "cursor-gap", { firstMissingCursor: 1, lastMissingCursor: 2 }],
      ["transport-fault", "oversized-record-413", { retryable: false }],
      ["transport-fault", "run-replacement", { staleRunRejected: true }],
    ] as const;
    if (records.length !== expected.length || records.some((record, index) => {
      const [kind, label, payload] = expected[index]!;
      return record.kind !== kind || record.label !== label
        || JSON.stringify(record.payload) !== JSON.stringify(payload);
    })) {
      throw new Error("C14 presentation records must prove gap 1-2, 413, replacement, and stale rejection");
    }
    const authority = terminal.presentationAuthority as ChroniclePresentationAuthority;
    if (authority.terminal.runId !== "mock-c14-v1-replacement"
      || authority.terminal.cursor !== 0) {
      throw new Error("C14 records must bind the exact replacement presentationAuthority");
    }
    return;
  }
  const record = records[0];
  const payload = record?.payload;
  const authority = terminal.presentationAuthority as ChroniclePresentationAuthority;
  if (records.length !== 1 || record?.kind !== "session-edge"
    || record.label !== "archive-live-isolation"
    || JSON.stringify(payload) !== JSON.stringify({ archiveCursor: 2, liveCursor: 4 })
    || authority.terminal.cursor !== 4) {
    throw new Error("C15 presentation record must prove Archive 2 and Live 4 authority");
  }
}

function parsePresentationAuthority(
  id: ChronicleId,
  mechanicRunId: string,
  mechanicFinalCursor: number,
  value: unknown,
): ChroniclePresentationAuthority {
  const expected = expectedPresentationTerminal(id, mechanicRunId, mechanicFinalCursor);
  if (value === undefined) {
    if (id === "C00" || id === "C14" || id === "C15") {
      throw new Error(`${id} must author presentationAuthority explicitly`);
    }
    return freezePresentationAuthority("mechanic-story", expected);
  }

  const authority = objectOf(value, "manifest presentationAuthority");
  assertExactKeys(authority, ["kind", "terminal"]);
  const expectedKind = expectedPresentationKind(id);
  if (authority.kind !== expectedKind) {
    throw new Error(`manifest presentationAuthority kind must be ${expectedKind}`);
  }
  const terminal = objectOf(authority.terminal, "manifest presentation terminal");
  assertExactKeys(terminal, ["source", "runId", "sourceKey", "cursor"]);
  if (terminal.source !== "live") {
    throw new Error("presentation terminal source must be Live");
  }
  const runId = stringOf(terminal.runId, "presentation terminal runId");
  const sourceKey = stringOf(terminal.sourceKey, "presentation terminal sourceKey");
  const cursor = safeIntegerOf(terminal.cursor, "presentation terminal cursor");
  if (sourceKey !== `live:${runId}`) {
    throw new Error("presentation terminal sourceKey must exactly identify its Live run");
  }
  if (runId !== expected.runId || cursor !== expected.cursor) {
    throw new Error(`${id} presentation terminal must match its authored Live endpoint`);
  }
  return freezePresentationAuthority(expectedKind, { source: "live", runId, sourceKey, cursor });
}

function expectedPresentationKind(id: ChronicleId): ChroniclePresentationAuthorityKind {
  switch (id) {
    case "C00": return "silent-checkpoint";
    case "C14": return "transport-recovery";
    case "C15": return "archive-live-isolation";
    default: return "mechanic-story";
  }
}

function expectedPresentationTerminal(
  id: ChronicleId,
  mechanicRunId: string,
  mechanicFinalCursor: number,
): ChroniclePresentationTerminalAuthority {
  switch (id) {
    case "C14":
      return Object.freeze({
        source: "live",
        runId: `${mechanicRunId}-replacement`,
        sourceKey: `live:${mechanicRunId}-replacement`,
        cursor: 0,
      });
    case "C15":
      return Object.freeze({
        source: "live",
        runId: mechanicRunId,
        sourceKey: `live:${mechanicRunId}`,
        cursor: 4,
      });
    default:
      return Object.freeze({
        source: "live",
        runId: mechanicRunId,
        sourceKey: `live:${mechanicRunId}`,
        cursor: mechanicFinalCursor,
      });
  }
}

function freezePresentationAuthority(
  kind: ChroniclePresentationAuthorityKind,
  terminal: ChroniclePresentationTerminalAuthority,
): ChroniclePresentationAuthority {
  return Object.freeze({ kind, terminal: Object.freeze({ ...terminal }) });
}

function validateSemanticOracle(
  id: ChronicleId,
  value: unknown,
  negativeAssertions: readonly string[],
): void {
  const oracle = objectOf(value, "manifest semanticOracle");
  assertExactKeys(oracle, ["positive", "negative", "terminal"]);
  const positive = stringArrayOf(oracle.positive, "semanticOracle positive");
  const negative = stringArrayOf(oracle.negative, "semanticOracle negative");
  const terminal = stringArrayOf(oracle.terminal, "semanticOracle terminal");
  if (JSON.stringify(positive) !== JSON.stringify(CHRONICLE_POSITIVE_ORACLES[id])) {
    throw new Error("manifest semanticOracle positive contract does not match its Chronicle id");
  }
  if (JSON.stringify(negative) !== JSON.stringify(negativeAssertions)) {
    throw new Error("manifest semanticOracle negative contract must match negativeAssertions");
  }
  if (
    JSON.stringify(terminal)
    !== JSON.stringify(["final-checkpoint-aligned", "run-identity-preserved"])
  ) {
    throw new Error("manifest semanticOracle terminal contract is invalid");
  }
}

function parseCatalogIndex(value: unknown): readonly ChronicleCatalogEntry[] {
  const input = objectOf(value, "Chronicle catalog index");
  assertExactKeys(input, ["schema", "chronicles"]);
  if (input.schema !== 1) throw new Error("Chronicle catalog must use schema 1");
  if (!Array.isArray(input.chronicles)) {
    throw new Error("Chronicle catalog chronicles must be an array");
  }
  const entries = input.chronicles.map((value, index): ChronicleCatalogEntry => {
    const entry = objectOf(value, `Chronicle catalog entry ${index + 1}`);
    assertExactKeys(entry, [
      "expectedFinalCursor",
      "file",
      "id",
      "runId",
      "seed",
      "slug",
      "version",
    ]);
    const id = chronicleIdOf(entry.id);
    const manifest = CHRONICLE_CATALOG[id];
    const parsed: ChronicleCatalogEntry = {
      id,
      slug: stringOf(entry.slug, "catalog slug"),
      file: stringOf(entry.file, "catalog file"),
      version: entry.version === 1
        ? 1
        : (() => { throw new Error("Chronicle catalog entry must use version 1"); })(),
      seed: safeIntegerOf(entry.seed, "catalog seed"),
      runId: stringOf(entry.runId, "catalog runId"),
      expectedFinalCursor: safeIntegerOf(
        entry.expectedFinalCursor,
        "catalog expectedFinalCursor",
      ),
    };
    const expectedFile = `${manifest.id}-${manifest.slug}.json`;
    if (
      parsed.slug !== manifest.slug
      || parsed.file !== expectedFile
      || parsed.seed !== manifest.seed
      || parsed.runId !== manifest.runId
      || parsed.expectedFinalCursor !== manifest.expectedFinalCursor
    ) {
      throw new Error(`Chronicle catalog entry ${id} does not match its manifest`);
    }
    return Object.freeze(parsed);
  });
  if (
    entries.length !== CHRONICLE_IDS.length
    || entries.some((entry, index) => entry.id !== CHRONICLE_IDS[index])
  ) {
    throw new Error("Chronicle catalog index must contain ordered C00-C19 entries");
  }
  return Object.freeze(entries);
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`Unexpected keys: expected ${wanted.join(", ")}`);
  }
}

function stringOf(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function safeIntegerOf(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function positiveSafeIntegerOf(value: unknown, label: string): number {
  const parsed = safeIntegerOf(value, label);
  if (parsed === 0) throw new Error(`${label} must be positive`);
  return parsed;
}

function stringArrayOf(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => stringOf(item, `${label}[${index}]`));
}

function chronicleIdOf(value: unknown): ChronicleId {
  if (typeof value !== "string" || !CHRONICLE_IDS.includes(value as ChronicleId)) {
    throw new Error("manifest id must be one of C00-C19");
  }
  return value as ChronicleId;
}

function checkpointSafetyOf(
  value: unknown,
): ClassifiedCheckpointRecord["safety"] {
  if (
    value !== "safe-world-tick"
    && value !== "archive-event"
    && value !== "archive-manual"
  ) {
    throw new Error("checkpoint safety classification is invalid");
  }
  return value;
}

function checkpointSafetyForReason(
  reason: string,
): ClassifiedCheckpointRecord["safety"] {
  if (reason === "world_tick") return "safe-world-tick";
  if (reason.startsWith("event:")) return "archive-event";
  return "archive-manual";
}

function deepFreezeClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
