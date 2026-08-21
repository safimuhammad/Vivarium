import { describe, expect, it, vi, type Mock } from "vitest";

import type { LiveApiClient } from "../app/client";
import type { WorldSnapshot } from "../app/schemas";
import type {
  FrameIdentity,
  PresentedObserverFrame,
  PresentationGap,
  PresentedSceneView,
} from "./contracts";
import { BeatDirector, type StoryMoment } from "./BeatDirector";
import { getChronicleManifest } from "./fixtures/chronicleCatalog";
import { createManualPresentationClock } from "./fixtures/ManualPresentationClock";
import { createPresentationFrameSink } from "./PresentationFrameSink";
import { PresentedWorldModel } from "./PresentedWorldModel";
import {
  createRecoveryCoordinator,
  type RecoveryDigest,
  type RecoveryPlacementPort,
  type RecoveryPublication,
  type RecoveryPublicationReceipt,
  type RecoveryPublicationPort,
  type RecoverySettlementPort,
} from "./RecoveryCoordinator";
import {
  SceneSettlementCoordinator,
  type SceneRuntimePort,
  type SceneRuntimeSignal,
  type SceneRuntimeStart,
} from "./SceneSettlementCoordinator";
import { StoryDirector } from "./StoryDirector";

const manifest = getChronicleManifest("C14");

describe("RecoveryCoordinator", () => {
  it("rejects a legacy placement replacement port on the production path", () => {
    expect(() => createRecoveryCoordinator({
      client: clientResolving(forwardSnapshot(4)),
      model: new PresentedWorldModel(structuredClone(manifest.initialSnapshot), activeIdentity()),
      placement: placementRecording([]),
      settlement: settlementIdle(),
      publication: publicationRecording([]),
      getActiveIdentity: activeIdentity,
    })).toThrow(/prepared placement generation/i);
  });
  it("accepts one valid grouped moment covering two skipped evidence cursors", async () => {
    const harness = makeHarness({ client: clientResolving(forwardSnapshot(2)) });
    const groupedDigest: RecoveryDigest = {
      skipped: { firstCursor: 1, lastCursor: 2 },
      majorMoments: [{ type: "agent_paralyzed", count: 1 }],
      compressedAmbientCount: 0,
    };

    await harness.coordinator.recover({
      reason: "queue-overflow",
      digest: groupedDigest,
      identity: activeIdentity(),
    });

    expect(harness.client.getWorld).toHaveBeenCalledOnce();
    expect(harness.coordinator.getSnapshot()).toMatchObject({
      status: "complete",
      snappedCursor: 2,
    });
  });

  it("adopts the real Task 4 consequence frame before one recovery fetch", async () => {
    const task4 = realTask4RecoveryHarness();

    const recovery = task4.coordinator.recover({
      reason: "queue-overflow",
      digest: {
        skipped: { firstCursor: 3, lastCursor: 4 },
        majorMoments: [{ type: "agent_recovered", count: 1 }],
        compressedAmbientCount: 0,
      },
      identity: task4.currentIdentity(),
    });
    expect(task4.client.getWorld).not.toHaveBeenCalled();

    task4.clock.advanceTo(100_000);
    await recovery;

    expect(task4.consequenceFrames).toHaveLength(1);
    expect(task4.consequenceFrames[0]).toMatchObject({
      revision: 2,
      firstCursor: 1,
      lastCursor: 2,
      scene: { momentId: "1:2:strike-fall", phase: "consequence" },
    });
    expect(task4.consequencePublicationSerials).toEqual([3]);
    expect(task4.settlement.getSnapshot().publishedRevision).toBe(2);
    expect(task4.client.getWorld).toHaveBeenCalledOnce();
    expect(task4.placement.replaceFromSnapshot).toHaveBeenCalledOnce();
    expect(task4.recoveryPublications).toHaveLength(1);
    expect(task4.recoveryPublications[0].frame).toMatchObject({
      revision: 3,
      firstCursor: 4,
      lastCursor: 4,
      presentedCursor: 4,
    });
    expect(task4.sink.getSnapshot().frame).toMatchObject({
      revision: 3,
      firstCursor: 4,
      lastCursor: 4,
    });
    expect(task4.coordinator.getSnapshot()).toMatchObject({
      status: "complete",
      snappedCursor: 4,
    });
    task4.director.dispose();
    task4.sink.dispose();
  });

  it("adopts a coherent settled consequence descendant retained before recovery ownership", async () => {
    const current = Object.freeze({
      ...frozenFrame(),
      scene: Object.freeze({
        momentId: "moment-3",
        regionId: "nirvana",
        phase: "consequence" as const,
        focus: Object.freeze({ kind: "region" as const, id: "nirvana" }),
        dialogue: null,
        actorIntents: Object.freeze([]),
        homeIntents: Object.freeze([]),
        effectIntents: Object.freeze([]),
        safeCancelMarkers: Object.freeze(["settled"]),
        reducedMotion: false,
        execution: Object.freeze({ sceneToken: 103, programId: "program-3" }),
      }),
    });
    const settlement = settlementFrom({
      sceneToken: 3,
      consequenceCommitted: true,
      publishedRevision: 1,
      safeBoundaryAcknowledged: true,
      cancelRequested: true,
      cancelGeneration: 1,
      acknowledgedCancelGeneration: 1,
      sceneSettled: true,
    });
    const harness = makeHarness({
      settlement,
      publication: publicationRecording([], current),
    });

    await harness.coordinator.recover(recoveryInput());

    expect(harness.client.getWorld).toHaveBeenCalledOnce();
    expect(harness.coordinator.getSnapshot()).toMatchObject({
      status: "complete",
      snappedCursor: 4,
    });
  });

  it("rejects a settled consequence whose published revision does not equal its frame revision", async () => {
    const task4 = realTask4RecoveryHarness({ settlementRevisionOffset: 1 });
    const recovery = task4.coordinator.recover({
      reason: "queue-overflow",
      digest: {
        skipped: { firstCursor: 3, lastCursor: 4 },
        majorMoments: [{ type: "agent_recovered", count: 1 }],
        compressedAmbientCount: 0,
      },
      identity: task4.currentIdentity(),
    });

    task4.clock.advanceTo(100_000);
    await recovery;

    expect(task4.consequencePublicationSerials).toEqual([3]);
    expect(task4.consequenceFrames[0].revision).toBe(2);
    expect(task4.settlement.getSnapshot().publishedRevision).toBe(3);
    expect(task4.client.getWorld).not.toHaveBeenCalled();
    expect(task4.placement.replaceFromSnapshot).not.toHaveBeenCalled();
    expect(task4.recoveryPublications).toEqual([]);
    expect(task4.coordinator.getSnapshot()).toEqual({ status: "idle" });
    task4.director.dispose();
    task4.sink.dispose();
  });

  it("retries placement failure from the exact retained settled consequence frame", async () => {
    const task4 = realTask4RecoveryHarness({ placementFailures: 1 });
    const first = task4.coordinator.recover({
      reason: "queue-overflow",
      digest: {
        skipped: { firstCursor: 3, lastCursor: 4 },
        majorMoments: [{ type: "agent_recovered", count: 1 }],
        compressedAmbientCount: 0,
      },
      identity: task4.currentIdentity(),
    });
    task4.clock.advanceTo(100_000);
    await first;

    const frozenConsequence = task4.sink.getSnapshot().frame;
    expect(frozenConsequence).toMatchObject({
      revision: 2,
      firstCursor: 1,
      lastCursor: 2,
      scene: { phase: "consequence" },
    });
    expect(task4.coordinator.getSnapshot().status).toBe("frozen-retry");
    expect(task4.client.getWorld).toHaveBeenCalledOnce();
    expect(task4.placement.replaceFromSnapshot).toHaveBeenCalledOnce();
    expect(task4.recoveryPublications).toEqual([]);

    await task4.coordinator.retry();

    expect(task4.sink.getSnapshot().frame).not.toBe(frozenConsequence);
    expect(task4.client.getWorld).toHaveBeenCalledTimes(2);
    expect(task4.placement.replaceFromSnapshot).toHaveBeenCalledTimes(2);
    expect(task4.recoveryPublications).toHaveLength(1);
    expect(task4.coordinator.getSnapshot()).toMatchObject({
      status: "complete",
      snappedCursor: 4,
    });
    task4.director.dispose();
    task4.sink.dispose();
  });

  it("recovers an idle scene with one world request and one ordered gap/frame publication", async () => {
    const order: string[] = [];
    const harness = makeHarness({
      client: clientResolving(forwardSnapshot(4), order),
      placement: placementRecording(order),
      publication: publicationRecording(order),
    });

    await harness.coordinator.recover(recoveryInput());

    expect(order).toEqual(["getWorld", "placement:4", "publication:4"]);
    expect(harness.client.getWorld).toHaveBeenCalledTimes(1);
    expect(harness.client.getEvents).not.toHaveBeenCalled();
    expect(harness.client.openEventStream).not.toHaveBeenCalled();
    expect(harness.placement.replaceFromSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.publication.publishRecovery).toHaveBeenCalledTimes(1);
    expect(harness.model.getView()).toMatchObject({
      exactBaseCursor: 4,
      projectedThroughCursor: 4,
    });
    expect(harness.coordinator.getSnapshot()).toMatchObject({
      status: "complete",
      snappedCursor: 4,
    });
    const published = harness.publication.publications[0];
    expect(published).toMatchObject({
      publicMessage: "The world moved ahead",
      gap: {
        firstCursor: 1,
        lastCursor: 4,
        chapter: "world-moved-ahead",
        archiveAvailable: true,
      },
      frame: {
        runId: manifest.runId,
        sourceKey: `live:${manifest.runId}`,
        revision: 8,
        firstCursor: 4,
        lastCursor: 4,
        ingestedCursor: 4,
        presentedCursor: 4,
        scene: null,
      },
    });
    expect(published.frame.world).toBe(harness.model.getView());
  });

  it("treats a settled or absent scene as safe without requesting cancellation", async () => {
    for (const initial of [settlementIdle(), settlementAlreadySettled()]) {
      const harness = makeHarness({ settlement: initial });
      await harness.coordinator.recover(recoveryInput());
      expect(initial.requestSafeCancel).not.toHaveBeenCalled();
      expect(harness.client.getWorld).toHaveBeenCalledTimes(1);
    }
  });

  it("waits for the current cancellation acknowledgement and settlement before fetching", async () => {
    const settlement = activeSettlement();
    const harness = makeHarness({ settlement });

    const recovery = harness.coordinator.recover(recoveryInput());
    await flushPromises();
    expect(settlement.requestSafeCancel).toHaveBeenCalledOnce();
    expect(settlement.requestSafeCancel).toHaveBeenCalledWith("recovery:cursor-gap");
    expect(harness.coordinator.getSnapshot().status).toBe("waiting-safe-boundary");
    expect(harness.client.getWorld).not.toHaveBeenCalled();

    settlement.emitStaleSettlement();
    settlement.acknowledgeCurrent();
    await flushPromises();
    expect(harness.client.getWorld).not.toHaveBeenCalled();

    settlement.settleCurrent();
    await recovery;
    expect(harness.client.getWorld).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent recover calls without replacing the first attempt", async () => {
    const response = deferred<WorldSnapshot>();
    const client = forbiddenAwareClient(() => response.promise);
    const harness = makeHarness({ client });
    const firstInput = recoveryInput();
    const first = harness.coordinator.recover(firstInput);
    const duplicate = harness.coordinator.recover({
      ...recoveryInput(),
      reason: "hidden-tab",
    });

    expect(duplicate).toBe(first);
    await flushPromises();
    expect(client.getWorld).toHaveBeenCalledOnce();
    response.resolve(forwardSnapshot(4));
    await first;
    expect(harness.publication.publications[0].gap.chapter).toBe("world-moved-ahead");
  });

  it("freezes the exact current frame on fetch failure and never retries implicitly", async () => {
    const frozen = frozenFrame();
    const client = forbiddenAwareClient(async () => {
      throw new Error("network details must remain private");
    });
    const publication = publicationRecording([], frozen);
    const harness = makeHarness({ client, publication });

    await harness.coordinator.recover(recoveryInput());
    await flushPromises(8);

    expect(client.getWorld).toHaveBeenCalledOnce();
    expect(publication.currentFrame()).toBe(frozen);
    expect(publication.publishRecovery).not.toHaveBeenCalled();
    expect(harness.coordinator.getSnapshot()).toMatchObject({
      status: "frozen-retry",
      publicMessage: "The world paused here. Retry when ready.",
    });
  });

  it("issues one request per explicit retry and coalesces concurrent retry calls", async () => {
    const retryResponse = deferred<WorldSnapshot>();
    const client = forbiddenAwareClient(vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => retryResponse.promise));
    const harness = makeHarness({ client });
    await harness.coordinator.recover(recoveryInput());
    expect(client.getWorld).toHaveBeenCalledTimes(1);

    const first = harness.coordinator.retry();
    const duplicate = harness.coordinator.retry();
    expect(duplicate).toBe(first);
    await flushPromises();
    expect(client.getWorld).toHaveBeenCalledTimes(2);
    retryResponse.resolve(forwardSnapshot(4));
    await first;

    expect(client.getWorld).toHaveBeenCalledTimes(2);
    expect(harness.coordinator.getSnapshot().status).toBe("complete");
    await harness.coordinator.retry();
    expect(client.getWorld).toHaveBeenCalledTimes(2);
  });

  it("routes checkpoint-413 through the same single world-snapshot path", async () => {
    const harness = makeHarness();
    await harness.coordinator.recover({
      ...recoveryInput(),
      reason: "checkpoint-413",
    });

    expect(harness.client.getWorld).toHaveBeenCalledOnce();
    expect(harness.client.getEvents).not.toHaveBeenCalled();
    expect(harness.client.openEventStream).not.toHaveBeenCalled();
    expect(harness.publication.publications).toHaveLength(1);
    expect(harness.publication.publications[0].gap.chapter).toBe("world-moved-ahead");
  });

  it("keeps a newer retry attempt owned after the older failure settles", async () => {
    const retryResponse = deferred<WorldSnapshot>();
    const client = forbiddenAwareClient(vi.fn()
      .mockRejectedValueOnce(new Error("first attempt failed"))
      .mockImplementationOnce(() => retryResponse.promise));
    const harness = makeHarness({ client });
    const older = harness.coordinator.recover(recoveryInput());
    await older;

    const newer = harness.coordinator.retry();
    await flushPromises(4);
    expect(harness.coordinator.getSnapshot()).toMatchObject({
      status: "fetching-world",
      requestCount: 2,
    });
    expect(harness.coordinator.retry()).toBe(newer);

    retryResponse.resolve(forwardSnapshot(4));
    await newer;
    expect(harness.coordinator.getSnapshot().status).toBe("complete");
  });

  it.each([
    ["run", { runId: "replacement-run" }],
    ["source", { sourceKey: "archive:checkpoint-9" }],
    ["revision", { revision: 8 }],
    ["range", { firstCursor: 1, lastCursor: 1 }],
  ] as const)("discards a response after stale %s identity", async (_label, change) => {
    const response = deferred<WorldSnapshot>();
    const harness = makeHarness({ client: forbiddenAwareClient(() => response.promise) });
    const recovery = harness.coordinator.recover(recoveryInput());
    harness.setIdentity({ ...harness.identity(), ...change });
    response.resolve(forwardSnapshot(4));
    await recovery;

    expect(harness.placement.replaceFromSnapshot).not.toHaveBeenCalled();
    expect(harness.publication.publishRecovery).not.toHaveBeenCalled();
    expect(harness.model.getView().exactBaseCursor).toBe(0);
    expect(harness.coordinator.getSnapshot()).toEqual({ status: "idle" });
  });

  it("rejects an unrelated selection change while a recovery fetch is in flight", async () => {
    const response = deferred<WorldSnapshot>();
    const publication = publicationRecording([]);
    const harness = makeHarness({
      client: forbiddenAwareClient(() => response.promise),
      publication,
    });
    const recovery = harness.coordinator.recover(recoveryInput());
    const current = publication.currentFrame();
    publication.replaceCurrent({
      ...current,
      selection: { kind: "region", id: "unrelated-region" },
    });
    response.resolve(forwardSnapshot(4));
    await recovery;

    expect(harness.placement.replaceFromSnapshot).not.toHaveBeenCalled();
    expect(harness.publication.publishRecovery).not.toHaveBeenCalled();
    expect(harness.coordinator.getSnapshot()).toEqual({ status: "idle" });
  });

  it("rejects a wrong-run or non-forward snapshot before model and placement mutation", async () => {
    for (const snapshot of [
      forwardSnapshot(4, { run_id: "replacement-run" }),
      forwardSnapshot(0),
      forwardSnapshot(2),
    ]) {
      const harness = makeHarness({ client: forbiddenAwareClient(async () => snapshot) });
      await harness.coordinator.recover(recoveryInput());
      expect(harness.model.getView().exactBaseCursor).toBe(0);
      expect(harness.placement.replaceFromSnapshot).not.toHaveBeenCalled();
      expect(harness.publication.publishRecovery).not.toHaveBeenCalled();
      expect(harness.coordinator.getSnapshot().status).toBe("frozen-retry");
    }
  });

  it("does not publish a half-applied frame when placement replacement fails", async () => {
    const frozen = frozenFrame();
    const placement: RecoveryPlacementPort = {
      replaceFromSnapshot: vi.fn(() => {
        throw new Error("map capacity exhausted");
      }),
    };
    const publication = publicationRecording([], frozen);
    const harness = makeHarness({ placement, publication });

    await harness.coordinator.recover(recoveryInput());

    expect(placement.replaceFromSnapshot).toHaveBeenCalledOnce();
    expect(harness.model.getView().exactBaseCursor).toBe(0);
    expect(publication.publishRecovery).not.toHaveBeenCalled();
    expect(publication.currentFrame()).toBe(frozen);
    expect(harness.coordinator.getSnapshot().status).toBe("frozen-retry");
  });

  it("prepares a replacement generation before mutating either active owner", async () => {
    const prepared = { runId: manifest.runId, eventCursor: 4 };
    const placement = {
      prepareFromSnapshot: vi.fn((_snapshot: WorldSnapshot) => {
        throw new Error("map capacity exhausted");
      }),
      commitPrepared: vi.fn((_candidate: typeof prepared) => undefined),
      rollbackPrepared: vi.fn((_candidate: typeof prepared) => undefined),
    };
    const harness = makeHarness({ placement });

    await harness.coordinator.recover(recoveryInput());

    expect(placement.prepareFromSnapshot).toHaveBeenCalledOnce();
    expect(placement.commitPrepared).not.toHaveBeenCalled();
    expect(harness.model.getView().exactBaseCursor).toBe(0);
    expect(harness.publication.publishRecovery).not.toHaveBeenCalled();
    expect(harness.coordinator.getSnapshot().status).toBe("frozen-retry");
  });

  it("rolls back both prepared owners when placement commit fails", async () => {
    const prepared = { runId: manifest.runId, eventCursor: 4 };
    const placement = {
      prepareFromSnapshot: vi.fn(() => prepared),
      commitPrepared: vi.fn(() => {
        throw new Error("candidate activation failed");
      }),
      rollbackPrepared: vi.fn(),
    };
    const harness = makeHarness({ placement });

    await harness.coordinator.recover(recoveryInput());

    expect(placement.commitPrepared).toHaveBeenCalledOnce();
    expect(placement.rollbackPrepared).toHaveBeenCalledOnce();
    expect(harness.model.getView().exactBaseCursor).toBe(0);
    expect(harness.publication.publishRecovery).not.toHaveBeenCalled();
    expect(harness.coordinator.getSnapshot().status).toBe("frozen-retry");
  });

  it("rolls back a prepared placement commit that reentrantly stales the recovery", async () => {
    let harness!: Harness;
    const prepared = { runId: manifest.runId, eventCursor: 4 };
    const placement = {
      prepareFromSnapshot: vi.fn(() => prepared),
      commitPrepared: vi.fn(() => {
        harness.setIdentity({ ...harness.identity(), revision: 8 });
      }),
      rollbackPrepared: vi.fn(),
    };
    harness = makeHarness({ placement });

    await harness.coordinator.recover(recoveryInput());

    expect(placement.rollbackPrepared).toHaveBeenCalledOnce();
    expect(harness.model.getView().exactBaseCursor).toBe(0);
    expect(harness.publication.publishRecovery).not.toHaveBeenCalled();
    expect(harness.coordinator.getSnapshot()).toEqual({ status: "idle" });
  });

  it.each(["throw", "rejected-old-positive"] as const)(
    "rolls model and placement back when typed publication is %s",
    async (mode) => {
      let placementCursor = 0;
      const prepared = { runId: manifest.runId, eventCursor: 4 };
      const placement = {
        prepareFromSnapshot: vi.fn(() => prepared),
        commitPrepared: vi.fn(() => { placementCursor = 4; }),
        rollbackPrepared: vi.fn(() => { placementCursor = 0; }),
      };
      const frozen = frozenFrame();
      const publication = publicationRecording([], frozen);
      publication.publishRecovery.mockImplementation(() => {
        if (mode === "throw") throw new Error("sink unavailable");
        return { status: "rejected", publicationSerial: 7 };
      });
      const harness = makeHarness({ placement, publication });

      await harness.coordinator.recover(recoveryInput());

      expect(placementCursor).toBe(0);
      expect(placement.rollbackPrepared).toHaveBeenCalledOnce();
      expect(harness.model.getView().exactBaseCursor).toBe(0);
      expect(publication.currentFrame()).toBe(frozen);
      expect(harness.coordinator.getSnapshot().status).toBe("frozen-retry");
    },
  );

  it("finalizes one coherent new generation from a typed superseded receipt", async () => {
    let placementCursor = 0;
    const prepared = { runId: manifest.runId, eventCursor: 4 };
    const placement = {
      prepareFromSnapshot: vi.fn(() => prepared),
      commitPrepared: vi.fn(() => { placementCursor = 4; }),
      rollbackPrepared: vi.fn(() => { placementCursor = 0; }),
    };
    const publication = publicationRecording([]);
    publication.publishRecovery.mockImplementation((value) => {
      publication.replaceCurrent({ ...value.frame, revision: value.frame.revision + 1 });
      return { status: "superseded", publicationSerial: 2 };
    });
    const harness = makeHarness({ placement, publication });

    await harness.coordinator.recover(recoveryInput());

    expect(placementCursor).toBe(4);
    expect(placement.rollbackPrepared).not.toHaveBeenCalled();
    expect(harness.model.getView().exactBaseCursor).toBe(4);
    expect(publication.currentFrame().revision).toBe(9);
    expect(harness.coordinator.getSnapshot().status).toBe("complete");
  });

  it("rejects publication when placement reentrantly replaces the active identity", async () => {
    let harness!: Harness;
    const placement: RecoveryPlacementPort = {
      replaceFromSnapshot: vi.fn(() => {
        harness.setIdentity({ ...harness.identity(), revision: 8 });
      }),
    };
    harness = makeHarness({ placement });

    await harness.coordinator.recover(recoveryInput());

    expect(harness.model.getView().exactBaseCursor).toBe(0);
    expect(placement.replaceFromSnapshot).toHaveBeenCalledOnce();
    expect(harness.publication.publishRecovery).not.toHaveBeenCalled();
    expect(harness.coordinator.getSnapshot()).toEqual({ status: "idle" });
  });

  it("treats publication as final before a subscriber installs a newer identity", async () => {
    let harness!: Harness;
    const publication = publicationRecording([]);
    const basePublish = publication.publishRecovery.getMockImplementation()!;
    publication.publishRecovery.mockImplementation((value) => {
      const serial = basePublish(value);
      harness.setIdentity({ ...harness.identity(), sourceKey: "live:replacement" });
      return serial;
    });
    harness = makeHarness({ publication });

    await harness.coordinator.recover(recoveryInput());

    expect(publication.publishRecovery).toHaveBeenCalledOnce();
    expect(harness.coordinator.getSnapshot().status).toBe("complete");
  });

  it("treats publication as final before a subscriber changes selection", async () => {
    const publication = publicationRecording([]);
    const basePublish = publication.publishRecovery.getMockImplementation()!;
    publication.publishRecovery.mockImplementation((value) => {
      const serial = basePublish(value);
      publication.replaceCurrent({
        ...value.frame,
        selection: { kind: "region", id: "unrelated-region" },
      });
      return serial;
    });
    const harness = makeHarness({ publication });

    await harness.coordinator.recover(recoveryInput());

    expect(publication.publishRecovery).toHaveBeenCalledOnce();
    expect(harness.coordinator.getSnapshot().status).toBe("complete");
  });

  it("can explicitly retry a placement failure while the model remains on retained truth", async () => {
    const placement: RecoveryPlacementPort = {
      replaceFromSnapshot: vi.fn()
        .mockImplementationOnce(() => {
          throw new Error("placement unavailable");
        })
        .mockImplementationOnce(() => undefined),
    };
    const harness = makeHarness({ placement });
    await harness.coordinator.recover(recoveryInput());
    expect(harness.model.getView().exactBaseCursor).toBe(0);
    expect(harness.publication.publishRecovery).not.toHaveBeenCalled();

    await harness.coordinator.retry();
    expect(harness.client.getWorld).toHaveBeenCalledTimes(2);
    expect(placement.replaceFromSnapshot).toHaveBeenCalledTimes(2);
    expect(harness.publication.publishRecovery).toHaveBeenCalledOnce();
    expect(harness.model.getView()).toMatchObject({
      exactBaseCursor: 4,
      projectedThroughCursor: 4,
    });
    expect(harness.publication.publications[0].frame).toMatchObject({
      firstCursor: 4,
      lastCursor: 4,
      presentedCursor: 4,
      ingestedCursor: 4,
    });
    expect(harness.publication.publications[0].frame.world).toBe(harness.model.getView());
    expect(harness.coordinator.getSnapshot().status).toBe("complete");
  });

  it("uses While you were away for hidden recovery and owns detached digest input", async () => {
    const digest = recoveryDigest();
    const harness = makeHarness();
    const recovery = harness.coordinator.recover({
      reason: "hidden-tab",
      digest,
      identity: activeIdentity(),
    });
    (digest.majorMoments as { type: "agent_died"; count: number }[])[0].count = 99;
    await recovery;

    expect(harness.publication.publications[0]).toMatchObject({
      publicMessage: "While you were away",
      gap: { chapter: "while-away" },
      digest: {
        majorMoments: [{ type: "agent_died", count: 1 }],
      },
    });
  });

  it("validates exact skipped ranges and digest counts before requesting world truth", async () => {
    const harness = makeHarness();
    const invalid = [
      { ...recoveryDigest(), skipped: { firstCursor: 2, lastCursor: 4 } },
      { ...recoveryDigest(), skipped: { firstCursor: 1, lastCursor: 0 } },
      { ...recoveryDigest(), compressedAmbientCount: -1 },
      { ...recoveryDigest(), majorMoments: [{ type: "agent_died" as const, count: 0 }] },
      { ...recoveryDigest(), compressedAmbientCount: 0, majorMoments: [] },
      {
        ...recoveryDigest(),
        majorMoments: [{ type: "fabricated_event" as "agent_died", count: 1 }],
      },
    ];

    for (const digest of invalid) {
      expect(() => harness.coordinator.recover({
        reason: "cursor-gap",
        digest,
        identity: activeIdentity(),
      })).toThrow();
    }
    expect(harness.client.getWorld).not.toHaveBeenCalled();
  });

  it("rejects story-moment over-accounting beyond the skipped cursor span", () => {
    const harness = makeHarness();
    expect(() => harness.coordinator.recover({
      reason: "queue-overflow",
      digest: {
        skipped: { firstCursor: 1, lastCursor: 2 },
        majorMoments: [{ type: "agent_paralyzed", count: 3 }],
        compressedAmbientCount: 0,
      },
      identity: activeIdentity(),
    })).toThrow("account");
    expect(harness.client.getWorld).not.toHaveBeenCalled();
  });

  it("disposal releases a safe-boundary wait without fetching and is terminal", async () => {
    const settlement = activeSettlement();
    const harness = makeHarness({ settlement });
    const pending = harness.coordinator.recover(recoveryInput());
    expect(harness.coordinator.getSnapshot().status).toBe("waiting-safe-boundary");
    expect(settlement.subscribe).toHaveBeenCalledOnce();

    harness.coordinator.dispose();
    harness.coordinator.dispose();
    await pending;
    settlement.acknowledgeCurrent();
    settlement.settleCurrent();
    await harness.coordinator.recover(recoveryInput());
    await harness.coordinator.retry();

    expect(harness.client.getWorld).not.toHaveBeenCalled();
    expect(harness.publication.publishRecovery).not.toHaveBeenCalled();
    expect(harness.coordinator.getSnapshot()).toEqual({ status: "idle" });
    expect(settlement.unsubscribe).toHaveBeenCalledOnce();
  });

  it("coalesces reentrant recovery requested by a settlement subscriber", async () => {
    const settlement = activeSettlement();
    const harness = makeHarness({ settlement });
    let reentrant: Promise<void> | null = null;
    settlement.onSubscribe = () => {
      reentrant = harness.coordinator.recover(recoveryInput());
    };
    const first = harness.coordinator.recover(recoveryInput());
    settlement.acknowledgeCurrent();
    settlement.settleCurrent();
    await first;

    expect(reentrant).toBe(first);
    expect(settlement.requestSafeCancel).toHaveBeenCalledOnce();
    expect(harness.client.getWorld).toHaveBeenCalledOnce();
  });

  it("discards an in-flight response after disposal", async () => {
    const response = deferred<WorldSnapshot>();
    const harness = makeHarness({ client: forbiddenAwareClient(() => response.promise) });
    const pending = harness.coordinator.recover(recoveryInput());
    harness.coordinator.dispose();
    response.resolve(forwardSnapshot(4));
    await pending;

    expect(harness.placement.replaceFromSnapshot).not.toHaveBeenCalled();
    expect(harness.publication.publishRecovery).not.toHaveBeenCalled();
  });
});

interface Harness {
  readonly coordinator: ReturnType<typeof createRecoveryCoordinator>;
  readonly client: ReturnType<typeof forbiddenAwareClient>;
  readonly model: PresentedWorldModel;
  readonly placement: RecoveryPlacementPort & {
    replaceFromSnapshot: Mock<(snapshot: WorldSnapshot) => void>;
  };
  readonly publication: RecordingPublication;
  identity(): FrameIdentity;
  setIdentity(identity: FrameIdentity): void;
}

function makeHarness(overrides: Readonly<{
  client?: ReturnType<typeof forbiddenAwareClient>;
  settlement?: RecoverySettlementPort;
  placement?: RecoveryPlacementPort;
  publication?: RecordingPublication;
}> = {}): Harness {
  let identity = activeIdentity();
  const initial = structuredClone(manifest.initialSnapshot);
  const model = new PresentedWorldModel(initial, identity);
  const client = overrides.client ?? clientResolving(forwardSnapshot(4));
  const rawPlacement = overrides.placement ?? placementRecording([]);
  const placement = rawPlacement as Harness["placement"];
  const publication = overrides.publication ?? publicationRecording([]);
  const coordinator = createRecoveryCoordinator({
    client,
    model,
    placement,
    settlement: overrides.settlement ?? settlementIdle(),
    publication,
    getActiveIdentity: () => identity,
    ...( "replaceFromSnapshot" in placement
      ? { allowLegacyPlacementForTests: true as const }
      : {}),
  });
  return {
    coordinator,
    client,
    model,
    placement,
    publication,
    identity: () => identity,
    setIdentity: (next) => {
      identity = next;
    },
  };
}

function recoveryInput() {
  return {
    reason: "cursor-gap" as const,
    digest: recoveryDigest(),
    identity: activeIdentity(),
  };
}

function recoveryDigest(): RecoveryDigest {
  return {
    skipped: { firstCursor: 1, lastCursor: 4 },
    majorMoments: [{ type: "agent_died", count: 1 }],
    compressedAmbientCount: 3,
  };
}

function activeIdentity(): FrameIdentity {
  return {
    runId: manifest.runId,
    sourceKey: `live:${manifest.runId}`,
    revision: 7,
    firstCursor: 0,
    lastCursor: 0,
  };
}

function forwardSnapshot(
  cursor: number,
  overrides: Partial<WorldSnapshot> = {},
): WorldSnapshot {
  return {
    ...structuredClone(manifest.initialSnapshot),
    event_cursor: cursor,
    world_time: manifest.initialSnapshot.world_time + cursor,
    ...overrides,
  };
}

function frozenFrame(): PresentedObserverFrame {
  const snapshot = structuredClone(manifest.initialSnapshot);
  const identity = activeIdentity();
  const model = new PresentedWorldModel(snapshot, identity);
  return Object.freeze({
    ...identity,
    source: "live" as const,
    ingestedCursor: 0,
    presentedCursor: 0,
    world: model.getView(),
    scene: null,
    selection: null,
    backlog: Object.freeze({
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up" as const,
      label: "Caught up",
    }),
    transport: Object.freeze({
      connection: "live" as const,
      ingestedCursor: 0,
      retryable: false,
    }),
  });
}

function forbiddenAwareClient(getWorld: () => Promise<WorldSnapshot>) {
  return {
    getRun: vi.fn(async () => {
      throw new Error("Recovery must not call getRun");
    }),
    getWorld: vi.fn(getWorld),
    getEvents: vi.fn(async () => {
      throw new Error("Recovery must not call getEvents");
    }),
    openEventStream: vi.fn(() => {
      throw new Error("Recovery must not open a stream");
    }),
  } satisfies LiveApiClient;
}

function clientResolving(snapshot: WorldSnapshot, order: string[] = []) {
  return forbiddenAwareClient(async () => {
    order.push("getWorld");
    return snapshot;
  });
}

function placementRecording(order: string[]): Harness["placement"] {
  return {
    replaceFromSnapshot: vi.fn((snapshot: WorldSnapshot) => {
      order.push(`placement:${snapshot.event_cursor}`);
    }),
  };
}

interface RecordingPublication extends RecoveryPublicationPort {
  readonly publications: RecoveryPublication[];
  readonly publishRecovery: Mock<(publication: RecoveryPublication) => RecoveryPublicationReceipt>;
  replaceCurrent(frame: PresentedObserverFrame): void;
}

function publicationRecording(
  order: string[],
  initial: PresentedObserverFrame = frozenFrame(),
): RecordingPublication {
  let current = initial;
  const publications: RecoveryPublication[] = [];
  return {
    publications,
    currentFrame: () => current,
    publishRecovery: vi.fn((publication: RecoveryPublication) => {
      order.push(`publication:${publication.frame.lastCursor}`);
      publications.push(publication);
      current = publication.frame;
      return {
        status: "committed" as const,
        publicationSerial: publications.length,
        identity: {
          runId: publication.frame.runId,
          sourceKey: publication.frame.sourceKey,
          revision: publication.frame.revision,
          firstCursor: publication.frame.firstCursor,
          lastCursor: publication.frame.lastCursor,
        },
      };
    }),
    replaceCurrent(frame): void {
      current = frame;
    },
  };
}

class Task4BoundaryRuntime implements SceneRuntimePort {
  private token = 0;
  private program: SceneRuntimeStart["program"] | null = null;
  private consequenceSent = false;
  private acknowledged = false;
  private boundarySent = false;
  private settled = false;
  private cancelRequested = false;
  private cancelGeneration = 0;

  start(input: SceneRuntimeStart, _identity: FrameIdentity): number {
    this.token += 1;
    this.program = input.program;
    this.consequenceSent = false;
    this.acknowledged = false;
    this.boundarySent = false;
    this.settled = false;
    this.cancelRequested = false;
    this.cancelGeneration = 0;
    return this.token;
  }

  advance(nowMs: number): readonly SceneRuntimeSignal[] {
    const program = this.program;
    if (program === null) return [];
    const signals: SceneRuntimeSignal[] = [];
    const consequenceAt = program.phaseWindows.find(
      (window) => window.phase === "consequence",
    )?.startMs ?? 0;
    if (!this.consequenceSent && nowMs >= consequenceAt) {
      this.consequenceSent = true;
      signals.push({
        kind: "consequence-marker",
        sceneToken: this.token,
        marker: program.consequenceMarker,
      });
    }
    if (this.acknowledged && !this.boundarySent) {
      this.boundarySent = true;
      signals.push({
        kind: "safe-cancel-ack",
        sceneToken: this.token,
        cancelApplied: this.cancelRequested,
        cancelGeneration: this.cancelGeneration,
      });
    }
    if (this.boundarySent && !this.settled && nowMs >= program.durationMs) {
      this.settled = true;
      signals.push({ kind: "scene-settled", sceneToken: this.token });
    }
    return signals;
  }

  acknowledgePublishedConsequence(
    _sceneToken: number,
    _publishedRevision: number,
    _cancelRequested: boolean,
    _cancelGeneration: number,
  ): void {
    this.acknowledged = true;
  }

  requestSafeCancel(
    _sceneToken: number,
    _reason: string,
    cancelGeneration: number,
  ): void {
    this.cancelRequested = true;
    this.cancelGeneration = cancelGeneration;
  }

  nextDeadlineMs(): number | null {
    const program = this.program;
    if (program === null || this.settled) return null;
    if (!this.consequenceSent) {
      return program.phaseWindows.find(
        (window) => window.phase === "consequence",
      )?.startMs ?? 0;
    }
    if (this.acknowledged && !this.boundarySent) return 0;
    return program.durationMs;
  }

  dispose(): void {
    this.program = null;
  }
}

function realTask4RecoveryHarness(options: Readonly<{
  settlementRevisionOffset?: number;
  placementFailures?: number;
}> = {}) {
  const task4Manifest = getChronicleManifest("C10");
  const modelIdentity: FrameIdentity = {
    runId: task4Manifest.runId,
    sourceKey: `live:${task4Manifest.runId}`,
    revision: 0,
    firstCursor: 0,
    lastCursor: 0,
  };
  const model = new PresentedWorldModel(task4Manifest.initialSnapshot, modelIdentity);
  const sink = createPresentationFrameSink();
  const moments = new BeatDirector().group(task4Manifest.entries);
  const active = moments[0];
  const activeIdentity: FrameIdentity = {
    ...modelIdentity,
    revision: 1,
    firstCursor: active.firstCursor,
    lastCursor: active.lastCursor,
  };
  sink.publish(observerFrame(model, activeIdentity, sceneFor(active, "enter")));
  sink.publish(observerFrame(model, activeIdentity, sceneFor(active, "hold")));
  const consequenceFrames: PresentedObserverFrame[] = [];
  const consequencePublicationSerials: number[] = [];
  const runtime = new Task4BoundaryRuntime();
  const settlement = new SceneSettlementCoordinator({
    model,
    runtime,
    publishConsequenceFrame(moment): number {
      const current = sink.getSnapshot().frame!;
      const consequence = observerFrame(model, {
        ...current,
        revision: current.revision + 1,
        firstCursor: moment.firstCursor,
        lastCursor: moment.lastCursor,
      }, sceneFor(moment, "consequence"));
      consequenceFrames.push(consequence);
      consequencePublicationSerials.push(sink.publish(consequence));
      return consequence.revision + (options.settlementRevisionOffset ?? 0);
    },
    onSettlementComplete: () => undefined,
  });
  const clock = createManualPresentationClock();
  const director = new StoryDirector({
    clock,
    identity: modelIdentity,
    model,
    settlement,
  });
  director.ingest(moments);
  director.acceptIngressFault({
    kind: "cursor-gap",
    firstMissingCursor: 3,
    lastMissingCursor: 4,
  });
  const recoveryPublications: RecoveryPublication[] = [];
  const publication: RecoveryPublicationPort = {
    currentFrame(): PresentedObserverFrame {
      return sink.getSnapshot().frame!;
    },
    publishRecovery(value): RecoveryPublicationReceipt {
      recoveryPublications.push(value);
      const publicationSerial = sink.publish(value.frame);
      return {
        status: "committed",
        publicationSerial,
        identity: {
          runId: value.frame.runId,
          sourceKey: value.frame.sourceKey,
          revision: value.frame.revision,
          firstCursor: value.frame.firstCursor,
          lastCursor: value.frame.lastCursor,
        },
      };
    },
  };
  const client = forbiddenAwareClient(async () => ({
    ...structuredClone(task4Manifest.initialSnapshot),
    event_cursor: 4,
    world_time: task4Manifest.initialSnapshot.world_time + 4,
  }));
  let placementFailures = options.placementFailures ?? 0;
  const placement = {
    replaceFromSnapshot: vi.fn((_snapshot: WorldSnapshot) => {
      if (placementFailures > 0) {
        placementFailures -= 1;
        throw new Error("placement unavailable");
      }
    }),
  };
  const coordinator = createRecoveryCoordinator({
    client,
    model,
    placement,
    settlement,
    publication,
    getActiveIdentity: () => sink.getSnapshot().frame!,
    allowLegacyPlacementForTests: true,
  });
  return {
    client,
    clock,
    consequenceFrames,
    consequencePublicationSerials,
    coordinator,
    currentIdentity: () => sink.getSnapshot().frame!,
    director,
    placement,
    recoveryPublications,
    settlement,
    sink,
  };
}

function observerFrame(
  model: PresentedWorldModel,
  identity: FrameIdentity,
  scene: PresentedSceneView | null,
): PresentedObserverFrame {
  return {
    ...identity,
    source: "live",
    ingestedCursor: identity.lastCursor,
    presentedCursor: identity.lastCursor,
    world: model.getView(),
    scene,
    selection: null,
    backlog: {
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Caught up",
    },
    transport: {
      connection: "live",
      ingestedCursor: identity.lastCursor,
      retryable: false,
    },
  };
}

function sceneFor(
  moment: StoryMoment,
  phase: PresentedSceneView["phase"],
): PresentedSceneView {
  return {
    momentId: moment.id,
    regionId: moment.representative.event.region,
    phase,
    focus: moment.focus,
    dialogue: null,
    actorIntents: [],
    homeIntents: [],
    effectIntents: [],
    safeCancelMarkers: ["settled"],
    reducedMotion: false,
  };
}

interface ControllableSettlement extends RecoverySettlementPort {
  readonly requestSafeCancel: Mock<(reason: string) => void>;
  readonly subscribe: Mock<(listener: () => void) => () => void>;
  readonly unsubscribe: Mock<() => void>;
  onSubscribe: (() => void) | null;
  acknowledgeCurrent(): void;
  settleCurrent(): void;
  emitStaleSettlement(): void;
}

function settlementIdle(): ControllableSettlement {
  return settlementFrom({
    sceneToken: null,
    consequenceCommitted: false,
    publishedRevision: null,
    safeBoundaryAcknowledged: false,
    cancelRequested: false,
    cancelGeneration: 0,
    acknowledgedCancelGeneration: null,
    sceneSettled: false,
  });
}

function settlementAlreadySettled(): ControllableSettlement {
  return settlementFrom({
    sceneToken: 3,
    consequenceCommitted: true,
    publishedRevision: 7,
    safeBoundaryAcknowledged: true,
    cancelRequested: false,
    cancelGeneration: 0,
    acknowledgedCancelGeneration: 0,
    sceneSettled: true,
  });
}

function activeSettlement(): ControllableSettlement {
  return settlementFrom({
    sceneToken: 3,
    consequenceCommitted: true,
    publishedRevision: 7,
    safeBoundaryAcknowledged: false,
    cancelRequested: false,
    cancelGeneration: 0,
    acknowledgedCancelGeneration: null,
    sceneSettled: false,
  });
}

function settlementFrom(initial: Omit<ReturnType<RecoverySettlementPort["getSnapshot"]>, "momentId">): ControllableSettlement {
  let snapshot = { ...initial, momentId: initial.sceneToken === null ? null : "moment-3" };
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const requestSafeCancel = vi.fn<(reason: string) => void>(() => {
    snapshot = {
      ...snapshot,
      cancelRequested: true,
      cancelGeneration: snapshot.cancelGeneration + 1,
      acknowledgedCancelGeneration: null,
      safeBoundaryAcknowledged: false,
      sceneSettled: false,
    };
    emit();
  });
  const unsubscribe = vi.fn<() => void>();
  const settlement: ControllableSettlement = {
    getSnapshot: () => snapshot,
    requestSafeCancel,
    subscribe: vi.fn((listener: () => void): (() => void) => {
      listeners.add(listener);
      settlement.onSubscribe?.();
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
        unsubscribe();
      };
    }),
    unsubscribe,
    onSubscribe: null,
    acknowledgeCurrent(): void {
      snapshot = {
        ...snapshot,
        safeBoundaryAcknowledged: true,
        acknowledgedCancelGeneration: snapshot.cancelGeneration,
      };
      emit();
    },
    settleCurrent(): void {
      snapshot = { ...snapshot, sceneSettled: true };
      emit();
    },
    emitStaleSettlement(): void {
      const current = snapshot;
      snapshot = {
        ...snapshot,
        acknowledgedCancelGeneration: Math.max(0, snapshot.cancelGeneration - 1),
        safeBoundaryAcknowledged: true,
        sceneSettled: true,
      };
      emit();
      snapshot = current;
    },
  };
  return settlement;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function flushPromises(turns = 2): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

function _assertGapType(_gap: PresentationGap): void {
  // Compile-only guard: recovery publications expose canonical gap contracts.
}
