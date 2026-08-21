import type { Page } from "@playwright/test";
import type {
  ChroniclePresentationTerminalAuthority,
} from "../../../frontend/src/presentation/fixtures/chronicleCatalog";

export interface TerminalObserverCanonicalState {
  readonly runId: string;
  readonly sourceKey: string;
  readonly presentedCursor: number;
  readonly ingestedCursor: number;
  readonly canvasLastCursor: number;
  readonly activeSceneCount: number;
  readonly pendingMoments: number;
  readonly scenePresent: boolean;
  readonly identitiesMatch: boolean;
  readonly acceptancePending: boolean;
  readonly semanticPending: boolean;
  readonly settlementComplete: boolean;
}

export interface TerminalObserverUiDrainEvidence {
  readonly clockNowMs: number;
  readonly announcerBefore: string;
  readonly announcerAfter: string;
  readonly publicText: string;
  readonly reactCommitCount: number;
  readonly canonicalState: TerminalObserverCanonicalState;
}

const LIVE_ANNOUNCER_IDLE_TIMEOUT_MS = 2_000;

/**
 * Wait for delayed observer-shell UI to commit after canonical model/Canvas completion.
 *
 * This capture-only drain never advances the ManualPresentationClock. It first fails
 * closed unless the observer and Canvas already agree on the terminal cursor, then
 * waits for the production polite live region to publish its explicit idle seam.
 */
export async function drainTerminalObserverUi(
  page: Page,
  expected: number | ChroniclePresentationTerminalAuthority,
): Promise<TerminalObserverUiDrainEvidence> {
  const expectedCursor = typeof expected === "number" ? expected : expected.cursor;
  const before = await terminalSnapshot(page);
  const canonicalErrors = canonicalTerminalErrors(before.canonicalState, expected);
  if (canonicalErrors.length > 0) {
    throw new Error(`terminal UI drain requires canonical completion: ${JSON.stringify({
      expectedCursor,
      errors: canonicalErrors,
      state: before.canonicalState,
    })}`);
  }

  await page.waitForFunction(() => {
    const region = document.querySelector<HTMLElement>(
      ".observer-live-announcer[role='status']",
    );
    return region?.getAttribute("aria-busy") === "false"
      && region.textContent?.trim() === "Caught up.";
  }, undefined, { timeout: LIVE_ANNOUNCER_IDLE_TIMEOUT_MS });
  await settleOneBrowserTurn(page);

  const after = await terminalSnapshot(page);
  if (after.clockNowMs !== before.clockNowMs) {
    throw new Error(`terminal UI drain advanced ManualPresentationClock: ${JSON.stringify({
      before: before.clockNowMs,
      after: after.clockNowMs,
    })}`);
  }
  if (after.announcerBusy || after.announcerText !== "Caught up.") {
    throw new Error(`terminal live announcer did not settle: ${JSON.stringify(after)}`);
  }
  const afterCanonicalErrors = canonicalTerminalErrors(after.canonicalState, expected);
  if (afterCanonicalErrors.length > 0) {
    throw new Error(`canonical state changed during terminal UI drain: ${JSON.stringify({
      expectedCursor,
      errors: afterCanonicalErrors,
      state: after.canonicalState,
    })}`);
  }

  return Object.freeze({
    clockNowMs: after.clockNowMs,
    announcerBefore: before.announcerText,
    announcerAfter: after.announcerText,
    publicText: after.publicText,
    reactCommitCount: after.reactCommitCount,
    canonicalState: after.canonicalState,
  });
}

interface TerminalSnapshot {
  readonly clockNowMs: number;
  readonly announcerText: string;
  readonly announcerBusy: boolean;
  readonly publicText: string;
  readonly reactCommitCount: number;
  readonly canonicalState: TerminalObserverCanonicalState;
}

async function terminalSnapshot(page: Page): Promise<TerminalSnapshot> {
  return page.evaluate(() => {
    const app = document.querySelector(".vivarium-2d-app");
    const stage = document.querySelector(".presentation-world-stage");
    const announcer = document.querySelector<HTMLElement>(
      ".observer-live-announcer[role='status']",
    );
    const control = window.__vivariumProductionCaptureClockForTest;
    const accessor = window.__vivariumProductionDiagnosticsForTest;
    const observer = app === null ? null : accessor?.snapshot(app) as any;
    const renderer = stage === null ? null : accessor?.snapshot(stage) as any;
    if (app === null || stage === null || announcer === null || control === undefined
      || observer === null || observer === undefined || renderer === null || renderer === undefined) {
      throw new Error("terminal UI drain requires mounted production capture diagnostics");
    }
    const identityKey = (identity: any): string => JSON.stringify([
      identity?.runId ?? null,
      identity?.sourceKey ?? null,
      identity?.revision ?? null,
      identity?.firstCursor ?? null,
      identity?.lastCursor ?? null,
    ]);
    const settlement = observer.session?.settlement ?? null;
    return {
      clockNowMs: control.now(),
      announcerText: announcer.textContent?.trim() ?? "",
      announcerBusy: announcer.getAttribute("aria-busy") !== "false",
      publicText: document.body.innerText,
      reactCommitCount: Number(observer.reactCommitCount ?? -1),
      canonicalState: {
        runId: String(observer.frameIdentity?.runId ?? ""),
        sourceKey: String(observer.frameIdentity?.sourceKey ?? ""),
        presentedCursor: Number(app.getAttribute("data-presented-cursor")),
        ingestedCursor: Number(observer.session?.ingress?.ingestedCursor ?? -1),
        canvasLastCursor: Number(renderer.frameIdentity?.lastCursor ?? -1),
        activeSceneCount: Number(observer.session?.director?.activeSceneCount ?? -1),
        pendingMoments: Number(observer.session?.director?.pendingMoments ?? -1),
        scenePresent: observer.scene !== null && observer.scene !== undefined,
        identitiesMatch: identityKey(observer.frameIdentity) === identityKey(renderer.frameIdentity),
        acceptancePending: renderer.postCommit?.acceptancePending !== false,
        semanticPending: renderer.postCommit?.semanticPending !== false,
        settlementComplete: settlement === null || settlement.sceneToken === null
          || settlement.sceneToken === undefined || settlement.sceneSettled === true,
      },
    };
  });
}

function canonicalTerminalErrors(
  state: TerminalObserverCanonicalState,
  expected: number | ChroniclePresentationTerminalAuthority,
): readonly string[] {
  const expectedCursor = typeof expected === "number" ? expected : expected.cursor;
  const errors: string[] = [];
  if (typeof expected !== "number"
    && (state.runId !== expected.runId || state.sourceKey !== expected.sourceKey)) {
    errors.push("presentation lineage");
  }
  if (state.presentedCursor !== expectedCursor) errors.push("presented cursor");
  if (state.ingestedCursor !== expectedCursor) errors.push("ingested cursor");
  if (state.canvasLastCursor !== expectedCursor) errors.push("Canvas cursor");
  if (state.activeSceneCount !== 0) errors.push("active scene count");
  if (state.pendingMoments !== 0) errors.push("pending moments");
  if (state.scenePresent) errors.push("scene still present");
  if (!state.identitiesMatch) errors.push("observer/Canvas identity");
  if (state.acceptancePending) errors.push("Canvas acceptance pending");
  if (state.semanticPending) errors.push("Canvas semantic snapshot pending");
  if (!state.settlementComplete) errors.push("scene settlement");
  return Object.freeze(errors);
}

async function settleOneBrowserTurn(page: Page): Promise<void> {
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
