import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseChronicleBufferMs,
  readChronicleSurfacePreference,
  writeChronicleSurfacePreference,
} from "./chronicleSurfacePreference";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("chronicle surface preference", () => {
  it("starts closed for a viewer who has never touched it", () => {
    expect(readChronicleSurfacePreference()).toBe(false);
  });

  it("round-trips the viewer's own choice", () => {
    writeChronicleSurfacePreference(true);
    expect(readChronicleSurfacePreference()).toBe(true);
    writeChronicleSurfacePreference(false);
    expect(readChronicleSurfacePreference()).toBe(false);
  });

  it("degrades to the default rather than throwing when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => writeChronicleSurfacePreference(true)).not.toThrow();
    expect(readChronicleSurfacePreference()).toBe(false);
  });
});

describe("parseChronicleBufferMs", () => {
  it("reads a positive finite override", () => {
    expect(parseChronicleBufferMs("?buffer=9000")).toBe(9_000);
    expect(parseChronicleBufferMs("?renderer=2d&buffer=1500&chronicle=C18")).toBe(1_500);
  });

  it("ignores an absent, malformed or non-positive value", () => {
    expect(parseChronicleBufferMs("")).toBeNull();
    expect(parseChronicleBufferMs("?renderer=2d")).toBeNull();
    expect(parseChronicleBufferMs("?buffer=soon")).toBeNull();
    expect(parseChronicleBufferMs("?buffer=0")).toBeNull();
    expect(parseChronicleBufferMs("?buffer=-5")).toBeNull();
  });
});
