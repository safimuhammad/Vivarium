import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { FollowShortcuts } from "./FollowShortcuts";
import {
  createSemanticWorldStore,
  type SemanticSubjectView,
  type SemanticWorldView,
} from "./semanticWorld";
import type {
  FollowAgentFact,
  FollowCandidateView,
  FollowRosterView,
} from "./followSubject";
import type { StreamEvent } from "./chronicleStream/streamEvent";
import type { FrameIdentity } from "../../presentation/contracts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function subject(
  key: string,
  action = "No active action",
): SemanticSubjectView {
  return {
    token: "token-" + key,
    kind: "agent",
    name: key.replace(/^./u, (value) => value.toUpperCase()),
    status: "Alive",
    position: "Nirvana, column 2, row 3",
    currentAction: action,
    selected: false,
    canFollow: true,
  };
}

function fact(
  key: string,
  regionKey = "nirvana",
  overrides: Partial<FollowAgentFact> = {},
): FollowAgentFact {
  return {
    name: key.replace(/^./u, (value) => value.toUpperCase()),
    regionKey,
    living: true,
    dead: false,
    reachable: true,
    ...overrides,
  };
}

function makeRoster(
  keys: readonly string[],
  regions: Readonly<Record<string, string>> = {},
): FollowRosterView {
  const candidates: FollowCandidateView[] = keys.map((key) => {
    const regionKey = regions[key] ?? "nirvana";
    return {
      key,
      name: key.replace(/^./u, (value) => value.toUpperCase()),
      regionKey,
      regionDisplayName: regionKey === "nirvana" ? "Nirvana" : "Warm Springs",
    };
  });
  return {
    candidates,
    byKey: new Map(candidates.map((candidate) => [
      candidate.key,
      fact(candidate.key, candidate.regionKey),
    ])),
  };
}

function event(key: string, atMs: number, cursor: number): StreamEvent {
  return {
    id: "stream:" + cursor,
    cursor,
    type: "speak",
    mapping: {} as StreamEvent["mapping"],
    catalog: {} as StreamEvent["catalog"],
    kind: "speech",
    glyph: "quote",
    family: "world",
    tier: "murmur",
    accent: "#8a8270",
    posture: "progress",
    notable: false,
    actorId: key,
    actorName: key,
    actorHue: "#43607f",
    targetId: null,
    targetName: null,
    targetHue: null,
    regionId: "nirvana",
    regionLabel: "Nirvana",
    homeId: null,
    narration: { verb: "spoke", line: key + " spoke.", detail: null, quote: null },
    participants: [key],
    baseSalience: 90,
    stateChange: [],
    atMs,
    payload: {},
    wallTimestamp: null,
    scope: "global",
    source: "test",
  };
}

function world(subjects: readonly SemanticSubjectView[]): SemanticWorldView {
  return {
    frameIdentity: {
      runId: "run",
      sourceKey: "live:run",
      revision: 1,
      firstCursor: 0,
      lastCursor: 1,
    },
    subjects,
  };
}

function render(
  store: ReturnType<typeof createSemanticWorldStore>,
  roster: FollowRosterView,
  onFollow: (key: string) => void,
  events: readonly StreamEvent[] = [],
  followedKey: string | null = null,
  frameIdentity?: FrameIdentity,
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const renderProps = (nextEvents = events): void => {
    root.render(
      <FollowShortcuts
        store={store}
        resolveAgentKey={(token) => token.replace("token-", "")}
        roster={roster}
        events={nextEvents}
        followedKey={followedKey}
        observedRegionKey="nirvana"
        frameIdentity={frameIdentity}
        onFollow={onFollow}
      />,
    );
  };
  return { container, root, renderProps };
}

describe("FollowShortcuts", () => {
  it("subscribes to semantic subjects, renders at most four cards, and calls the opaque key on click", async () => {
    const store = createSemanticWorldStore();
    store.publish(world([
      subject("aster", "Speaking"),
      subject("briar"),
      subject("cinder"),
      subject("dove"),
      subject("ember"),
    ]));
    const onFollow = vi.fn();
    const { container, root, renderProps } = render(
      store,
      makeRoster(["aster", "briar", "cinder", "dove", "ember"]),
      onFollow,
    );

    await act(async () => renderProps());

    const buttons = [...container.querySelectorAll<HTMLButtonElement>(
      "[data-follow-shortcut]",
    )];
    expect(buttons).toHaveLength(4);
    expect(container.textContent).toContain("Speaking");
    expect(container.innerHTML).not.toContain("token-");
    expect(container.innerHTML).not.toContain("aster");
    const aster = buttons.find((button) => button.textContent?.includes("Aster"));
    expect(aster).toBeDefined();

    await act(async () => aster?.click());
    expect(onFollow).toHaveBeenCalledWith("aster");
    await act(async () => root.unmount());
  });

  it("marks the followed card active and shows an explicit region for a recent remote being", async () => {
    const store = createSemanticWorldStore();
    store.publish(world([subject("aster")]));
    const { container, root, renderProps } = render(
      store,
      makeRoster(["aster", "briar"], { briar: "warm_springs" }),
      vi.fn(),
      [event("briar", 9_500, 3)],
      "briar",
    );

    await act(async () => renderProps());

    const active = container.querySelector<HTMLButtonElement>("[aria-pressed='true']");
    expect(active?.textContent).toContain("Briar");
    expect(active?.textContent).toContain("Warm Springs");
    expect(active?.getAttribute("aria-label")).toContain("Warm Springs");
    await act(async () => root.unmount());
  });

  it("revalidates removal or death immediately before invoking the follow callback", async () => {
    const store = createSemanticWorldStore();
    store.publish(world([subject("aster")]));
    const onFollow = vi.fn();
    const roster = makeRoster(["aster"]);
    const { container, root, renderProps } = render(store, roster, onFollow);
    await act(async () => renderProps());

    const button = container.querySelector<HTMLButtonElement>("[data-follow-shortcut]")!;
    (roster.byKey as Map<string, FollowAgentFact>).set(
      "aster",
      fact("aster", "nirvana", { living: false, dead: true }),
    );
    await act(async () => button.click());

    expect(onFollow).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("keeps the focused shortcut node while a newly active candidate arrives", async () => {
    const store = createSemanticWorldStore();
    store.publish(world([
      subject("aster"), subject("briar"), subject("cinder"), subject("dove"),
    ]));
    const roster = makeRoster(["aster", "briar", "cinder", "dove", "ember"]);
    const { container, root, renderProps } = render(store, roster, vi.fn());
    document.body.append(container);
    await act(async () => renderProps());
    const focused = container.querySelector<HTMLButtonElement>(
      "[data-follow-shortcut][aria-label^='Follow Dove']",
    )!;
    focused.focus();

    await act(async () => {
      store.publish(world([
        subject("aster"), subject("briar"), subject("cinder"), subject("dove"),
        subject("ember", "Speaking"),
      ]));
      renderProps([event("ember", 10_000, 90)]);
    });

    const after = container.querySelector<HTMLButtonElement>(
      "[data-follow-shortcut][aria-label^='Follow Dove']",
    );
    expect(after).toBe(focused);
    expect(document.activeElement).toBe(focused);
    expect(container.querySelectorAll("[data-follow-shortcut]")).toHaveLength(4);
    await act(async () => root.unmount());
    container.remove();
  });

  it("updates cards when the semantic store publishes a new visible subject", async () => {
    const store = createSemanticWorldStore();
    store.publish(world([subject("aster")]));
    const { container, root, renderProps } = render(
      store,
      makeRoster(["aster", "briar"]),
      vi.fn(),
    );
    await act(async () => renderProps());
    expect(container.textContent).toContain("Aster");

    await act(async () => {
      store.publish(world([subject("briar", "Building")]));
    });

    expect(container.textContent).toContain("Briar");
    expect(container.textContent).toContain("Building");
    expect(container.textContent).not.toContain("Aster");
    await act(async () => root.unmount());
  });

  it("withholds a stale semantic action until the accepted frame matches", async () => {
    const store = createSemanticWorldStore();
    const stale = world([subject("aster", "Speaking")]);
    store.publish(stale);
    const accepted: FrameIdentity = {
      ...stale.frameIdentity,
      revision: stale.frameIdentity.revision + 1,
      lastCursor: stale.frameIdentity.lastCursor + 1,
    };
    const { container, root, renderProps } = render(
      store,
      makeRoster(["aster"]),
      vi.fn(),
      [event("aster", 9_500, 7)],
      null,
      accepted,
    );

    await act(async () => renderProps());

    const button = container.querySelector<HTMLButtonElement>("[data-follow-shortcut]");
    expect(button?.textContent).toContain("Spoke");
    expect(button?.textContent).not.toContain("Speaking");
    expect(button?.getAttribute("data-follow-remote")).toBe("true");
    // An identity-only publication shares the same subject array. It must
    // refresh freshness without requiring a different action or parent render.
    await act(async () => store.publish({ ...stale, frameIdentity: accepted }));
    expect(container.querySelector<HTMLButtonElement>("[data-follow-shortcut]")?.textContent)
      .toContain("Speaking");
    expect(container.querySelector<HTMLButtonElement>("[data-follow-shortcut]")
      ?.getAttribute("data-follow-remote")).toBe("false");
    await act(async () => root.unmount());
  });

  it("holds a disabled placeholder for a hovered being that dies until the pointer leaves", async () => {
    const store = createSemanticWorldStore();
    store.publish(world([
      subject("aster"), subject("briar"), subject("cinder"), subject("dove"),
    ]));
    const roster = makeRoster(["aster", "briar", "cinder", "dove", "ember"]);
    const onFollow = vi.fn();
    const { container, root, renderProps } = render(store, roster, onFollow);
    document.body.append(container);
    await act(async () => renderProps());
    const first = container.querySelector<HTMLButtonElement>(
      "[data-follow-shortcut][aria-label^='Follow Aster']",
    )!;

    await act(async () => {
      first.dispatchEvent(new Event("pointerover", { bubbles: true }));
    });
    (roster.byKey as Map<string, FollowAgentFact>).set(
      "aster",
      fact("aster", "nirvana", { living: false, dead: true }),
    );
    await act(async () => {
      store.publish(world([
        subject("briar"), subject("cinder"), subject("dove"), subject("ember"),
      ]));
    });

    const unavailable = container.querySelector<HTMLButtonElement>(
      "[data-follow-shortcut][data-follow-unavailable='true']",
    );
    expect(unavailable).toBe(first);
    expect(unavailable?.disabled).toBe(true);
    expect(unavailable?.textContent).toContain("Aster");
    expect([...container.querySelectorAll("[data-follow-shortcut]")].map(
      (button) => button.textContent?.includes("Ember") ?? false,
    )).toEqual([false, false, false, false]);
    await act(async () => unavailable?.click());
    expect(onFollow).not.toHaveBeenCalled();

    await act(async () => {
      unavailable?.dispatchEvent(new Event("pointerout", { bubbles: true }));
    });
    expect(container.querySelector("[data-follow-shortcut][data-follow-unavailable='true']"))
      .toBeNull();
    expect(container.textContent).toContain("Ember");
    await act(async () => root.unmount());
    container.remove();
  });
});
