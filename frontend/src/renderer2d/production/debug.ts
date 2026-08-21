import type {
  ProductionSceneGraph,
  ProductionSceneGraphDebugSnapshot,
} from "./ProductionSceneGraph";

export interface ProductionSceneDebugProbe {
  snapshot(): ProductionSceneGraphDebugSnapshot;
}

export interface ProductionStageDebugProbe<T = unknown> {
  snapshot(): T;
}

export interface ProductionStageDebugRegistration {
  release(): void;
}

export interface ProductionDiagnosticsForTest {
  snapshot(surface: Element): unknown | null;
}

declare global {
  interface Window {
    __vivariumEnableProductionDiagnosticsForTest?: boolean;
    __vivariumProductionDiagnosticsForTest?: Readonly<ProductionDiagnosticsForTest>;
  }
}

interface InstalledStageProbe {
  readonly token: object;
  readonly probe: ProductionStageDebugProbe;
}

const installedStageProbes = new WeakMap<Element, InstalledStageProbe>();

if (typeof window !== "undefined" && window.__vivariumEnableProductionDiagnosticsForTest === true) {
  window.__vivariumProductionDiagnosticsForTest = Object.freeze({
    snapshot(surface: Element): unknown | null {
      return installedStageProbes.get(surface)?.probe.snapshot() ?? null;
    },
  });
}

/**
 * True when the pre-document `__vivariumEnableProductionDiagnosticsForTest`
 * flag is active for this session.
 *
 * Reused by any production renderer that draws a developer-facing diagnostic
 * cue (as opposed to in-universe visual content) so it stays invisible during
 * normal viewing and only appears for a QA/test harness that has explicitly
 * opted in -- the same gate that controls whether the debug snapshot
 * accessor above is published. Read live (not cached at module load) so a
 * harness that sets the flag before drawing, rather than before module
 * evaluation, is still honored.
 */
export function isProductionDiagnosticsForTestEnabled(): boolean {
  return typeof window !== "undefined" && window.__vivariumEnableProductionDiagnosticsForTest === true;
}

/** Create a read-only detached observer over a production scene graph. */
export function createProductionSceneDebugProbe(
  graph: ProductionSceneGraph,
): ProductionSceneDebugProbe {
  return Object.freeze({
    snapshot: (): ProductionSceneGraphDebugSnapshot => graph.debugSnapshot(),
  });
}

/** Install one observer-only stage probe; stale releases cannot remove a newer probe. */
export function installProductionStageDebugProbe<T>(
  surface: Element,
  probe: ProductionStageDebugProbe<T>,
): ProductionStageDebugRegistration {
  const token = Object.freeze({});
  installedStageProbes.set(surface, { token, probe });
  let released = false;
  return Object.freeze({
    release(): void {
      if (released) return;
      released = true;
      if (installedStageProbes.get(surface)?.token === token) installedStageProbes.delete(surface);
    },
  });
}

/** Read the observer-only probe installed for an exact production Stage surface. */
export function getProductionStageDebugProbe(
  surface: Element,
): ProductionStageDebugProbe | null {
  return installedStageProbes.get(surface)?.probe ?? null;
}
