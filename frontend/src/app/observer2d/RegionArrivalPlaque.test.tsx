import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RegionArrivalPlaque } from "./RegionArrivalPlaque";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => vi.useRealTimers());

describe("RegionArrivalPlaque", () => {
  it("briefly presents first arrival and restarts for a changed observed region", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(
      <RegionArrivalPlaque regionName="Nirvana" reducedMotion={false} />,
    ));

    const liveRegion = container.querySelector<HTMLElement>("[data-region-arrival]")!;
    expect(liveRegion.getAttribute("aria-live")).toBe("polite");
    expect(liveRegion.querySelector("strong")?.textContent).toBe("NIRVANA");
    expect(liveRegion.querySelector("button, [tabindex]")).toBeNull();

    await act(async () => vi.advanceTimersByTime(1_800));
    expect(liveRegion.querySelector("strong")).toBeNull();

    await act(async () => root.render(
      <RegionArrivalPlaque regionName="Warm Springs" reducedMotion={true} />,
    ));
    expect(liveRegion.querySelector("strong")?.textContent).toBe("WARM SPRINGS");
    expect(liveRegion.dataset.reducedMotion).toBe("true");

    await act(async () => root.unmount());
  });
});
