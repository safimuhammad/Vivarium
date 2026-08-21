import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoryMoment } from "../../../presentation/BeatDirector";
import type { PresentedObserverFrame } from "../../../presentation/contracts";
import type { PresentedChronicleWindow } from "../../../presentation/selectors";
import type { EventEnvelopeEntry } from "../../schemas";
import { useChronicleStream, type ChronicleStreamView } from "./useChronicleStream";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function entry(cursor: number, type: string): EventEnvelopeEntry {
  return {
    cursor,
    event: {
      type,
      source: "test",
      payload: {},
      scope: "global",
      region: "nirvana",
      target: null,
      timestamp: 100 + cursor,
    },
    resolved: { actor_id: "wanderer_001", region: "nirvana" },
    snapshot_after: null,
  };
}

function moment(cursor: number, type: string): StoryMoment {
  const evidence = entry(cursor, type);
  return {
    id: `${cursor}:${cursor}:single`,
    firstCursor: cursor,
    lastCursor: cursor,
    evidenceCursors: [cursor],
    evidence: [evidence],
    representative: evidence,
    chainKind: "single",
    priority: "ambient",
    focus: { kind: "agent", id: "wanderer_001" },
  };
}

function frame(sourceKey: string, exactBaseCursor: number): PresentedObserverFrame {
  return {
    runId: "run-1",
    sourceKey,
    revision: 1,
    firstCursor: 0,
    lastCursor: 9,
    source: "fixture",
    ingestedCursor: 9,
    presentedCursor: 9,
    world: {
      exactBaseCursor,
      projectedThroughCursor: 9,
      worldTime: 0,
      agents: [{
        completeness: "exact",
        value: { id: "wanderer_001", name: "Joe", position: "nirvana", status: "alive" },
      }],
      regions: [],
      homes: [],
      ruins: [],
      pendingProposals: [],
    },
    scene: null,
    selection: null,
    backlog: { pendingMoments: 0, firstPendingCursor: null, lastPendingCursor: null, state: "caught-up", label: "" },
    transport: { connection: "live", ingestedCursor: 9, retryable: false },
  };
}

function chronicle(moments: readonly StoryMoment[]): PresentedChronicleWindow {
  return {
    now: moments.at(-1) ?? null,
    previous: moments.slice(0, -1),
    upcoming: [],
    gaps: [],
  };
}

interface HarnessHandle {
  setInput: (next: Readonly<{
    frame: PresentedObserverFrame | null;
    chronicle: PresentedChronicleWindow | null;
    active: boolean;
  }>) => void;
  view: ChronicleStreamView | null;
}

/** Drives the hook through a real React tree with an injected clock. */
function Harness({
  handle,
  now,
  schedule,
}: Readonly<{
  handle: HarnessHandle;
  now: () => number;
  schedule: (callback: () => void, intervalMs: number) => () => void;
}>): ReactElement {
  const [input, setInput] = useState<Readonly<{
    frame: PresentedObserverFrame | null;
    chronicle: PresentedChronicleWindow | null;
    active: boolean;
  }>>({ frame: null, chronicle: null, active: false });
  handle.setInput = setInput;
  handle.view = useChronicleStream({ ...input, now, schedule });
  return <output>{handle.view.events.length}</output>;
}

describe("useChronicleStream", () => {
  it("keeps ingesting while the feed is closed, so history survives closing it", async () => {
    let clock = 0;
    const handle: HarnessHandle = { setInput: () => undefined, view: null };
    await act(async () => root.render(
      <Harness handle={handle} now={() => clock} schedule={() => () => undefined} />,
    ));

    await act(async () => handle.setInput({
      frame: frame("s1", 0),
      chronicle: chronicle([moment(1, "speak")]),
      active: false,
    }));
    expect(handle.view?.events.map((event) => event.cursor)).toEqual([1]);

    clock = 500;
    await act(async () => handle.setInput({
      frame: frame("s1", 0),
      chronicle: chronicle([moment(1, "speak"), moment(2, "attack")]),
      active: false,
    }));
    expect(handle.view?.events.map((event) => event.cursor)).toEqual([1, 2]);
    expect(handle.view?.liveMs).toBe(500);
  });

  it("ticks the age clock only while the feed is on screen", async () => {
    const stop = vi.fn();
    const schedule = vi.fn(() => stop);
    const handle: HarnessHandle = { setInput: () => undefined, view: null };
    await act(async () => root.render(
      <Harness handle={handle} now={() => 0} schedule={schedule} />,
    ));
    expect(schedule).not.toHaveBeenCalled();

    await act(async () => handle.setInput({ frame: null, chronicle: null, active: true }));
    expect(schedule).toHaveBeenCalledTimes(1);

    await act(async () => handle.setInput({ frame: null, chronicle: null, active: false }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("reports a bounded memory bill the surface can print", async () => {
    const handle: HarnessHandle = { setInput: () => undefined, view: null };
    await act(async () => root.render(
      <Harness handle={handle} now={() => 0} schedule={() => () => undefined} />,
    ));
    await act(async () => handle.setInput({
      frame: frame("s1", 0),
      chronicle: chronicle([moment(1, "speak")]),
      active: true,
    }));
    const diagnostics = handle.view!.diagnostics;
    expect(diagnostics.bufferMs).toBe(90_000);
    expect(diagnostics.anchorCount).toBe(1);
    expect(diagnostics.approxBytes).toBeGreaterThan(0);
  });
});
