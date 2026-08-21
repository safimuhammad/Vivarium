import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const FRONTEND_ROOT = process.cwd();
const PILOT_HTML = resolve(FRONTEND_ROOT, "valley-pilot.html");
const PILOT_ENTRY = resolve(FRONTEND_ROOT, "src/qa/valleyPilot/entry.tsx");
const PRODUCTION_HTML = resolve(FRONTEND_ROOT, "index.html");
const NIRVANA_PRODUCTION_HTML = resolve(FRONTEND_ROOT, "nirvana.html");
const VITE_CONFIG = resolve(FRONTEND_ROOT, "vite.config.ts");

describe("Valley pilot dependency closure", () => {
  it("keeps the valley terrain viewer behind its own development-only entry", () => {
    expect(existsSync(PILOT_HTML), "the pilot HTML entry must exist").toBe(true);
    expect(existsSync(PILOT_ENTRY), "the pilot React entry must exist").toBe(true);

    const pilotHtml = readFileSync(PILOT_HTML, "utf8");
    const productionHtml = readFileSync(PRODUCTION_HTML, "utf8");
    const nirvanaProductionHtml = readFileSync(NIRVANA_PRODUCTION_HTML, "utf8");

    expect(pilotHtml).toMatch(/<main[^>]+id=["']root["']/);
    expect(pilotHtml).toMatch(
      /<script[^>]+type=["']module["'][^>]+src=["']\/src\/qa\/valleyPilot\/entry\.tsx["']/,
    );
    expect(pilotHtml).not.toMatch(/chronicle|Vivarium2DApp|LivingAtlasApp|backend|provider/i);

    expect(productionHtml).toMatch(/src=["']\/src\/main\.tsx["']/);
    expect(productionHtml).not.toMatch(/valley-pilot|valleyPilot/i);
    expect(nirvanaProductionHtml).not.toMatch(/valley-pilot|valleyPilot/i);
  });

  it("is not one of the two production build inputs", () => {
    const config = readFileSync(VITE_CONFIG, "utf8");
    const inputBlock = config.match(/rollupOptions:\s*{\s*input:\s*{([\s\S]*?)}/);
    expect(inputBlock, "vite.config.ts must declare rollupOptions.input").not.toBeNull();
    const inputSource = inputBlock?.[1] ?? "";
    expect(inputSource).toMatch(/index:/);
    expect(inputSource).toMatch(/nirvana:/);
    expect(inputSource).not.toMatch(/valley/i);
  });
});
