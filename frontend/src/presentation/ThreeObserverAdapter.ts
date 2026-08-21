import {
  parseWorldSnapshot,
  type AgentSnapshot,
  type HomeSnapshot,
  type RegionSnapshot,
  type WorldSnapshot,
} from "../app/schemas";
import {
  type CameraMode,
  type FrameIdentity,
  type ObserverSelection,
  type PresentedObserverFrame,
  type PresentedRecord,
  type SafeFrameInsets,
  type StoryFocus,
  type Vec2,
} from "./contracts";
import {
  createGuardedObserverRendererPort,
  type ObserverRendererCallbacks,
  type ObserverRendererDiagnostics,
  type ObserverRendererPort,
} from "./rendererPort";
import { claimObserverRendererSurface } from "./rendererSurfaceOwnership";

export type ThreeRendererSelection =
  | { readonly kind: "region"; readonly id: string }
  | { readonly kind: "agent"; readonly id: string }
  | { readonly kind: "home"; readonly id: string };

export interface ThreeObserverBackendDiagnostics {
  readonly disposed: boolean;
  readonly drawP95Ms: number;
  readonly scheduledFrame: boolean;
  readonly activeActors: number;
  readonly activeHomes: number;
  readonly activeEffects: number;
  readonly staticLayerRebuilds: number;
  readonly assetBytes: number;
  readonly decodedAssetBytes: number;
  readonly pathFallbacks: number;
}

export interface ThreeObserverBackend {
  updateSnapshot(snapshot: WorldSnapshot | null): void;
  setSelected(selection: ThreeRendererSelection | null): void;
  focusSelection(selection: ThreeRendererSelection): boolean;
  setSafeFrame(insets: SafeFrameInsets): void;
  setCameraMode(mode: CameraMode): void;
  panCamera(deltaCss: Vec2): void;
  zoomCamera(factor: number, anchorCss: Vec2): void;
  resize(cssWidth: number, cssHeight: number): void;
  diagnostics(): ThreeObserverBackendDiagnostics;
  dispose(): void;
}

export interface ThreeObserverBackendCallbacks {
  onSelectionChange(selection: ThreeRendererSelection): void;
  onCameraModeChange(mode: CameraMode): void;
}

export interface ThreeObserverBackendFactoryOptions {
  readonly surface: HTMLElement;
  readonly signal: AbortSignal;
  readonly callbacks: ThreeObserverBackendCallbacks;
}

export type ThreeObserverBackendFactory = (
  options: ThreeObserverBackendFactoryOptions,
) => Promise<ThreeObserverBackend> | ThreeObserverBackend;

export interface ThreeObserverAdapterOptions {
  readonly surface: HTMLElement;
  readonly signal?: AbortSignal;
  readonly callbacks: ObserverRendererCallbacks;
  readonly backendFactory: ThreeObserverBackendFactory;
}

interface ReconciledFrame {
  readonly snapshot: WorldSnapshot;
  readonly agents: Map<string, AgentSnapshot>;
  readonly regions: Map<string, RegionSnapshot>;
  readonly homes: Map<string, HomeSnapshot>;
  readonly ruins: Map<string, HomeSnapshot>;
  readonly terminalAgents: Set<string>;
  readonly terminalHomes: Set<string>;
}

/**
 * Every `WorldSnapshot` field, required, as handed to `parseWorldSnapshot`.
 *
 * The presented frame is shaped nothing like a snapshot — camel-cased, its
 * records wrapped in completeness envelopes — so this translation cannot be a
 * spread and has to name each field. `Required<...>` makes that naming total:
 * a field added to `WorldSnapshot` later, optional or not, fails this type
 * until the translation decides what to send for it. Hand-maintained key lists
 * are how `region_pressure` was silently dropped on the replay clone path; this
 * one cannot go quiet, it can only fail to compile.
 */
type LegacySnapshotWire = { readonly [K in keyof Required<WorldSnapshot>]: unknown };

const abortError = (): DOMException => new DOMException("Aborted", "AbortError");

/** Creates a renderer-neutral observer port over one structural Three backend. */
export async function createThreeObserverAdapter(
  options: ThreeObserverAdapterOptions,
): Promise<ObserverRendererPort> {
  if (options.signal?.aborted) throw abortError();
  const surfaceLease = claimObserverRendererSurface(options.surface, "three-fallback");
  const lifecycle = new AbortController();
  const disposedCandidates = new WeakSet<ThreeObserverBackend>();
  let cancelled = false;
  let installedPort: ObserverRendererPort | null = null;
  let currentFrame: PresentedObserverFrame | null = null;
  let currentSnapshot: WorldSnapshot | null = null;
  let currentSelection: ObserverSelection = null;
  let cameraMode: CameraMode = "story";
  let observedRegionId: string | null = null;
  let lastIdentity: FrameIdentity | null = null;
  let agents = new Map<string, AgentSnapshot>();
  let regions = new Map<string, RegionSnapshot>();
  let homes = new Map<string, HomeSnapshot>();
  let ruins = new Map<string, HomeSnapshot>();
  let terminalAgents = new Set<string>();
  let terminalHomes = new Set<string>();

  const disposeCandidate = (candidate: ThreeObserverBackend): void => {
    if (disposedCandidates.has(candidate)) return;
    disposedCandidates.add(candidate);
    candidate.dispose();
  };

  const onExternalAbort = (): void => {
    if (cancelled) return;
    cancelled = true;
    if (installedPort !== null) installedPort.dispose();
    else {
      lifecycle.abort();
      surfaceLease.release();
    }
  };
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  const backendCallbacks: ThreeObserverBackendCallbacks = {
    onSelectionChange(selection): void {
      if (cancelled) return;
      const mapped: ObserverSelection = selection.kind === "home" && ruins.has(selection.id)
        ? { kind: "ruin", id: selection.id }
        : { ...selection };
      currentSelection = mapped;
      options.callbacks.onSelectionChange?.(mapped);
    },
    onCameraModeChange(mode): void {
      if (cancelled) return;
      cameraMode = mode;
      options.callbacks.onCameraModeChange?.(mode);
    },
  };

  const candidatePromise = Promise.resolve().then(() => options.backendFactory({
    surface: options.surface,
    signal: lifecycle.signal,
    callbacks: backendCallbacks,
  }));
  void candidatePromise.then((candidate) => {
    if (cancelled) disposeCandidate(candidate);
  }, () => undefined);

  const aborted = new Promise<never>((_resolve, reject) => {
    lifecycle.signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });

  let backend: ThreeObserverBackend;
  try {
    backend = await Promise.race([candidatePromise, aborted]);
  } catch (error) {
    cancelled = true;
    lifecycle.abort();
    surfaceLease.release();
    options.signal?.removeEventListener("abort", onExternalAbort);
    throw error;
  }
  if (cancelled || lifecycle.signal.aborted || options.signal?.aborted) {
    disposeCandidate(backend);
    lifecycle.abort();
    surfaceLease.release();
    options.signal?.removeEventListener("abort", onExternalAbort);
    throw abortError();
  }

  let delegateDisposed = false;
  const detailedFailure = (error: unknown): void => {
    options.callbacks.onFailure?.({
      kind: "canvas",
      retryable: false,
      publicMessage: error instanceof Error
        ? `The fallback renderer rejected this world frame: ${error.message}`
        : "The fallback renderer rejected this world frame.",
    });
  };

  const diagnostics = (): ObserverRendererDiagnostics => {
    const measured = backend.diagnostics();
    return Object.freeze({
      disposed: delegateDisposed || measured.disposed,
      frameIdentity: lastIdentity === null ? null : Object.freeze({ ...lastIdentity }),
      drawP95Ms: measured.drawP95Ms,
      scheduledFrame: measured.scheduledFrame,
      activeActors: measured.activeActors,
      activeHomes: measured.activeHomes,
      activeEffects: measured.activeEffects,
      staticLayerRebuilds: measured.staticLayerRebuilds,
      assetBytes: measured.assetBytes,
      decodedAssetBytes: measured.decodedAssetBytes,
      pathFallbacks: measured.pathFallbacks,
    });
  };

  const delegate: ObserverRendererPort = {
    updatePresentation(frame): void {
      if (delegateDisposed || !accepts(lastIdentity, frame)) return;
      let reconciled: ReconciledFrame;
      let mappedSelection: ThreeRendererSelection | null;
      let automaticFocus: ThreeRendererSelection | null;
      try {
        reconciled = reconcileFrame(
          frame,
          agents,
          regions,
          homes,
          ruins,
          terminalAgents,
          terminalHomes,
        );
        if (observedRegionId !== null && !reconciled.regions.has(observedRegionId)) {
          observedRegionId = null;
        }
        mappedSelection = mapSelection(frame.selection, frame, false);
        automaticFocus = observedRegionId !== null && cameraMode !== "story"
          ? null
          : automaticFocusFor(cameraMode, frame.selection, frame);
      } catch (error) {
        detailedFailure(error);
        return;
      }

      const priorSnapshot = currentSnapshot === null ? null : structuredClone(currentSnapshot);
      const priorSelection = mapSelection(currentSelection, currentFrame, false);
      const priorFocus = automaticFocusFor(cameraMode, currentSelection, currentFrame);
      try {
        backend.updateSnapshot(reconciled.snapshot);
        backend.setSelected(mappedSelection);
        if (automaticFocus !== null) backend.focusSelection(automaticFocus);
      } catch (error) {
        try {
          backend.updateSnapshot(priorSnapshot);
          backend.setSelected(priorSelection);
          if (priorFocus !== null) backend.focusSelection(priorFocus);
        } catch {
          // The fallback has no stronger transaction primitive. Preserve adapter
          // truth and report the original candidate failure even if rollback fails.
        }
        detailedFailure(error);
        return;
      }

      agents = reconciled.agents;
      regions = reconciled.regions;
      homes = reconciled.homes;
      ruins = reconciled.ruins;
      terminalAgents = reconciled.terminalAgents;
      terminalHomes = reconciled.terminalHomes;
      currentFrame = structuredClone(frame);
      currentSnapshot = structuredClone(reconciled.snapshot);
      currentSelection = structuredClone(frame.selection);
      lastIdentity = identityOf(frame);
      options.callbacks.onDiagnostics?.(diagnostics());
    },
    setSelection(selection): void {
      currentSelection = structuredClone(selection);
      backend.setSelected(mapSelection(selection, currentFrame, false));
    },
    focusSelection(selection): void {
      const mapped = mapSelection(selection, currentFrame, true);
      if (mapped !== null) backend.focusSelection(mapped);
    },
    observeRegion(regionId): void {
      if (!regions.has(regionId)) {
        options.callbacks.onFailure?.({
          kind: "path",
          retryable: false,
          publicMessage: "The selected region is unavailable.",
        });
        return;
      }
      try {
        if (!backend.focusSelection({ kind: "region", id: regionId })) {
          options.callbacks.onFailure?.({
            kind: "path",
            retryable: false,
            publicMessage: "The selected region is unavailable.",
          });
        } else {
          observedRegionId = regionId;
        }
      } catch (error) {
        detailedFailure(error);
      }
    },
    setSafeFrame(insets): void {
      backend.setSafeFrame(insets);
    },
    setCameraMode(mode): void {
      cameraMode = mode;
      if (mode === "story") observedRegionId = null;
      backend.setCameraMode(mode);
    },
    panCamera(deltaCss): void {
      backend.panCamera(deltaCss);
    },
    zoomCamera(factor, anchorCss): void {
      backend.zoomCamera(factor, anchorCss);
    },
    resize(cssWidth, cssHeight): void {
      backend.resize(cssWidth, cssHeight);
    },
    diagnostics,
    dispose(): void {
      if (delegateDisposed) return;
      delegateDisposed = true;
      try {
        disposeCandidate(backend);
      } finally {
        lifecycle.abort();
        surfaceLease.release();
        options.signal?.removeEventListener("abort", onExternalAbort);
        currentFrame = null;
        currentSnapshot = null;
        currentSelection = null;
        observedRegionId = null;
        agents.clear();
        regions.clear();
        homes.clear();
        ruins.clear();
        terminalAgents.clear();
        terminalHomes.clear();
      }
    },
  };

  const guarded = createGuardedObserverRendererPort(delegate);
  installedPort = guarded;
  if (options.signal?.aborted) {
    guarded.dispose();
    throw abortError();
  }
  return guarded;
}

function accepts(prior: FrameIdentity | null, next: FrameIdentity): boolean {
  return prior === null || (
    next.runId === prior.runId
    && next.sourceKey === prior.sourceKey
    && next.revision >= prior.revision
    && next.firstCursor >= prior.firstCursor
    && next.lastCursor >= prior.lastCursor
  );
}

function identityOf(frame: FrameIdentity): FrameIdentity {
  return Object.freeze({
    runId: frame.runId,
    sourceKey: frame.sourceKey,
    revision: frame.revision,
    firstCursor: frame.firstCursor,
    lastCursor: frame.lastCursor,
  });
}

function reconcileFrame(
  frame: PresentedObserverFrame,
  priorAgents: ReadonlyMap<string, AgentSnapshot>,
  priorRegions: ReadonlyMap<string, RegionSnapshot>,
  priorHomes: ReadonlyMap<string, HomeSnapshot>,
  priorRuins: ReadonlyMap<string, HomeSnapshot>,
  priorTerminalAgents: ReadonlySet<string>,
  priorTerminalHomes: ReadonlySet<string>,
): ReconciledFrame {
  const agentValues = reconcileRecords(frame.world.agents, priorAgents, "id", (id, value, completeness) => (
    completeness === "projected-partial" && priorTerminalAgents.has(id)
      ? {
          ...value,
          status: "dead" as const,
          died_at: priorAgents.get(id)?.died_at ?? value.died_at,
        }
      : value
  ));
  const regionValues = reconcileRecords(frame.world.regions, priorRegions, "name");
  const combinedHomes = new Map<string, HomeSnapshot>([...priorHomes, ...priorRuins]);
  const homeValues = reconcileRecords(frame.world.homes, combinedHomes, "home_id", (id, value, completeness) => (
    completeness === "projected-partial" && priorTerminalHomes.has(id)
      ? {
          ...value,
          status: "ruin" as const,
          ruined_at: combinedHomes.get(id)?.ruined_at ?? value.ruined_at,
        }
      : value
  ));
  const ruinValues = reconcileRecords(frame.world.ruins, combinedHomes, "home_id", (id, value, completeness) => (
    completeness === "projected-partial" && priorTerminalHomes.has(id)
      ? {
          ...value,
          status: "ruin" as const,
          ruined_at: combinedHomes.get(id)?.ruined_at ?? value.ruined_at,
        }
      : value
  ));

  const wire: LegacySnapshotWire = {
    schema: 1,
    run_id: frame.runId,
    world_time: frame.world.worldTime,
    event_cursor: frame.presentedCursor,
    // The presented world carries no run default: every presented being already
    // holds its own resolved birth words, having been resolved against the run
    // default at the upstream parse boundary. Stating `undefined` here asks the
    // parse to take each being at its word, which yields the same personas.
    seed_persona: undefined,
    agents: agentValues,
    regions: regionValues,
    homes: homeValues,
    ruins: ruinValues,
    pending_proposals: structuredClone(frame.world.pendingProposals),
    // Exact checkpoint truth, forwarded rather than dropped. Omitting it makes
    // the parse fall back to a live census, which is not the monotone high-water
    // the run recorded, and a region map generated from it draws differently.
    region_pressure: structuredClone(frame.world.regionPressure),
  };
  const snapshot = parseWorldSnapshot(wire);
  if (snapshot.homes.some(({ status }) => status !== "standing")) {
    throw new Error("Standing-home partition contains a ruin.");
  }
  if (snapshot.ruins.some(({ status }) => status !== "ruin")) {
    throw new Error("Ruin partition contains a standing home.");
  }

  const nextAgents = mapBy(snapshot.agents, "id");
  const nextRegions = mapBy(snapshot.regions, "name");
  const nextHomes = mapBy(snapshot.homes, "home_id");
  const nextRuins = mapBy(snapshot.ruins, "home_id");
  const nextTerminalAgents = new Set(
    snapshot.agents.filter(({ status }) => status === "dead").map(({ id }) => id),
  );
  const nextTerminalHomes = new Set(snapshot.ruins.map(({ home_id }) => home_id));

  return {
    snapshot,
    agents: nextAgents,
    regions: nextRegions,
    homes: nextHomes,
    ruins: nextRuins,
    terminalAgents: nextTerminalAgents,
    terminalHomes: nextTerminalHomes,
  };
}

function reconcileRecords<T extends object>(
  records: readonly PresentedRecord<T>[],
  prior: ReadonlyMap<string, T>,
  key: keyof T,
  protect: (
    id: string,
    value: T,
    completeness: PresentedRecord<T>["completeness"],
  ) => T = (_id, value) => value,
): T[] {
  const values: T[] = [];
  for (const record of records) {
    const rawId = record.value[key];
    if (typeof rawId !== "string" || rawId.length === 0) {
      throw new Error(`Presented ${String(key)} must be a non-empty string.`);
    }
    const priorValue = prior.get(rawId);
    if (record.completeness === "projected-partial" && priorValue === undefined) continue;
    const candidate = record.completeness === "exact"
      ? structuredClone(record.value) as T
      : { ...structuredClone(priorValue), ...structuredClone(record.value) } as T;
    values.push(protect(rawId, candidate, record.completeness));
  }
  return values;
}

function mapBy<T extends object>(values: readonly T[], key: keyof T): Map<string, T> {
  const mapped = new Map<string, T>();
  for (const value of values) {
    const id = value[key];
    if (typeof id !== "string") throw new Error(`${String(key)} must be a string.`);
    mapped.set(id, structuredClone(value));
  }
  return mapped;
}

function mapSelection(
  selection: ObserverSelection,
  frame: PresentedObserverFrame | null,
  allowMomentFocus: boolean,
): ThreeRendererSelection | null {
  if (selection === null) return null;
  if (selection.kind === "moment") {
    return allowMomentFocus ? mapStoryFocus(frame?.scene?.focus ?? null) : null;
  }
  if (selection.kind === "ruin") return { kind: "home", id: selection.id };
  return { kind: selection.kind, id: selection.id };
}

function automaticFocusFor(
  mode: CameraMode,
  selection: ObserverSelection,
  frame: PresentedObserverFrame | null,
): ThreeRendererSelection | null {
  if (mode === "follow") return mapSelection(selection, frame, true);
  if (mode === "story") return mapStoryFocus(frame?.scene?.focus ?? null);
  return null;
}

function mapStoryFocus(focus: StoryFocus | null): ThreeRendererSelection | null {
  if (focus === null || focus.kind === "system") return null;
  if (focus.kind === "ruin") return { kind: "home", id: focus.id };
  return { kind: focus.kind, id: focus.id };
}
