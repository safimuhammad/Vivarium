import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventEnvelopeEntry } from "../../schemas";
import type { PresentedWorldView } from "../../../presentation/contracts";
import { frameEntityIdDenylist } from "../publicCopy";
import {
  buildFlowItems,
  ChronicleKillfeed,
  fittingCount,
  type ChronicleKillfeedProps,
} from "./ChronicleKillfeed";
import { createChronicleStreamBuffer } from "./streamBuffer";
import type { StreamEvent } from "./streamEvent";
import type { ChronicleStreamView } from "./useChronicleStream";

const DENIED = frameEntityIdDenylist({
  world: { agents: [], homes: [], ruins: [] },
  selection: null,
} as never);

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

function entry(
  cursor: number,
  type: string,
  payload: Readonly<Record<string, unknown>> = {},
  resolved: EventEnvelopeEntry["resolved"] = {},
): EventEnvelopeEntry {
  return {
    cursor,
    event: {
      type,
      source: "test",
      payload: { ...payload },
      scope: "global",
      region: (resolved.region as string | undefined) ?? null,
      target: null,
      timestamp: 1_000 + cursor,
    },
    resolved,
    snapshot_after: null,
  };
}

function spatialTravelEntry(
  cursor: number,
  type: "spatial_travel_started" | "spatial_travel_cancelled" | "spatial_travel_arrived",
): EventEnvelopeEntry {
  const route = [{ x: 32, y: 64 }, { x: 160, y: 64 }];
  const moving = type === "spatial_travel_started";
  const position = moving ? route[0]! : route[1]!;
  return {
    cursor,
    event: {
      type,
      source: "wanderer_001",
      payload: {
        message: "",
        agent_id: "wanderer_001",
        region_id: "nirvana",
        map_id: "nirvana:map-1",
        layout_fingerprint: "map-1",
        travel_id: "journey-1",
        destination_id: "foraging_grove",
        route,
        started_at: 100,
        arrives_at: 120,
        position,
        spatial: {
          version: 1,
          region_id: "nirvana",
          map_id: "nirvana:map-1",
          layout_fingerprint: "map-1",
          x: position.x,
          y: position.y,
          observed_at: 100 + cursor,
          at_landmark: moving ? null : "foraging_grove",
          travel: moving ? {
            id: "journey-1",
            destination_id: "foraging_grove",
            route,
            started_at: 100,
            arrives_at: 120,
          } : null,
        },
        ...(type === "spatial_travel_cancelled" ? { reason: "requested" } : {}),
      },
      scope: "local",
      region: "nirvana",
      target: null,
      timestamp: 1_000 + cursor,
    },
    resolved: { actor_id: "wanderer_001", region: "nirvana" },
    snapshot_after: null,
  };
}

function world(exactBaseCursor: number, projectedThroughCursor: number): PresentedWorldView {
  return {
    exactBaseCursor,
    projectedThroughCursor,
    worldTime: exactBaseCursor,
    agents: [
      { completeness: "exact", value: { id: "wanderer_001", name: "Joe", position: "nirvana", status: "alive" } },
      { completeness: "exact", value: { id: "wanderer_003", name: "Dick", position: "nirvana", status: "alive" } },
    ],
    regions: [{ completeness: "exact", value: {
      name: "nirvana",
      spatial: {
        version: 1,
        region_id: "nirvana",
        map_id: "nirvana:map-1",
        layout_fingerprint: "map-1",
        tile_size: 32,
        landmarks: [{
          id: "foraging_grove",
          name: "Grove of Returns",
          x: 160,
          y: 64,
          affordances: ["energy"],
        }],
        initial_pressure: { populationHighWater: 2, builtFootprintHighWater: 0 },
      },
    } }],
    homes: [],
    ruins: [],
    pendingProposals: [],
  };
}

/** Builds a real buffer at a controlled clock, then the view the surface reads. */
function makeStream(
  batches: readonly (readonly [number, readonly EventEnvelopeEntry[]])[],
): ChronicleStreamView {
  let clock = 0;
  const buffer = createChronicleStreamBuffer({ now: () => clock });
  for (const [at, entries] of batches) {
    clock = at;
    buffer.ingest({
      sourceKey: "s1",
      world: world(0, entries.at(-1)?.cursor ?? 0),
      entries,
      deniedIds: DENIED,
    });
  }
  return Object.freeze({
    events: buffer.getEvents(),
    liveMs: buffer.getLiveMs(),
    floorMs: buffer.getFloorMs(),
    clockMs: clock,
    evictedCount: buffer.getEvictedCount(),
    buffer,
    diagnostics: buffer.diagnostics(),
  });
}

function defaultProps(stream: ChronicleStreamView) {
  return {
    stream,
    gaps: [],
    paused: false,
    speed: 1 as const,
    onPause: vi.fn(),
    onResume: vi.fn(),
    onSpeedChange: vi.fn(),
    onViewCursor: vi.fn(),
    onFocusBeing: vi.fn(),
    onOpenArchive: vi.fn(),
    onClose: vi.fn(),
  };
}

async function render(
  props: ReturnType<typeof defaultProps> & Partial<ChronicleKillfeedProps>,
): Promise<void> {
  await act(async () => root.render(<ChronicleKillfeed {...props} />));
}

function transportPill(): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(".chronicle-killfeed__live");
  if (found === null) throw new Error("no transport pill");
  return found;
}

function cards(): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".chronicle-killfeed__card")];
}

function button(label: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (found === null) throw new Error(`no button labelled ${label}`);
  return found;
}

describe("ChronicleKillfeed event timestamps", () => {
  it("shows UTC event times after run replacement despite an older page clock", async () => {
    let pageMs = 410_200;
    const buffer = createChronicleStreamBuffer({ now: () => pageMs });
    const timedEntry = (cursor: number, timestamp: number): EventEnvelopeEntry => {
      const value = entry(cursor, "speak", { message: "Hello." }, { actor_id: "wanderer_001" });
      return { ...value, event: { ...value.event, timestamp } };
    };
    const view = (): ChronicleStreamView => ({
      events: buffer.getEvents(),
      liveMs: buffer.getLiveMs(),
      floorMs: buffer.getFloorMs(),
      clockMs: pageMs,
      evictedCount: buffer.getEvictedCount(),
      buffer,
      diagnostics: buffer.diagnostics(),
    });
    buffer.ingest({
      sourceKey: "old-run", world: world(0, 1), deniedIds: DENIED,
      entries: [timedEntry(1, 1_789_341_600)],
    });
    await render(defaultProps(view()));

    pageMs = 421_900;
    buffer.ingest({
      sourceKey: "replacement-run", world: world(0, 2), deniedIds: DENIED,
      entries: [timedEntry(1, 1_789_341_765), timedEntry(2, 1_789_341_767)],
    });
    await render(defaultProps(view()));

    expect(cards().map((card) => card.textContent).join(" ")).toContain("23:22:45 UTC");
    expect(cards().map((card) => card.textContent).join(" ")).toContain("23:22:47 UTC");
    expect(cards().map((card) => card.textContent).join(" ")).not.toContain("7:01.9");

    await act(async () => container
      .querySelector<HTMLButtonElement>(".chronicle-killfeed__more")!.click());
    expect(container.querySelector(".chronicle-killfeed__chain")?.textContent)
      .toContain("23:22:47 UTC");
  });
});

describe("ChronicleKillfeed retained history", () => {
  it("shows spatial walking, stop, and arrival cards with a named replay route", async () => {
    const stream = makeStream([
      [0, [spatialTravelEntry(1, "spatial_travel_started")]],
      [200, [spatialTravelEntry(2, "spatial_travel_cancelled")]],
      [400, [spatialTravelEntry(3, "spatial_travel_arrived")]],
    ]);
    const props = defaultProps(stream);
    await render(props);

    const cardCopy = cards().map((card) => card.textContent).join(" ");
    expect(cardCopy).toContain("Joe began walking to Grove of Returns.");
    expect(cardCopy).toContain("Joe came to rest on the way to Grove of Returns.");
    expect(cardCopy).toContain("Joe arrived at Grove of Returns.");
    const route = container.querySelector('[data-event-cursor="1"] [data-travel-route]');
    expect(route?.textContent).toContain("Nirvana");
    expect(route?.textContent).toContain("Grove of Returns");
    expect(route?.textContent).toContain("walking");

    await act(async () => button("Replay from Joe began walking to Grove of Returns.").click());
    expect(props.onViewCursor).toHaveBeenCalledWith(1);
  });

  it("keeps every retained event available in chronological reading order", async () => {
    const entries = Array.from({ length: 28 }, (_, index) => entry(
      index + 1,
      "speak",
      { message: `Line ${index + 1}.` },
      { actor_id: "wanderer_001", region: "nirvana" },
    ));
    await render(defaultProps(makeStream([[0, entries]])));

    expect(cards()).toHaveLength(28);
    expect(cards().map((card) => card.getAttribute("data-event-cursor"))).toEqual(
      entries.map((item) => String(item.cursor)),
    );
  });
});

describe("ChronicleKillfeed expressive event grammar", () => {
  it("renders only grounded quotes, routes, paired people, signed facts, and distinct life notices", async () => {
    const entries = [
      entry(1, "speak", {
        message: "I see you.", target_id: "wanderer_003", region: "warm_springs", speak_energy_cost: 1,
      }, { actor_id: "wanderer_001", target_id: "wanderer_003", region: "warm_springs" }),
      entry(2, "self_talk", { message: "Stay steady.", agent_id: "wanderer_001" }, {
        actor_id: "wanderer_001", region: "warm_springs",
      }),
      entry(3, "agent_entered_region", {
        message: "", agent_id: "wanderer_001", from_region: "warm_springs", to_region: "nirvana",
        move_energy_cost: 2, agent_energy: 8,
      }, { actor_id: "wanderer_001", region: "nirvana" }),
      entry(4, "resource_transferred", {
        message: "", sender_id: "wanderer_001", receiver_id: "wanderer_003", region: "nirvana",
        resource_type: "energy", amount: 5, sender_energy: 8, sender_materials: 0,
        receiver_energy: 12, receiver_materials: 0,
      }, { actor_id: "wanderer_001", target_id: "wanderer_003", region: "nirvana" }),
      entry(5, "home_built", {
        message: "", home_id: "home_001", target_home: "home_001", builder_id: "wanderer_001",
        owner_id: "wanderer_001", region: "nirvana", materials_cost: 20, integrity: 100,
        stakeholders: ["wanderer_001"],
      }, { actor_id: "wanderer_001", region: "nirvana" }),
      entry(6, "agent_paralyzed", {
        message: "", agent_id: "wanderer_003", region: "nirvana", trigger: "attack", energy: 0,
        victim_id: "wanderer_003", attacker_id: "wanderer_001",
      }, { actor_id: "system", target_id: "wanderer_003", region: "nirvana" }),
      entry(7, "agent_died", {
        message: "", victim_id: "wanderer_003", victim_name: "Dick", killer_id: "wanderer_001",
        killer: "wanderer_001", region: "nirvana", attack_damage: 10, attack_energy_cost: 2,
        victim_was_paralyzed: true, looted_energy: 0, looted_materials: 0,
      }, { actor_id: "wanderer_003", target_id: "wanderer_003", region: "nirvana" }),
      entry(8, "agent_born", {
        message: "", child_id: "child_007", child_name: "Martha", parent_ids: ["wanderer_001", "wanderer_003"],
        initiator_id: "wanderer_001", acceptor_id: "wanderer_003", region: "nirvana",
        committed_resources: { energy: 20, materials: 8 }, child_resources: { energy: 10, materials: 4 },
        offspring_multiplier: 1,
      }, { actor_id: "child_007", region: "nirvana" }),
    ];
    await render(defaultProps(makeStream([[0, entries]])));

    expect(container.querySelector("[data-event-cursor='1'] [data-quote-kind='speech']")?.textContent)
      .toContain("I see you.");
    expect(container.querySelector("[data-event-cursor='2'] [data-quote-kind='private-thought']")?.textContent)
      .toContain("Stay steady.");
    expect(container.querySelector("[data-event-cursor='3'] [data-travel-route]")?.textContent)
      .toContain("Warm Springs");
    expect(container.querySelector("[data-event-cursor='3'] [data-travel-route]")?.textContent)
      .toContain("Nirvana");
    expect(container.querySelectorAll("[data-event-cursor='4'] .chronicle-killfeed__portrait"))
      .toHaveLength(2);
    expect(container.querySelector("[data-event-cursor='4'] [data-resource-fact]")?.textContent)
      .toContain("+5 energy");
    expect(container.querySelector("[data-event-cursor='5'] [data-event-grammar='shelter']")?.textContent)
      .toContain("Shelter");
    expect(container.querySelector("[data-event-cursor='6'] [data-lifecycle-state='fallen']"))
      .not.toBeNull();
    expect(container.querySelector("[data-event-cursor='7'] [data-lifecycle-state='dead']"))
      .not.toBeNull();
    expect(container.querySelectorAll("[data-event-cursor='8'] .chronicle-killfeed__portrait"))
      .toHaveLength(3);
  });

  it("previews a long exact quote and discloses its full message without replaying", async () => {
    const message = Array.from({ length: 72 }, (_, index) => `word-${index + 1}`).join(" ");
    const props = defaultProps(makeStream([[0, [entry(1, "self_talk", { message }, {
      actor_id: "wanderer_001", region: "nirvana",
    })]]]));
    await render(props);

    const quote = container.querySelector<HTMLElement>("[data-quote-kind='private-thought']");
    expect(quote?.classList.contains("is-expanded")).toBe(false);
    expect(quote?.querySelector("q")?.textContent).toBe(message);

    await act(async () => button("Read full message").click());
    expect(quote?.classList.contains("is-expanded")).toBe(true);
    expect(button("Show message preview").getAttribute("aria-expanded")).toBe("true");
    expect(props.onViewCursor).not.toHaveBeenCalled();

    await act(async () => container.querySelector<HTMLButtonElement>(
      ".chronicle-killfeed__more",
    )!.click());
    expect(container.querySelector(".chronicle-killfeed__said")?.textContent).toContain(message);
  });
});

describe("ChronicleKillfeed reader controls", () => {
  it("uses parent-provided Nearby and Following contexts without losing World history", async () => {
    const stream = makeStream([[0, [
      entry(1, "speak", { message: "Warm." }, { actor_id: "wanderer_001", region: "warm_springs" }),
      entry(2, "speak", { message: "Nirvana." }, { actor_id: "wanderer_003", region: "nirvana" }),
    ]]]);
    const onFilterChange = vi.fn();
    const props = {
      ...defaultProps(stream),
      filter: "nearby" as const,
      nearbyRegionId: "warm_springs",
      followingBeingId: "wanderer_003",
      onFilterChange,
      cameraControls: <button type="button">Camera: Auto</button>,
    };
    await render(props);

    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.getAttribute("data-event-cursor")).toBe("1");
    expect(container.querySelector("[aria-label='Camera controls']")?.textContent).toContain("Camera: Auto");
    await act(async () => container.querySelector<HTMLButtonElement>("[role='tab'][aria-selected='true']")
      ?.parentElement?.querySelector<HTMLButtonElement>("[role='tab']:last-child")?.click());
    expect(onFilterChange).toHaveBeenCalledWith("following");

    await render({ ...props, filter: "world" });
    expect(cards().map((card) => card.getAttribute("data-event-cursor"))).toEqual(["1", "2"]);
  });

  it("counts only matching rows when a narrowed reader is active", async () => {
    const stream = makeStream([[0, [
      entry(1, "speak", { message: "Here." }, { actor_id: "wanderer_001", region: "warm_springs" }),
      entry(2, "speak", { message: "There." }, { actor_id: "wanderer_003", region: "nirvana" }),
    ]]]);
    await render({
      ...defaultProps(stream),
      filter: "nearby",
      nearbyRegionId: "warm_springs",
    });

    expect(container.querySelector(".chronicle-killfeed__contract")?.textContent)
      .toContain("1 matching event");
    expect(container.querySelector(".chronicle-killfeed__contract")?.textContent)
      .not.toContain("held");
  });

  it("pauses only auto-scroll while the reader looks back", async () => {
    const props = defaultProps(makeStream([[0, [
      entry(1, "speak", { message: "Keep reading." }, { actor_id: "wanderer_001", region: "nirvana" }),
    ]]]));
    await render(props);
    const reader = container.querySelector<HTMLDivElement>(".chronicle-killfeed__reader")!;
    Object.defineProperties(reader, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
    });
    reader.scrollTop = 40;
    await act(async () => reader.dispatchEvent(new Event("scroll", { bubbles: true })));

    expect(reader.dataset["autoscroll"]).toBe("paused");
    expect(props.onViewCursor).not.toHaveBeenCalled();
    expect(container.textContent).toContain("The world continues; new events wait below.");

    await act(async () => button("Resume auto-scroll").click());
    expect(reader.scrollTop).toBe(500);
  });

  it("keeps following new cards when the bounded feed replaces an old card", async () => {
    const at = (cursor: number) => defaultProps(makeStream([[0, [
      entry(cursor, "speak", { message: `Moment ${cursor}.` },
        { actor_id: "wanderer_001", region: "nirvana" }),
    ]]]));
    await render(at(1));
    const reader = container.querySelector<HTMLDivElement>(".chronicle-killfeed__reader")!;
    Object.defineProperties(reader, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
    });
    reader.scrollTop = 400;
    Object.defineProperty(reader, "scrollHeight", { configurable: true, value: 700 });

    // Retention evicted one row as another arrived: count is still one, but
    // the newer, taller card must remain attached to the live edge.
    await render(at(2));
    expect(cards()).toHaveLength(1);
    expect(reader.scrollTop).toBe(700);
    expect(reader.dataset["autoscroll"]).toBe("on");

    reader.scrollTop = 40;
    await act(async () => reader.dispatchEvent(new Event("scroll", { bubbles: true })));
    await render(at(3));
    expect(reader.scrollTop).toBe(40);
    expect(reader.dataset["autoscroll"]).toBe("paused");
  });
});

describe("ChronicleKillfeed leading edge", () => {
  // The Chronicle absorbed the retired bottom-right NOW card (owner direction,
  // Safi, 2026-08-22: one UI, not two). These cases are that card's contract,
  // re-proved on the surface that took it over.
  const twoEvents = () => makeStream([
    [0, [entry(1, "speak", {}, { actor_id: "wanderer_001", region: "nirvana" })]],
    [4_000, [entry(2, "home_built", {}, { actor_id: "wanderer_003", region: "nirvana" })]],
  ]);

  it("marks the newest entry NOW while it belongs to the moment still playing", async () => {
    const stream = twoEvents();
    await render({
      ...defaultProps(stream),
      activeMomentRange: { firstCursor: 2, lastCursor: 2 },
    });

    const marked = [...container.querySelectorAll("[data-chronicle-now]")];
    expect(marked).toHaveLength(1);
    expect(marked[0]!.getAttribute("data-event-cursor")).toBe("2");
    expect(marked[0]!.getAttribute("data-chronicle-now")).toBe("Now");
    expect(marked[0]!.getAttribute("aria-current")).toBe("true");
    expect(marked[0]!.textContent).toContain("Now");
  });

  it("calls the newest entry LATEST when no moment is playing", async () => {
    await render({ ...defaultProps(twoEvents()), activeMomentRange: null });
    const marked = container.querySelector("[data-chronicle-now]");
    expect(marked?.getAttribute("data-chronicle-now")).toBe("Latest");
  });

  it("calls it LATEST when the newest entry is outside the playing moment", async () => {
    await render({
      ...defaultProps(twoEvents()),
      activeMomentRange: { firstCursor: 1, lastCursor: 1 },
    });
    expect(container.querySelector("[data-chronicle-now]")?.getAttribute("data-chronicle-now"))
      .toBe("Latest");
  });

  it("views the leading moment WITHOUT rewinding off live", async () => {
    // Every other card seeks back a beat so the viewer sees the event arrive.
    // Doing that to the present tense would drop the feed behind live and hang a
    // "Behind live" banner over a viewer who only asked to look at now.
    const stream = twoEvents();
    const props = defaultProps(stream);
    await render({ ...props, activeMomentRange: { firstCursor: 2, lastCursor: 2 } });

    const leading = container.querySelector<HTMLElement>("[data-chronicle-now]")!;
    await act(async () => leading.querySelector<HTMLButtonElement>(
      ".chronicle-killfeed__replay",
    )!.click());

    expect(props.onViewCursor).toHaveBeenCalledOnce();
    expect(props.onViewCursor).toHaveBeenCalledWith(2);
    expect(container.querySelector(".chronicle-killfeed__behind")).toBeNull();
    expect(container.querySelector(".chronicle-killfeed__live")?.getAttribute("aria-pressed"))
      .toBe("true");
  });

  it("still rewinds for an older card, and then marks nothing as now", async () => {
    const stream = twoEvents();
    const props = defaultProps(stream);
    await render({ ...props, activeMomentRange: { firstCursor: 2, lastCursor: 2 } });

    const older = container.querySelector<HTMLElement>("[data-event-cursor='1']")!;
    await act(async () => older.querySelector<HTMLButtonElement>(
      ".chronicle-killfeed__replay",
    )!.click());

    expect(props.onViewCursor).toHaveBeenCalledWith(1);
    // Rewound: the newest card on screen is one the viewer chose to look at, not
    // the world's current moment, so nothing may claim to be the present tense.
    expect(container.querySelector(".chronicle-killfeed__behind")).not.toBeNull();
    expect(container.querySelector("[data-chronicle-now]")).toBeNull();
  });

  it("navigates the world exactly once per press, not once per nested handler", async () => {
    const stream = twoEvents();
    const props = defaultProps(stream);
    await render({ ...props, activeMomentRange: null });
    const leading = container.querySelector<HTMLElement>("[data-chronicle-now]")!;
    await act(async () => leading.querySelector<HTMLButtonElement>(
      ".chronicle-killfeed__replay",
    )!.click());
    expect(props.onViewCursor).toHaveBeenCalledOnce();
  });
});

describe("ChronicleKillfeed", () => {
  // The pill used to read only `playhead.atLive` — a position in the buffer — so it
  // said LIVE over a finished run, a dead socket and a frozen stage alike. That is
  // exactly what the live-replay route caught it doing for 150 seconds.
  it.each([
    ["quiet", "Quiet", "is-quiet"],
    ["behind", "Behind", "is-behind"],
    ["disconnected", "Offline", "is-disconnected"],
    ["ended", "Ended", "is-ended"],
  ] as const)("shows %s on the transport pill instead of an unconditional LIVE", async (
    state,
    label,
    className,
  ) => {
    const stream = makeStream([[0, [entry(1, "speak", {}, { actor_id: "wanderer_001", region: "nirvana" })]]]);
    await render({
      ...defaultProps(stream),
      liveness: { state, label, detail: `${label} detail`, retryable: false },
    });

    const pill = transportPill();
    expect(pill.textContent).toContain(label);
    expect(pill.className).toContain(className);
    expect(pill.className).not.toContain("is-on");
    expect(pill.title).toBe(`${label} detail`);
  });

  it("offers a reconnect only when the reading says one is worth trying", async () => {
    const stream = makeStream([[0, [entry(1, "speak", {}, { actor_id: "wanderer_001", region: "nirvana" })]]]);
    const onReconnect = vi.fn();
    await render({
      ...defaultProps(stream),
      liveness: { state: "disconnected", label: "Offline", detail: "gone", retryable: true },
      onReconnect,
    });
    await act(async () => button("Reconnect now").click());
    expect(onReconnect).toHaveBeenCalledOnce();

    await render({
      ...defaultProps(stream),
      liveness: { state: "quiet", label: "Quiet", detail: "thinking", retryable: false },
      onReconnect,
    });
    expect(container.querySelector('button[aria-label="Reconnect now"]')).toBeNull();
  });

  // A silent zero is the worst failure mode a live view has: six of eight recorded
  // runs presented 0 of ~544 moments while the frame still read "live".
  it("surfaces absorbed presentation faults instead of swallowing them", async () => {
    const stream = makeStream([[0, [entry(1, "speak", {}, { actor_id: "wanderer_001", region: "nirvana" })]]]);
    await render({
      ...defaultProps(stream),
      notices: [{
        kind: "unpresentable-moment",
        detail: "Some of what happened could not be staged and was skipped.",
        firstCursor: 4,
        lastCursor: 61,
        count: 12,
      }],
    });

    const notices = container.querySelector(".chronicle-killfeed__notices");
    expect(notices?.textContent).toContain("could not be staged");
    expect(notices?.textContent).toContain("12×");
    expect(notices?.textContent).toContain("4–61");
  });


  it("replays from anywhere on a card, not only from its sentence", async () => {
    const stream = makeStream([
      [0, [entry(1, "speak", {}, { actor_id: "wanderer_001", region: "nirvana" })]],
      [9_000, [entry(2, "attack", { damage: 30 }, { actor_id: "wanderer_001", target_id: "wanderer_003", region: "nirvana" })]],
    ]);
    const props = defaultProps(stream);
    await render(props);

    await act(async () => cards()[0]!.click());
    expect(props.onViewCursor).toHaveBeenCalledWith(1);
    expect(container.querySelector(".chronicle-killfeed__behind")).not.toBeNull();
  });

  it("shows every delivered event as its own card, newest last", async () => {
    const stream = makeStream([
      [0, [entry(1, "resource_changed", { resource_type: "energy", amount: 2 }, { actor_id: "wanderer_001", region: "nirvana" })]],
      [400, [entry(2, "attack", { damage: 30 }, { actor_id: "wanderer_001", target_id: "wanderer_003", region: "nirvana" })]],
      [800, [entry(3, "agent_paralyzed", { victim_id: "wanderer_003", attacker_id: "wanderer_001" }, { region: "nirvana" })]],
    ]);
    await render(defaultProps(stream));

    const rendered = cards();
    expect(rendered).toHaveLength(3);
    expect(rendered.map((card) => card.dataset["eventCursor"])).toEqual(["1", "2", "3"]);
    expect(rendered.at(-1)?.textContent).toContain("Dick has fallen.");
  });

  it("breaks a rupture out of the column and leaves progress flush", async () => {
    const stream = makeStream([
      [0, [entry(1, "home_built", {}, { actor_id: "wanderer_001", region: "nirvana" })]],
      [400, [entry(2, "home_collapsed", { remnant_materials: 40 }, { home_id: "home_001", region: "nirvana" })]],
      [800, [entry(3, "agent_born", { child_name: "Martha" }, { region: "nirvana" })]],
    ]);
    await render(defaultProps(stream));

    expect(cards().map((card) => card.dataset["posture"]))
      .toEqual(["progress", "rupture", "arrival"]);
    expect(container.querySelectorAll(".chronicle-killfeed__tear")).toHaveLength(1);
  });

  it("clicking a card rewinds the playhead and navigates the world", async () => {
    const stream = makeStream([
      [0, [entry(1, "speak", { message: "Hold." }, { actor_id: "wanderer_001", region: "nirvana" })]],
      [9_000, [entry(2, "attack", { damage: 30 }, { actor_id: "wanderer_001", target_id: "wanderer_003", region: "nirvana" })]],
    ]);
    const props = defaultProps(stream);
    await render(props);

    expect(container.querySelector(".chronicle-killfeed__behind")).toBeNull();
    await act(async () => button("Replay from Joe spoke at Nirvana.").click());

    expect(props.onViewCursor).toHaveBeenCalledWith(1);
    const behind = container.querySelector(".chronicle-killfeed__behind");
    expect(behind?.textContent).toContain("Behind live");
    expect(behind?.textContent).toContain("1 event received since");
    // The feed itself re-derives: the later strike is no longer on screen.
    expect(cards()).toHaveLength(1);
  });

  it("follows a restored historical source without applying the old feed seek twice", async () => {
    const stream = makeStream([
      [0, [entry(1, "speak", { message: "Hold." }, { actor_id: "wanderer_001", region: "nirvana" })]],
      [9_000, [entry(2, "attack", { damage: 30 }, { actor_id: "wanderer_001", target_id: "wanderer_003", region: "nirvana" })]],
    ]);
    const props = defaultProps(stream);
    const onReturnLive = vi.fn();
    await render(props);
    await act(async () => button("Replay from Joe spoke at Nirvana.").click());
    expect(cards()).toHaveLength(1);

    // The session has restored its own clock and releases only evidence true
    // at that clock. The old feed offset must not filter it a second time.
    await render({ ...props, historicalSourceKey: "archive:recording:replay-1", onReturnLive });
    expect(cards()).toHaveLength(2);
    expect(container.querySelector(".chronicle-killfeed__behind")?.textContent)
      .toContain("Recorded moment");
    expect(container.querySelector(".chronicle-killfeed__behind")?.textContent)
      .not.toContain("Behind live");
    expect(container.querySelector(".chronicle-killfeed__reader")?.getAttribute("data-autoscroll"))
      .toBe("on");
    expect(container.querySelector(".chronicle-killfeed__still")).toBeNull();
    await act(async () => button("Return to current view").click());
    expect(onReturnLive).toHaveBeenCalledTimes(1);
  });

  it("leaves a repeated spatial replay to its world clock even when the source key is reused", async () => {
    const stream = makeStream([
      [0, [spatialTravelEntry(1, "spatial_travel_started")]],
      [9_000, [spatialTravelEntry(2, "spatial_travel_cancelled")]],
    ]);
    const props = { ...defaultProps(stream), historicalSourceKey: "archive:recording:replay-1" };
    await render(props);
    await act(async () => button("Replay from Joe began walking to Grove of Returns.").click());
    await render(props);
    expect(props.onViewCursor).toHaveBeenCalledWith(1);
    // Only the authoritative replacement stream may remove the later stop.
    expect(cards()).toHaveLength(2);
  });

  it("returns to the leading edge as a jump when LIVE is pressed", async () => {
    const stream = makeStream([
      [0, [entry(1, "speak", {}, { actor_id: "wanderer_001", region: "nirvana" })]],
      [9_000, [entry(2, "attack", { damage: 30 }, { actor_id: "wanderer_001", target_id: "wanderer_003", region: "nirvana" })]],
    ]);
    await render(defaultProps(stream));
    await act(async () => button("Replay from Joe spoke at Nirvana.").click());
    expect(container.querySelector(".chronicle-killfeed__live.is-on")).toBeNull();

    await act(async () => button("Return to live").click());
    expect(container.querySelector(".chronicle-killfeed__behind")).toBeNull();
    expect(container.querySelector(".chronicle-killfeed__live.is-on")).not.toBeNull();
    expect(cards()).toHaveLength(2);
  });

  it("follows a being, and refuses honestly when they are gone", async () => {
    const stream = makeStream([
      [0, [entry(1, "attack", { damage: 30 }, { actor_id: "wanderer_001", target_id: "wanderer_003", region: "nirvana" })]],
      [200, [entry(2, "agent_died", { victim_id: "wanderer_003", killer_id: "wanderer_001" }, { region: "nirvana" })]],
      [400, [entry(3, "agent_decayed", {}, { actor_id: "wanderer_003", region: "nirvana" })]],
    ]);
    const props = defaultProps(stream);
    await render(props);

    await act(async () => button("Follow Joe").click());
    // Following must not also replay: the whole card is the replay target, so a
    // chip inside it has to stop the click on its way past.
    expect(props.onViewCursor).not.toHaveBeenCalled();
    expect(container.querySelector(".chronicle-killfeed__behind")).toBeNull();
    expect(props.onFocusBeing).toHaveBeenCalledWith("wanderer_001");
    expect(container.querySelector(".chronicle-killfeed__lens")?.textContent)
      .toContain("Joe is at Nirvana now.");

    const gone = container.querySelector<HTMLButtonElement>(".chronicle-killfeed__being.is-gone");
    expect(gone?.disabled).toBe(true);
    expect(gone?.getAttribute("aria-label")).toContain("There is no one to follow");
  });

  it("uses the controlled camera follow reading, including an explicit released state", async () => {
    const stream = makeStream([[0, [entry(1, "speak", { message: "Here." }, {
      actor_id: "wanderer_001", region: "nirvana",
    })]]]);
    const props = defaultProps(stream);
    const onStopFollowing = vi.fn();
    await render(props);
    await act(async () => button("Follow Joe").click());
    expect(container.querySelector(".chronicle-killfeed__lens")?.textContent).toContain("Joe is at Nirvana now.");

    await render({ ...props, followingBeingId: null, onStopFollowing });
    expect(container.querySelector(".chronicle-killfeed__lens")).toBeNull();
    expect(container.querySelector(".chronicle-killfeed__portrait.is-following")).toBeNull();

    await render({ ...props, followingBeingId: "wanderer_001", onStopFollowing });
    expect(container.querySelector(".chronicle-killfeed__lens")?.textContent).toContain("Joe is at Nirvana now.");
    expect(container.querySelector(".chronicle-killfeed__portrait.is-following")).not.toBeNull();
    await act(async () => button("Stop following").click());
    expect(onStopFollowing).toHaveBeenCalledOnce();
  });

  it("does not offer current follow for a body, a decayed being, or an unlocated identity", async () => {
    const stream = makeStream([
      [0, [entry(1, "agent_died", {
        victim_id: "wanderer_003", killer_id: "wanderer_001",
      }, { actor_id: "wanderer_001", target_id: "wanderer_003", region: "nirvana" })]],
      [200, [entry(2, "agent_decayed", {}, {
        actor_id: "decayed_002", region: "nirvana",
      })]],
      [400, [entry(3, "speak", { message: "Is anyone there?" }, {
        actor_id: "unlocated_999", region: "nirvana",
      })]],
    ]);
    await render(defaultProps(stream));

    const deathPortrait = container.querySelector<HTMLButtonElement>(
      '[data-event-cursor="1"] .chronicle-killfeed__portrait.is-gone',
    );
    expect(deathPortrait?.disabled).toBe(true);
    expect(deathPortrait?.getAttribute("aria-label")).toContain("There is no present being to follow");

    for (const cursor of ["2", "3"]) {
      const action = container.querySelector<HTMLButtonElement>(
        `[data-event-cursor="${cursor}"] .chronicle-killfeed__card-actions button[aria-label^="Follow "]`,
      );
      expect(action).toBeNull();
      const portrait = container.querySelector<HTMLButtonElement>(
        `[data-event-cursor="${cursor}"] .chronicle-killfeed__portrait`,
      );
      expect(portrait?.disabled).toBe(true);
    }
  });

  it("carries the standing conditions a decaying feed would lose", async () => {
    const stream = makeStream([
      [0, [entry(1, "home_breached", { integrity: 12 }, { actor_id: "wanderer_001", home_id: "home_001", region: "nirvana" })]],
      [200, [entry(2, "agent_paralyzed", { victim_id: "wanderer_003", attacker_id: "wanderer_001" }, { region: "nirvana" })]],
    ]);
    await render(defaultProps(stream));

    const tags = [...container.querySelectorAll(".chronicle-killfeed__condition span")]
      .map((node) => node.textContent);
    expect(tags).toContain("wall open");
    expect(tags).toContain("fallen");
  });

  it("opens a detail panel built only from the payload the world emitted", async () => {
    const stream = makeStream([
      [0, [entry(1, "home_thieved", {
        loot_shares: { wanderer_002: 20, wanderer_004: 20 },
        loot: { materials: 40 },
      }, { actor_id: "wanderer_001", home_id: "home_001", region: "nirvana" })]],
    ]);
    const props = defaultProps(stream);
    await render(props);
    expect(container.querySelector(".chronicle-killfeed__detail")).toBeNull();

    await act(async () => container
      .querySelector<HTMLButtonElement>(".chronicle-killfeed__more")!.click());
    // Opening the detail must not replay either.
    expect(props.onViewCursor).not.toHaveBeenCalled();
    const detail = container.querySelector(".chronicle-killfeed__detail");
    expect(detail?.textContent).toContain("split");
    expect(detail?.textContent).toContain("home thieved");
    // No coordinates exist in any payload, so none can be shown.
    expect(detail?.textContent).not.toMatch(/\bx:|\by:/u);
  });

  it("keeps the transport controls the old bottom bar used to carry", async () => {
    const stream = makeStream([[0, [entry(1, "speak", {}, { actor_id: "wanderer_001" })]]]);
    const props = defaultProps(stream);
    await render(props);

    await act(async () => button("Pause view").click());
    expect(props.onPause).toHaveBeenCalledTimes(1);
    const speed = container.querySelector<HTMLSelectElement>('select[aria-label="View speed"]');
    expect(speed).not.toBeNull();
    expect([...speed!.options].map((option) => option.value)).toEqual(["0.5", "1", "1.5", "2"]);
  });

  it("says the world is quiet rather than showing an empty band", async () => {
    await render(defaultProps(makeStream([])));
    expect(container.querySelector(".chronicle-killfeed__quiet")?.textContent)
      .toBe("The world is quiet.");
  });
});

describe("buildFlowItems", () => {
  const at = (ms: number, cursor: number): StreamEvent =>
    ({ id: `s:${cursor}`, cursor, atMs: ms, regionId: "nirvana" } as StreamEvent);

  it("caps a run of five or more inside 700ms with a burst heading", () => {
    const items = buildFlowItems([
      at(0, 1), at(100, 2), at(200, 3), at(300, 4), at(400, 5),
    ]);
    expect(items[0]).toMatchObject({ kind: "burst", count: 5 });
    expect(items.filter((item) => item.kind === "card")).toHaveLength(5);
  });

  it("leaves a lull uncapped", () => {
    const items = buildFlowItems([at(0, 1), at(4_000, 2), at(9_000, 3)]);
    expect(items.every((item) => item.kind === "card")).toBe(true);
  });
});

describe("fittingCount", () => {
  it("keeps only whole cards, counted from the newest backwards", () => {
    // 420px band, 60px cards: seven fit exactly, the eighth would not.
    expect(fittingCount(Array.from({ length: 20 }, () => 60), 420, 24)).toBe(7);
    expect(fittingCount(Array.from({ length: 20 }, () => 60), 419, 24)).toBe(6);
  });

  it("counts the real heights it is given, not an average", () => {
    // A birth card is nearly twice a one-line card; the band must lose a card
    // when one arrives, which a fixed count would never notice.
    expect(fittingCount([60, 60, 60, 60, 60, 60, 85], 420, 24)).toBe(6);
  });

  it("never renders more than the DOM ceiling", () => {
    expect(fittingCount(Array.from({ length: 400 }, () => 1), 10_000, 24)).toBe(24);
  });

  it("shows one clipped card rather than an empty band", () => {
    expect(fittingCount([900], 420, 24)).toBe(1);
  });

  it("falls back to the ceiling where there is no layout to measure", () => {
    // jsdom reports 0 for every box, and the band is unmeasurable while closed.
    expect(fittingCount([0, 0, 0], 0, 24)).toBe(24);
    expect(fittingCount([0, 0, 0], Number.NaN, 24)).toBe(24);
  });
});
