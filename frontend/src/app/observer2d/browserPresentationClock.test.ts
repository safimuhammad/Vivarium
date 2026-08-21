import { describe, expect, it, vi } from "vitest";

import { createBrowserPresentationClock } from "./browserPresentationClock";

describe("createBrowserPresentationClock", () => {
  it("uses the monotonic browser clock and one cancellable timeout per schedule", () => {
    let now = 125;
    const callbacks: Array<() => void> = [];
    const clearTimeout = vi.fn();
    const setTimeout = vi.fn((next: () => void, delayMs: number) => {
      callbacks.push(next);
      return 41;
    });
    const clock = createBrowserPresentationClock({
      now: () => now,
      setTimeout,
      clearTimeout,
    });
    const fired = vi.fn();

    expect(clock.now()).toBe(125);
    const cancel = clock.schedule(200, fired);
    expect(setTimeout).toHaveBeenCalledOnce();
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 75);
    cancel();
    cancel();
    expect(clearTimeout).toHaveBeenCalledOnce();
    expect(clearTimeout).toHaveBeenCalledWith(41);
    callbacks[0]?.();
    expect(fired).not.toHaveBeenCalled();

    now = 240;
    clock.schedule(200, fired);
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 0);
  });

  it("fires a scheduled callback at most once and makes late cancellation inert", () => {
    const callbacks: Array<() => void> = [];
    const clearTimeout = vi.fn();
    const clock = createBrowserPresentationClock({
      now: () => 10,
      setTimeout: (next) => {
        callbacks.push(next);
        return 9;
      },
      clearTimeout,
    });
    const fired = vi.fn();

    const cancel = clock.schedule(15, fired);
    callbacks[0]?.();
    callbacks[0]?.();
    cancel();

    expect(fired).toHaveBeenCalledOnce();
    expect(clearTimeout).not.toHaveBeenCalled();
  });
});
