import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const FRONTEND_ROOT = process.cwd();
const PILOT_HTML = resolve(FRONTEND_ROOT, "nirvana-pilot.html");
const PILOT_ENTRY = resolve(FRONTEND_ROOT, "src/qa/nirvanaV2Pilot/entry.tsx");
const PRODUCTION_HTML = resolve(FRONTEND_ROOT, "index.html");

describe("Nirvana V2 pilot dependency closure", () => {
  it("keeps the atlas pilot behind its own development entry", () => {
    expect(existsSync(PILOT_HTML), "the pilot HTML entry must exist").toBe(true);
    expect(existsSync(PILOT_ENTRY), "the pilot React entry must exist").toBe(true);

    const pilotHtml = readFileSync(PILOT_HTML, "utf8");
    const productionHtml = readFileSync(PRODUCTION_HTML, "utf8");

    expect(pilotHtml).toMatch(/<main[^>]+id=["']root["']/);
    expect(pilotHtml).toMatch(
      /<script[^>]+type=["']module["'][^>]+src=["']\/src\/qa\/nirvanaV2Pilot\/entry\.tsx["']/,
    );
    expect(pilotHtml).not.toMatch(/chronicle|Vivarium2DApp|LivingAtlasApp|backend|provider/i);

    expect(productionHtml).toMatch(/src=["']\/src\/main\.tsx["']/);
    expect(productionHtml).not.toMatch(/nirvana-pilot|nirvanaV2Pilot/);
  });
});
