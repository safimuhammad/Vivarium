/** Regression tests for canonical numeric intake. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  snapshotRegionalR5CompositionInput,
} from "./regional-art-r5-composition-intake.mjs";

test("composition intake rejects primitives that do not have unique canonical JSON", () => {
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 1n]) {
    assert.throws(
      () => snapshotRegionalR5CompositionInput({ authority: { expectation: invalid } }),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.deepEqual(error.intakePath, ["authority", "expectation"]);
        return true;
      },
      `expected intake to reject ${Object.is(invalid, -0) ? "-0" : String(invalid)}`,
    );
  }
});
