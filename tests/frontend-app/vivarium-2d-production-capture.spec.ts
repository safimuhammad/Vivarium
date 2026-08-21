import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  readFileSync,
  rm,
} from "node:fs";
import { promisify } from "node:util";
import path from "node:path";

import { expect, test, type Page, type Request, type TestInfo } from "@playwright/test";

import {
  chronicleTerminalAuthority,
  parseChronicleManifest,
  type ChronicleManifest,
  type ChroniclePresentationTerminalAuthority,
} from "../../frontend/src/presentation/fixtures/chronicleCatalog";
import type {
  CheckpointFocusTarget,
  FrameIdentity,
  PresentedObserverFrame,
  PresentedRecord,
} from "../../frontend/src/presentation/contracts";
import type { WorldSnapshot } from "../../frontend/src/app/schemas";
import type {} from "../../frontend/src/app/observer2d/productionCaptureTestSeam";
import {
  assertC03ResourceTransferWitness,
  assertNoFrameDrivenReactCommits,
  buildEventMarkerExpectations,
  captureReadyToSettle,
  eventMarkerBoundaryReached,
  observedCursorAuthority,
  type EventMarkerExpectation,
  type C03ResourceTransferWitnessObservation,
  type C03ResourceTransferWitnessEvidence,
  orderCapturedMarkerIds,
  presentationTerminalReached,
} from "../../frontend/src/capture/captureEvidence";
import {
  createRuntimeNetworkObservation,
  normalizeRuntimeRequests,
  recordRuntimeNetworkResponse,
  recordRuntimeNetworkTerminal,
  type RuntimeNetworkObservation,
} from "../../frontend/src/capture/runtimeNetworkEvidence";
import {
  classifyCaptureLongTasks,
  recordCaptureProductWork,
  startBrowserLongTaskObservation,
  stopBrowserLongTaskObservation,
  type CaptureLongTaskEvidence,
  type CaptureLongTaskObservation,
  type CaptureProductWorkInterval,
} from "../../frontend/src/capture/longTaskAttribution";
import {
  readingHoldDuration,
  type ReadingHoldWitness,
} from "../../frontend/src/capture/readingHoldDuration";
import {
  C14_EVENTLESS_CAPTURE_OPERATION_START_FRAMES,
  C15_EVENTLESS_CAPTURE_OPERATION_START_FRAMES,
  createEventlessCaptureOperationDriver,
  eventlessCaptureSchedulerIsQuiescent,
  runSameTimeSettledEventlessCaptureFrame,
  type EventlessCaptureOperationDriver,
} from "../../frontend/src/capture/eventlessCaptureOperationDriver";
import {
  installProductionChronicleFixture,
  type ProductionChronicleFixture,
} from "./fixtures/production-chronicle-fixture";
import {
  captureFrameCountWithTerminalWitness,
  productionCaptureFrameCeiling,
  productionTravelFrameBudget,
} from "./fixtures/production-chronicle-budget";
import { createC16ManualCaptureScenario } from "./fixtures/c16-manual-capture-scenario";
import { drainTerminalObserverUi } from "./fixtures/terminal-observer-ui-drain";
import { installTypedProductionCaptureEntry } from "./fixtures/typed-production-capture-entry";
import { projectMotionSamplesForHandoff } from "../../frontend/scripts/project-2d-capture-handoff.mjs";
import {
  canonicalJson,
  writeNormalizedJson,
} from "../../frontend/scripts/recording-artifacts.mjs";

const readFileAsync = promisify(readFile);
const mkdirAsync = promisify(mkdir);
const copyFileAsync = promisify(copyFile);
const rmAsync = promisify(rm);
const execFileAsync = promisify(execFile);
const FPS = 30;
const CAPTURE_ACCEPTANCE_DRAIN_LIMIT = 64;
const QUIET_CANVAS_PROBE_DURATION_MS = 500;
const QUIET_CANVAS_PROBE_TICKS = 15;
const LIVE_ANNOUNCER_IDLE_TIMEOUT_MS = 2_000;
const CHECKPOINT_CORRECTION_HOLD_MS = 800;
const TERMINAL_CAMERA_STABLE_SAMPLE_COUNT = 3;
const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900 }),
  mobile: Object.freeze({ width: 390, height: 844 }),
});
const CAPTURE_ENABLED = process.env.VIVARIUM_CAPTURE_2D_PRODUCTION === "1";
const OUTPUT_ROOT = path.resolve(
  process.env.VIVARIUM_CAPTURE_2D_OUTPUT ?? "scratchpad/2d-production-chronicles",
);
const FIXTURE_ROOT = path.resolve("tests/frontend-app/fixtures/chronicles/data");
const CATALOG_PATH = path.join(FIXTURE_ROOT, "catalog.json");
const CATALOG = parseCatalog(readFileSync(CATALOG_PATH, "utf8"));

test.describe.serial("production 2D deterministic Chronicle capture", () => {
  for (const entry of CATALOG) {
    for (const [viewportName, viewportSize] of Object.entries(VIEWPORTS)) {
      test(`${entry.id} ${viewportName} writes exact ManualPresentationClock PNG evidence`, async ({ page, browser }, testInfo) => {
        test.skip(!CAPTURE_ENABLED, "set VIVARIUM_CAPTURE_2D_PRODUCTION=1 to write production evidence");
        expect([undefined, "off"].includes(testInfo.project.use.video as undefined | "off")).toBe(true);

        const fixturePath = path.join(FIXTURE_ROOT, entry.file);
        const manifest = parseChronicleManifest(JSON.parse(
          await readFileAsync(fixturePath, "utf8"),
        ));
        const terminalAuthority = chronicleTerminalAuthority(manifest);
        test.setTimeout(manifestTimeout(manifest));
        expect(manifest.id).toBe(entry.id);
        const outputDirectory = path.join(OUTPUT_ROOT, entry.id, viewportName);
        const framesDirectory = path.join(outputDirectory, ".frames");
        const markersDirectory = path.join(outputDirectory, "markers");
        await rmAsync(outputDirectory, { recursive: true, force: true });
        await mkdirAsync(framesDirectory, { recursive: true });
        await mkdirAsync(markersDirectory, { recursive: true });

        await page.setViewportSize(viewportSize);
        const runtimeNetworkObserver = observeRuntimeNetwork(page);
        await page.addInitScript(() => {
          (window as typeof window & {
            __vivariumEnableProductionCaptureClockForTest?: boolean;
          }).__vivariumEnableProductionCaptureClockForTest = true;
        });
        await installTypedProductionCaptureEntry(page);
        const navigationResponsePromise = page.waitForResponse((response) => (
          response.request().isNavigationRequest()
          && response.request().frame() === page.mainFrame()
        ));
        const fixture = await installProductionChronicleFixture(page, manifest, fixturePath);
        const navigationResponse = await navigationResponsePromise;
        const navigationUrl = new URL(navigationResponse.url());
        const navigationObservation = Object.freeze({
          method: navigationResponse.request().method(),
          path: `${navigationUrl.pathname}${navigationUrl.search}`,
          status: navigationResponse.status(),
          disposition: "fulfilled" as const,
        });
        await expect.poll(() => captureClockState(page)).toMatchObject({ nowMs: 0 });
        await startLongTaskObserver(page);
        const productWorkIntervals: CaptureProductWorkInterval[] = [];
        const captureScenario = await recordPageProductWork(
          page,
          productWorkIntervals,
          "scenario-prepare",
          () => prepareScenario(page, fixture, entry.id),
        );
        const targetCursor = captureScenario.terminal.cursor;
        await recordPageProductWork(
          page,
          productWorkIntervals,
          "scenario-initial-settle",
          () => settleObserverWork(page),
        );
        const initialObservation = await browserObservation(page);

        const eventMarkerCursors = buildEventMarkerExpectations(
          manifest.entries,
          manifest.expectedMarkers,
        );
        const markerFrames = new Map<string, number>();
        const markerObservations = new Map<string, BrowserObservation>();
        const checkpointWitnesses = new Map<number, MutableCheckpointHoldWitness>();
        const frames: CaptureFrame[] = [];
        const cursorSamples: CursorSample[] = [];
        const motionSamples: MotionSample[] = [];
        const runtimeObservations: RuntimeObservation[] = [];
        const stageIds = new Set<string>();
        const canvasIds = new Set<string>();
        const rasterCoordinates: number[] = [];
        const imageSmoothingSamples: boolean[] = [];
        const cacheRebuildReasons = new Set<string>();
        const maximumFrames = await captureFrameBudget(page, manifest);
        const minimumFrames = minimumCaptureFrames(entry.id);
        let finalObservation: BrowserObservation | null = null;
        let terminalCameraSamples: readonly TerminalCameraWitnessSample[] = [];
        let terminalCameraWitness: TerminalCameraWitness | null = null;
        let settledWithinBudget = false;

        for (let frameIndex = 0; frameIndex < maximumFrames; frameIndex += 1) {
          const exactTimeMs = frameIndex * 1000 / FPS;
          if (captureScenario.eventlessOperationDriver === null) {
            await recordPageProductWork(
              page,
              productWorkIntervals,
              `frame-${frameIndex}:scenario-input`,
              () => captureScenario.step(frameIndex),
            );
            await flushCaptureTime(page, exactTimeMs, productWorkIntervals, `frame-${frameIndex}`);
          } else {
            await runSameTimeSettledEventlessCaptureFrame(
              captureScenario.eventlessOperationDriver,
              frameIndex,
              exactTimeMs,
              (productWork) => recordPageProductWork(
                page,
                productWorkIntervals,
                `frame-${frameIndex}:eventless-operation`,
                productWork,
              ),
              async (sameTimeMs) => {
                await captureScenario.step(frameIndex);
                await advanceCaptureClock(page, sameTimeMs);
                await settleObserverWork(page);
              },
              async (sameTimeMs) => {
                await advanceCaptureClock(page, sameTimeMs);
                await settleObserverWork(page);
              },
              () => assertCaptureTimeQuiescent(page, exactTimeMs),
            );
          }
          const observation = await browserObservation(page);
          // Snapshot the settled eventless authority once per observed frame so
          // the visual and semantic evidence retain one stable phase identity.
          const frameOperationalTrace = captureScenario.operationalTrace();
          const authoritativeCursor = frameOperationalTrace.at(-1)?.live.cursor
            ?? captureScenario.authoritativeCursor(frameIndex);
          const frameCompleted = frameOperationalTrace.at(-1)?.completed
            ?? captureScenario.completed(frameIndex);
          const epochReady = captureScenario.epochReady(frameIndex);
          stageIds.add(observation.stageId);
          canvasIds.add(observation.canvasId);
          rasterCoordinates.push(...observation.canvas.coordinates);
          const renderRasterOrigin = exactRenderRasterOrigin(observation);
          rasterCoordinates.push(
            renderRasterOrigin.x,
            renderRasterOrigin.y,
          );
          imageSmoothingSamples.push(observation.canvas.imageSmoothingEnabled);
          if (typeof observation.renderer.cache.lastRebuildReason === "string") {
            cacheRebuildReasons.add(observation.renderer.cache.lastRebuildReason);
          }
          finalObservation = observation;
          expect(observation.clockNowMs).toBe(exactTimeMs);
          expect(observation.canvasFrameIdentity).toEqual(observation.observerFrameIdentity);
          const motion = captureMotionObservation(observation);
          captureCheckpointHoldWitness(checkpointWitnesses, observation, frameIndex);
          const relativeFrameFile = `.frames/${String(frameIndex).padStart(6, "0")}.png`;
          const absoluteFrameFile = path.join(outputDirectory, relativeFrameFile);
          await page.screenshot({ path: absoluteFrameFile, fullPage: false });
          const bytes = await readFileAsync(absoluteFrameFile);
          const frameFileEvidence = { bytes: bytes.length, sha256: sha256(bytes) };
          frames.push(Object.freeze({
            frameIndex,
            file: relativeFrameFile,
            ...frameFileEvidence,
            mediaTimeMs: exactTimeMs,
            presentationTimeMs: exactTimeMs,
            presentedCursor: observation.presentedCursor,
            presentedSource: observation.presentedSource,
            activeSceneCount: observation.activeSceneCount,
            pendingMoments: observation.pendingMoments,
            scenePhase: observation.scene?.phase ?? null,
            readingWitness: observation.dialogueNow,
            activeEffects: observation.renderer.graph.activeEffects,
            focusSelectionKey: motion.focusSelectionKey,
            transferFrame: c03TransferFrame(entry.id, frameIndex, observation, motion),
            ...captureRetainedFrameLineage(observation),
            canvasFrameIdentity: observation.canvasFrameIdentity,
            observerFrameIdentity: observation.observerFrameIdentity,
          }));
          appendCursorSample(
            cursorSamples,
            frameIndex,
            observation,
            authoritativeCursor,
            epochReady,
            captureScenario.terminal,
            frameOperationalTrace,
            frameCompleted,
          );
          appendRuntimeObservation(
            runtimeObservations,
            entry.id,
            frameIndex,
            authoritativeCursor,
            observation,
            epochReady,
            frameOperationalTrace,
            captureScenario.terminal,
          );
          const placements = placementHashes(observation);
          if (entry.id === "C16" && epochReady && [1_024, 2_048, 3_072, 4_096].includes(authoritativeCursor)) {
            const placementIds = Object.keys(placements);
            expect(placementIds.filter((id) => id.startsWith("actor:"))).toHaveLength(256);
            expect(placementIds.filter((id) => id.startsWith("home:"))).toHaveLength(128);
            expect(placementIds).toHaveLength(384);
          }
          motionSamples.push(Object.freeze({
            frameIndex,
            presentationTimeMs: exactTimeMs,
            cursor: observation.presentedCursor,
            epochReady,
            placementHash: sha256(Buffer.from(canonicalJson(placements))),
            placements,
            actors: motion.actors,
            focusSelectionKey: motion.focusSelectionKey,
            camera: motion.camera,
            regionTransitions: motion.regionTransitions,
            homes: observation.renderer.graph.homes,
            recentMarkers: observation.renderer.graph.recentMarkers,
            pathFallbacks: Number(observation.renderer.graph.pathFallbacks),
            activeEffects: observation.renderer.graph.activeEffects,
            activeRegion: observation.renderer.graph.activeRegion,
            environments: observation.renderer.graph.environments,
            rendererPool: observation.renderer.pool,
          }));
          terminalCameraSamples = retainConsecutiveTerminalCameraSamples(
            terminalCameraSamples,
            captureTerminalCameraWitnessSample(
              observation,
              frameIndex,
              exactTimeMs,
              captureScenario.terminal,
              frameCompleted,
            ),
          );
          for (const marker of manifest.expectedMarkers) {
            if (markerFrames.has(marker)) continue;
            if (markerReached(
              marker,
              observation,
              eventMarkerCursors,
              captureScenario.terminal,
              frameCompleted,
              terminalCameraSamples.length >= TERMINAL_CAMERA_STABLE_SAMPLE_COUNT,
            )) {
              markerFrames.set(marker, frameIndex);
              markerObservations.set(marker, observation);
              if (marker === "checkpoint:final") {
                terminalCameraWitness = finalizeTerminalCameraWitness(
                  terminalCameraSamples,
                  frameIndex,
                );
              }
            }
          }
          if (captureReadyToSettle({
            minimumFrameCountReached: frames.length >= minimumFrames,
            terminalReached: presentationTerminalReached(
              captureScenario.terminal,
              observedPresentationState(observation),
            ),
            expectedMarkersReached: manifest.expectedMarkers.every((marker) => (
              markerFrames.has(marker)
            )),
            checkpointHoldActive: checkpointHoldIsActive(observation),
            actors: observation.renderer.graph.actors,
          })) {
            settledWithinBudget = true;
            break;
          }
        }

        expect(finalObservation, "capture must observe the production Stage").not.toBeNull();
        if (!settledWithinBudget) {
          throw new Error(`capture did not settle within ${maximumFrames} frames: ${JSON.stringify({
            presentationTimeMs: frames.at(-1)?.presentationTimeMs,
            presentedCursor: finalObservation!.presentedCursor,
            canvasLastCursor: finalObservation!.canvasLastCursor,
            activeSceneCount: finalObservation!.activeSceneCount,
            pendingMoments: finalObservation!.pendingMoments,
            markers: [...markerFrames.entries()],
            recentMarkers: finalObservation!.renderer.graph.recentMarkers,
            nextDeadlineMs: finalObservation!.renderer.graph.nextDeadlineMs,
          })}`);
        }
        expect([...markerFrames.keys()].sort()).toEqual([...manifest.expectedMarkers].sort());
        if (manifest.expectedMarkers.includes("checkpoint:final")
          && terminalCameraWitness === null) {
          throw new Error("standard capture lacks terminal camera stability evidence");
        }
        const standardCheckpointWitnesses = finalizeCheckpointHoldWitnesses(checkpointWitnesses);
        assertTrustedCheckpointPresentation(manifest, standardCheckpointWitnesses, markerFrames);
        assertCausalHomeCapture(entry.id, motionSamples, markerObservations);
        await recordPageProductWork(
          page,
          productWorkIntervals,
          "terminal-observer-ui-settle",
          () => settleTerminalObserverProductWork(page),
        );
        await drainTerminalObserverUi(page, captureScenario.terminal);
        const quietCanvasProbe = await runQuietCanvasCommitProbe(page, productWorkIntervals);
        finalObservation = quietCanvasProbe.observation;
        const longTasks = classifyCaptureLongTasks(
          await stopLongTaskObserver(page),
          productWorkIntervals,
        );
        const observedMarkers = await writeMarkerEvidence(
          outputDirectory, viewportName, manifest, frames, markerFrames,
        );
        const timelineSha256 = sha256(Buffer.from(canonicalJson(frames)));
        const captureDocument = {
          schemaVersion: 1,
          chronicleId: entry.id,
          viewport: viewportName,
          route: "/?renderer=2d",
          clock: "ManualPresentationClock",
          captureMethod: "playwright-page-screenshot",
          playwrightRecordVideo: false,
          fps: FPS,
          frameCount: frames.length,
          timelineSha256,
          frames,
        };
        await writeCanonicalJson(path.join(outputDirectory, "markers.json"), {
          schemaVersion: 1,
          chronicleId: entry.id,
          viewport: viewportName,
          expected: manifest.expectedMarkers,
          observed: observedMarkers,
        });
        const standardMotion = motionModeEvidence(finalObservation!, frames, markerFrames, manifest);
        const standardTransferWitness = c03ResourceTransferWitnessEvidence(
          manifest,
          frames,
          markerFrames,
          markerObservations,
        );
        const reducedMotion = await runIndependentReducedMotionProbe(
          browser,
          viewportSize,
          fixturePath,
          manifest,
          outputDirectory,
          viewportName,
        );
        expect(reducedMotion.evidence).toEqual(standardMotion);
        expect(checkpointModeEvidence(reducedMotion.checkpointWitnesses.witnesses))
          .toEqual(checkpointModeEvidence(standardCheckpointWitnesses));
        assertTrustedTravelVisualFocus(
          manifest,
          motionSamples,
          standardCheckpointWitnesses,
          "standard",
        );
        assertTrustedTravelVisualFocus(
          manifest,
          reducedMotion.motionSamples,
          reducedMotion.checkpointWitnesses.witnesses,
          "reduced",
        );
        expect(reducedMotion.resourceTransferWitness).toEqual(standardTransferWitness);
        if (standardTransferWitness !== null) {
          await writeCanonicalJson(path.join(outputDirectory, "resource-transfer-witness.json"), {
            schemaVersion: 1,
            chronicleId: entry.id,
            viewport: viewportName,
            standard: standardTransferWitness,
            reduced: reducedMotion.resourceTransferWitness,
          });
        }
        const standardCadence = await runIndependentCadenceProbe(
          browser, viewportSize, fixturePath, manifest, false, 60,
        );
        const reducedCadence = await runIndependentCadenceProbe(
          browser, viewportSize, fixturePath, manifest, true, 30,
        );
        await writeCanonicalJson(path.join(outputDirectory, "reduced-markers.json"), {
          schemaVersion: 1,
          chronicleId: entry.id,
          viewport: viewportName,
          captureId: `${entry.id}:${viewportName}:reduced`,
          expected: manifest.expectedMarkers,
          observed: reducedMotion.observedMarkers,
        });
        if (reducedMotion.capture !== null) {
          await writeCanonicalJson(path.join(outputDirectory, "reduced-capture.json"), reducedMotion.capture);
        }
        const performanceEvidence = await collectCapturePerformanceEvidence(
          page,
          entry.id,
          runtimeObservations,
          finalObservation!,
          longTasks,
          reducedMotion.schedulerSamples,
        );
        await page.evaluate(async () => {
          try {
            await fetch("/api/replay/artifacts/events");
          } catch {
            // The fixture intentionally aborts raw-artifact access without a response.
          }
        });
        await page.evaluate(() => {
          const unmount = window.__vivariumProductionCaptureUnmountForTest;
          if (unmount === undefined) throw new Error("capture root unmount control is unavailable");
          unmount();
        });
        await settleObserverWork(page);
        const disposedDomOwners = await page.evaluate(() => ({
          stages: document.querySelectorAll(".presentation-world-stage").length,
          canvases: document.querySelectorAll(".presentation-world-stage canvas").length,
        }));
        const captureTerminal = await page.evaluate(() => (
          window.__vivariumProductionCaptureTerminalForTest ?? null
        ));
        const terminal = await fixture.dispose();
        expect(terminal).toMatchObject({
          activeStreams: 0,
          balancedSseLifecycle: true,
          unmatchedRouteCount: 0,
          routeReconciliationErrors: [],
        });
        const virtualSseLedger = await fixture.virtualSseLedger();
        const mechanicEventWitnesses = virtualSseLedger.filter((witness) => (
          witness.kind === "envelope"
          && witness.disposition === "accepted"
          && (witness.envelope?.events.length ?? 0) > 0
        ));
        if (entry.id === "C01" || entry.id === "C02") {
          expect(
            mechanicEventWitnesses.map((witness) => witness.envelope?.events ?? []),
            `${entry.id} exact travel budget requires one accepted entry per SSE envelope`,
          ).toEqual(manifest.entries.map((mechanicEntry) => [mechanicEntry]));
        }
        const runtimeRequests = normalizeRuntimeRequests(
          await runtimeNetworkObserver.snapshot(),
          fixture.requests.routeLedger,
          new URL(testInfo.project.use.baseURL as string).origin,
        );
        expect(captureTerminal?.rendererDisposals).toHaveLength(1);
        expect(disposedDomOwners).toEqual({ stages: 0, canvases: 0 });
        const retainedLifecycle = {
            fixture: terminal,
            renderer: captureTerminal,
            network: {
              navigation: { method: "GET", path: "/?renderer=2d", status: 200 },
              routeLedger: fixture.requests.routeLedger,
              observedRoutes: fixture.requests.observedRoutes,
              virtualSseLedger,
            },
          };
        await writeCanonicalJson(path.join(outputDirectory, "capture.json"), {
          ...captureDocument,
          lifecycle: retainedLifecycle,
        });
        const rawHandoffPath = path.join(outputDirectory, "capture-raw-observations.json");
        const ownerCounter = (created: number, disposed: number) => ({
          created,
          disposed,
          live: Math.max(0, created - disposed),
          outstanding: Math.max(0, created - disposed),
          peak: created > 0 ? 1 : 0,
        });
        const observations = {
          terminalCameraWitness,
          semanticTerminalObservation: {
            observerFrameIdentity: finalObservation!.observerFrameIdentity,
            canvasFrameIdentity: finalObservation!.canvasFrameIdentity,
            ingestedCursor: finalObservation!.ingestedCursor,
            presentedCursor: finalObservation!.presentedCursor,
            targetCursor,
            activeSceneCount: finalObservation!.activeSceneCount,
            pendingMoments: finalObservation!.pendingMoments,
            frame: finalObservation!.observer.captureFrame,
          },
          terminalAuthority,
          operationalWorkload: Object.freeze({
            trace: captureScenario.operationalTrace(),
          }),
          transportWitnesses: virtualSseLedger,
          eventWitnesses: mechanicEventWitnesses,
          markers: [...markerFrames.keys()],
          cadenceWindows: [
            standardCadence.active,
            reducedCadence.active,
            standardCadence.hidden,
          ],
          lifecycle: {
            stage: ownerCounter(stageIds.size, disposedDomOwners.stages === 0 ? stageIds.size : 0),
            canvas: ownerCounter(canvasIds.size, disposedDomOwners.canvases === 0 ? canvasIds.size : 0),
            graph: ownerCounter(
              Number(captureTerminal?.rendererCreations ?? 0),
              Number(captureTerminal?.rendererDisposals.length ?? 0),
            ),
            react: {
              initialCommitCount: Number(initialObservation.observer.reactCommitCount),
              finalCommitCount: Number(finalObservation!.observer.reactCommitCount),
              frameDrivenCommitCount: quietCanvasProbe.frameDrivenCommitCount,
              quietCanvasProbe: quietCanvasProbe.evidence,
            },
            cacheRebuildReasons: [...cacheRebuildReasons],
          },
          raster: { imageSmoothingSamples, coordinates: rasterCoordinates },
          viewportMetrics: {
            width: finalObservation!.viewport.width,
            height: finalObservation!.viewport.height,
            devicePixelRatio: finalObservation!.devicePixelRatio,
          },
          navigation: navigationObservation,
          requestSummary: {
            observedCount: runtimeRequests.length,
            ledgerSha256: sha256(Buffer.from(canonicalJson(runtimeRequests))),
          },
        };
        const handoffMotionSamples = projectMotionSamplesForHandoff(motionSamples);
        await writeCanonicalJson(rawHandoffPath, {
          schemaVersion: 1,
          chronicleId: entry.id,
          viewport: viewportName,
          cursorSamples,
          motionSamples: handoffMotionSamples,
          checkpointWitnesses: {
            standard: {
              witnesses: standardCheckpointWitnesses,
              markerFrames: Object.fromEntries(markerFrames),
            },
            reduced: reducedMotion.checkpointWitnesses,
          },
          runtimeObservations,
          performanceEvidence,
          terminalObservation: finalObservation,
          reducedTerminalCameraWitness: reducedMotion.terminalCameraWitness,
          markerFrames: [...markerFrames.entries()],
          standardMotion,
          reducedMotion: reducedMotion.evidence,
          captureTerminal,
          requests: { ...fixture.requests, runtimeRequests },
          observations,
        });
        const encoded = await execFileAsync(process.execPath, [
          "frontend/scripts/record-2d-chronicles.mjs",
          "--prepared-viewport", outputDirectory,
          "--chronicle-id", entry.id,
          "--viewport-name", viewportName,
          "--fixture", fixturePath,
        ]);
        expect(JSON.parse(encoded.stdout)).toEqual({ encoded: `${entry.id}/${viewportName}` });
        const finalized = await execFileAsync(process.execPath, [
          "frontend/scripts/finalize-2d-capture-handoff.mjs",
          "--handoff", rawHandoffPath,
          "--artifact-root", OUTPUT_ROOT,
          "--application-origin", new URL(testInfo.project.use.baseURL as string).origin,
          "--delete-on-success",
        ]);
        expect(JSON.parse(finalized.stdout)).toEqual({ finalized: `${entry.id}/${viewportName}` });
      });
    }
  }
});

interface CatalogEntry {
  readonly id: string;
  readonly file: string;
}

interface CaptureFrame {
  readonly frameIndex: number;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly mediaTimeMs: number;
  readonly presentationTimeMs: number;
  readonly presentedCursor: number;
  readonly exactBaseCursor: number;
  readonly projectedThroughCursor: number;
  readonly region: Readonly<{
    activeRegionId: string | null;
    visibleRegionId: string | null;
    loadingRegionId: string | null;
  }>;
  readonly presentedSource: string;
  readonly activeSceneCount: number;
  readonly pendingMoments: number;
  readonly scenePhase: string | null;
  readonly readingWitness: ReadingHoldWitness | null;
  readonly activeEffects: number;
  readonly focusSelectionKey: string | null;
  readonly transferFrame: C03ResourceTransferWitnessObservation["transferFrames"][number] | null;
  readonly canvasFrameIdentity: FrameIdentity | null;
  readonly observerFrameIdentity: FrameIdentity | null;
}

interface BrowserObservation {
  readonly clockNowMs: number;
  readonly presentedCursor: number;
  readonly presentedSource: string;
  readonly activeSceneCount: number;
  readonly pendingMoments: number;
  readonly ingestedCursor: number;
  readonly canvasLastCursor: number;
  readonly canvasFrameIdentity: FrameIdentity | null;
  readonly observerFrameIdentity: FrameIdentity | null;
  readonly observerPublicationSerial: number;
  readonly scene: any;
  readonly dialogueNow: ReadingHoldWitness | null;
  readonly settlement: any;
  readonly publicText: string;
  readonly semanticSubjects: readonly string[];
  readonly stageLabel: string;
  readonly stageId: string;
  readonly canvasId: string;
  readonly canvas: Readonly<{
    width: number;
    height: number;
    clientWidth: number;
    clientHeight: number;
    imageSmoothingEnabled: boolean;
    integerAligned: boolean;
    coordinates: readonly number[];
  }>;
  readonly bodyScroll: Readonly<{ horizontal: boolean; vertical: boolean }>;
  readonly devicePixelRatio: number;
  readonly viewport: Readonly<{ width: number; height: number }>;
  readonly observer: any;
  readonly renderer: any;
}

interface TerminalCameraWitnessSample {
  readonly frameIndex: number;
  readonly presentationTimeMs: number;
  readonly frameIdentity: FrameIdentity;
  readonly presentation: Readonly<{
    ingestedCursor: number;
    presentedCursor: number;
    canvasLastCursor: number;
    activeSceneCount: number;
    pendingMoments: number;
  }>;
  readonly world: Readonly<{
    exactBaseCursor: number;
    projectedThroughCursor: number;
  }>;
  readonly region: Readonly<{
    activeRegionId: string;
    visibleRegionId: string;
    loadingRegionId: null;
  }>;
  readonly camera: Readonly<{
    mode: string;
    center: Readonly<{ x: number; y: number }>;
    zoom: number;
    rasterOrigin: Readonly<{ x: number; y: number }>;
    safeFrame: Readonly<{ x: number; y: number; width: number; height: number }>;
    viewport: Readonly<{ width: number; height: number }>;
    focusSelectionKey: string | null;
    pendingStoryEntityId: null;
    pendingStoryTarget: null;
  }>;
  readonly activeEffects: 0;
  readonly actors: readonly Readonly<{
    id: string;
    instanceId: number;
    position: Readonly<{ x: number; y: number }>;
    facing: string;
    activeAction: null;
    reposition: null;
  }>[];
}

interface TerminalCameraWitness {
  readonly requiredConsecutiveSamples: 3;
  readonly markerFrameIndex: number;
  readonly samples: readonly TerminalCameraWitnessSample[];
}

interface CursorSample {
  readonly frameIndex: number;
  readonly authoritativeCursor: number;
  readonly acceptedCursor: number;
  readonly presentedCursor: number;
  readonly publicCursor: number;
  readonly runId: string;
  readonly sourceKey: string;
  readonly phase: "running" | "paused" | "recovering" | "settled";
  readonly epochReady: boolean;
}

interface MotionSample {
  readonly frameIndex: number;
  readonly presentationTimeMs: number;
  readonly cursor: number;
  readonly epochReady: boolean;
  readonly placementHash: string;
  readonly placements: Readonly<Record<string, string>>;
  readonly actors: readonly unknown[];
  readonly focusSelectionKey: string | null;
  readonly camera: unknown;
  readonly regionTransitions: readonly unknown[];
  readonly homes: readonly unknown[];
  readonly recentMarkers: readonly unknown[];
  readonly pathFallbacks: number;
  readonly activeEffects: number;
  readonly activeRegion: Readonly<{ id: string }> | null;
  readonly environments: readonly any[];
  readonly rendererPool: any;
}

interface CheckpointRenderedHomeWitness {
  readonly id: string;
  readonly instanceId: number;
  readonly kind: "home" | "ruin";
  readonly status: "standing" | "ruin" | "unknown";
  readonly plot: Readonly<{ x: number; y: number }>;
  readonly durable: Readonly<{
    status: "standing" | "ruin" | "unknown";
    integrityRatio: number | null;
    remnantMaterials: number | null;
  }>;
  readonly diagnostics: Readonly<{
    rawIntegrity: number | null;
    rawMaxIntegrity: number | null;
    integrityClamped: boolean;
  }>;
  readonly geometry: Readonly<{
    logicalBounds: Readonly<{ width: number; height: number }>;
    worldBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  }>;
  readonly visual: Readonly<{
    backComponents: readonly string[];
    frontComponents: readonly string[];
    ruinFrameId: string | null;
  }>;
  readonly screenBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly screenVisible: boolean;
  readonly safeFrameVisible: boolean;
}

interface CheckpointHoldFrameSample {
  readonly frameIndex: number;
  readonly presentationTimeMs: number;
  readonly elapsedMs: number;
  readonly remainingMs: number;
  readonly presentedCursor: number;
  readonly frameIdentity: FrameIdentity;
  readonly publicationSerial: number;
  readonly activeRegionId: string | null;
  readonly focusTarget: CheckpointFocusTarget & Readonly<{
    segmentDurationMs: number;
    segmentElapsedMs: number;
    segmentRemainingMs: number;
  }>;
  readonly viewport: Readonly<{ width: number; height: number }>;
  readonly camera: Readonly<{
    zoom: number;
    rasterOrigin: Readonly<{ x: number; y: number }>;
  }>;
  readonly safeFrame: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly homes: readonly CheckpointRenderedHomeWitness[];
}

interface CheckpointHoldWitness {
  readonly line: number;
  readonly eventCursor: number;
  readonly worldTime: number;
  readonly correctionEntityIds: readonly string[];
  readonly durationMs: number;
  readonly firstFrameIndex: number;
  readonly lastFrameIndex: number;
  readonly firstPresentationTimeMs: number;
  readonly lastPresentationTimeMs: number;
  readonly firstElapsedMs: number;
  readonly lastElapsedMs: number;
  readonly sampleCount: number;
  readonly presentedCursor: number;
  readonly firstFrameIdentity: FrameIdentity;
  readonly lastFrameIdentity: FrameIdentity;
  readonly samples: readonly CheckpointHoldFrameSample[];
  readonly world: Readonly<{
    runId: string;
    exactBaseCursor: number;
    projectedThroughCursor: number;
    worldTime: number;
    agents: readonly unknown[];
    homes: readonly unknown[];
    regions: readonly unknown[];
    ruins: readonly unknown[];
    pendingProposals: readonly unknown[];
  }>;
}

interface MutableCheckpointHoldWitness extends Omit<CheckpointHoldWitness,
  "lastFrameIndex" | "lastPresentationTimeMs" | "lastElapsedMs" | "lastFrameIdentity"
  | "sampleCount" | "samples"> {
  lastFrameIndex: number;
  lastPresentationTimeMs: number;
  lastElapsedMs: number;
  lastFrameIdentity: FrameIdentity;
  sampleCount: number;
  samples: CheckpointHoldFrameSample[];
}

interface CheckpointModeWitnesses {
  readonly witnesses: readonly CheckpointHoldWitness[];
  readonly markerFrames: Readonly<Record<string, number>>;
}

function captureCheckpointHoldWitness(
  retained: Map<number, MutableCheckpointHoldWitness>,
  observation: BrowserObservation,
  frameIndex: number,
): void {
  const hold = observation.observer.session?.director?.checkpointHold as Readonly<{
    line: number;
    eventCursor: number;
    worldTime: number;
    correctionEntityIds: readonly string[];
    durationMs: number;
    elapsedMs: number;
    remainingMs: number;
    segmentDurationMs: number;
    segmentElapsedMs: number;
    segmentRemainingMs: number;
    focusTarget: CheckpointFocusTarget;
  }> | null | undefined;
  if (hold === null || hold === undefined) return;
  const frame = observation.observer.captureFrame as PresentedObserverFrame | null;
  if (frame === null || observation.observerFrameIdentity === null) {
    throw new Error(`checkpoint hold line ${hold.line} lacks an accepted observer frame`);
  }
  if (frame.checkpointFocus === null || frame.checkpointFocus === undefined) {
    throw new Error(`checkpoint hold line ${hold.line} lacks a checkpoint focus target`);
  }
  expect(frame.checkpointFocus, `checkpoint hold line ${hold.line} focus identity`)
    .toEqual(hold.focusTarget);
  const exactValues = (records: readonly PresentedRecord<unknown>[], label: string): readonly unknown[] => {
    if (records.some(({ completeness }) => completeness !== "exact")) {
      throw new Error(`checkpoint hold line ${hold.line} has non-exact ${label}`);
    }
    return records.map(({ value }) => structuredClone(value));
  };
  const world = Object.freeze({
    runId: frame.runId,
    exactBaseCursor: frame.world.exactBaseCursor,
    projectedThroughCursor: frame.world.projectedThroughCursor,
    worldTime: frame.world.worldTime,
    agents: exactValues(frame.world.agents, "agents"),
    homes: exactValues(frame.world.homes, "homes"),
    regions: exactValues(frame.world.regions, "regions"),
    ruins: exactValues(frame.world.ruins, "ruins"),
    pendingProposals: structuredClone(frame.world.pendingProposals),
  });
  const sample = captureCheckpointHoldFrameSample(observation, frameIndex, hold);
  const candidate: MutableCheckpointHoldWitness = {
    line: hold.line,
    eventCursor: hold.eventCursor,
    worldTime: hold.worldTime,
    correctionEntityIds: Object.freeze([...hold.correctionEntityIds]),
    durationMs: hold.durationMs,
    firstFrameIndex: frameIndex,
    lastFrameIndex: frameIndex,
    firstPresentationTimeMs: observation.clockNowMs,
    lastPresentationTimeMs: observation.clockNowMs,
    firstElapsedMs: hold.elapsedMs,
    lastElapsedMs: hold.elapsedMs,
    sampleCount: 1,
    presentedCursor: observation.presentedCursor,
    firstFrameIdentity: Object.freeze({ ...observation.observerFrameIdentity }),
    lastFrameIdentity: Object.freeze({ ...observation.observerFrameIdentity }),
    samples: [sample],
    world,
  };
  const existing = retained.get(hold.line);
  if (existing === undefined) {
    retained.set(hold.line, candidate);
    return;
  }
  expect({
    eventCursor: candidate.eventCursor,
    worldTime: candidate.worldTime,
    correctionEntityIds: candidate.correctionEntityIds,
    durationMs: candidate.durationMs,
    presentedCursor: candidate.presentedCursor,
    world: candidate.world,
  }, `checkpoint hold line ${hold.line} changed while visible`).toEqual({
    eventCursor: existing.eventCursor,
    worldTime: existing.worldTime,
    correctionEntityIds: existing.correctionEntityIds,
    durationMs: existing.durationMs,
    presentedCursor: existing.presentedCursor,
    world: existing.world,
  });
  existing.lastFrameIndex = frameIndex;
  existing.lastPresentationTimeMs = observation.clockNowMs;
  existing.lastElapsedMs = hold.elapsedMs;
  existing.lastFrameIdentity = Object.freeze({ ...observation.observerFrameIdentity });
  existing.sampleCount += 1;
  existing.samples.push(sample);
}

function captureCheckpointHoldFrameSample(
  observation: BrowserObservation,
  frameIndex: number,
  hold: Readonly<{
    elapsedMs: number;
    remainingMs: number;
    segmentDurationMs: number;
    segmentElapsedMs: number;
    segmentRemainingMs: number;
    focusTarget: CheckpointFocusTarget;
  }>,
): CheckpointHoldFrameSample {
  const camera = captureMotionObservation(observation).camera;
  const homes = observation.renderer.graph.homes.map((home: any): CheckpointRenderedHomeWitness => {
    const plot = { x: Number(home.plot.x), y: Number(home.plot.y) };
    const logicalBounds = {
      width: Number(home.geometry.logicalBounds.width),
      height: Number(home.geometry.logicalBounds.height),
    };
    const worldBounds = {
      x: plot.x,
      y: plot.y,
      width: logicalBounds.width,
      height: logicalBounds.height,
    };
    const screenBounds = {
      x: worldBounds.x * camera.zoom + camera.rasterOrigin.x,
      y: worldBounds.y * camera.zoom + camera.rasterOrigin.y,
      width: worldBounds.width * camera.zoom,
      height: worldBounds.height * camera.zoom,
    };
    const screenVisible = screenBounds.x < camera.viewport.width
      && screenBounds.x + screenBounds.width > 0
      && screenBounds.y < camera.viewport.height
      && screenBounds.y + screenBounds.height > 0;
    const safeFrameVisible = screenBounds.x >= camera.safeFrame.x
      && screenBounds.y >= camera.safeFrame.y
      && screenBounds.x + screenBounds.width <= camera.safeFrame.x + camera.safeFrame.width
      && screenBounds.y + screenBounds.height <= camera.safeFrame.y + camera.safeFrame.height;
    return Object.freeze({
      id: String(home.id),
      instanceId: Number(home.instanceId),
      kind: String(home.kind) as "home" | "ruin",
      status: String(home.status) as "standing" | "ruin" | "unknown",
      plot: Object.freeze(plot),
      durable: Object.freeze({
        status: String(home.durable.status) as "standing" | "ruin" | "unknown",
        integrityRatio: home.durable.integrityRatio === null
          ? null
          : Number(home.durable.integrityRatio),
        remnantMaterials: home.durable.remnantMaterials === null
          ? null
          : Number(home.durable.remnantMaterials),
      }),
      diagnostics: Object.freeze({
        rawIntegrity: home.diagnostics.rawIntegrity === null
          ? null
          : Number(home.diagnostics.rawIntegrity),
        rawMaxIntegrity: home.diagnostics.rawMaxIntegrity === null
          ? null
          : Number(home.diagnostics.rawMaxIntegrity),
        integrityClamped: Boolean(home.diagnostics.integrityClamped),
      }),
      geometry: Object.freeze({
        logicalBounds: Object.freeze(logicalBounds),
        worldBounds: Object.freeze(worldBounds),
      }),
      visual: Object.freeze({
        backComponents: Object.freeze([...home.visual.backComponents].map(String)),
        frontComponents: Object.freeze([...home.visual.frontComponents].map(String)),
        ruinFrameId: home.visual.ruinFrameId === null ? null : String(home.visual.ruinFrameId),
      }),
      screenBounds: Object.freeze(screenBounds),
      screenVisible,
      safeFrameVisible,
    });
  });
  return Object.freeze({
    frameIndex,
    presentationTimeMs: observation.clockNowMs,
    elapsedMs: hold.elapsedMs,
    remainingMs: hold.remainingMs,
    presentedCursor: observation.presentedCursor,
    frameIdentity: Object.freeze({ ...observation.observerFrameIdentity! }),
    publicationSerial: observation.observerPublicationSerial,
    activeRegionId: observation.renderer.graph.activeRegion?.id ?? null,
    focusTarget: Object.freeze({
      ...hold.focusTarget,
      segmentDurationMs: hold.segmentDurationMs,
      segmentElapsedMs: hold.segmentElapsedMs,
      segmentRemainingMs: hold.segmentRemainingMs,
    }),
    viewport: Object.freeze({ ...camera.viewport }),
    camera: Object.freeze({
      zoom: camera.zoom,
      rasterOrigin: Object.freeze({ ...camera.rasterOrigin }),
    }),
    safeFrame: Object.freeze({ ...camera.safeFrame }),
    homes: Object.freeze(homes),
  });
}

function finalizeCheckpointHoldWitnesses(
  retained: ReadonlyMap<number, MutableCheckpointHoldWitness>,
): readonly CheckpointHoldWitness[] {
  return Object.freeze([...retained.values()]
    .sort((left, right) => left.line - right.line)
    .map((witness) => Object.freeze({
      ...witness,
      samples: Object.freeze([...witness.samples]),
    })));
}

function checkpointModeEvidence(witnesses: readonly CheckpointHoldWitness[]): readonly unknown[] {
  return witnesses.map(({
    firstFrameIndex: _firstFrameIndex,
    lastFrameIndex: _lastFrameIndex,
    firstPresentationTimeMs: _firstPresentationTimeMs,
    lastPresentationTimeMs: _lastPresentationTimeMs,
    firstElapsedMs: phaseOffsetMs,
    lastElapsedMs,
    firstFrameIdentity: { revision: _firstRevision, ...firstIdentity },
    lastFrameIdentity: { revision: _lastRevision, ...lastIdentity },
    samples,
    ...witness
  }) => ({
    ...witness,
    firstElapsedMs: 0,
    lastElapsedMs: checkpointParityTiming(lastElapsedMs - phaseOffsetMs),
    firstFrameIdentity: firstIdentity,
    lastFrameIdentity: lastIdentity,
    samples: samples.map(({
      frameIndex: _frameIndex,
      presentationTimeMs: _presentationTimeMs,
      viewport: _viewport,
      camera: _camera,
      safeFrame: _safeFrame,
      frameIdentity: { revision: _sampleRevision, ...sampleIdentity },
      publicationSerial: _publicationSerial,
      elapsedMs,
      remainingMs,
      focusTarget,
      homes,
      ...sample
    }) => ({
      ...sample,
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
      frameIdentity: sampleIdentity,
      homes: homes.map(({
        instanceId: _instanceId,
        plot: _plot,
        screenBounds: _screenBounds,
        screenVisible: _screenVisible,
        safeFrameVisible: _safeFrameVisible,
        geometry,
        ...home
      }) => {
        const { worldBounds: _worldBounds, ...geometrySemantics } = geometry;
        return { ...home, geometry: geometrySemantics };
      }),
    })),
  }));
}

function checkpointParityTiming(value: number): number {
  return Number(value.toFixed(9));
}

function assertTrustedCheckpointPresentation(
  manifest: ChronicleManifest,
  witnesses: readonly CheckpointHoldWitness[],
  markerFrames: ReadonlyMap<string, number>,
): void {
  const requiredLines = {
    C07: [1, 2, 3],
    C09: [1, 2],
  } as const;
  const expectedCorrectionIds: Readonly<Record<string, readonly string[]>> = {
    "C07:1": ["home_c07", "wanderer_002"],
    "C07:2": [
      "home_c07", "nirvana", "nirvana_east", "nirvana_west", "wanderer_001",
      "warm_springs",
    ],
    "C07:3": ["wanderer_002", "wanderer_004"],
    "C09:1": [
      "home_c09", "home_repair", "home_zero", "nirvana", "nirvana_east",
      "nirvana_west", "wanderer_001", "warm_springs",
    ],
    "C09:2": [
      "home_c09", "home_repair", "home_zero", "nirvana", "nirvana_east",
      "nirvana_west", "wanderer_001", "warm_springs",
    ],
  };
  const expectedFocusTargets: Readonly<Record<string, readonly CheckpointFocusTarget[]>> = {
    "C07:1": [
      { regionId: "warm_springs", kind: "home", entityId: "home_c07", segmentIndex: 0, segmentCount: 1, removed: false },
    ],
    "C07:2": [
      { regionId: "warm_springs", kind: "home", entityId: "home_c07", segmentIndex: 0, segmentCount: 1, removed: false },
    ],
    "C07:3": [
      { regionId: "warm_springs", kind: "region", entityId: null, segmentIndex: 0, segmentCount: 1, removed: false },
    ],
    "C09:1": [
      { regionId: "warm_springs", kind: "home", entityId: "home_repair", segmentIndex: 0, segmentCount: 3, removed: false },
      { regionId: "nirvana", kind: "ruin", entityId: "home_c09", segmentIndex: 1, segmentCount: 3, removed: false },
      { regionId: "nirvana", kind: "ruin", entityId: "home_zero", segmentIndex: 2, segmentCount: 3, removed: false },
    ],
    "C09:2": [
      { regionId: "warm_springs", kind: "home", entityId: "home_repair", segmentIndex: 0, segmentCount: 2, removed: false },
      { regionId: "nirvana", kind: "region", entityId: null, segmentIndex: 1, segmentCount: 2, removed: true },
    ],
  };
  const lines = requiredLines[manifest.id as keyof typeof requiredLines];
  if (lines === undefined) return;

  expect(witnesses.map(({ line }) => line), `${manifest.id} checkpoint holds`)
    .toEqual([...lines]);
  for (const line of lines) {
    const witness = witnesses.find((candidate) => candidate.line === line);
    const trusted = manifest.checkpoints.find((candidate) => candidate.line === line);
    expect(witness, `${manifest.id} must visibly hold checkpoint line ${line}`).toBeDefined();
    expect(trusted, `${manifest.id} lacks trusted checkpoint line ${line}`).toBeDefined();
    const snapshot = trusted!.checkpoint.snapshot;
    const focusTargets = expectedFocusTargets[`${manifest.id}:${line}`]!;
    expect({
      eventCursor: witness!.eventCursor,
      worldTime: witness!.worldTime,
      durationMs: witness!.durationMs,
      presentedCursor: witness!.presentedCursor,
      firstFrameRunId: witness!.firstFrameIdentity.runId,
      firstFrameLastCursor: witness!.firstFrameIdentity.lastCursor,
      lastFrameRunId: witness!.lastFrameIdentity.runId,
      lastFrameLastCursor: witness!.lastFrameIdentity.lastCursor,
      correctionEntityIds: witness!.correctionEntityIds,
      world: normalizeCheckpointWorld(witness!.world),
    }, `${manifest.id} checkpoint line ${line} must equal producer truth`).toEqual({
      eventCursor: trusted!.checkpoint.event_cursor,
      worldTime: trusted!.checkpoint.world_time,
      durationMs: CHECKPOINT_CORRECTION_HOLD_MS * focusTargets.length,
      presentedCursor: trusted!.checkpoint.event_cursor,
      firstFrameRunId: snapshot.run_id,
      firstFrameLastCursor: trusted!.checkpoint.event_cursor,
      lastFrameRunId: snapshot.run_id,
      lastFrameLastCursor: trusted!.checkpoint.event_cursor,
      correctionEntityIds: expectedCorrectionIds[`${manifest.id}:${line}`],
      world: trustedCheckpointWorld(snapshot),
    });
    assertCheckpointHoldCoverage(manifest.id, witness!, focusTargets);
    assertCheckpointRenderedWorld(manifest.id, witness!, snapshot, focusTargets);
  }

  const byLine = new Map(witnesses.map((witness) => [witness.line, witness]));
  const markerFrame = (marker: string): number => {
    const frame = markerFrames.get(marker);
    expect(frame, `${manifest.id} lacks ${marker} for checkpoint ordering`).toBeDefined();
    return frame!;
  };
  if (manifest.id === "C07") {
    expect(byLine.get(1)!.lastFrameIndex).toBeLessThan(byLine.get(2)!.firstFrameIndex);
    expect(byLine.get(2)!.lastFrameIndex).toBeLessThan(markerFrame("event:home_breached"));
    expect(markerFrame("event:home_breached")).toBeLessThanOrEqual(
      markerFrame("event:home_thieved"),
    );
    expect(markerFrame("event:home_thieved")).toBeLessThan(byLine.get(3)!.firstFrameIndex);
    expect(markerFrame("checkpoint:final")).toBeGreaterThan(byLine.get(3)!.lastFrameIndex);
  } else {
    expect(markerFrame("event:home_collapsed@cursor:1")).toBeLessThan(
      markerFrame("event:home_collapsed@cursor:2"),
    );
    expect(markerFrame("event:home_collapsed@cursor:2")).toBeLessThan(byLine.get(1)!.firstFrameIndex);
    expect(byLine.get(1)!.lastFrameIndex).toBeLessThan(markerFrame("event:agent_left_region"));
    expect(markerFrame("event:ruins_scavenged@cursor:5")).toBeLessThan(
      markerFrame("event:ruins_scavenged@cursor:6"),
    );
    expect(markerFrame("event:ruins_scavenged@cursor:6")).toBeLessThan(byLine.get(2)!.firstFrameIndex);
    expect(markerFrame("checkpoint:final")).toBeGreaterThan(byLine.get(2)!.lastFrameIndex);
  }
}

function assertTrustedTravelVisualFocus(
  manifest: ChronicleManifest,
  samples: readonly MotionSample[],
  checkpointWitnesses: readonly CheckpointHoldWitness[],
  mode: "standard" | "reduced",
): void {
  const travelEntries = manifest.entries.filter(({ event }) => (
    event.type === "agent_left_region" || event.type === "agent_entered_region"
  ));
  if (travelEntries.length === 0) return;
  if (travelEntries.length % 2 !== 0) {
    throw new Error(`${manifest.id} ${mode} travel entries must form exact left/entered pairs`);
  }
  for (let index = 0; index < travelEntries.length; index += 2) {
    const left = travelEntries[index]!;
    const entered = travelEntries[index + 1]!;
    if (left.event.type !== "agent_left_region" || entered.event.type !== "agent_entered_region") {
      throw new Error(`${manifest.id} ${mode} travel entries are out of order`);
    }
    const actorId = left.event.payload.agent_id;
    if (typeof actorId !== "string"
      || actorId !== entered.event.payload.agent_id
      || left.event.payload.from_region !== entered.event.payload.from_region
      || left.event.payload.to_region !== entered.event.payload.to_region) {
      throw new Error(`${manifest.id} ${mode} travel pair ${left.cursor}-${entered.cursor} is incoherent`);
    }
    const trustedStartAfter = checkpointWitnesses
      .filter((witness) => witness.eventCursor < left.cursor)
      .reduce((latest, witness) => Math.max(latest, witness.lastFrameIndex), -1);
    const window = samples.filter((sample) => (
      sample.frameIndex > trustedStartAfter
      && sample.cursor >= left.cursor - 1
      && sample.cursor <= entered.cursor - 1
    ));
    const label = `${manifest.id} ${mode} travel leg ${left.cursor}-${entered.cursor}`;
    if (window.length === 0) throw new Error(`${label} has no post-checkpoint presentation window`);
    let visibleDisplacements = 0;
    for (let sampleIndex = 0; sampleIndex < window.length; sampleIndex += 1) {
      const sample = window[sampleIndex]!;
      const actor = sample.actors.find((candidate: any) => candidate.id === actorId) as any;
      if (actor === undefined) throw new Error(`${label} is missing traveler ${actorId}`);
      if (sample.focusSelectionKey !== `agent:${actorId}` || actor.safeFrameVisible !== true) {
        throw new Error(`${label} traveler ${actorId} is not visibly Story-focused`);
      }
      const beforeSample = window[sampleIndex - 1];
      if (beforeSample === undefined || beforeSample.activeRegion?.id !== sample.activeRegion?.id) continue;
      const before = beforeSample.actors.find((candidate: any) => candidate.id === actorId) as any;
      if (before !== undefined
        && (before.position.x !== actor.position.x || before.position.y !== actor.position.y)) {
        visibleDisplacements += 1;
      }
    }
    if (visibleDisplacements === 0) throw new Error(`${label} has no visible locomotion displacement`);
  }
}

function assertCheckpointHoldCoverage(
  chronicleId: string,
  witness: CheckpointHoldWitness,
  expectedFocusTargets: readonly CheckpointFocusTarget[],
): void {
  const frameDurationMs = 1_000 / FPS;
  const toleranceMs = 0.001;
  const expectedDurationMs = expectedFocusTargets.length * CHECKPOINT_CORRECTION_HOLD_MS;
  const expectedSamplesPerSegment = Math.ceil(CHECKPOINT_CORRECTION_HOLD_MS / frameDurationMs);
  expect(witness.firstFrameIndex).toBeLessThanOrEqual(witness.lastFrameIndex);
  expect(witness.sampleCount, `${chronicleId} checkpoint line ${witness.line} sample count`)
    .toBe(witness.lastFrameIndex - witness.firstFrameIndex + 1);
  expect(witness.sampleCount, `${chronicleId} checkpoint line ${witness.line} complete focus samples`)
    .toBe(expectedFocusTargets.length * expectedSamplesPerSegment);
  expect(witness.durationMs).toBe(expectedDurationMs);
  expect(witness.firstElapsedMs).toBeGreaterThanOrEqual(0);
  expect(witness.firstElapsedMs).toBeLessThanOrEqual(frameDurationMs + toleranceMs);
  expect(witness.lastElapsedMs).toBeGreaterThanOrEqual(
    expectedDurationMs - frameDurationMs - toleranceMs,
  );
  expect(witness.lastElapsedMs).toBeLessThan(expectedDurationMs);
  expect(witness.lastPresentationTimeMs - witness.firstPresentationTimeMs)
    .toBeCloseTo(witness.lastElapsedMs - witness.firstElapsedMs, 6);
  expect(witness.firstFrameIdentity).toEqual(witness.samples[0]!.frameIdentity);
  expect(witness.lastFrameIdentity).toEqual(witness.samples.at(-1)!.frameIdentity);
  expect(witness.firstFrameIdentity.firstCursor).toBeLessThanOrEqual(witness.eventCursor);
  expect(witness.firstFrameIdentity.lastCursor).toBe(witness.eventCursor);
  const lineFrameIdentity = {
    runId: witness.firstFrameIdentity.runId,
    sourceKey: witness.firstFrameIdentity.sourceKey,
    firstCursor: witness.firstFrameIdentity.firstCursor,
    lastCursor: witness.firstFrameIdentity.lastCursor,
  };
  const segmentRevisions = new Map<number, number>();
  const segmentPublications = new Map<number, number>();
  for (const [index, sample] of witness.samples.entries()) {
    expect(sample.frameIndex).toBe(witness.firstFrameIndex + index);
    expect(sample.presentedCursor).toBe(witness.eventCursor);
    expect(sample.presentationTimeMs)
      .toBeCloseTo(witness.firstPresentationTimeMs + index * frameDurationMs, 6);
    expect(sample.elapsedMs)
      .toBeCloseTo(witness.firstElapsedMs + index * frameDurationMs, 6);
    expect(sample.elapsedMs + sample.remainingMs).toBeCloseTo(witness.durationMs, 6);
    const segmentIndex = Math.floor(index / expectedSamplesPerSegment);
    const segmentSampleIndex = index % expectedSamplesPerSegment;
    expect(sample.frameIdentity).toMatchObject({
      ...lineFrameIdentity,
    });
    expect(sample.publicationSerial).toBeGreaterThan(0);
    if (segmentSampleIndex === 0) {
      const priorRevision = segmentRevisions.get(segmentIndex - 1);
      const priorPublication = segmentPublications.get(segmentIndex - 1);
      if (segmentIndex > 0) {
        expect(sample.frameIdentity.revision,
          `${chronicleId} checkpoint line ${witness.line} target boundary revision`)
          .toBe(priorRevision! + 1);
        expect(sample.publicationSerial,
          `${chronicleId} checkpoint line ${witness.line} target boundary publication`)
          .toBe(priorPublication! + 1);
      }
      segmentRevisions.set(segmentIndex, sample.frameIdentity.revision);
      segmentPublications.set(segmentIndex, sample.publicationSerial);
    } else {
      expect(sample.frameIdentity.revision,
        `${chronicleId} checkpoint line ${witness.line} zero intra-segment revision churn`)
        .toBe(segmentRevisions.get(segmentIndex));
      expect(sample.publicationSerial,
        `${chronicleId} checkpoint line ${witness.line} zero intra-segment publication churn`)
        .toBe(segmentPublications.get(segmentIndex));
    }
    const {
      segmentDurationMs: _segmentDurationMs,
      segmentElapsedMs: _segmentElapsedMs,
      segmentRemainingMs: _segmentRemainingMs,
      ...observedFocusTarget
    } = sample.focusTarget;
    expect(observedFocusTarget,
      `${chronicleId} checkpoint line ${witness.line} focus segment ${segmentIndex}`)
      .toEqual(expectedFocusTargets[segmentIndex]!);
    expect(sample.focusTarget.segmentDurationMs).toBe(CHECKPOINT_CORRECTION_HOLD_MS);
    expect(sample.focusTarget.segmentElapsedMs)
      .toBeCloseTo(witness.firstElapsedMs + segmentSampleIndex * frameDurationMs, 6);
    expect(sample.focusTarget.segmentElapsedMs).toBeLessThan(CHECKPOINT_CORRECTION_HOLD_MS);
    expect(sample.focusTarget.segmentElapsedMs + sample.focusTarget.segmentRemainingMs)
      .toBeCloseTo(CHECKPOINT_CORRECTION_HOLD_MS, 6);
    if (index === 0) continue;
    const previous = witness.samples[index - 1]!;
    expect(sample.presentationTimeMs).toBeGreaterThan(previous.presentationTimeMs);
    expect(sample.elapsedMs).toBeGreaterThan(previous.elapsedMs);
    expect(sample.remainingMs).toBeLessThan(previous.remainingMs);
  }
}

function assertCheckpointRenderedWorld(
  chronicleId: string,
  witness: CheckpointHoldWitness,
  snapshot: WorldSnapshot,
  expectedFocusTargets: readonly CheckpointFocusTarget[],
): void {
  const partitioned = [
    ...snapshot.homes.map((home) => ({ home, kind: "home" as const })),
    ...snapshot.ruins.map((home) => ({ home, kind: "ruin" as const })),
  ];
  const samplesPerSegment = Math.ceil(CHECKPOINT_CORRECTION_HOLD_MS / (1_000 / FPS));
  for (const [sampleIndex, sample] of witness.samples.entries()) {
    const expectedFocusTarget = expectedFocusTargets[Math.floor(sampleIndex / samplesPerSegment)]!;
    expect(sample.activeRegionId,
      `${chronicleId} checkpoint line ${witness.line} active visual region`)
      .toBe(expectedFocusTarget.regionId);
    const {
      segmentDurationMs: _segmentDurationMs,
      segmentElapsedMs: _segmentElapsedMs,
      segmentRemainingMs: _segmentRemainingMs,
      ...observedFocusTarget
    } = sample.focusTarget;
    expect(observedFocusTarget).toEqual(expectedFocusTarget);
    const expectedVisible = partitioned
      .filter(({ home }) => home.region === sample.activeRegionId)
      .sort((left, right) => left.home.home_id.localeCompare(right.home.home_id));
    const actualVisible = [...sample.homes]
      .sort((left, right) => left.id.localeCompare(right.id));
    expect(actualVisible.map(({ id }) => id),
      `${chronicleId} checkpoint line ${witness.line} renderer home partition`)
      .toEqual(expectedVisible.map(({ home }) => home.home_id));
    for (const [index, { home, kind }] of expectedVisible.entries()) {
      const rendered = actualVisible[index]!;
      const ratio = home.max_integrity > 0
        ? Math.max(0, Math.min(1, home.integrity / home.max_integrity))
        : null;
      expect({
        kind: rendered.kind,
        status: rendered.status,
        durableStatus: rendered.durable.status,
        integrityRatio: rendered.durable.integrityRatio,
        remnantMaterials: rendered.durable.remnantMaterials,
        rawIntegrity: rendered.diagnostics.rawIntegrity,
        rawMaxIntegrity: rendered.diagnostics.rawMaxIntegrity,
      }, `${chronicleId} checkpoint line ${witness.line} rendered ${home.home_id}`).toEqual({
        kind,
        status: home.status,
        durableStatus: home.status,
        integrityRatio: ratio,
        remnantMaterials: home.remnant_materials,
        rawIntegrity: home.integrity,
        rawMaxIntegrity: home.max_integrity,
      });
      if (kind === "ruin") {
        expect(rendered.visual.ruinFrameId).not.toBeNull();
      } else {
        expect(rendered.visual.backComponents.length + rendered.visual.frontComponents.length)
          .toBeGreaterThan(0);
      }
      assertCheckpointRenderedHomeGeometry(sample, rendered, chronicleId, witness.line);
    }
    if (expectedFocusTarget.kind === "region") {
      if (expectedFocusTarget.removed) {
        expect(actualVisible,
          `${chronicleId} checkpoint line ${witness.line} removed region sweep`)
          .toEqual([]);
      } else {
        expect(actualVisible.length,
          `${chronicleId} checkpoint line ${witness.line} retained region partition`)
          .toBeGreaterThan(0);
      }
    } else {
      const renderedTarget = actualVisible.find(({ id }) => id === expectedFocusTarget.entityId);
      expect(renderedTarget,
        `${chronicleId} checkpoint line ${witness.line} continuous target ${String(expectedFocusTarget.entityId)}`)
        .toBeDefined();
      expect(renderedTarget!.kind).toBe(expectedFocusTarget.kind);
      expect(renderedTarget!.screenVisible).toBe(true);
      expect(renderedTarget!.safeFrameVisible).toBe(true);
    }
  }
}

function assertCheckpointRenderedHomeGeometry(
  sample: CheckpointHoldFrameSample,
  home: CheckpointRenderedHomeWitness,
  chronicleId: string,
  line: number,
): void {
  const label = `${chronicleId} checkpoint line ${line} rendered ${home.id}`;
  expect(home.geometry.worldBounds, `${label} world bounds`).toEqual({
    x: home.plot.x,
    y: home.plot.y,
    width: home.geometry.logicalBounds.width,
    height: home.geometry.logicalBounds.height,
  });
  const expectedScreenBounds = {
    x: home.geometry.worldBounds.x * sample.camera.zoom + sample.camera.rasterOrigin.x,
    y: home.geometry.worldBounds.y * sample.camera.zoom + sample.camera.rasterOrigin.y,
    width: home.geometry.worldBounds.width * sample.camera.zoom,
    height: home.geometry.worldBounds.height * sample.camera.zoom,
  };
  expect(home.screenBounds, `${label} screen bounds`).toEqual(expectedScreenBounds);
  const screenVisible = expectedScreenBounds.x < sample.viewport.width
    && expectedScreenBounds.x + expectedScreenBounds.width > 0
    && expectedScreenBounds.y < sample.viewport.height
    && expectedScreenBounds.y + expectedScreenBounds.height > 0;
  expect(home.screenVisible, `${label} screen visibility`).toBe(screenVisible);
  const safeFrameVisible = expectedScreenBounds.x >= sample.safeFrame.x
    && expectedScreenBounds.y >= sample.safeFrame.y
    && expectedScreenBounds.x + expectedScreenBounds.width
      <= sample.safeFrame.x + sample.safeFrame.width
    && expectedScreenBounds.y + expectedScreenBounds.height
      <= sample.safeFrame.y + sample.safeFrame.height;
  expect(home.safeFrameVisible, `${label} safe-frame visibility`).toBe(safeFrameVisible);
}

function trustedCheckpointWorld(snapshot: WorldSnapshot): CheckpointHoldWitness["world"] {
  return normalizeCheckpointWorld({
    runId: snapshot.run_id,
    exactBaseCursor: snapshot.event_cursor,
    projectedThroughCursor: snapshot.event_cursor,
    worldTime: snapshot.world_time,
    agents: snapshot.agents,
    homes: snapshot.homes,
    regions: snapshot.regions,
    ruins: snapshot.ruins,
    pendingProposals: snapshot.pending_proposals,
  });
}

function normalizeCheckpointWorld(
  world: CheckpointHoldWitness["world"],
): CheckpointHoldWitness["world"] {
  const ordered = (values: readonly unknown[], identityKey: string): readonly unknown[] => (
    [...values].sort((left, right) => {
      const leftId = String((left as Record<string, unknown>)[identityKey]);
      const rightId = String((right as Record<string, unknown>)[identityKey]);
      return leftId.localeCompare(rightId);
    })
  );
  return {
    runId: world.runId,
    exactBaseCursor: world.exactBaseCursor,
    projectedThroughCursor: world.projectedThroughCursor,
    worldTime: world.worldTime,
    agents: ordered(world.agents, "id"),
    homes: ordered(world.homes, "home_id"),
    regions: ordered(world.regions, "name"),
    ruins: ordered(world.ruins, "home_id"),
    pendingProposals: [...world.pendingProposals]
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
  };
}

function assertCausalHomeCapture(
  chronicleId: string,
  samples: readonly MotionSample[],
  markerObservations: ReadonlyMap<string, BrowserObservation>,
): void {
  const contests = {
    C07: { homeId: "home_c07", eventMarkers: ["event:home_breached", "event:home_thieved"] },
    C08: { homeId: "home_c08", eventMarkers: ["event:home_breached", "event:home_colonized"] },
  } as const;
  const contest = contests[chronicleId as keyof typeof contests];
  if (contest === undefined) return;

  const warmSpringsSamples = samples.filter(({ activeRegion }) => activeRegion?.id === "warm_springs");
  expect(warmSpringsSamples.length, `${chronicleId} must render its home region`).toBeGreaterThan(0);
  for (const sample of warmSpringsSamples) {
    const homes = sample.homes as readonly Readonly<{ id: string }>[];
    expect(homes.some(({ id }) => id === contest.homeId),
      `${chronicleId} lost its causally-present shelter at frame ${sample.frameIndex}`).toBe(true);
    expect(sample.pathFallbacks, `${chronicleId} used a standard-motion path fallback`).toBe(0);
    expect((sample.recentMarkers as readonly Readonly<{ actorId?: string; marker?: string }>[]).some(
      ({ actorId, marker }) => actorId === "wanderer_002" && marker === "repositioned",
    ), `${chronicleId} emitted an observer reposition marker`).toBe(false);
  }

  const actorTrace = warmSpringsSamples.flatMap((sample) => (
    (sample.actors as readonly CapturedActorMotion[])
      .filter(({ id }) => id === "wanderer_002")
      .map((actor) => ({ frameIndex: sample.frameIndex, actor }))
  ));
  expect(actorTrace.length, `${chronicleId} must retain Mae through the contest`).toBeGreaterThan(3);
  expect(new Set(actorTrace.map(({ actor }) => actor.instanceId)).size,
    `${chronicleId} recreated Mae during the contest`).toBe(1);
  expect(actorTrace.every(({ actor }) => actor.reposition === null),
    `${chronicleId} used fade repositioning instead of a physical route`).toBe(true);
  expect(actorTrace.some(({ actor }) => actor.activeAction === "moving"),
    `${chronicleId} never showed Mae walking`).toBe(true);
  expect(new Set(actorTrace.map(({ actor }) => `${actor.position.x},${actor.position.y}`)).size,
    `${chronicleId} did not visibly traverse its shelter route`).toBeGreaterThan(3);
  expect(actorTrace.at(-1)?.actor.position,
    `${chronicleId} did not return Mae to her durable origin`).toEqual(actorTrace[0]?.actor.position);
  for (let index = 1; index < actorTrace.length; index += 1) {
    const before = actorTrace[index - 1]!.actor.position;
    const after = actorTrace[index]!.actor.position;
    expect(Math.hypot(after.x - before.x, after.y - before.y),
      `${chronicleId} exceeded its 30 Hz physical-route step at frame ${actorTrace[index]!.frameIndex}`)
      .toBeLessThanOrEqual(1.600001);
  }

  for (const marker of contest.eventMarkers) {
    const observation = markerObservations.get(marker);
    expect(observation, `${chronicleId} lacks its exact ${marker} observation`).toBeDefined();
    const motion = captureMotionObservation(observation!);
    expect(motion.focusSelectionKey, `${chronicleId} ${marker} did not focus its shelter`)
      .toBe(`home:${contest.homeId}`);
    const home = observation!.renderer.graph.homes.find(({ id }: { id: string }) => id === contest.homeId);
    expect(home, `${chronicleId} ${marker} rendered no shelter`).toBeDefined();
    const screenDoor = {
      x: Number(home.door.x) * motion.camera.zoom + motion.camera.rasterOrigin.x,
      y: Number(home.door.y) * motion.camera.zoom + motion.camera.rasterOrigin.y,
    };
    expect(screenDoor.x).toBeGreaterThanOrEqual(motion.camera.safeFrame.x);
    expect(screenDoor.x).toBeLessThanOrEqual(motion.camera.safeFrame.x + motion.camera.safeFrame.width);
    expect(screenDoor.y).toBeGreaterThanOrEqual(motion.camera.safeFrame.y);
    expect(screenDoor.y).toBeLessThanOrEqual(motion.camera.safeFrame.y + motion.camera.safeFrame.height);
  }
}

interface CapturedActorMotion {
  readonly id: string;
  readonly instanceId: number;
  readonly position: Readonly<{ x: number; y: number }>;
  readonly facing: string;
  readonly activeAction: string | null;
  readonly opacity: number;
  readonly reposition: Readonly<{
    phase: "fade-out" | "fade-in";
    reason: "fallback";
    target: Readonly<{ x: number; y: number }>;
  }> | null;
  readonly worldBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly screenBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly screenVisible: boolean;
  readonly safeFrameVisible: boolean;
}

function captureMotionObservation(observation: BrowserObservation): Readonly<{
  focusSelectionKey: string | null;
  camera: Readonly<{
    mode: string;
    zoom: number;
    rasterOrigin: Readonly<{ x: number; y: number }>;
    safeFrame: Readonly<{ x: number; y: number; width: number; height: number }>;
    viewport: Readonly<{ width: number; height: number }>;
  }>;
  actors: readonly CapturedActorMotion[];
  regionTransitions: readonly unknown[];
}> {
  const camera = observation.renderer.camera;
  const rasterOrigin = exactRenderRasterOrigin(observation);
  const viewport = { width: observation.canvas.width, height: observation.canvas.height };
  const safeFrame = {
    x: Number(camera.safeFrame.x),
    y: Number(camera.safeFrame.y),
    width: Number(camera.safeFrame.width),
    height: Number(camera.safeFrame.height),
  };
  const zoom = Number(camera.zoom);
  const actors = observation.renderer.graph.actors.map((actor: any) => {
    const worldBounds = {
      x: Number(actor.worldBounds.x),
      y: Number(actor.worldBounds.y),
      width: Number(actor.worldBounds.width),
      height: Number(actor.worldBounds.height),
    };
    const screenBounds = {
      x: worldBounds.x * zoom + rasterOrigin.x,
      y: worldBounds.y * zoom + rasterOrigin.y,
      width: worldBounds.width * zoom,
      height: worldBounds.height * zoom,
    };
    const screenVisible = screenBounds.x < viewport.width
      && screenBounds.x + screenBounds.width > 0
      && screenBounds.y < viewport.height
      && screenBounds.y + screenBounds.height > 0;
    const safeFrameVisible = screenBounds.x >= safeFrame.x
      && screenBounds.y >= safeFrame.y
      && screenBounds.x + screenBounds.width <= safeFrame.x + safeFrame.width
      && screenBounds.y + screenBounds.height <= safeFrame.y + safeFrame.height;
    return Object.freeze({
      id: String(actor.id),
      instanceId: Number(actor.instanceId),
      position: Object.freeze({ x: Number(actor.position.x), y: Number(actor.position.y) }),
      facing: String(actor.facing),
      activeAction: typeof actor.activeAction === "string" ? actor.activeAction : null,
      opacity: Number(actor.opacity),
      reposition: actor.reposition === null ? null : Object.freeze({
        phase: String(actor.reposition.phase) as "fade-out" | "fade-in",
        reason: String(actor.reposition.reason) as "fallback",
        target: Object.freeze({
          x: Number(actor.reposition.target.x),
          y: Number(actor.reposition.target.y),
        }),
      }),
      worldBounds,
      screenBounds,
      screenVisible,
      safeFrameVisible,
    });
  });
  return Object.freeze({
    focusSelectionKey: camera.mode === "story"
      ? camera.storyEntityId ?? null
      : camera.mode === "follow" ? camera.followEntityId ?? null : null,
    camera: Object.freeze({
      mode: String(camera.mode),
      zoom,
      rasterOrigin: Object.freeze(rasterOrigin),
      safeFrame: Object.freeze(safeFrame),
      viewport: Object.freeze(viewport),
    }),
    actors: Object.freeze(actors),
    regionTransitions: Object.freeze([...(observation.renderer.graph.regionTransitions ?? [])]),
  });
}

function c03TransferFrame(
  chronicleId: string,
  frameIndex: number,
  observation: BrowserObservation,
  motion: Readonly<{ actors: readonly CapturedActorMotion[] }>,
): C03ResourceTransferWitnessObservation["transferFrames"][number] | null {
  if (chronicleId !== "C03"
    || observation.scene?.execution?.eventType !== "resource_transferred") return null;
  const phase = String(observation.scene?.phase ?? "");
  if (!["enter", "hold", "consequence", "recover", "exit"].includes(phase)) {
    throw new Error(`C03 transfer frame ${frameIndex} has invalid phase ${phase}`);
  }
  const sender = motion.actors.find(({ id }) => id === "wanderer_001");
  const receiver = motion.actors.find(({ id }) => id === "wanderer_002");
  if (sender === undefined || receiver === undefined) {
    throw new Error(`C03 transfer frame ${frameIndex} is missing an endpoint actor`);
  }
  return Object.freeze({
    frameIndex,
    phase,
    sender: Object.freeze({
      id: sender.id,
      position: Object.freeze({ ...sender.position }),
      activeAction: sender.activeAction,
      safeFrameVisible: sender.safeFrameVisible,
    }),
    receiver: Object.freeze({
      id: receiver.id,
      position: Object.freeze({ ...receiver.position }),
      activeAction: receiver.activeAction,
      safeFrameVisible: receiver.safeFrameVisible,
    }),
  });
}

function exactRenderRasterOrigin(
  observation: BrowserObservation,
): Readonly<{ x: number; y: number }> {
  const value = observation.renderer.renderRasterOrigin;
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("production capture actual renderRasterOrigin is unavailable");
  }
  return Object.freeze({ x, y });
}

interface RuntimeObservation {
  readonly frameIndex: number;
  readonly authoritativeCursor: number;
  readonly phase: "active" | "operational" | "pressure" | "terminal";
  readonly epochReady: boolean;
  readonly observation: BrowserObservation;
  readonly workload: unknown | null;
}

function appendRuntimeObservation(
  values: RuntimeObservation[],
  chronicleId: string,
  frameIndex: number,
  authoritativeCursor: number,
  observation: BrowserObservation,
  epochReady: boolean,
  operationalTrace: readonly import("./fixtures/production-chronicle-fixture").ProductionCaptureAuthorityTraceEntry[],
  terminalAuthority: ChroniclePresentationTerminalAuthority,
): void {
  const terminal = presentationTerminalReached(
    terminalAuthority,
    observedPresentationState(observation),
  );
  if (chronicleId === "C16") {
    const existing = values.findIndex((value) => value.authoritativeCursor === authoritativeCursor);
    if (authoritativeCursor === 1_024) {
      if (observation.activeSceneCount !== 1 || existing >= 0) return;
      values.push(Object.freeze({
        frameIndex,
        authoritativeCursor,
        phase: "active",
        observation,
        epochReady,
        workload: null,
      }));
      return;
    }
    if (!epochReady || existing >= 0) return;
    if (authoritativeCursor === 4_096 && !terminal) return;
    const phase = terminal ? "terminal" : "pressure";
    const sample = Object.freeze({
      frameIndex, authoritativeCursor, phase, observation, epochReady, workload: null,
    });
    values.push(sample);
    return;
  }
  const workload = operationalTrace.at(-1) ?? null;
  if (workload !== null) {
    if (observation.activeSceneCount !== 0) {
      throw new Error(`${chronicleId} eventless workload fabricated an active scene`);
    }
    const identity = observation.observerFrameIdentity;
    if (identity === null
      || identity.runId !== workload.selected.runId
      || identity.sourceKey !== workload.selected.sourceKey
      || observation.presentedCursor !== workload.selected.cursor
      || authoritativeCursor !== workload.live.cursor) {
      // The browser and async scenario authority crossed a frame boundary.
      // Retain only a frame where both were observed in the same stable phase.
      return;
    }
    const phase = workload.completed && terminal ? "terminal" as const : "operational" as const;
    const prior = values.findIndex((value) => (
      value.phase === phase && (value.workload as { label?: unknown } | null)?.label === workload.label
    ));
    if (prior < 0) {
      values.push(Object.freeze({
        frameIndex,
        authoritativeCursor,
        phase,
        observation,
        epochReady,
        workload,
      }));
    } else {
      values[prior] = Object.freeze({
        frameIndex,
        authoritativeCursor,
        phase,
        observation,
        epochReady,
        workload,
      });
    }
    return;
  }
  if (observation.activeSceneCount === 1 && !values.some(({ phase }) => phase === "active")) {
    values.push(Object.freeze({
      frameIndex, authoritativeCursor, phase: "active", observation, epochReady, workload: null,
    }));
  }
  if (terminal) {
    const prior = values.findIndex(({ phase }) => phase === "terminal");
    const sample = Object.freeze({
      frameIndex,
      authoritativeCursor,
      phase: "terminal" as const,
      observation,
      epochReady,
      workload: null,
    });
    if (prior < 0) values.push(sample);
    else values[prior] = sample;
  }
}

function observedPresentationState(observation: BrowserObservation) {
  return {
    runId: observation.observerFrameIdentity?.runId ?? "",
    sourceKey: observation.observerFrameIdentity?.sourceKey ?? "",
    ingestedCursor: observation.ingestedCursor,
    presentedCursor: observation.presentedCursor,
    canvasLastCursor: observation.canvasLastCursor,
    activeSceneCount: observation.activeSceneCount,
    pendingMoments: observation.pendingMoments,
  };
}

function checkpointHoldIsActive(observation: BrowserObservation): boolean {
  const hold = observation.observer.session?.director?.checkpointHold;
  return hold !== null && hold !== undefined;
}

function placementHashes(observation: BrowserObservation): Readonly<Record<string, string>> {
  const placement = observation.renderer.graph.placement;
  const rows = [
    ...placement.agents.map((agent: any) => [
      `actor:${agent.id}`,
      sha256(Buffer.from(canonicalJson({
        regionId: agent.regionId,
        point: agent.point,
        anchorKind: agent.anchorKind,
      }))),
    ] as const),
    ...placement.homes.map((home: any) => [
      `home:${home.id}`,
      sha256(Buffer.from(canonicalJson({
        regionId: home.regionId,
        plotId: home.plotId,
        door: home.door,
      }))),
    ] as const),
  ].sort(([left], [right]) => left.localeCompare(right));
  return Object.freeze(Object.fromEntries(rows));
}

interface MotionModeEvidence {
  readonly endpoints: readonly string[];
  readonly consequences: readonly string[];
  readonly markerOrder: readonly string[];
  readonly labels: readonly string[];
  readonly readingHoldsMs: readonly number[];
}

function parseCatalog(raw: string): readonly CatalogEntry[] {
  const parsed = JSON.parse(raw) as { chronicles?: CatalogEntry[] };
  if (!Array.isArray(parsed.chronicles)) throw new Error("Chronicle capture catalog is missing");
  const expected = Array.from({ length: 18 }, (_, index) => `C${String(index).padStart(2, "0")}`);
  const ids = parsed.chronicles.map(({ id }) => id);
  if (JSON.stringify(ids) !== JSON.stringify(expected)) throw new Error("capture catalog must retain exact C00-C17 order");
  return Object.freeze(parsed.chronicles.map((entry) => Object.freeze({ ...entry })));
}

interface PreparedCaptureScenario {
  readonly terminal: ChroniclePresentationTerminalAuthority;
  readonly eventlessOperationDriver: EventlessCaptureOperationDriver | null;
  step(frameIndex: number): Promise<void>;
  authoritativeCursor(frameIndex: number): number;
  completed(frameIndex: number): boolean;
  epochReady(frameIndex: number): boolean;
  operationalTrace(): readonly import("./fixtures/production-chronicle-fixture").ProductionCaptureAuthorityTraceEntry[];
}

async function prepareScenario(
  page: Page,
  fixture: ProductionChronicleFixture,
  chronicleId: string,
): Promise<PreparedCaptureScenario> {
  const finalCursor = fixture.manifest.expectedFinalCursor;
  const terminal = chronicleTerminalAuthority(fixture.manifest).presentation.terminal;
  if (chronicleId === "C16") {
    const pressure = createC16ManualCaptureScenario(page, fixture);
    await pressure.start();
    return Object.freeze({
      terminal,
      eventlessOperationDriver: null,
      step: (frameIndex: number) => pressure.step(frameIndex),
      authoritativeCursor: () => pressure.snapshot().authoritativeCursor,
      completed: () => pressure.snapshot().completed,
      epochReady: (frameIndex: number) => pressure.epochReady(frameIndex),
      operationalTrace: () => Object.freeze([]),
    });
  }
  if (chronicleId === "C14" || chronicleId === "C15" || finalCursor === 0) {
    return staticCaptureScenario(page, fixture, chronicleId, terminal);
  }
  if (chronicleId === "C13") {
    await fixture.dispatchRange(1, 1);
    return staticCaptureScenario(page, fixture, chronicleId, terminal);
  }
  await fixture.dispatchRange(1, finalCursor);
  return staticCaptureScenario(page, fixture, chronicleId, terminal);
}

function staticCaptureScenario(
  page: Page,
  fixture: ProductionChronicleFixture,
  chronicleId: string,
  terminal: ChroniclePresentationTerminalAuthority,
): PreparedCaptureScenario {
  const operationDriver = createFixtureEventlessCaptureOperationDriver(fixture, chronicleId);
  const operationalTrace = (): readonly import("./fixtures/production-chronicle-fixture").ProductionCaptureAuthorityTraceEntry[] => (
    fixture.scenario.kind === "none" ? Object.freeze([]) : fixture.scenario.authorityTrace()
  );
  return Object.freeze({
    terminal,
    eventlessOperationDriver: operationDriver,
    step: (frameIndex: number) => runStaticScenarioStep(page, fixture, chronicleId, frameIndex),
    authoritativeCursor: (frameIndex: number) => operationalTrace().at(-1)?.live.cursor
      ?? authoritativeCursorAt(chronicleId, frameIndex, terminal.cursor),
    completed: (frameIndex: number) => operationalTrace().at(-1)?.completed
      ?? scenarioCompletedAt(chronicleId, frameIndex),
    epochReady: () => false,
    operationalTrace,
  });
}

async function runStaticScenarioStep(
  page: Page,
  fixture: ProductionChronicleFixture,
  chronicleId: string,
  frameIndex: number,
): Promise<void> {
  if (chronicleId === "C13" && frameIndex === 12) {
    await page.getByRole("button", { name: "Pause story" }).click();
    await fixture.dispatchRange(2, fixture.manifest.expectedFinalCursor, {
      completion: "bounded-prefix",
    });
  } else if (chronicleId === "C13" && frameIndex === 24) {
    await page.getByRole("button", { name: "Resume story" }).click();
  } else if (chronicleId === "C00") {
    if (fixture.scenario.kind !== "C00") throw new Error("C00 capture requires its typed ambient scenario");
    if (frameIndex === 12) fixture.scenario.completeAmbientObservation();
  }
}

/** Bind typed C14/C15 fixture operations to their authored capture frames. */
function createFixtureEventlessCaptureOperationDriver(
  fixture: ProductionChronicleFixture,
  chronicleId: string,
): EventlessCaptureOperationDriver | null {
  const scenario = fixture.scenario;
  let startFrames: readonly number[];
  let operations: readonly (() => Promise<unknown>)[];
  if (chronicleId === "C14") {
    if (scenario.kind !== "C14") throw new Error("C14 capture requires its typed transport scenario");
    startFrames = C14_EVENTLESS_CAPTURE_OPERATION_START_FRAMES;
    operations = Object.freeze([
      () => scenario.recoverFromStreamErrorAndCheckpoint413(),
      () => scenario.recoverOnceFromOverflow(),
      () => scenario.replaceRun(),
      () => scenario.deliverStaleOldRun(),
    ]);
  } else if (chronicleId === "C15") {
    if (scenario.kind !== "C15") throw new Error("C15 capture requires its typed Archive scenario");
    startFrames = C15_EVENTLESS_CAPTURE_OPERATION_START_FRAMES;
    operations = Object.freeze([
      () => scenario.primeArchiveCursor(),
      () => scenario.enterArchive(),
      () => scenario.advanceLiveWhileArchived(),
      () => scenario.returnToLive(),
    ]);
  } else {
    return null;
  }

  return createEventlessCaptureOperationDriver(startFrames.map((startFrame, index) => ({
    startFrame,
    run: operations[index]!,
  })));
}

async function captureClockState(page: Page): Promise<{ nowMs: number; pending: number }> {
  return page.evaluate(() => {
    const control = window.__vivariumProductionCaptureClockForTest;
    if (control === undefined) throw new Error("opt-in ManualPresentationClock control is unavailable");
    return { nowMs: control.now(), pending: control.pendingCount() };
  });
}

async function advanceCaptureClock(page: Page, presentationTimeMs: number): Promise<void> {
  await page.evaluate((target) => {
    const control = window.__vivariumProductionCaptureClockForTest;
    if (control === undefined) throw new Error("opt-in ManualPresentationClock control is unavailable");
    control.advanceTo(target);
  }, presentationTimeMs);
}

async function advanceCaptureRendererClock(
  page: Page,
  presentationTimeMs: number,
): Promise<void> {
  await page.evaluate((target) => {
    const control = window.__vivariumProductionCaptureClockForTest;
    if (control === undefined) throw new Error("opt-in ManualPresentationClock control is unavailable");
    control.advanceRendererTo(target);
  }, presentationTimeMs);
}

async function recordPageProductWork<T>(
  page: Page,
  intervals: CaptureProductWorkInterval[],
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  return recordCaptureProductWork(
    intervals,
    label,
    () => page.evaluate(() => performance.now()),
    operation,
  );
}

async function flushCaptureTime(
  page: Page,
  presentationTimeMs: number,
  productWorkIntervals?: CaptureProductWorkInterval[],
  productWorkLabel: string = "capture-clock",
): Promise<void> {
  let matchingDrains = 0;
  let matchingIdentityKey: string | null = null;
  let lastAccepted: unknown = null;
  for (let drain = 0; drain < CAPTURE_ACCEPTANCE_DRAIN_LIMIT; drain += 1) {
    const advanceAndSettle = async (): Promise<void> => {
      await advanceCaptureClock(page, presentationTimeMs);
      await settleObserverWork(page);
    };
    if (productWorkIntervals === undefined) await advanceAndSettle();
    else {
      await recordPageProductWork(
        page,
        productWorkIntervals,
        `${productWorkLabel}:advance-settle-${drain}`,
        advanceAndSettle,
      );
    }
    const accepted = await captureAcceptanceObservation(page);
    lastAccepted = accepted;
    if (accepted.observerKey !== null
      && accepted.observerKey === accepted.canvasKey
      && accepted.postCommit?.acceptancePending === false
      && accepted.postCommit?.semanticPending === false) {
      if (accepted.observerKey === matchingIdentityKey) matchingDrains += 1;
      else {
        matchingIdentityKey = accepted.observerKey;
        matchingDrains = 1;
      }
      if (matchingDrains >= 2) return;
    } else {
      matchingIdentityKey = null;
      matchingDrains = 0;
    }
  }
  throw new Error(`Canvas frame acceptance did not quiesce at ${presentationTimeMs} ms: ${JSON.stringify(lastAccepted)}`);
}

async function assertCaptureTimeQuiescent(
  page: Page,
  presentationTimeMs: number,
): Promise<void> {
  const first = await captureAcceptanceObservation(page);
  const second = await captureAcceptanceObservation(page);
  const accepted = first.observerKey !== null
    && first.observerKey === first.canvasKey
    && first.observerKey === second.observerKey
    && second.observerKey === second.canvasKey
    && first.postCommit?.acceptancePending === false
    && first.postCommit?.semanticPending === false
    && second.postCommit?.acceptancePending === false
    && second.postCommit?.semanticPending === false
    && eventlessCaptureSchedulerIsQuiescent(first.scheduler, presentationTimeMs)
    && eventlessCaptureSchedulerIsQuiescent(second.scheduler, presentationTimeMs);
  if (!accepted) {
    throw new Error(`settled eventless frame was not quiescent at ${presentationTimeMs} ms: ${JSON.stringify({
      first,
      second,
    })}`);
  }
}

async function captureAcceptanceObservation(page: Page): Promise<any> {
  return page.evaluate(() => {
    const app = document.querySelector(".vivarium-2d-app");
    const stage = document.querySelector(".presentation-world-stage");
    const renderer = stage === null
      ? null
      : (window.__vivariumProductionDiagnosticsForTest?.snapshot(stage) as any);
    const observerIdentity = (app === null
      ? null
      : (window.__vivariumProductionDiagnosticsForTest?.snapshot(app) as any)?.frameIdentity) ?? null;
    const canvasIdentity = renderer?.frameIdentity ?? null;
    const identityKey = (identity: any): string | null => identity === null
      ? null
      : `${identity.runId}\0${identity.sourceKey}\0${identity.firstCursor}\0${identity.lastCursor}\0${identity.revision}`;
    return {
      observerIdentity,
      canvasIdentity,
      observerKey: identityKey(observerIdentity),
      canvasKey: identityKey(canvasIdentity),
      drawCount: Number(renderer?.draw?.count ?? 0),
      scheduler: renderer?.scheduler ?? null,
      postCommit: renderer?.postCommit ?? null,
      pendingClockWork: window.__vivariumProductionCaptureClockForTest?.pendingCount() ?? -1,
    };
  });
}

async function settleObserverWork(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const turn = (): Promise<void> => new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (): void => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
    await turn();
    await turn();
    await turn();
    await turn();
  });
}

async function browserObservation(page: Page): Promise<BrowserObservation> {
  return page.evaluate(() => {
    const app = document.querySelector(".vivarium-2d-app");
    const stage = document.querySelector(".presentation-world-stage");
    const canvas = stage?.querySelector("canvas");
    const control = window.__vivariumProductionCaptureClockForTest;
    const dialogueWitnessAccessor = window.__vivariumProductionDialogueNowWitnessForTest;
    const accessor = window.__vivariumProductionDiagnosticsForTest;
    if (app === null || stage === null || !(canvas instanceof HTMLCanvasElement)
      || control === undefined || dialogueWitnessAccessor === undefined || accessor === undefined) {
      throw new Error("production capture observer surfaces are unavailable");
    }
    const observer = accessor.snapshot(app) as any;
    const renderer = accessor.snapshot(stage) as any;
    if (observer === null || renderer === null) throw new Error("production capture diagnostics are unavailable");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("production Canvas2D context is unavailable");
    const scope = window as typeof window & { __vivariumCaptureOwnerSequence?: number };
    const canvasBounds = canvas.getBoundingClientRect();
    const dialogueNow = dialogueWitnessAccessor();
    const ownerId = (element: HTMLElement, prefix: string): string => {
      const existing = element.dataset.captureOwnerId;
      if (existing !== undefined) return existing;
      const next = (scope.__vivariumCaptureOwnerSequence ?? 0) + 1;
      scope.__vivariumCaptureOwnerSequence = next;
      const id = `${prefix}-${next}`;
      element.dataset.captureOwnerId = id;
      return id;
    };
    return {
      clockNowMs: control.now(),
      presentedCursor: Number(app.getAttribute("data-presented-cursor")),
      presentedSource: app.getAttribute("data-presented-source") ?? "unknown",
      activeSceneCount: Number(observer.session?.director?.activeSceneCount ?? 0),
      pendingMoments: Number(observer.session?.director?.pendingMoments ?? 0),
      ingestedCursor: Number(observer.session?.ingress?.ingestedCursor ?? 0),
      canvasLastCursor: Number(renderer.frameIdentity?.lastCursor ?? 0),
      canvasFrameIdentity: renderer.frameIdentity,
      observerFrameIdentity: observer.frameIdentity,
      observerPublicationSerial: Number(
        observer.session?.director?.framePublicationSerial ?? 0,
      ),
      scene: observer.scene ?? null,
      dialogueNow,
      settlement: observer.session?.settlement ?? null,
      publicText: document.body.innerText,
      semanticSubjects: [...document.querySelectorAll(".semantic-world-mirror [data-subject-token]")]
        .map((node) => node.textContent?.trim() ?? ""),
      stageLabel: stage.getAttribute("aria-label") ?? "",
      stageId: ownerId(stage as HTMLElement, "stage"),
      canvasId: ownerId(canvas, "canvas"),
      canvas: {
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        imageSmoothingEnabled: context.imageSmoothingEnabled,
        integerAligned: Number.isInteger(canvas.width)
          && Number.isInteger(canvas.height)
          && Number.isInteger(canvasBounds.x)
          && Number.isInteger(canvasBounds.y),
        coordinates: [canvasBounds.x, canvasBounds.y, canvas.width, canvas.height],
      },
      bodyScroll: {
        horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      },
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      observer,
      renderer,
    };
  });
}

function markerReached(
  marker: string,
  observation: BrowserObservation,
  eventMarkers: ReadonlyMap<string, EventMarkerExpectation>,
  terminalAuthority: ChroniclePresentationTerminalAuthority,
  scenarioCompleted: boolean,
  terminalCameraWitnessReady: boolean,
): boolean {
  if (marker === "checkpoint:final") {
    return scenarioCompleted
      && presentationTerminalReached(
        terminalAuthority,
        observedPresentationState(observation),
      )
      && (observation.settlement === null || observation.settlement.sceneToken === null
        || observation.settlement.sceneSettled === true)
      && !checkpointHoldIsActive(observation)
      && (observation.observer.captureFrame?.checkpointFocus ?? null) === null
      && terminalCameraWitnessReady;
  }
  const expectation = eventMarkers.get(marker);
  const identity = observation.canvasFrameIdentity as any;
  if (expectation === undefined) return false;
  const motion = captureMotionObservation(observation);
  return eventMarkerBoundaryReached(expectation, {
    phase: observation.scene?.phase ?? null,
    consequenceCommitted: observation.settlement?.consequenceCommitted === true,
    frameIdentity: identity === null || identity === undefined ? null : {
      firstCursor: Number(identity.firstCursor),
      lastCursor: Number(identity.lastCursor),
    },
    cameraMode: motion.camera.mode,
    focusSelectionKey: motion.focusSelectionKey,
    actors: motion.actors as readonly Readonly<{ id: string; safeFrameVisible: boolean }>[],
  });
}

function captureTerminalCameraWitnessSample(
  observation: BrowserObservation,
  frameIndex: number,
  presentationTimeMs: number,
  terminalAuthority: ChroniclePresentationTerminalAuthority,
  scenarioCompleted: boolean,
): TerminalCameraWitnessSample | null {
  if (!scenarioCompleted
    || !presentationTerminalReached(terminalAuthority, observedPresentationState(observation))
    || checkpointHoldIsActive(observation)
    || (observation.observer.captureFrame?.checkpointFocus ?? null) !== null
    || (observation.settlement !== null && observation.settlement.sceneToken !== null
      && observation.settlement.sceneSettled !== true)) return null;
  if (observation.canvasFrameIdentity === null
    || observation.observerFrameIdentity === null
    || canonicalJson(observation.canvasFrameIdentity)
      !== canonicalJson(observation.observerFrameIdentity)) return null;
  const acceptedFrame = observation.observer.captureFrame as PresentedObserverFrame | null;
  if (acceptedFrame === null) return null;

  const renderer = observation.renderer;
  const camera = renderer?.camera;
  const activeRegionId = renderer?.graph?.activeRegion?.id;
  if (typeof activeRegionId !== "string" || activeRegionId.length === 0
    || renderer.visibleRegionId !== activeRegionId
    || renderer.loadingRegionId !== null
    || camera === null || camera === undefined
    || camera.pendingStoryEntityId !== null
    || camera.pendingStoryTarget !== null
    || !Number.isFinite(camera.zoom) || camera.zoom <= 0
    || !Number.isFinite(camera.center?.x)
    || !Number.isFinite(camera.center?.y)) return null;

  const motion = captureMotionObservation(observation);
  if (Number(renderer.graph.activeEffects) !== 0
    || motion.actors.some((actor) => (
      actor.activeAction !== null || actor.reposition !== null
    ))) return null;
  const actors = motion.actors.map((actor) => Object.freeze({
    id: actor.id,
    instanceId: actor.instanceId,
    position: Object.freeze({ ...actor.position }),
    facing: actor.facing,
    activeAction: null,
    reposition: null,
  }));
  return Object.freeze({
    frameIndex,
    presentationTimeMs,
    frameIdentity: Object.freeze({ ...observation.observerFrameIdentity }),
    presentation: Object.freeze({
      ingestedCursor: observation.ingestedCursor,
      presentedCursor: observation.presentedCursor,
      canvasLastCursor: observation.canvasLastCursor,
      activeSceneCount: observation.activeSceneCount,
      pendingMoments: observation.pendingMoments,
    }),
    world: Object.freeze({
      exactBaseCursor: acceptedFrame.world.exactBaseCursor,
      projectedThroughCursor: acceptedFrame.world.projectedThroughCursor,
    }),
    region: Object.freeze({
      activeRegionId,
      visibleRegionId: activeRegionId,
      loadingRegionId: null,
    }),
    camera: Object.freeze({
      mode: String(camera.mode),
      center: Object.freeze({ x: Number(camera.center.x), y: Number(camera.center.y) }),
      zoom: Number(camera.zoom),
      rasterOrigin: Object.freeze({ ...motion.camera.rasterOrigin }),
      safeFrame: Object.freeze({ ...motion.camera.safeFrame }),
      viewport: Object.freeze({ ...motion.camera.viewport }),
      focusSelectionKey: motion.focusSelectionKey,
      pendingStoryEntityId: null,
      pendingStoryTarget: null,
    }),
    activeEffects: 0,
    actors: Object.freeze(actors),
  });
}

function captureRetainedFrameLineage(observation: BrowserObservation): Readonly<{
  exactBaseCursor: number;
  projectedThroughCursor: number;
  region: Readonly<{
    activeRegionId: string | null;
    visibleRegionId: string | null;
    loadingRegionId: string | null;
  }>;
}> {
  const frame = observation.observer.captureFrame as PresentedObserverFrame | null;
  if (frame === null || observation.canvasFrameIdentity === null
    || observation.observerFrameIdentity === null) {
    throw new Error("retained recording frame lacks accepted presentation lineage");
  }
  return Object.freeze({
    exactBaseCursor: frame.world.exactBaseCursor,
    projectedThroughCursor: frame.world.projectedThroughCursor,
    region: Object.freeze({
      activeRegionId: observation.renderer.graph.activeRegion?.id ?? null,
      visibleRegionId: observation.renderer.visibleRegionId ?? null,
      loadingRegionId: observation.renderer.loadingRegionId ?? null,
    }),
  });
}

function retainConsecutiveTerminalCameraSamples(
  retained: readonly TerminalCameraWitnessSample[],
  sample: TerminalCameraWitnessSample | null,
): readonly TerminalCameraWitnessSample[] {
  if (sample === null) return Object.freeze([]);
  const previous = retained.at(-1);
  if (previous === undefined) return Object.freeze([sample]);
  const stableState = (value: TerminalCameraWitnessSample): string => canonicalJson({
    frameIdentity: value.frameIdentity,
    presentation: value.presentation,
    region: value.region,
    camera: value.camera,
    activeEffects: value.activeEffects,
    actors: value.actors,
  });
  if (sample.frameIndex !== previous.frameIndex + 1
    || sample.presentationTimeMs <= previous.presentationTimeMs
    || stableState(sample) !== stableState(previous)) {
    return Object.freeze([sample]);
  }
  return Object.freeze(
    [...retained, sample].slice(-TERMINAL_CAMERA_STABLE_SAMPLE_COUNT),
  );
}

function finalizeTerminalCameraWitness(
  samples: readonly TerminalCameraWitnessSample[],
  markerFrameIndex: number,
): TerminalCameraWitness {
  if (samples.length < TERMINAL_CAMERA_STABLE_SAMPLE_COUNT
    || samples.at(-1)?.frameIndex !== markerFrameIndex) {
    throw new Error("checkpoint:final lacks three consecutive stable terminal camera observations");
  }
  return Object.freeze({
    requiredConsecutiveSamples: TERMINAL_CAMERA_STABLE_SAMPLE_COUNT,
    markerFrameIndex,
    samples: Object.freeze(samples.map((sample) => Object.freeze(structuredClone(sample)))),
  });
}

function scenarioCompletedAt(chronicleId: string, frameIndex: number): boolean {
  if (chronicleId === "C14") return frameIndex >= 30;
  if (chronicleId === "C15") return frameIndex >= 49;
  return true;
}

function captureCommitObservation(observation: BrowserObservation) {
  const { reactCommitCount: _reactCommitCount, ...observer } = observation.observer;
  return {
    reactCommitCount: Number(observation.observer.reactCommitCount),
    acceptedPublicState: canonicalJson({
      presentedCursor: observation.presentedCursor,
      presentedSource: observation.presentedSource,
      activeSceneCount: observation.activeSceneCount,
      pendingMoments: observation.pendingMoments,
      ingestedCursor: observation.ingestedCursor,
      canvasLastCursor: observation.canvasLastCursor,
      canvasFrameIdentity: observation.canvasFrameIdentity,
      observerFrameIdentity: observation.observerFrameIdentity,
      scene: observation.scene,
      dialogueNow: observation.dialogueNow,
      settlement: observation.settlement,
      publicText: observation.publicText,
      semanticSubjects: observation.semanticSubjects,
      stageLabel: observation.stageLabel,
      observer,
    }),
  };
}

async function runQuietCanvasCommitProbe(
  page: Page,
  productWorkIntervals: CaptureProductWorkInterval[],
): Promise<Readonly<{
  observation: BrowserObservation;
  frameDrivenCommitCount: number;
  evidence: Readonly<{
    durationMs: number;
    tickCount: number;
    beforeStateSha256: string;
    afterStateSha256: string;
    beforeCommitCount: number;
    afterCommitCount: number;
  }>;
}>> {
  await recordPageProductWork(
    page,
    productWorkIntervals,
    "quiet-canvas:initial-settle",
    () => settleObserverWork(page),
  );
  const before = await browserObservation(page);
  const beforeCommit = captureCommitObservation(before);
  for (let tick = 1; tick <= QUIET_CANVAS_PROBE_TICKS; tick += 1) {
    await recordPageProductWork(
      page,
      productWorkIntervals,
      `quiet-canvas:advance-settle-${tick}`,
      async () => {
        await advanceCaptureRendererClock(
          page,
          before.clockNowMs + tick * QUIET_CANVAS_PROBE_DURATION_MS / QUIET_CANVAS_PROBE_TICKS,
        );
        await settleObserverWork(page);
      },
    );
  }
  const after = await browserObservation(page);
  const afterCommit = captureCommitObservation(after);
  expect(after.clockNowMs, "quiet Canvas probe must not advance session/model time")
    .toBe(before.clockNowMs);
  expect(afterCommit.acceptedPublicState, "quiet Canvas probe must preserve accepted/public bytes")
    .toBe(beforeCommit.acceptedPublicState);
  expect(
    Number(after.renderer.draw.totalCount),
    "quiet Canvas probe must exercise renderer frame/wake callbacks",
  ).toBeGreaterThan(Number(before.renderer.draw.totalCount));
  return Object.freeze({
    observation: after,
    frameDrivenCommitCount: assertNoFrameDrivenReactCommits(beforeCommit, afterCommit),
    evidence: Object.freeze({
      durationMs: QUIET_CANVAS_PROBE_DURATION_MS,
      tickCount: QUIET_CANVAS_PROBE_TICKS,
      beforeStateSha256: sha256(Buffer.from(beforeCommit.acceptedPublicState)),
      afterStateSha256: sha256(Buffer.from(afterCommit.acceptedPublicState)),
      beforeCommitCount: beforeCommit.reactCommitCount,
      afterCommitCount: afterCommit.reactCommitCount,
    }),
  });
}

async function settleTerminalObserverProductWork(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const region = document.querySelector<HTMLElement>(
      ".observer-live-announcer[role='status']",
    );
    return region?.getAttribute("aria-busy") === "false"
      && region.textContent?.trim() === "Caught up.";
  }, undefined, { timeout: LIVE_ANNOUNCER_IDLE_TIMEOUT_MS });
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (): void => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  }));
}

async function captureFrameBudget(page: Page, manifest: ChronicleManifest): Promise<number> {
  const baseFrameCount = manifest.id === "C01" || manifest.id === "C02"
    ? (await productionTravelFrameBudget(page, manifest, FPS)).frameCount
    : (await productionCaptureFrameCeiling(page, manifest, FPS)).frameCount;
  return manifest.expectedMarkers.includes("checkpoint:final")
    ? captureFrameCountWithTerminalWitness(
      baseFrameCount,
      TERMINAL_CAMERA_STABLE_SAMPLE_COUNT,
    )
    : baseFrameCount;
}

function genericCaptureFrameBudget(manifest: ChronicleManifest): number {
  const maximumChoreographyDurationMs = manifest.entries.length <= 48
    ? manifest.entries.length * 120_000 + 5_000
    : 0;
  const pressureDurationMs = manifest.id === "C13" ? 20_000
    : manifest.id === "C16" ? 40_000
      : 0;
  const boundedMomentDurationMs = Math.min(48, Math.max(1, manifest.entries.length)) * 6_400
    + 5_000;
  const durationMs = manifest.entries.length === 0
    ? 4_000
    : Math.max(pressureDurationMs, boundedMomentDurationMs, maximumChoreographyDurationMs);
  return Math.ceil(durationMs * FPS / 1_000) + 1;
}

function manifestTimeout(manifest: ChronicleManifest): number {
  if (manifest.id === "C02") return 6 * 60 * 60 * 1_000;
  const frameWorkMs = genericCaptureFrameBudget(manifest) * 250;
  const archiveAndEncodeMs = manifest.id === "C16" ? 600_000 : 300_000;
  return frameWorkMs + archiveAndEncodeMs;
}

function minimumCaptureFrames(chronicleId: string): number {
  if (chronicleId === "C14") return 42;
  if (chronicleId === "C15") return 49;
  return 31;
}

function motionModeEvidence(
  observation: BrowserObservation,
  frames: readonly CaptureFrame[],
  markerFrames: ReadonlyMap<string, number>,
  manifest: ChronicleManifest,
): MotionModeEvidence {
  const endpoints = [
    ...observation.renderer.graph.actors.map((actor: any) => (
      `agent:${actor.id}:${actor.position.x},${actor.position.y}:${actor.facing}:${actor.status}`
    )),
    ...observation.renderer.graph.homes.map((home: any) => (
      `${home.kind}:${home.id}:${home.plot.x},${home.plot.y}:${home.status}`
    )),
  ].sort();
  const orderedMarkers = orderCapturedMarkerIds(manifest.expectedMarkers, markerFrames);
  return Object.freeze({
    endpoints: Object.freeze(endpoints),
    consequences: Object.freeze([...markerFrames.keys()].sort()),
    markerOrder: Object.freeze(orderedMarkers),
    labels: Object.freeze(orderedMarkers.map(markerLabel)),
    readingHoldsMs: Object.freeze(orderedMarkers.map((marker) => (
      readingHoldDuration(frames, markerFrames.get(marker)!, FPS)
    ))),
  });
}

function c03ResourceTransferWitnessEvidence(
  manifest: ChronicleManifest,
  frames: readonly CaptureFrame[],
  markerFrames: ReadonlyMap<string, number>,
  markerObservations: ReadonlyMap<string, BrowserObservation>,
): C03ResourceTransferWitnessEvidence | null {
  if (manifest.id !== "C03") return null;
  const marker = "event:resource_transferred";
  const frameIndex = markerFrames.get(marker);
  const observation = markerObservations.get(marker);
  const transfer = manifest.entries.find(({ event }) => event.type === "resource_transferred");
  if (frameIndex === undefined || observation === undefined || transfer === undefined) {
    throw new Error("C03 resource-transfer witness is missing its exact marker authority");
  }
  const senderId = transfer.event.payload.sender_id;
  const receiverId = transfer.event.payload.receiver_id;
  const resourceType = transfer.event.payload.resource_type;
  const amount = transfer.event.payload.amount;
  if (typeof senderId !== "string" || typeof receiverId !== "string"
    || typeof resourceType !== "string" || typeof amount !== "number") {
    throw new Error("C03 resource-transfer witness payload authority is invalid");
  }
  const motion = captureMotionObservation(observation);
  return assertC03ResourceTransferWitness({
    senderId,
    receiverId,
    resourceType,
    amount,
    phase: observation.scene?.phase ?? null,
    focusSelectionKey: motion.focusSelectionKey,
    dialogue: observation.scene?.dialogue ?? null,
    dialogueNow: observation.dialogueNow,
    viewport: observation.viewport,
    actors: motion.actors as readonly Readonly<{ id: string; safeFrameVisible: boolean }>[],
    maximumActiveEffects: exactMaximumC03ActiveEffects(frames),
    transferFrames: frames.flatMap(({ transferFrame }) => (
      transferFrame === null ? [] : [transferFrame]
    )),
    readingHoldMs: readingHoldDuration(frames, frameIndex, FPS),
  });
}

function exactMaximumC03ActiveEffects(frames: readonly CaptureFrame[]): number {
  let maximum = 0;
  for (const [frameIndex, { activeEffects }] of frames.entries()) {
    if (typeof activeEffects !== "number"
      || !Number.isSafeInteger(activeEffects)
      || activeEffects < 0) {
      throw new Error(`C03 retained frame ${frameIndex} activeEffects must be a non-negative safe integer`);
    }
    maximum = Math.max(maximum, activeEffects);
  }
  return maximum;
}

async function runIndependentReducedMotionProbe(
  browser: import("@playwright/test").Browser,
  viewportSize: Readonly<{ width: number; height: number }>,
  fixturePath: string,
  manifest: ChronicleManifest,
  outputDirectory: string,
  viewport: string,
): Promise<Readonly<{
  evidence: MotionModeEvidence;
  observedMarkers: readonly unknown[];
  capture: unknown | null;
  schedulerSamples: readonly unknown[];
  resourceTransferWitness: C03ResourceTransferWitnessEvidence | null;
  checkpointWitnesses: CheckpointModeWitnesses;
  terminalCameraWitness: TerminalCameraWitness;
  motionSamples: readonly MotionSample[];
}>> {
  const page = await browser.newPage({ viewport: viewportSize, reducedMotion: "reduce" });
  const reducedFramesDirectory = path.join(outputDirectory, ".reduced-frames");
  await mkdirAsync(reducedFramesDirectory, { recursive: true });
  let fixture: ProductionChronicleFixture | null = null;
  try {
    await page.addInitScript(() => {
      window.__vivariumEnableProductionCaptureClockForTest = true;
    });
    await installTypedProductionCaptureEntry(page);
    fixture = await installProductionChronicleFixture(page, manifest, fixturePath);
    const captureScenario = await prepareScenario(page, fixture, manifest.id);
    const targetCursor = captureScenario.terminal.cursor;
    await settleObserverWork(page);
    const markerFrames = new Map<string, number>();
    const markerObservations = new Map<string, BrowserObservation>();
    const checkpointWitnesses = new Map<number, MutableCheckpointHoldWitness>();
    const eventMarkers = buildEventMarkerExpectations(manifest.entries, manifest.expectedMarkers);
    const frames: CaptureFrame[] = [];
    const motionSamples: MotionSample[] = [];
    let finalObservation: BrowserObservation | null = null;
    let terminalCameraSamples: readonly TerminalCameraWitnessSample[] = [];
    let terminalCameraWitness: TerminalCameraWitness | null = null;
    let activeScheduler: unknown | null = null;
    let settledWithinBudget = false;
    const maximumFrames = await captureFrameBudget(page, manifest);
    for (let frameIndex = 0; frameIndex < maximumFrames; frameIndex += 1) {
      const exactTimeMs = frameIndex * 1000 / FPS;
      if (captureScenario.eventlessOperationDriver === null) {
        await captureScenario.step(frameIndex);
        await flushCaptureTime(page, exactTimeMs);
      } else {
        await runSameTimeSettledEventlessCaptureFrame(
          captureScenario.eventlessOperationDriver,
          frameIndex,
          exactTimeMs,
          async (productWork) => productWork(),
          async (sameTimeMs) => {
            await captureScenario.step(frameIndex);
            await advanceCaptureClock(page, sameTimeMs);
            await settleObserverWork(page);
          },
          async (sameTimeMs) => {
            await advanceCaptureClock(page, sameTimeMs);
            await settleObserverWork(page);
          },
          () => assertCaptureTimeQuiescent(page, exactTimeMs),
        );
      }
      const observation = await browserObservation(page);
      const workload = captureScenario.operationalTrace().at(-1) ?? null;
      if (activeScheduler === null
        && (observation.activeSceneCount === 1
          || (workload !== null && workload.completed === false))) {
        activeScheduler = captureSchedulerSample(
          observation,
          "reduced-active",
          workload === null ? "active" : "operational",
          "reduced",
          workload?.workload ?? "mechanic-story",
        );
      }
      finalObservation = observation;
      expect(observation.canvasFrameIdentity).toEqual(observation.observerFrameIdentity);
      const motion = captureMotionObservation(observation);
      captureCheckpointHoldWitness(checkpointWitnesses, observation, frameIndex);
      frames.push(Object.freeze({
        frameIndex,
        file: `.reduced-frames/${String(frameIndex).padStart(6, "0")}.png`,
        bytes: 0,
        sha256: "0".repeat(64),
        mediaTimeMs: exactTimeMs,
        presentationTimeMs: exactTimeMs,
        presentedCursor: observation.presentedCursor,
        presentedSource: observation.presentedSource,
        activeSceneCount: observation.activeSceneCount,
        pendingMoments: observation.pendingMoments,
        scenePhase: observation.scene?.phase ?? null,
        readingWitness: observation.dialogueNow,
        activeEffects: observation.renderer.graph.activeEffects,
        focusSelectionKey: motion.focusSelectionKey,
        transferFrame: c03TransferFrame(
          manifest.id,
          frameIndex,
          observation,
          motion,
        ),
        ...captureRetainedFrameLineage(observation),
        canvasFrameIdentity: observation.canvasFrameIdentity,
        observerFrameIdentity: observation.observerFrameIdentity,
      }));
      const placements = placementHashes(observation);
      motionSamples.push(Object.freeze({
        frameIndex,
        presentationTimeMs: exactTimeMs,
        cursor: observation.presentedCursor,
        epochReady: true,
        placementHash: sha256(Buffer.from(canonicalJson(placements))),
        placements,
        actors: motion.actors,
        focusSelectionKey: motion.focusSelectionKey,
        camera: motion.camera,
        regionTransitions: motion.regionTransitions,
        homes: observation.renderer.graph.homes,
        recentMarkers: observation.renderer.graph.recentMarkers,
        pathFallbacks: Number(observation.renderer.graph.pathFallbacks),
        activeEffects: observation.renderer.graph.activeEffects,
        activeRegion: observation.renderer.graph.activeRegion,
        environments: observation.renderer.graph.environments,
        rendererPool: observation.renderer.pool,
      }));
      const frameFile = path.join(
        outputDirectory,
        `.reduced-frames/${String(frameIndex).padStart(6, "0")}.png`,
      );
      await page.screenshot({ path: frameFile, fullPage: false });
      const bytes = await readFileAsync(frameFile);
      frames[frames.length - 1] = Object.freeze({
        ...frames[frames.length - 1]!, bytes: bytes.length, sha256: sha256(bytes),
      });
      terminalCameraSamples = retainConsecutiveTerminalCameraSamples(
        terminalCameraSamples,
        captureTerminalCameraWitnessSample(
          observation,
          frameIndex,
          exactTimeMs,
          captureScenario.terminal,
          captureScenario.completed(frameIndex),
        ),
      );
      for (const marker of manifest.expectedMarkers) {
        if (!markerFrames.has(marker)
          && markerReached(
            marker,
            observation,
            eventMarkers,
            captureScenario.terminal,
            captureScenario.completed(frameIndex),
            terminalCameraSamples.length >= TERMINAL_CAMERA_STABLE_SAMPLE_COUNT,
          )) {
          markerFrames.set(marker, frameIndex);
          markerObservations.set(marker, observation);
          if (marker === "checkpoint:final") {
            terminalCameraWitness = finalizeTerminalCameraWitness(
              terminalCameraSamples,
              frameIndex,
            );
          }
        }
      }
      if (captureReadyToSettle({
        minimumFrameCountReached: frames.length >= minimumCaptureFrames(manifest.id),
        terminalReached: presentationTerminalReached(
          captureScenario.terminal,
          observedPresentationState(observation),
        ),
        expectedMarkersReached: manifest.expectedMarkers.every((marker) => (
          markerFrames.has(marker)
        )),
        checkpointHoldActive: checkpointHoldIsActive(observation),
        actors: observation.renderer.graph.actors,
      })) {
        settledWithinBudget = true;
        break;
      }
    }
    if (finalObservation === null) throw new Error("reduced-motion route produced no observation");
    if (!settledWithinBudget) {
      throw new Error(`reduced-motion capture did not settle within ${maximumFrames} frames`);
    }
    expect([...markerFrames.keys()].sort()).toEqual([...manifest.expectedMarkers].sort());
    if (terminalCameraWitness === null) {
      throw new Error("reduced-motion capture lacks terminal camera stability evidence");
    }
    const reducedCheckpointWitnesses = finalizeCheckpointHoldWitnesses(checkpointWitnesses);
    assertTrustedCheckpointPresentation(manifest, reducedCheckpointWitnesses, markerFrames);
    const observedMarkers = await writeMarkerEvidence(
      outputDirectory, viewport, manifest, frames, markerFrames, "reduced",
    );
    const timelineSha256 = sha256(Buffer.from(canonicalJson(frames)));
    if (activeScheduler === null) throw new Error("reduced-motion route did not expose an active scheduler owner");
    await drainTerminalObserverUi(page, captureScenario.terminal);
    const terminalScheduler = await runTerminalStaticZeroProbe(page, captureScenario.terminal);
    const terminal = await fixture.dispose();
    expect(terminal).toMatchObject({
      activeStreams: 0, balancedSseLifecycle: true, unmatchedRouteCount: 0,
    });
    return Object.freeze({
      evidence: motionModeEvidence(finalObservation, frames, markerFrames, manifest),
      observedMarkers,
      resourceTransferWitness: c03ResourceTransferWitnessEvidence(
        manifest,
        frames,
        markerFrames,
        markerObservations,
      ),
      checkpointWitnesses: Object.freeze({
        witnesses: reducedCheckpointWitnesses,
        markerFrames: Object.freeze(Object.fromEntries(markerFrames)),
      }),
      terminalCameraWitness,
      motionSamples: Object.freeze(motionSamples),
      schedulerSamples: Object.freeze([activeScheduler, terminalScheduler]),
      capture: {
        schemaVersion: 1,
        chronicleId: manifest.id,
        viewport,
        captureId: `${manifest.id}:${viewport}:reduced`,
        route: "/?renderer=2d",
        clock: "ManualPresentationClock",
        captureMethod: "playwright-page-screenshot",
        playwrightRecordVideo: false,
        fps: FPS,
        frameCount: frames.length,
        timelineSha256,
        checkpointWitnesses: Object.freeze({
          witnesses: reducedCheckpointWitnesses,
          markerFrames: Object.freeze(Object.fromEntries(markerFrames)),
        }),
        terminalCameraWitness,
        frames,
        lifecycle: terminal,
      },
    });
  } finally {
    if (fixture !== null) await fixture.dispose();
    await page.close();
  }
}

async function runIndependentCadenceProbe(
  browser: import("@playwright/test").Browser,
  viewportSize: Readonly<{ width: number; height: number }>,
  fixturePath: string,
  manifest: ChronicleManifest,
  reducedMotion: boolean,
  ticksPerSecond: 60 | 30,
): Promise<Readonly<{
  active: Readonly<{ mode: "visible" | "reduced"; frameCount: number; durationMs: number }>;
  hidden: Readonly<{ mode: "hidden"; frameCount: number; durationMs: number }>;
}>> {
  const page = await browser.newPage({
    viewport: viewportSize,
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  let fixture: ProductionChronicleFixture | null = null;
  try {
    await page.addInitScript(() => {
      window.__vivariumEnableProductionCaptureClockForTest = true;
    });
    await installTypedProductionCaptureEntry(page);
    fixture = await installProductionChronicleFixture(page, manifest, fixturePath);
    await prepareScenario(page, fixture, manifest.id);
    await settleObserverWork(page);
    const activeStart = await browserObservation(page);
    for (let tick = 1; tick <= ticksPerSecond; tick += 1) {
      await advanceCaptureClock(page, activeStart.clockNowMs + tick * 1_000 / ticksPerSecond);
      await settleObserverWork(page);
    }
    const activeEnd = await browserObservation(page);
    const activeCount = Number(activeEnd.renderer.draw.totalCount)
      - Number(activeStart.renderer.draw.totalCount);
    if (activeCount < 0 || activeCount > ticksPerSecond) {
      throw new Error(`cadence probe observed ${activeCount} draws across ${ticksPerSecond} owned ticks`);
    }

    await setCapturePageHidden(page, true);
    const hiddenStart = await browserObservation(page);
    for (let tick = 1; tick <= ticksPerSecond; tick += 1) {
      await advanceCaptureClock(page, hiddenStart.clockNowMs + tick * 1_000 / ticksPerSecond);
      await settleObserverWork(page);
    }
    const hiddenEnd = await browserObservation(page);
    const hiddenCount = Number(hiddenEnd.renderer.draw.totalCount)
      - Number(hiddenStart.renderer.draw.totalCount);
    if (hiddenCount !== 0) throw new Error("hidden cadence probe drew a frame");
    return Object.freeze({
      active: Object.freeze({
        mode: reducedMotion ? "reduced" as const : "visible" as const,
        frameCount: activeCount,
        durationMs: activeEnd.clockNowMs - activeStart.clockNowMs,
      }),
      hidden: Object.freeze({
        mode: "hidden" as const,
        frameCount: hiddenCount,
        durationMs: hiddenEnd.clockNowMs - hiddenStart.clockNowMs,
      }),
    });
  } finally {
    await page.evaluate(() => window.__vivariumProductionCaptureUnmountForTest?.()).catch(() => undefined);
    if (fixture !== null) await fixture.dispose();
    await page.close();
  }
}

function observeRuntimeNetwork(page: Page): Readonly<{
  snapshot(): Promise<readonly RuntimeNetworkObservation[]>;
}> {
  let sequence = 0;
  const byRequest = new WeakMap<Request, RuntimeNetworkObservation>();
  const terminalResolvers = new WeakMap<Request, () => void>();
  const terminalPromises: Promise<void>[] = [];
  const observations: RuntimeNetworkObservation[] = [];
  let observerError: Error | null = null;
  page.on("request", (request) => {
    const observation = createRuntimeNetworkObservation({
      sequence: ++sequence,
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      navigation: request.isNavigationRequest() && request.frame() === page.mainFrame(),
    });
    byRequest.set(request, observation);
    observations.push(observation);
    terminalPromises.push(new Promise((resolve) => terminalResolvers.set(request, resolve)));
  });
  page.on("response", (response) => {
    const observation = byRequest.get(response.request());
    if (observation === undefined) return;
    try {
      recordRuntimeNetworkResponse(observation, response.status());
    } catch (error) {
      observerError = error instanceof Error ? error : new Error(String(error));
    }
  });
  page.on("requestfinished", (request) => {
    recordTerminal(request, "finished", null);
  });
  page.on("requestfailed", (request) => {
    recordTerminal(
      request,
      "failed",
      request.failure()?.errorText ?? "unknown Playwright request failure",
    );
  });
  return Object.freeze({
    async snapshot(): Promise<readonly RuntimeNetworkObservation[]> {
      await waitForTerminalDrain(terminalPromises);
      if (observerError !== null) throw observerError;
      if (observations.some(({ terminal }) => terminal === null)) {
        throw new Error("runtime network observation contains an unterminated request");
      }
      return Object.freeze(observations.map((observation) => Object.freeze({ ...observation })));
    },
  });

  function recordTerminal(
    request: Request,
    terminal: "finished" | "failed",
    failureText: string | null,
  ): void {
    const observation = byRequest.get(request);
    if (observation === undefined) return;
    try {
      recordRuntimeNetworkTerminal(observation, terminal, failureText);
    } catch (error) {
      observerError = error instanceof Error ? error : new Error(String(error));
    } finally {
      terminalResolvers.get(request)?.();
    }
  }
}

async function waitForTerminalDrain(
  terminalPromises: readonly Promise<void>[],
  timeoutMs = 5_000,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      Promise.all([...terminalPromises]),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(
          `runtime network terminal drain exceeded ${timeoutMs} ms`,
        )), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

function appendCursorSample(
  samples: CursorSample[],
  frameIndex: number,
  observation: BrowserObservation,
  authoritativeCursor: number,
  epochReady: boolean,
  terminalAuthority: ChroniclePresentationTerminalAuthority,
  operationalTrace: readonly import("./fixtures/production-chronicle-fixture").ProductionCaptureAuthorityTraceEntry[],
  scenarioCompleted: boolean,
): void {
  const identity = observation.observerFrameIdentity;
  if (identity === null) throw new Error("cursor evidence requires observer frame identity");
  const observed = observedCursorAuthority(observedPresentationState(observation));
  const workload = operationalTrace.at(-1) ?? null;
  if (workload !== null && (
    identity.runId !== workload.selected.runId
    || identity.sourceKey !== workload.selected.sourceKey
    || observed.presentedCursor !== workload.selected.cursor
    || observed.acceptedCursor !== workload.selected.cursor
    || observed.publicCursor !== workload.selected.cursor
    || authoritativeCursor !== workload.live.cursor
  )) {
    // The visual frame and async scenario authority crossed a boundary.  The
    // PNG remains in the recording, but it cannot certify either phase.
    return;
  }
  const terminal = presentationTerminalReached(
    terminalAuthority,
    observedPresentationState(observation),
  ) && scenarioCompleted && (workload?.completed ?? true);
  const recovering = observation.observer.session?.recovery?.status;
  samples.push(Object.freeze({
    frameIndex,
    authoritativeCursor,
    acceptedCursor: observed.acceptedCursor,
    presentedCursor: observed.presentedCursor,
    publicCursor: observed.publicCursor,
    runId: identity.runId,
    sourceKey: identity.sourceKey,
    epochReady,
    phase: terminal ? "settled"
      : observation.observer.session?.paused === true ? "paused"
        : recovering !== undefined && !["idle", "complete"].includes(recovering)
          ? "recovering"
          : "running",
  }));
}

function authoritativeCursorAt(
  chronicleId: string,
  frameIndex: number,
  finalCursor: number,
): number {
  if (chronicleId === "C13") return frameIndex < 12 ? 1 : finalCursor;
  return finalCursor;
}

async function writeMarkerEvidence(
  directory: string,
  viewport: string,
  manifest: ChronicleManifest,
  frames: readonly CaptureFrame[],
  markerFrames: ReadonlyMap<string, number>,
  stillPrefix = "",
): Promise<readonly unknown[]> {
  const observed = [];
  const orderedMarkers = orderCapturedMarkerIds(manifest.expectedMarkers, markerFrames);
  for (const [ordinal, marker] of orderedMarkers.entries()) {
    const frameIndex = markerFrames.get(marker);
    if (frameIndex === undefined) throw new Error(`capture missed named marker ${marker}`);
    const frame = frames[frameIndex]!;
    const markerSlug = marker.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    const prefix = stillPrefix === "" ? "" : `${stillPrefix}-`;
    const relativeStill = `markers/${prefix}${String(frameIndex).padStart(6, "0")}-${markerSlug}.png`;
    await copyFileAsync(path.join(directory, frame.file), path.join(directory, relativeStill));
    observed.push(Object.freeze({
      id: `${manifest.id}:${ordinal}:${markerSlug}`,
      label: markerLabel(marker),
      expectedMarker: marker,
      frameIndex,
      mediaTimeMs: frame.mediaTimeMs,
      presentationTimeMs: frame.presentationTimeMs,
      still: {
        file: relativeStill,
        bytes: frame.bytes,
        sha256: frame.sha256,
      },
      viewport,
    }));
  }
  return Object.freeze(observed);
}

function markerLabel(marker: string): string {
  return marker
    .replace(/@cursor:\d+$/, "")
    .replace(/^event:/, "")
    .replace(/^checkpoint:/, "Checkpoint ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function startLongTaskObserver(page: Page): Promise<void> {
  await page.evaluate(startBrowserLongTaskObservation);
}

async function stopLongTaskObserver(page: Page): Promise<CaptureLongTaskObservation> {
  return page.evaluate(stopBrowserLongTaskObservation);
}

interface CapturePerformanceEvidence {
  readonly schedulerSamples: readonly unknown[];
  readonly archiveObservations: readonly unknown[];
  readonly heap: unknown;
  readonly observerStartedAt: number;
  readonly longTaskSamples: CaptureLongTaskEvidence["longTaskSamples"];
  readonly productWorkIntervals: CaptureLongTaskEvidence["productWorkIntervals"];
  readonly longTasksMs: readonly number[];
  readonly captureInstrumentationLongTasks: CaptureLongTaskEvidence["captureInstrumentationLongTasks"];
  readonly hiddenCadenceWindow: Readonly<{ mode: "hidden"; frameCount: number; durationMs: number }>;
}

function captureSchedulerSample(
  observation: BrowserObservation,
  mode: "visible" | "reduced-active" | "terminal-static" | "hidden",
  phase: "ambient" | "active" | "operational" | "terminal-static" | "hidden",
  routeId: "standard" | "reduced",
  workload: string = phase,
): Readonly<Record<string, unknown>> {
  const scheduler = observation.renderer.scheduler;
  const rafScheduled = Boolean(scheduler.rafScheduled);
  const wakeScheduled = Boolean(scheduler.wakeScheduled);
  const nextDeadlineMs = scheduler.nextDeadlineMs === null
    ? null
    : Number(scheduler.nextDeadlineMs);
  return Object.freeze({
    mode,
    phase,
    routeId,
    workload,
    ownerId: observation.canvasId,
    dirty: Boolean(scheduler.dirty),
    rafScheduled,
    wakeScheduled,
    nextDeadlineMs,
    observedAtMs: Number(observation.clockNowMs),
    drawTotal: Number(observation.renderer.draw.totalCount),
    reason: wakeScheduled
      ? scheduler.reason
      : rafScheduled ? (scheduler.dirty ? "dirty-frame" : "animated-frame") : null,
  });
}

async function runTerminalStaticZeroProbe(
  page: Page,
  terminalAuthority: ChroniclePresentationTerminalAuthority,
): Promise<Readonly<Record<string, unknown>>> {
  await settleObserverWork(page);
  const before = await browserObservation(page);
  const beforeCommit = captureCommitObservation(before);
  expect(before).toMatchObject({
    presentedCursor: terminalAuthority.cursor,
    observerFrameIdentity: {
      runId: terminalAuthority.runId,
      sourceKey: terminalAuthority.sourceKey,
      lastCursor: terminalAuthority.cursor,
    },
    activeSceneCount: 0,
    pendingMoments: 0,
    renderer: {
      postCommit: { acceptancePending: false, semanticPending: false },
      scheduler: {
        dirty: false,
        rafScheduled: false,
        wakeScheduled: false,
        nextDeadlineMs: null,
      },
      graph: { activeEffects: 0 },
    },
  });
  await advanceCaptureRendererClock(page, before.clockNowMs + 1_000);
  await settleObserverWork(page);
  const after = await browserObservation(page);
  const afterCommit = captureCommitObservation(after);
  expect(Number(after.renderer.draw.totalCount)).toBe(Number(before.renderer.draw.totalCount));
  expect(afterCommit.reactCommitCount).toBe(beforeCommit.reactCommitCount);
  expect(after.presentedCursor).toBe(before.presentedCursor);
  expect(after.canvasFrameIdentity).toEqual(before.canvasFrameIdentity);
  expect(afterCommit.acceptedPublicState).toBe(beforeCommit.acceptedPublicState);
  expect(after.renderer.scheduler).toMatchObject({
    dirty: false,
    rafScheduled: false,
    wakeScheduled: false,
    nextDeadlineMs: null,
  });
  return Object.freeze({
    ...captureSchedulerSample(
      after,
      "terminal-static",
      "terminal-static",
      "reduced",
      "terminal",
    ),
    quiet: Object.freeze({
      durationMs: 1_000,
      drawDelta: Number(after.renderer.draw.totalCount) - Number(before.renderer.draw.totalCount),
      reactCommitDelta: afterCommit.reactCommitCount - beforeCommit.reactCommitCount,
      cursorBefore: before.presentedCursor,
      cursorAfter: after.presentedCursor,
      frameIdentityBefore: sha256(Buffer.from(canonicalJson(before.canvasFrameIdentity))),
      frameIdentityAfter: sha256(Buffer.from(canonicalJson(after.canvasFrameIdentity))),
      stateHashBefore: sha256(Buffer.from(beforeCommit.acceptedPublicState)),
      stateHashAfter: sha256(Buffer.from(afterCommit.acceptedPublicState)),
    }),
  });
}

async function collectCapturePerformanceEvidence(
  page: Page,
  chronicleId: string,
  runtimeObservations: readonly RuntimeObservation[],
  finalObservation: BrowserObservation,
  longTasks: CaptureLongTaskEvidence,
  reducedSchedulerSamples: readonly unknown[],
): Promise<CapturePerformanceEvidence> {
  if (runtimeObservations.length < 2) {
    throw new Error(`${chronicleId} did not expose both active and terminal runtime phases`);
  }
  const visibleScheduler = captureSchedulerSample(
    finalObservation,
    "visible",
    "ambient",
    "standard",
  );
  const hiddenWindowStart = await browserObservation(page);
  await setCapturePageHidden(page, true);
  await advanceCaptureClock(page, hiddenWindowStart.clockNowMs + 1_000);
  await settleObserverWork(page);
  const hiddenObservation = await browserObservation(page);
  const hiddenScheduler = captureSchedulerSample(
    hiddenObservation,
    "hidden",
    "hidden",
    "standard",
  );
  expect(hiddenScheduler).toMatchObject({ rafScheduled: false, wakeScheduled: false });
  const cdp = await page.context().newCDPSession(page);
  const baseline = await retainedCaptureState(cdp);
  await setCapturePageHidden(page, false);
  const archiveObservations = chronicleId === "C16"
    ? await collectArchiveObservations(page, finalObservation)
    : [];
  await setCapturePageHidden(page, true);
  await settleObserverWork(page);
  const tail = await retainedCaptureState(cdp);
  await setCapturePageHidden(page, false);
  await cdp.detach();
  return Object.freeze({
    schedulerSamples: Object.freeze([
      visibleScheduler,
      ...reducedSchedulerSamples,
      hiddenScheduler,
    ]),
    archiveObservations: Object.freeze(archiveObservations),
    heap: Object.freeze({
      supportProbe: { api: "CDP HeapProfiler.collectGarbage", supported: true },
      collections: 4,
      baseline: baseline.heap,
      tail: tail.heap,
      domBaseline: { nodes: baseline.dom.nodes, listeners: baseline.dom.jsEventListeners },
      domTail: { nodes: tail.dom.nodes, listeners: tail.dom.jsEventListeners },
    }),
    observerStartedAt: longTasks.observerStartedAt,
    longTaskSamples: longTasks.longTaskSamples,
    productWorkIntervals: longTasks.productWorkIntervals,
    longTasksMs: longTasks.longTasksMs,
    captureInstrumentationLongTasks: longTasks.captureInstrumentationLongTasks,
    hiddenCadenceWindow: Object.freeze({
      mode: "hidden" as const,
      frameCount: Math.max(
        0,
        Number(hiddenObservation.renderer.draw.totalCount)
          - Number(hiddenWindowStart.renderer.draw.totalCount),
      ),
      durationMs: hiddenObservation.clockNowMs - hiddenWindowStart.clockNowMs,
    }),
  });
}

async function collectArchiveObservations(
  page: Page,
  terminalLive: BrowserObservation,
): Promise<readonly unknown[]> {
  const liveCursor = terminalLive.presentedCursor;
  const liveStateHash = captureLiveStateHash(terminalLive);
  await page.locator("#observer-archive-trigger").click();
  await expect(page.getByRole("heading", { name: "Archive", exact: true })).toBeVisible();
  await expect.poll(async () => (await browserObservation(page)).observer.archiveStatus).toBe("ready");
  const observations = [];
  for (let cycle = 1; cycle <= 25; cycle += 1) {
    await page.locator(".archive-drawer__checkpoints button").first().click();
    await expect.poll(async () => (await browserObservation(page)).presentedSource).toBe("archive");
    const archived = await browserObservation(page);
    expect(archived.renderer.graph.spatialBinding).toEqual({
      placementRebound: true,
      recipesRebound: true,
    });
    await page.locator(".archive-drawer__return").click();
    await expect.poll(async () => (await browserObservation(page)).presentedSource).toBe("live");
    const restored = await browserObservation(page);
    expect(restored.presentedCursor).toBe(liveCursor);
    expect(restored.activeSceneCount).toBe(0);
    expect(restored.pendingMoments).toBe(0);
    expect(restored.canvasFrameIdentity).toEqual(restored.observerFrameIdentity);
    expect(restored.renderer.graph.spatialBinding).toEqual({
      placementRebound: false,
      recipesRebound: false,
    });
    expect(captureLiveStateHash(restored)).toBe(liveStateHash);
    observations.push(Object.freeze({
      cycle,
      source: "archive",
      liveCursorBefore: liveCursor,
      liveCursorAfter: restored.presentedCursor,
      liveStateHashBefore: liveStateHash,
      liveStateHashAfter: captureLiveStateHash(restored),
      liveSessions: archived.observer.liveSessions,
      archiveSessions: archived.observer.archiveSessions,
      stageId: archived.stageId,
      canvasId: archived.canvasId,
      archiveSpatialBinding: Object.freeze({
        ...archived.renderer.graph.spatialBinding,
      }),
      restoredLiveSpatialBinding: Object.freeze({
        ...restored.renderer.graph.spatialBinding,
      }),
    }));
  }
  return Object.freeze(observations);
}

function captureLiveStateHash(observation: BrowserObservation): string {
  // Live visibility pause/resume publishes a new revision, and selecting a new
  // lineage reconstructs renderer instances. Hash persistent world truth while
  // retaining every authored actor/home field; omit only revision, instanceId,
  // and the renderer-local transient activeAction.
  const frameIdentity = observation.observerFrameIdentity === null
    ? null
    : {
        runId: observation.observerFrameIdentity.runId,
        sourceKey: observation.observerFrameIdentity.sourceKey,
        firstCursor: observation.observerFrameIdentity.firstCursor,
        lastCursor: observation.observerFrameIdentity.lastCursor,
      };
  const actors = observation.renderer.graph.actors.map((actor: any) => ({
    id: actor.id,
    position: actor.position,
    facing: actor.facing,
    worldBounds: actor.worldBounds,
    status: actor.status,
    terminal: actor.terminal,
    selected: actor.selected,
  }));
  const homes = observation.renderer.graph.homes.map((home: any) => ({
    id: home.id,
    kind: home.kind,
    status: home.status,
    plot: home.plot,
    door: home.door,
    kit: home.kit,
    remnantMaterials: home.remnantMaterials,
    provisional: home.provisional,
  }));
  return sha256(Buffer.from(canonicalJson({
    frameIdentity,
    actors,
    homes,
  })));
}

async function setCapturePageHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((nextHidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, value: nextHidden });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: nextHidden ? "hidden" : "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

async function retainedCaptureState(cdp: import("@playwright/test").CDPSession): Promise<any> {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = await cdp.send("Runtime.getHeapUsage");
  const dom = await cdp.send("Memory.getDOMCounters");
  return { heap, dom };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeCanonicalJson(filename: string, value: unknown): Promise<void> {
  await writeNormalizedJson(filename, value);
}
