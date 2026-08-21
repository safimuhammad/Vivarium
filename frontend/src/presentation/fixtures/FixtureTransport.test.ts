import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createPresentationIngress } from "../PresentationIngress";
import {
  FIXTURE_PRESENTATION_SOURCE,
  fixtureSourceKey,
  getChronicleManifest,
  type ChronicleManifest,
} from "./chronicleCatalog";
import {
  createFixtureTransport,
  type FixtureTransport,
  type FixtureTransportCallbacks,
} from "./FixtureTransport";

function makeIngressCallbacks(order: string[] = []): {
  callbacks: FixtureTransportCallbacks;
  ingress: ReturnType<typeof createPresentationIngress>;
} {
  const ingress = createPresentationIngress();
  const callbacks: FixtureTransportCallbacks = {
    onRunAccepted(run, disposition): void {
      order.push(`run:${disposition}:${run.provider}`);
      ingress.reset({
        runId: run.run_id,
        sourceKey: fixtureSourceKey(run.run_id),
        cursor: run.event_cursor,
      });
    },
    onSnapshotAccepted(snapshot): void {
      order.push(`snapshot:${snapshot.event_cursor}`);
      ingress.onSnapshotAccepted(snapshot);
    },
    onEnvelopeAccepted(envelope): void {
      order.push(`envelope:${envelope.next_cursor}`);
      ingress.onEnvelopeAccepted(envelope);
    },
    onCheckpointAccepted(record): void {
      order.push(`checkpoint:${record.line}`);
      ingress.onCheckpointAccepted(record);
    },
  };
  return { callbacks, ingress };
}

function withEntries(
  manifest: ChronicleManifest,
  cursors: readonly number[],
): ChronicleManifest {
  const template = getChronicleManifest("C12").entries[0];
  return {
    ...manifest,
    entries: cursors.map((cursor) => ({ ...template, cursor })),
    expectedFinalCursor: Math.max(0, ...cursors),
    checkpoints: [],
  };
}

function expectedDeliveryOrder(manifest: ChronicleManifest): string[] {
  return [
    ...manifest.entries.map((entry) => ({
      cursor: entry.cursor,
      kindOrder: 0,
      lineOrder: 0,
      label: `envelope:${entry.cursor}`,
    })),
    ...manifest.checkpoints.map((record) => ({
      cursor: record.checkpoint.event_cursor,
      kindOrder: 1,
      lineOrder: record.line,
      label: `checkpoint:${record.line}`,
    })),
  ]
    .sort((left, right) => (
      left.cursor - right.cursor
      || left.kindOrder - right.kindOrder
      || left.lineOrder - right.lineOrder
    ))
    .map((item) => item.label);
}

describe("FixtureTransport", () => {
  it("uses fixture identity and the same run, snapshot, envelope, checkpoint callback order as Live", () => {
    const order: string[] = [];
    const { callbacks, ingress } = makeIngressCallbacks(order);
    const transport = createFixtureTransport(callbacks);
    const manifest = getChronicleManifest("C12");

    transport.start(manifest);
    transport.deliverThroughCursor(2);
    transport.deliverThroughCursor(2);
    transport.deliverAll();

    expect(FIXTURE_PRESENTATION_SOURCE).toBe("fixture");
    expect(order).toEqual([
      "run:initial:fixture",
      "snapshot:0",
      ...expectedDeliveryOrder(manifest),
    ]);
    expect(ingress.getSnapshot()).toEqual({
      runId: manifest.runId,
      sourceKey: `fixture:${manifest.runId}`,
      ingestedCursor: manifest.expectedFinalCursor,
      acceptedCount: manifest.entries.length,
      duplicateCount: 0,
      gaps: [],
    });
  });

  it("leaves duplicate and gap ownership with production PresentationIngress", () => {
    const duplicateHarness = makeIngressCallbacks();
    const duplicateTransport = createFixtureTransport(duplicateHarness.callbacks);
    duplicateTransport.start(withEntries(getChronicleManifest("C12"), [1, 1]));
    duplicateTransport.deliverAll();

    expect(duplicateHarness.ingress.getSnapshot()).toMatchObject({
      ingestedCursor: 1,
      acceptedCount: 1,
      duplicateCount: 1,
      gaps: [],
    });

    const gapHarness = makeIngressCallbacks();
    const gapTransport = createFixtureTransport(gapHarness.callbacks);
    gapTransport.start(withEntries(getChronicleManifest("C12"), [1, 3]));
    gapTransport.deliverAll();

    expect(gapHarness.ingress.getSnapshot()).toMatchObject({
      ingestedCursor: 3,
      acceptedCount: 2,
      duplicateCount: 0,
      gaps: [
        { kind: "cursor-gap", firstMissingCursor: 2, lastMissingCursor: 2 },
      ],
    });
  });

  it("atomically replaces runs and rejects reentrant stale old-run deliveries", () => {
    const order: string[] = [];
    const base = makeIngressCallbacks(order);
    let transport: FixtureTransport;
    const callbacks: FixtureTransportCallbacks = {
      ...base.callbacks,
      onEnvelopeAccepted(envelope): void {
        base.callbacks.onEnvelopeAccepted(envelope);
        if (envelope.events[0]?.event.source === "wanderer_003") {
          transport.replaceRun(getChronicleManifest("C17"));
        }
      },
    };
    transport = createFixtureTransport(callbacks);

    transport.start(getChronicleManifest("C12"));
    transport.deliverAll();
    transport.deliverAll();

    expect(order).toEqual([
      "run:initial:fixture",
      "snapshot:0",
      "envelope:1",
      "run:replacement:fixture",
      "snapshot:0",
      "checkpoint:1",
      "envelope:1",
      "envelope:2",
      "envelope:3",
      "checkpoint:2",
    ]);
    expect(base.ingress.getSnapshot()).toMatchObject({
      runId: "mock-c17-v1",
      sourceKey: "fixture:mock-c17-v1",
      ingestedCursor: 3,
      acceptedCount: 3,
      duplicateCount: 0,
      gaps: [],
    });
  });

  it("rejects all remaining callbacks when disposal occurs reentrantly", () => {
    const onRunAccepted = vi.fn();
    const onSnapshotAccepted = vi.fn();
    const onCheckpointAccepted = vi.fn();
    const deliveredCursors: number[] = [];
    let transport: FixtureTransport;
    transport = createFixtureTransport({
      onRunAccepted,
      onSnapshotAccepted,
      onEnvelopeAccepted(envelope): void {
        deliveredCursors.push(envelope.next_cursor);
        transport.dispose();
      },
      onCheckpointAccepted,
    });

    transport.start(getChronicleManifest("C12"));
    transport.deliverAll();
    transport.deliverAll();
    transport.replaceRun(getChronicleManifest("C17"));

    expect(onRunAccepted).toHaveBeenCalledOnce();
    expect(onSnapshotAccepted).toHaveBeenCalledOnce();
    expect(deliveredCursors).toEqual([1]);
    expect(onCheckpointAccepted).not.toHaveBeenCalled();
  });

  it("delivers intermediate checkpoints in merged event/checkpoint chronology", () => {
    const order: string[] = [];
    const original = getChronicleManifest("C12");
    const base = withEntries(original, [1, 2, 3]);
    const finalRecord = original.checkpoints.at(-1)!;
    const manifest: ChronicleManifest = {
      ...base,
      checkpoints: [
        {
          ...finalRecord,
          line: 1,
          checkpoint: {
            ...finalRecord.checkpoint,
            event_cursor: 1,
            snapshot: { ...finalRecord.checkpoint.snapshot, event_cursor: 1 },
          },
        },
        {
          ...finalRecord,
          line: 2,
          checkpoint: {
            ...finalRecord.checkpoint,
            event_cursor: 3,
            snapshot: { ...finalRecord.checkpoint.snapshot, event_cursor: 3 },
          },
        },
      ],
    };
    const { callbacks } = makeIngressCallbacks(order);
    const transport = createFixtureTransport(callbacks);

    transport.start(manifest);
    transport.deliverAll();

    expect(order).toEqual([
      "run:initial:fixture",
      "snapshot:0",
      "envelope:1",
      "checkpoint:1",
      "envelope:2",
      "envelope:3",
      "checkpoint:2",
    ]);
  });

  it("accepts same-run replacement and stops old checkpoint delivery reentrantly", () => {
    const order: string[] = [];
    const base = makeIngressCallbacks(order);
    let transport: FixtureTransport;
    let replaced = false;
    const callbacks: FixtureTransportCallbacks = {
      ...base.callbacks,
      onCheckpointAccepted(record): void {
        base.callbacks.onCheckpointAccepted(record);
        if (!replaced) {
          replaced = true;
          transport.replaceRun(getChronicleManifest("C12"));
        }
      },
    };
    transport = createFixtureTransport(callbacks);

    transport.start(getChronicleManifest("C12"));
    transport.deliverAll();
    transport.deliverAll();

    expect(order.filter((item) => item.startsWith("run:"))).toEqual([
      "run:initial:fixture",
      "run:same-run:fixture",
    ]);
    expect(order.filter((item) => item.startsWith("checkpoint:"))).toEqual([
      "checkpoint:1",
      ...getChronicleManifest("C12").checkpoints.map(
        (record) => `checkpoint:${record.line}`,
      ),
    ]);
  });

  it("stops old checkpoint delivery when disposal occurs reentrantly", () => {
    const manifest = getChronicleManifest("C12");
    const record = manifest.checkpoints[0];
    const twoCheckpoints: ChronicleManifest = {
      ...manifest,
      checkpoints: [record, { ...record, line: record.line + 1 }],
    };
    const accepted: number[] = [];
    let transport: FixtureTransport;
    transport = createFixtureTransport({
      onRunAccepted: vi.fn(),
      onSnapshotAccepted: vi.fn(),
      onEnvelopeAccepted: vi.fn(),
      onCheckpointAccepted(checkpoint): void {
        accepted.push(checkpoint.line);
        transport.dispose();
      },
    });

    transport.start(twoCheckpoints);
    transport.deliverAll();

    expect(accepted).toEqual([1]);
  });

  it("has no direct visual-system import or control dependency", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/presentation/fixtures/FixtureTransport.ts"),
      "utf8",
    );
    const importPaths = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
      (match) => match[1],
    );

    expect(importPaths).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/actor|renderer|camera|choreograph/i),
      ]),
    );
    expect(source).not.toMatch(/\.actor|\.renderer|\.camera|chronicleComponent/i);
  });
});
