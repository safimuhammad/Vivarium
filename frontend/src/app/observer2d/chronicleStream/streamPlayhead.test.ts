import { describe, expect, it } from "vitest";

import { formatEventTime, formatFeedTime, resolveStreamPlayhead } from "./streamPlayhead";

describe("resolveStreamPlayhead", () => {
  const base = { clockMs: 20_000, liveMs: 20_000, floorMs: 0, bufferMs: 90_000 };

  it("rides the leading edge when there is no seek", () => {
    expect(resolveStreamPlayhead({ ...base, seek: null })).toMatchObject({
      nowMs: 20_000,
      behindMs: 0,
      atLive: true,
      atFloor: false,
    });
  });

  it("lands behind live after a seek and reports the exact offset", () => {
    expect(resolveStreamPlayhead({
      ...base,
      seek: { toMs: 10_900, atMs: 20_000 },
    })).toMatchObject({
      nowMs: 10_900,
      behindMs: 9_100,
      atLive: false,
      atFloor: false,
    });
  });

  it("plays forward from a seek at real speed", () => {
    const later = resolveStreamPlayhead({
      ...base,
      clockMs: 24_000,
      liveMs: 24_000,
      seek: { toMs: 10_900, atMs: 20_000 },
    });
    expect(later.nowMs).toBe(14_900);
    expect(later.behindMs).toBe(9_100);
    expect(later.atLive).toBe(false);
  });

  it("snaps to live once playback catches the leading edge", () => {
    const caught = resolveStreamPlayhead({
      ...base,
      clockMs: 40_000,
      liveMs: 21_000,
      seek: { toMs: 10_900, atMs: 20_000 },
    });
    expect(caught.atLive).toBe(true);
    expect(caught.nowMs).toBe(21_000);
    expect(caught.behindMs).toBe(0);
  });

  it("clamps a seek below the buffer floor and says so", () => {
    const floored = resolveStreamPlayhead({
      ...base,
      floorMs: 8_000,
      seek: { toMs: 1_000, atMs: 20_000 },
    });
    expect(floored.nowMs).toBe(8_000);
    expect(floored.atFloor).toBe(true);
    expect(floored.behindMs).toBe(12_000);
  });

  it("never treats the leading edge as the floor", () => {
    expect(resolveStreamPlayhead({
      ...base,
      floorMs: 20_000,
      seek: { toMs: 20_000, atMs: 20_000 },
    })).toMatchObject({ atLive: true, atFloor: false });
  });
});

describe("formatFeedTime", () => {
  it("formats the feed clock as m:ss.d and floors below zero", () => {
    expect(formatFeedTime(0)).toBe("0:00.0");
    expect(formatFeedTime(9_120)).toBe("0:09.1");
    expect(formatFeedTime(61_500)).toBe("1:01.5");
    expect(formatFeedTime(-500)).toBe("0:00.0");
  });
});

describe("formatEventTime", () => {
  it("formats epoch seconds as UTC independently of page age", () => {
    expect(formatEventTime(1_789_341_765.9, 421_900)).toBe("23:22:45 UTC");
    expect(formatEventTime(946_684_800, 421_900)).toBe("00:00:00 UTC");
  });

  it("preserves elapsed formatting for synthetic event clocks", () => {
    expect(formatEventTime(61.5, 421_900)).toBe("1:01.5");
    expect(formatEventTime(0, 421_900)).toBe("0:00.0");
  });

  it("retains arrival-clock fallback when an event has no valid timestamp", () => {
    expect(formatEventTime(null, 9_120)).toBe("0:09.1");
    expect(formatEventTime(Number.NaN, 9_120)).toBe("0:09.1");
  });
});
