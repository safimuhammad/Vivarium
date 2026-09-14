import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseChronicleBufferMs,
  readChronicleSurfacePreference,
  writeChronicleSurfacePreference,
} from "./chronicleSurfacePreference";

let storage: Storage;

beforeEach(() => {
  storage = memoryStorage();
  // Node 26 exposes an opt-in process-level `localStorage` getter, which is
  // unavailable in this Vitest worker and shadows JSDOM's browser surface.
  // The preference contract needs a browser-shaped store, not host storage.
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chronicle surface preference", () => {
  it("starts OPEN for a viewer who has never touched it", () => {
    expect(readChronicleSurfacePreference()).toBe(true);
  });

  it("round-trips the viewer's own choice", () => {
    writeChronicleSurfacePreference(false);
    expect(readChronicleSurfacePreference()).toBe(false);
    writeChronicleSurfacePreference(true);
    expect(readChronicleSurfacePreference()).toBe(true);
  });

  it("never inherits the retired default from a stale pre-v2 value", () => {
    // Every viewer who closed the old feed left `"false"` behind under the old
    // key. Reading it would hand them the retired closed-by-default forever,
    // because "closed" and "chose closed" are the same three characters.
    localStorage.setItem("vivarium.observer.chronicle-open", "false");
    expect(readChronicleSurfacePreference()).toBe(true);
  });

  it("treats an unrecognised stored value as the default rather than as closed", () => {
    localStorage.setItem("vivarium.observer.chronicle-open.v2", "yes");
    expect(readChronicleSurfacePreference()).toBe(true);
  });

  it("degrades to the default rather than throwing when storage is unavailable", () => {
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => writeChronicleSurfacePreference(true)).not.toThrow();
    expect(readChronicleSurfacePreference()).toBe(true);
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length(): number { return values.size; },
    clear: (): void => values.clear(),
    getItem: (key: string): string | null => values.get(key) ?? null,
    key: (index: number): string | null => [...values.keys()][index] ?? null,
    removeItem: (key: string): void => { values.delete(key); },
    setItem: (key: string, value: string): void => { values.set(key, value); },
  };
}

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
