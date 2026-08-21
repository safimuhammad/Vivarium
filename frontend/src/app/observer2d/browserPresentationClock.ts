import type { PresentationClock } from "../../presentation/storyClock";

export interface BrowserPresentationClockPlatform {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout: (handle: number) => void;
}

/** Creates the app-layer monotonic clock used by the production story director. */
export function createBrowserPresentationClock(
  platform: BrowserPresentationClockPlatform = browserPlatform(),
): PresentationClock {
  return {
    now(): number {
      return platform.now();
    },
    schedule(deadlineMs, callback): () => void {
      if (!Number.isFinite(deadlineMs)) {
        throw new RangeError("presentation deadline must be finite");
      }
      let active = true;
      const handle = platform.setTimeout(() => {
        if (!active) return;
        active = false;
        callback();
      }, Math.max(0, deadlineMs - platform.now()));
      return () => {
        if (!active) return;
        active = false;
        platform.clearTimeout(handle);
      };
    },
  };
}

function browserPlatform(): BrowserPresentationClockPlatform {
  return {
    now: () => globalThis.performance.now(),
    setTimeout: (callback, delayMs) => Number(globalThis.setTimeout(callback, delayMs)),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
  };
}
