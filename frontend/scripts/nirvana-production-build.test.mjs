import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestUrl = new URL("../dist/.vite/manifest.json", import.meta.url);

test("the built frontend has exactly two isolated HTML entries", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const htmlEntries = Object.entries(manifest)
    .filter(([, record]) => record.isEntry === true)
    .map(([key]) => key)
    .sort();

  assert.deepEqual(htmlEntries, ["index.html", "nirvana.html"]);

  const defaultClosure = builtClosure(manifest, "index.html");
  const nirvanaClosure = builtClosure(manifest, "nirvana.html");
  assert.equal(defaultClosure.has("nirvana.html"), false);
  assert.equal(nirvanaClosure.has("index.html"), false);
});

function builtClosure(manifest, entryKey) {
  const pending = [entryKey];
  const seen = new Set();
  while (pending.length > 0) {
    const key = pending.pop();
    if (key === undefined || seen.has(key)) continue;
    const record = manifest[key];
    assert.notEqual(record, undefined, `missing manifest record ${key}`);
    seen.add(key);
    pending.push(...(record.imports ?? []), ...(record.dynamicImports ?? []));
  }
  return seen;
}
