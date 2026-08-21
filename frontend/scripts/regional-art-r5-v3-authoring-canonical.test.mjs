/** Regression proof for the self-authenticating V3 authoring identity. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  REGIONAL_R5_V3_ATOMIC_LITERAL_AUTHORITY,
} from "./fixtures/regional-art-r5-v3-atomic-literal-authority.mjs";
import { buildRegionalR5V3AtomicSourceMasters } from "./pack-2d-production-assets.mjs";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort(compareText).map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalDigest(value) {
  return createHash("sha256").update(Buffer.from(canonicalJson(value))).digest("hex");
}

test("V3 authoring identity authenticates its closed predecessor body", async () => {
  const { authoringIdentity } = await buildRegionalR5V3AtomicSourceMasters({
    authority: REGIONAL_R5_V3_ATOMIC_LITERAL_AUTHORITY,
  });
  const { canonicalSha256, ...body } = authoringIdentity;
  assert.deepEqual(Object.keys(authoringIdentity).sort(compareText), [
    "authoritySha256",
    "canonicalSha256",
    "landmarkPortReceiptSha256",
    "masterSetSha256",
    "placementSha256",
    "receiptSha256",
    "schema",
  ]);
  assert.equal(canonicalSha256, canonicalDigest(body));
});
