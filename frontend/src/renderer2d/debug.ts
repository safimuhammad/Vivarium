import type { Vivarium2DSliceDebug } from "./contracts";

declare global {
  interface Window {
    __vivarium2DSlice?: Vivarium2DSliceDebug;
  }
}

/** Installs one renderer debug handle without letting stale cleanup remove a successor. */
export function installVivarium2DSliceDebug(debug: Vivarium2DSliceDebug): () => void {
  window.__vivarium2DSlice = debug;
  return (): void => {
    if (window.__vivarium2DSlice === debug) delete window.__vivarium2DSlice;
  };
}

