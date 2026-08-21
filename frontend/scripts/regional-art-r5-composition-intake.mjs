/** Strict synchronous intake for asynchronous regional-art composition. */

import { types as utilTypes } from "node:util";

function rejectInput(message, path) {
  const error = new TypeError(message);
  Object.defineProperty(error, "intakePath", {
    configurable: false,
    enumerable: false,
    value: Object.freeze([...path]),
    writable: false,
  });
  throw error;
}

function assertNoProxy(value, path) {
  if (utilTypes.isProxy(value)) {
    rejectInput("Regional R5 composition input cannot contain Proxy values.", path);
  }
}

function assertDataDescriptor(descriptor, path) {
  if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
    rejectInput(
      "Regional R5 composition input requires enumerable data properties only.",
      path,
    );
  }
}

function assertCanonicalPrimitive(value, path) {
  if (typeof value === "bigint") {
    rejectInput("Regional R5 composition input cannot contain BigInt values.", path);
  }
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) {
    rejectInput(
      "Regional R5 composition numbers require a unique canonical JSON representation.",
      path,
    );
  }
}

function cloneBuffer(value, path) {
  if (Object.getPrototypeOf(value) !== Buffer.prototype) {
    rejectInput("Regional R5 composition Buffers require the standard prototype.", path);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length) {
    rejectInput("Regional R5 composition Buffers cannot contain metadata.", path);
  }
  const output = value.length === 0 ? Buffer.alloc(0) : Buffer.allocUnsafeSlow(value.length);
  value.copy(output);
  return output;
}

function cloneArray(value, path, active, snapshots) {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    rejectInput("Regional R5 composition Arrays require the standard prototype.", path);
  }
  const output = new Array(value.length);
  snapshots.set(value, output);
  active.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string"
        || !/^(?:0|[1-9][0-9]*)$/u.test(key)
        || Number(key) >= value.length) {
      rejectInput("Regional R5 composition Arrays cannot contain metadata.", path);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assertDataDescriptor(descriptor, [...path, key]);
    Object.defineProperty(output, key, {
      configurable: true,
      enumerable: true,
      value: cloneValue(descriptor.value, [...path, key], active, snapshots),
      writable: true,
    });
  }
  active.delete(value);
  return output;
}

function cloneMap(value, path, active, snapshots) {
  if (Object.getPrototypeOf(value) !== Map.prototype || Reflect.ownKeys(value).length !== 0) {
    rejectInput("Regional R5 composition Maps require the standard closed shape.", path);
  }
  const output = new Map();
  snapshots.set(value, output);
  active.add(value);
  for (const [key, child] of Map.prototype.entries.call(value)) {
    if ((key !== null && typeof key === "object")
        || typeof key === "function" || typeof key === "symbol") {
      rejectInput("Regional R5 composition Maps require primitive non-Symbol keys.", path);
    }
    assertCanonicalPrimitive(key, [...path, `<map-key:${String(key)}>`]);
    output.set(key, cloneValue(child, [...path, `<map:${String(key)}>`], active, snapshots));
  }
  active.delete(value);
  return output;
}

function cloneObject(value, path, active, snapshots) {
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    rejectInput("Regional R5 composition objects require the plain Object prototype.", path);
  }
  const output = {};
  snapshots.set(value, output);
  active.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      rejectInput("Regional R5 composition objects cannot contain Symbol keys.", path);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assertDataDescriptor(descriptor, [...path, key]);
    Object.defineProperty(output, key, {
      configurable: true,
      enumerable: true,
      value: cloneValue(descriptor.value, [...path, key], active, snapshots),
      writable: true,
    });
  }
  active.delete(value);
  return output;
}

function cloneValue(value, path, active, snapshots) {
  if (typeof value === "symbol") {
    rejectInput("Regional R5 composition input cannot contain Symbol values.", path);
  }
  if (typeof value === "function") {
    assertNoProxy(value, path);
    return value;
  }
  assertCanonicalPrimitive(value, path);
  if (value === null || typeof value !== "object") return value;
  assertNoProxy(value, path);
  if (active.has(value)) {
    rejectInput("Regional R5 composition input cannot contain cycles.", path);
  }
  if (snapshots.has(value)) return snapshots.get(value);
  if (Buffer.isBuffer(value)) {
    const output = cloneBuffer(value, path);
    snapshots.set(value, output);
    return output;
  }
  if (Array.isArray(value)) return cloneArray(value, path, active, snapshots);
  if (utilTypes.isMap(value)) return cloneMap(value, path, active, snapshots);
  return cloneObject(value, path, active, snapshots);
}

/**
 * Validate and detach a complete regional composition input graph.
 *
 * This function is deliberately synchronous so callers can invoke it exactly once
 * before their first asynchronous boundary. Functions remain identity leaves;
 * plain objects, arrays, Maps, and Buffers are recursively copied.
 */
export function snapshotRegionalR5CompositionInput(input) {
  return cloneValue(input, [], new WeakSet(), new WeakMap());
}
