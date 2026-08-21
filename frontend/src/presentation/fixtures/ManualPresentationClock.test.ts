import { describe, expect, it, vi } from "vitest";

import { createManualPresentationClock } from "./ManualPresentationClock";

describe("ManualPresentationClock", () => {
  it("runs equal-deadline callbacks in insertion order and advances deterministically", () => {
    const clock = createManualPresentationClock({ initialNowMs: 10 });
    const order: string[] = [];
    clock.schedule(30, () => order.push(`first:${clock.now()}`));
    clock.schedule(20, () => order.push(`early:${clock.now()}`));
    clock.schedule(30, () => order.push(`second:${clock.now()}`));

    clock.advanceBy(20);

    expect(order).toEqual(["early:20", "first:30", "second:30"]);
    expect(clock.now()).toBe(30);
    expect(clock.pendingCount()).toBe(0);
  });

  it("is reentrant-safe when callbacks schedule and cancel due work", () => {
    const clock = createManualPresentationClock();
    const order: string[] = [];
    let cancelSecond: () => void = () => undefined;
    clock.schedule(5, () => {
      order.push("first");
      cancelSecond();
      clock.schedule(5, () => order.push("reentrant"));
    });
    cancelSecond = clock.schedule(5, () => order.push("cancelled"));

    clock.advanceTo(5);

    expect(order).toEqual(["first", "reentrant"]);
    expect(clock.pendingCount()).toBe(0);
  });

  it("bounds self-rescheduling callbacks per advance without losing pending work", () => {
    const clock = createManualPresentationClock({ maxCallbacksPerAdvance: 3 });
    const callback = vi.fn(() => clock.schedule(clock.now(), callback));
    clock.schedule(0, callback);

    expect(() => clock.advanceTo(0)).toThrow(
      "manual clock exceeded 3 callbacks in one advance",
    );
    expect(callback).toHaveBeenCalledTimes(3);
    expect(clock.pendingCount()).toBe(1);
  });

  it("supports idempotent cancellation and disposal of every deadline", () => {
    const clock = createManualPresentationClock();
    const callback = vi.fn();
    const cancel = clock.schedule(1, callback);
    cancel();
    cancel();
    clock.schedule(2, callback);

    clock.dispose();
    clock.dispose();
    clock.advanceTo(10);
    clock.schedule(10, callback)();

    expect(callback).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
  });

  it("rejects non-finite, negative, and backwards time movement", () => {
    const clock = createManualPresentationClock({ initialNowMs: 10 });

    expect(() => clock.schedule(Number.NaN, () => undefined)).toThrow(
      "deadlineMs must be a finite number",
    );
    expect(() => clock.advanceBy(-1)).toThrow(
      "deltaMs must be a non-negative finite number",
    );
    expect(() => clock.advanceTo(9)).toThrow(
      "manual clock cannot move backwards",
    );
  });

  it("never moves backward when a callback advances beyond the outer target", () => {
    const clock = createManualPresentationClock();
    const observed: number[] = [];
    clock.schedule(5, () => {
      observed.push(clock.now());
      clock.advanceTo(20);
      observed.push(clock.now());
    });
    clock.schedule(15, () => observed.push(clock.now()));

    clock.advanceTo(10);

    expect(observed).toEqual([5, 15, 20]);
    expect(clock.now()).toBe(20);
  });

  it("preserves pending work and monotonic time after a callback exception", () => {
    const clock = createManualPresentationClock();
    const later = vi.fn();
    clock.schedule(5, () => { throw new Error("boom"); });
    clock.schedule(10, later);

    expect(() => clock.advanceTo(20)).toThrow("boom");
    expect(clock.now()).toBe(5);
    expect(clock.pendingCount()).toBe(1);

    clock.advanceTo(20);
    expect(later).toHaveBeenCalledOnce();
    expect(clock.now()).toBe(20);
  });

  it("stops nested work immediately when a callback disposes the clock", () => {
    const clock = createManualPresentationClock();
    const later = vi.fn();
    clock.schedule(5, () => clock.dispose());
    clock.schedule(10, later);

    clock.advanceTo(20);

    expect(later).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
    expect(clock.now()).toBe(5);
  });

  it("keeps later-target time monotonic on callback-budget exhaustion and recovers", () => {
    const clock = createManualPresentationClock({ maxCallbacksPerAdvance: 2 });
    let reschedule = true;
    const callback = vi.fn(() => {
      if (reschedule) clock.schedule(clock.now(), callback);
    });
    clock.schedule(5, callback);

    expect(() => clock.advanceTo(20)).toThrow(
      "manual clock exceeded 2 callbacks in one advance",
    );
    expect(clock.now()).toBe(20);
    expect(clock.pendingCount()).toBe(1);
    reschedule = false;
    clock.advanceTo(20);
    expect(callback).toHaveBeenCalledTimes(3);
    expect(clock.pendingCount()).toBe(0);
  });
});
