import { describe, expect, it } from "vitest";

import type { PresentedObserverFrame, PresentedSceneView } from "../../presentation/contracts";
import { identityHue } from "./environment/bubbleGrammar";
import type { NavigationGrid } from "./navigation/navigation";
import type { PlacementLedgerSnapshot } from "./placement/PlacementLedger";
import { createProductionSceneCommandResolver } from "./ProductionSceneCommandResolver";

describe("ProductionSceneCommandResolver", () => {
  it("clears the body pose as well as speech when a scene requests idle", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(frame(scene({
      actorIntents: [{ actorId: "aster", kind: "idle", target: null, marker: null }],
    })));
    const commands = batch?.commands.flatMap((command) =>
      command.kind === "actor" && command.actorId === "aster" ? [command.command] : []);
    expect(commands).toEqual(expect.arrayContaining([
      { kind: "clear-body" },
      { kind: "set-face", expression: "neutral" },
    ]));
  });

  it("RED: translates one typed retained scene identity into a deterministic command batch", () => {
    const resolver = createProductionSceneCommandResolver({
      getPlacement: () => placement(),
    });
    const input = frame(scene({
      actorIntents: [
        { actorId: "aster", kind: "orient", target: { x: 96, y: 64 }, facing: "north", marker: "face" },
        {
          actorId: "aster",
          kind: "move",
          target: { x: 128, y: 64 },
          waypoints: [{ x: 80, y: 64 }, { x: 80, y: 96 }, { x: 128, y: 64 }],
          facing: "south",
          marker: "arrive",
        },
        { actorId: "briar", kind: "prone", target: null, marker: "fall" },
      ],
      homeIntents: [{ homeId: "hearth", kind: "collapse", marker: "collapse-contact" }],
      effectIntents: [{ kind: "camera-impulse", sourceId: "aster", targetId: "briar" }],
    }));

    const first = resolver(input);
    const second = resolver(structuredClone(input));
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      identity: { runId: "run-a", sourceKey: "live:run-a", revision: 3 },
      sceneToken: 7,
    });
    expect(first?.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "actor", actorId: "aster", command: expect.objectContaining({ kind: "orient", facing: "north" }) }),
      expect.objectContaining({
        kind: "actor",
        actorId: "aster",
        command: expect.objectContaining({
          kind: "move",
          waypoints: [{ x: 80, y: 64 }, { x: 80, y: 96 }, { x: 128, y: 64 }],
        }),
      }),
      expect.objectContaining({ kind: "actor", actorId: "briar", command: expect.objectContaining({ kind: "set-status", status: "paralyzed" }) }),
      expect.objectContaining({ kind: "home", homeId: "hearth", command: expect.objectContaining({ kind: "collapse", durationMs: 900 }) }),
      expect.objectContaining({ kind: "hit-stop", actorIds: ["aster", "briar"], durationMs: 80 }),
    ]));
    expect(new Set(first?.commands.map(({ commandId }) => commandId)).size).toBe(first?.commands.length);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.commands)).toBe(true);
  });

  it("spreads two actors' move intents that share an identical target onto distinct legal endpoints (SpatialDirector)", () => {
    // A home-contest-style convergence: two independently-computed routes
    // (e.g. a primary breacher and a supporting-cast member) both end at the
    // exact same door pixel. Left alone, both bodies would render fused on
    // top of one another -- SpatialDirector's coincident-target spreading
    // must give each actor a distinct final standing point.
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const sharedDoor = { x: 128, y: 96 };
    const batch = resolver(frame(scene({
      actorIntents: [
        { actorId: "aster", kind: "move", target: sharedDoor, marker: "breach" },
        { actorId: "briar", kind: "move", target: sharedDoor, marker: "breach-support" },
      ],
    })));
    const asterMove = batch?.commands.find((command) =>
      command.kind === "actor" && command.actorId === "aster" && command.command.kind === "move");
    const briarMove = batch?.commands.find((command) =>
      command.kind === "actor" && command.actorId === "briar" && command.command.kind === "move");
    expect(asterMove).toBeDefined();
    expect(briarMove).toBeDefined();
    const asterEnd = lastWaypoint(asterMove);
    const briarEnd = lastWaypoint(briarMove);
    expect(asterEnd).not.toEqual(briarEnd);
    // One of the two keeps the true anchor exactly (the door itself).
    expect([asterEnd, briarEnd]).toContainEqual(sharedDoor);

    // The result is deterministic, not order-dependent.
    const repeat = resolver(structuredClone(frame(scene({
      actorIntents: [
        { actorId: "aster", kind: "move", target: sharedDoor, marker: "breach" },
        { actorId: "briar", kind: "move", target: sharedDoor, marker: "breach-support" },
      ],
    }), 4)));
    const repeatAsterEnd = lastWaypoint(repeat?.commands.find((command) =>
      command.kind === "actor" && command.actorId === "aster" && command.command.kind === "move"));
    expect(repeatAsterEnd).toEqual(asterEnd);
  });

  it("GAP: never spreads a coincident target onto blocked ground when the region's real terrain is known", () => {
    // Same convergence as above ("spreads two actors' move intents..."), but
    // this region has real river/cliff terrain: the ring's first candidate
    // around the shared door (anchor + (52, 0) -- MIN_AGENT_SEPARATION_PX.x,
    // ~52px per SpatialDirector.ts) sits on blocked ground. Before the real
    // predicate is threaded in, `spreadCoincidentTargets` is called with a
    // hardcoded `() => true` and happily returns that blocked point -- the
    // gap named in `.superpowers/sdd/terrain-seam-report.md` Concerns §1.
    const sharedDoor = { x: 128, y: 96 };
    // Tile (5, 3) covers feet point (180, 96) = sharedDoor + (52, 0); every
    // other tile near the door is open.
    const grid = openGrid(20, 20, [{ column: 5, row: 3 }]);
    const resolver = createProductionSceneCommandResolver({
      getPlacement: () => placement(),
      getNavigationGrid: (regionId) => (regionId === "meadow" ? grid : null),
    });
    const batch = resolver(frame(scene({
      actorIntents: [
        { actorId: "aster", kind: "move", target: sharedDoor, marker: "breach" },
        { actorId: "briar", kind: "move", target: sharedDoor, marker: "breach-support" },
      ],
    })));
    const asterEnd = lastWaypoint(batch?.commands.find((command) =>
      command.kind === "actor" && command.actorId === "aster" && command.command.kind === "move"));
    // The blocked ring candidate must never be chosen...
    expect(asterEnd).not.toEqual({ x: 180, y: 96 });
    // ...the next ring candidate (anchor - (52, 0)) is open and is chosen instead.
    expect(asterEnd).toEqual({ x: 76, y: 96 });
  });

  it("preserves today's exact deterministic ring spread when the region's terrain is fully open", () => {
    // Same fixture as the GAP test above, minus the blocked tile: proves the
    // real predicate changes nothing for the C08-colonize-staging /
    // home-contest shape when terrain genuinely permits the first ring slot.
    const sharedDoor = { x: 128, y: 96 };
    const grid = openGrid(20, 20);
    const resolver = createProductionSceneCommandResolver({
      getPlacement: () => placement(),
      getNavigationGrid: (regionId) => (regionId === "meadow" ? grid : null),
    });
    const batch = resolver(frame(scene({
      actorIntents: [
        { actorId: "aster", kind: "move", target: sharedDoor, marker: "breach" },
        { actorId: "briar", kind: "move", target: sharedDoor, marker: "breach-support" },
      ],
    })));
    const asterEnd = lastWaypoint(batch?.commands.find((command) =>
      command.kind === "actor" && command.actorId === "aster" && command.command.kind === "move"));
    expect(asterEnd).toEqual({ x: 180, y: 96 });
  });

  it("falls back to the original (overlapping) target, never a blocked one, when every ring slot around the anchor is blocked ground", () => {
    const sharedDoor = { x: 128, y: 96 };
    // Every one of the 8 first-ring tiles around (128, 96)'s own tile (4, 3)
    // is blocked; the anchor tile itself stays open.
    const grid = openGrid(20, 20, [
      { column: 5, row: 3 }, { column: 2, row: 3 },
      { column: 4, row: 4 }, { column: 4, row: 1 },
      { column: 5, row: 4 }, { column: 2, row: 4 },
      { column: 5, row: 1 }, { column: 2, row: 1 },
    ]);
    const resolver = createProductionSceneCommandResolver({
      getPlacement: () => placement(),
      getNavigationGrid: (regionId) => (regionId === "meadow" ? grid : null),
    });
    const batch = resolver(frame(scene({
      actorIntents: [
        { actorId: "aster", kind: "move", target: sharedDoor, marker: "breach" },
        { actorId: "briar", kind: "move", target: sharedDoor, marker: "breach-support" },
      ],
    })));
    const asterEnd = lastWaypoint(batch?.commands.find((command) =>
      command.kind === "actor" && command.actorId === "aster" && command.command.kind === "move"));
    // No legal ring slot: aster keeps its original (overlapping) target
    // rather than being nudged onto blocked ground.
    expect(asterEnd).toEqual(sharedDoor);
  });

  it("cuts a truncated walk to its declared origin BEFORE walking the tail (truncate-then-walk)", () => {
    // The departure half of a region transition. It may not become a teleport --
    // a being must be SEEN leaving through its own gate -- so the middle is
    // elided instead: one reposition to the cut origin, then the walk in.
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const tail = [{ x: 96, y: 64 }, { x: 128, y: 64 }];
    const batch = resolver(frame(scene({
      actorIntents: [
        {
          actorId: "aster",
          kind: "move",
          target: { x: 128, y: 64 },
          waypoints: tail,
          cutFrom: { x: 96, y: 64 },
          facing: "east",
          marker: "departure-gate-reached",
        },
      ],
    })));
    const asterCommands = (batch?.commands ?? []).filter((command) =>
      command.kind === "actor" && command.actorId === "aster");
    expect(asterCommands.map((command) =>
      command.kind === "actor" ? command.command.kind : null)).toEqual(["reposition", "move"]);
    const [reposition, walk] = asterCommands;
    expect(reposition?.kind === "actor" ? reposition.command : null).toMatchObject({
      kind: "reposition",
      position: { x: 96, y: 64 },
      // Reuses the reason the distance gate already declares: this is the same
      // decision -- that stretch was too far to be worth watching.
      reason: "distance-cut",
    });
    expect(walk?.kind === "actor" ? walk.command : null).toMatchObject({
      kind: "move",
      waypoints: tail,
      gait: "walk",
    });
    // Both halves must survive de-duplication.
    expect(new Set((batch?.commands ?? []).map(({ commandId }) => commandId)).size)
      .toBe(batch?.commands.length);
  });

  it("does not emit a reposition for an ordinary walk that declares no cut origin", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(frame(scene({
      actorIntents: [
        {
          actorId: "aster",
          kind: "move",
          target: { x: 128, y: 64 },
          waypoints: [{ x: 96, y: 64 }, { x: 128, y: 64 }],
          marker: "departure-gate-reached",
        },
      ],
    })));
    expect((batch?.commands ?? []).some((command) =>
      command.kind === "actor" && command.command.kind === "reposition")).toBe(false);
  });

  it("keeps a truncated walk's spread endpoint on the WALK, never on the cut origin", () => {
    // `relocationTargets` keys spatial truth by the walk's endpoint. A truncated
    // walk must not let SpatialDirector's nudge leak onto the point the being is
    // cut to -- that would drop it somewhere it was never routed through.
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const sharedDoor = { x: 128, y: 96 };
    const batch = resolver(frame(scene({
      actorIntents: [
        {
          actorId: "aster",
          kind: "move",
          target: sharedDoor,
          waypoints: [{ x: 96, y: 96 }, sharedDoor],
          cutFrom: { x: 96, y: 96 },
          marker: "departure-gate-reached",
        },
        { actorId: "briar", kind: "move", target: sharedDoor, marker: "breach-support" },
      ],
    })));
    const reposition = (batch?.commands ?? []).find((command) =>
      command.kind === "actor" && command.actorId === "aster" && command.command.kind === "reposition");
    expect(reposition?.kind === "actor" && reposition.command.kind === "reposition"
      ? reposition.command.position
      : null).toEqual({ x: 96, y: 96 });
  });

  it("does not alter a solitary move intent's endpoint when no other actor targets the same point", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(frame(scene({
      actorIntents: [
        { actorId: "aster", kind: "move", target: { x: 128, y: 64 }, marker: "solo" },
      ],
    })));
    const move = batch?.commands.find((command) =>
      command.kind === "actor" && command.actorId === "aster" && command.command.kind === "move");
    expect(lastWaypoint(move)).toEqual({ x: 128, y: 64 });
  });

  it("spreads two actors' fade-reposition intents that share an identical target", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const sharedTarget = { x: 200, y: 200 };
    const batch = resolver(frame(scene({
      actorIntents: [
        { actorId: "aster", kind: "fade-reposition", target: sharedTarget, marker: "fallback" },
        { actorId: "briar", kind: "fade-reposition", target: sharedTarget, marker: "fallback" },
      ],
    })));
    const asterReposition = batch?.commands.find((command) =>
      command.kind === "actor" && command.actorId === "aster" && command.command.kind === "reposition");
    const briarReposition = batch?.commands.find((command) =>
      command.kind === "actor" && command.actorId === "briar" && command.command.kind === "reposition");
    const asterPosition = asterReposition?.kind === "actor" && asterReposition.command.kind === "reposition"
      ? asterReposition.command.position
      : null;
    const briarPosition = briarReposition?.kind === "actor" && briarReposition.command.kind === "reposition"
      ? briarReposition.command.position
      : null;
    expect(asterPosition).not.toEqual(briarPosition);
    expect([asterPosition, briarPosition]).toContainEqual(sharedTarget);
  });

  it("emits a presence-fade vanish for the door-interacting actor during a home-interaction beat's hold phase (Bug 3 motion contract)", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(frame(scene({
      phase: "hold",
      execution: { sceneToken: 7, programId: "choreography:1:1:single:hearth_used", eventType: "hearth_used" },
      actorIntents: [
        { actorId: "aster", kind: "kneel", target: { x: 128, y: 96 }, marker: "hearth_used:contact" },
      ],
    })));
    expect(batch?.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "presence-fade", actorId: "aster", mode: "vanish" }),
    ]));
  });

  it("does NOT presence-fade a co-resident who only orients toward the door during home_joined's hold phase", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(frame(scene({
      phase: "hold",
      execution: { sceneToken: 7, programId: "choreography:1:1:single:home_joined", eventType: "home_joined" },
      actorIntents: [
        { actorId: "aster", kind: "reach", target: { x: 128, y: 96 }, marker: "home_joined:contact" },
        { actorId: "briar", kind: "orient", target: { x: 128, y: 96 }, marker: "home_joined:contact" },
      ],
    })));
    const fades = batch?.commands.filter((command) => command.kind === "presence-fade") ?? [];
    expect(fades).toEqual([expect.objectContaining({ actorId: "aster", mode: "vanish" })]);
  });

  it("emits a presence-fade reveal for the returning actor as a home-interaction beat's recover phase begins", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(frame(scene({
      phase: "recover",
      execution: { sceneToken: 7, programId: "choreography:1:1:single:home_started_hoarding", eventType: "home_started_hoarding" },
      actorIntents: [
        { actorId: "aster", kind: "move", target: { x: 64, y: 64 }, marker: "home_started_hoarding:return" },
      ],
    })));
    const fadeIndex = batch?.commands.findIndex((command) => command.kind === "presence-fade") ?? -1;
    const moveIndex = batch?.commands.findIndex((command) =>
      command.kind === "actor" && command.command.kind === "move") ?? -1;
    expect(fadeIndex).toBeGreaterThanOrEqual(0);
    expect(batch?.commands[fadeIndex]).toEqual(expect.objectContaining({ actorId: "aster", mode: "reveal" }));
    expect(fadeIndex).toBeLessThan(moveIndex);
  });

  it("never emits presence-fade for an event type outside the door-anchored motion contract (e.g. home_built's work pose)", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(frame(scene({
      phase: "hold",
      execution: { sceneToken: 7, programId: "choreography:1:1:single:home_built", eventType: "home_built" },
      actorIntents: [
        { actorId: "aster", kind: "work", target: { x: 128, y: 96 }, marker: "home_built:work-contact" },
      ],
    })));
    expect(batch?.commands.some((command) => command.kind === "presence-fade")).toBe(false);
  });

  it("never emits presence-fade outside hold/consequence/recover phases", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const enter = resolver(frame(scene({
      phase: "enter",
      execution: { sceneToken: 7, programId: "choreography:1:1:single:hearth_used", eventType: "hearth_used" },
      actorIntents: [
        { actorId: "aster", kind: "move", target: { x: 128, y: 96 }, marker: "hearth_used:door-open" },
      ],
    })));
    expect(enter?.commands.some((command) => command.kind === "presence-fade")).toBe(false);
  });

  it("keeps a timed home command id stable across hold and consequence revisions", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const hold = resolver(frame(scene({
      phase: "hold",
      homeIntents: [{ homeId: "hearth", kind: "collapse", marker: "contact" }],
    })));
    const consequence = resolver(frame(scene({
      phase: "consequence",
      homeIntents: [{ homeId: "hearth", kind: "collapse", marker: "truth" }],
    }), 4));

    expect(hold?.commands[0]?.commandId).toBe(consequence?.commands[0]?.commandId);
  });

  it("translates the exact provisional home geometry into the graph lifecycle command", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(frame(scene({
      homeIntents: [{
        kind: "create-provisional",
        homeId: "future-home",
        regionId: "meadow",
        plotId: "plot-9",
        plot: { x: 160, y: 96 },
        door: { x: 160, y: 112 },
        kit: "spring-terraces",
        marker: "foundation",
      }],
    })));

    expect(batch?.commands).toEqual([expect.objectContaining({
      kind: "create-provisional-home",
      homeId: "future-home",
      regionId: "meadow",
      plotId: "plot-9",
      plot: { x: 160, y: 96 },
      door: { x: 160, y: 112 },
      kit: "spring-terraces",
    })]);
  });

  it("keeps an unequal-share arc as pure motion and carries the exact share into the mark's own micro chip", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(frame(scene({
      phase: "consequence",
      execution: { sceneToken: 7, programId: "choreography:1:1:single:home_thieved", eventType: "home_thieved" },
      homeIntents: [{ kind: "loot", homeId: "hearth", marker: null }],
      effectIntents: [{ kind: "arc", sourceId: "aster", targetId: "briar", label: "27" }],
    })));

    // The ember no longer paints a floating system-font number over the world.
    expect(batch?.commands).toContainEqual(expect.objectContaining({
      kind: "environment",
      request: { kind: "ember", at: { x: 96, y: 64 }, tint: "#e9b96e" },
    }));
    // The exact share becomes the mark's micro and the recipient's own thread.
    expect(batch?.commands).toContainEqual(expect.objectContaining({
      kind: "environment",
      request: expect.objectContaining({
        kind: "event-mark",
        ownerId: "aster",
        glyph: "thieve",
        family: "harm",
        tier: "strike",
        micro: "27",
        // `toKind` rides with every far end: the receiver cap hangs over a
        // being, and a being that has left the stage is not drawn a cap.
        threads: [{
          to: { x: 96, y: 64 }, toId: "briar", toKind: "being",
          mode: "aim", accent: "#9c3b26", hue: identityHue("briar"),
        }],
      }),
    }));
  });

  it("resolves a spoken line to a vellum balloon tailed in the speaker's own identity hue, carrying the verbatim text", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(frame(scene({
      effectIntents: [{
        kind: "speech-bubble", sourceId: "aster", targetId: null,
        text: "The silence holds us. I am here.", variant: "spoken",
      }],
    })));

    expect(batch?.commands).toEqual([expect.objectContaining({
      kind: "environment",
      request: {
        kind: "speech-bubble",
        at: { x: 64, y: 64 },
        speakerId: "aster",
        variant: "speech",
        text: "The silence holds us. I am here.",
        tailLean: 0,
        hue: identityHue("aster"),
        accent: "#8a8270",
        tier: "murmur",
      },
    })]);
  });

  it("gives a whisper a thread to its co-located listener and a tail that leans toward them -- a broadcast gets neither", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const whisper = resolver(frame(scene({
      effectIntents: [{
        kind: "speech-bubble", sourceId: "aster", targetId: "briar", text: "just us", variant: "whisper",
      }],
    })));

    expect(whisper?.commands).toEqual([expect.objectContaining({
      kind: "environment",
      request: expect.objectContaining({
        kind: "speech-bubble",
        variant: "whisper",
        // briar sits 32px east of aster; the tail leans toward them in world px.
        tailLean: 8,
        thread: { to: { x: 96, y: 64 }, toId: "briar", mode: "aim", accent: "#8a8270", hue: identityHue("briar") },
      }),
    })]);

    const broadcast = resolver(frame(scene({
      momentId: "1:2:single",
      effectIntents: [{
        kind: "speech-bubble", sourceId: "aster", targetId: null, text: "to everyone", variant: "spoken",
      }],
    })));
    const request = (broadcast?.commands[0] as { request: Record<string, unknown> }).request;
    expect(request.thread).toBeUndefined();
    expect(request.tailLean).toBe(0);
  });

  it("tags directed speech with the addressee's NAME on both ingestion paths, and tags nothing else", () => {
    // The tag comes from the payload's target, resolved at the ONE choke point
    // both bubble paths pass through -- the non-blocking utterance lane, and a
    // `speak` chained into a physical moment, which reaches the same builder
    // through the scene's own effect intents.
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const chained = resolver(namedFrame(scene({
      effectIntents: [{
        kind: "speech-bubble", sourceId: "aster", targetId: "briar",
        text: "just us", variant: "whisper",
      }],
    })));
    expect(chained?.commands).toEqual([expect.objectContaining({
      request: expect.objectContaining({ targetId: "briar", targetName: "Joe" }),
    })]);

    const overlayLane = resolver(namedFrame(null, {
      utterances: [{
        momentId: "m-1",
        cursor: 9,
        beingId: "aster",
        targetId: "briar",
        regionId: "worn",
        text: "Between us only.",
        variant: "whisper",
        eventType: "speak",
      }],
    }, 4));
    // A null scene also closes the previous one, so assert on the bubble alone.
    expect(overlayLane?.commands).toContainEqual(expect.objectContaining({
      kind: "environment",
      request: expect.objectContaining({ targetId: "briar", targetName: "Joe" }),
    }));

    // A line aimed across regions is variant "spoken" -- there is nobody on
    // screen to whisper at -- and is still DIRECTED, so it still gets a tag.
    const remote = resolver(namedFrame(null, {
      utterances: [{
        momentId: "m-2",
        cursor: 10,
        beingId: "aster",
        targetId: "briar",
        regionId: "worn",
        text: "Come back to the springs.",
        variant: "spoken",
        eventType: "speak",
      }],
    }, 5));
    expect(remote?.commands).toContainEqual(expect.objectContaining({
      kind: "environment",
      request: expect.objectContaining({ variant: "speech", targetName: "Joe" }),
    }));

    // Undirected speech and private self-talk name no audience at all.
    for (const [index, intent] of [
      { kind: "speech-bubble" as const, sourceId: "aster", targetId: null, text: "to everyone", variant: "spoken" as const },
      { kind: "speech-bubble" as const, sourceId: "aster", targetId: null, text: "I drift, content.", variant: "thought" as const },
    ].entries()) {
      const batch = resolver(namedFrame(scene({ momentId: `1:${index + 7}:single`, effectIntents: [intent] })));
      const request = (batch?.commands[0] as { request: Record<string, unknown> }).request;
      expect(request.targetId).toBeUndefined();
      expect(request.targetName).toBeUndefined();
    }
  });

  it("hands every bubble the frame's whole roster, so the words can name beings the line is not addressed to", () => {
    // The `[to <Name>]` tag answers "who is this aimed at"; the roster answers
    // "which words in it are beings". A line like "Joe, Dick, Allen -- it is as
    // I feared" names three, is addressed to none of them in particular, and a
    // self-talk names them with no addressee at all -- so the roster cannot be
    // derived from the target, and rides on every bubble regardless of variant.
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const chained = resolver(namedFrame(scene({
      effectIntents: [{
        kind: "speech-bubble", sourceId: "aster", targetId: "briar",
        text: "Joe, it is as I feared.", variant: "whisper",
      }],
    })));
    const chainedRequest = (chained?.commands[0] as { request: Record<string, unknown> }).request;
    expect(chainedRequest.knownBeingNames).toEqual(["Mae", "Joe"]);

    // Self-talk: no addressee, still the full roster.
    const alone = resolver(namedFrame(scene({
      momentId: "1:21:single",
      effectIntents: [{
        kind: "speech-bubble", sourceId: "aster", targetId: null,
        text: "Joe was right.", variant: "thought",
      }],
    })));
    const aloneRequest = (alone?.commands[0] as { request: Record<string, unknown> }).request;
    expect(aloneRequest.targetName).toBeUndefined();
    expect(aloneRequest.knownBeingNames).toEqual(["Mae", "Joe"]);

    // The overlay lane resolves the roster at the same choke point.
    const overlayLane = resolver(namedFrame(null, {
      utterances: [{
        momentId: "m-9", cursor: 21, beingId: "aster", targetId: null, regionId: "worn",
        text: "Joe, Mae -- the East is sparse.", variant: "spoken", eventType: "speak",
      }],
    }, 9));
    expect(overlayLane?.commands).toContainEqual(expect.objectContaining({
      kind: "environment",
      request: expect.objectContaining({ knownBeingNames: ["Mae", "Joe"] }),
    }));

    // A frame with no named beings carries no roster at all, rather than an
    // empty one: there is nothing a bubble could match, and nothing is invented.
    const nameless = resolver(frame(scene({
      momentId: "1:22:single",
      effectIntents: [{
        kind: "speech-bubble", sourceId: "aster", targetId: null,
        text: "Quiet here.", variant: "spoken",
      }],
    })));
    const namelessRequest = (nameless?.commands[0] as { request: Record<string, unknown> }).request;
    expect(namelessRequest.knownBeingNames).toBeUndefined();
  });

  it("flash-steps a conversational addressee without a scene, and turns both beings", () => {
    // The staging lane (`presentation/conversationStaging.ts`): a being spoken
    // to from across the region APPEARS beside the speaker. It is published
    // exactly the way a bubble is -- no scene, no lease, no token bump --
    // because it must never delay or disturb whatever the stage is doing.
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const stepped = resolver(namedFrame(null, {
      staging: [{
        id: "m-1:9:flash-step",
        kind: "flash-step",
        beingId: "briar",
        regionId: "worn",
        to: { x: 256, y: 160 },
      }],
    }, 4));

    expect(stepped?.sceneToken).toBe(0);
    // `conversation-flash` is the reason that makes the actors perform their
    // vanish-and-appear fade rather than snapping: a deliberate step, not a
    // dropped frame. It is deliberately NOT `fallback`, which the scene graph
    // gates behind its failure policy and would refuse.
    expect(stepped?.commands).toEqual([{
      kind: "actor",
      commandId: "staging:m-1:9:flash-step:0",
      actorId: "briar",
      command: {
        kind: "reposition",
        position: { x: 256, y: 160 },
        reason: "conversation-flash",
      },
    }]);

    // Re-published frames carry a rolling window; the step is raised once.
    expect(resolver(namedFrame(null, {
      staging: [{
        id: "m-1:9:flash-step",
        kind: "flash-step",
        beingId: "briar",
        regionId: "worn",
        to: { x: 256, y: 160 },
      }],
    }, 5))).toBeNull();

    const faced = resolver(namedFrame(null, {
      staging: [
        { id: "m-1:9:face-speaker", kind: "face", beingId: "briar", regionId: "worn", facing: "west" },
        { id: "m-1:9:face-listener", kind: "face", beingId: "aster", regionId: "worn", facing: "east" },
      ],
    }, 6));
    expect(faced?.commands).toEqual([
      {
        kind: "actor",
        commandId: "staging:m-1:9:face-speaker:0",
        actorId: "briar",
        command: { kind: "orient", facing: "west" },
      },
      {
        kind: "actor",
        commandId: "staging:m-1:9:face-listener:0",
        actorId: "aster",
        command: { kind: "orient", facing: "east" },
      },
    ]);
  });

  it("steps before it turns, exactly as the scene lane repositions before it moves", () => {
    // The order is load-bearing, not cosmetic: the graph applies each command as
    // it validates it, so a turn resolved before the step would aim the being
    // from where it no longer stands.
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(namedFrame(null, {
      staging: [
        {
          id: "m-2:11:flash-step",
          kind: "flash-step",
          beingId: "briar",
          regionId: "worn",
          to: { x: 352, y: 160 },
        },
        {
          id: "m-2:11:face-speaker",
          kind: "face",
          beingId: "briar",
          regionId: "worn",
          facing: "west",
        },
      ],
    }, 4));

    expect(batch?.commands.map((command) => (
      (command as { command: { kind: string } }).command.kind
    ))).toEqual(["reposition", "orient"]);
    expect(batch?.commands[0]).toMatchObject({
      command: { kind: "reposition", position: { x: 352, y: 160 }, reason: "conversation-flash" },
    });
  });

  it("raises a conversational flash step beside a running scene, and outlives the scene's clear", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const running = resolver(namedFrame(scene({}), {
      staging: [{
        id: "m-3:12:flash-step",
        kind: "flash-step",
        beingId: "briar",
        regionId: "worn",
        to: { x: 288, y: 160 },
      }],
    }));
    // The scene keeps its own token; the step rides along without bumping it.
    expect(running?.sceneToken).toBe(7);
    expect(running?.commands).toContainEqual(expect.objectContaining({
      commandId: "staging:m-3:12:flash-step:0",
    }));

    const closing = resolver(namedFrame(null, {
      staging: [{
        id: "m-3:13:face",
        kind: "face",
        beingId: "briar",
        regionId: "worn",
        facing: "north",
      }],
    }, 4));
    // `clear-scene` cancels fallback repositions and offsets, never a route --
    // so the turn is published after it and the walk under way is untouched.
    expect(closing?.commands.map((command) => command.kind)).toEqual(["clear-scene", "actor"]);
  });

  it("prints no tag rather than an opaque id when the addressee has no public name", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    // `frame`'s world record carries no beings, so no name can be resolved.
    const batch = resolver(frame(scene({
      effectIntents: [{
        kind: "speech-bubble", sourceId: "aster", targetId: "briar",
        text: "just us", variant: "whisper",
      }],
    })));
    const request = (batch?.commands[0] as { request: Record<string, unknown> }).request;
    expect(request.targetId).toBe("briar");
    expect(request.targetName).toBeUndefined();
  });

  it("SELF_TALK RENDERS OPENLY: a private thought renders for every being, with no selection gating", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const thought = {
      kind: "speech-bubble" as const, sourceId: "aster", targetId: null,
      text: "I drift, content.", variant: "thought" as const,
    };

    // Owner decision (Safi, 2026-07-25), recorded in .superpowers/sdd/progress.md:
    // PRIVATE means other BEINGS do not perceive a thought -- the viewer is not
    // a being. This deliberately REVERSES the draw-time selection gate the
    // bubble-fix task added; the gating mechanism is retained for other uses.
    // Do not restore it here as a regression fix.
    const unselected = resolver(frame(scene({ effectIntents: [thought] }), 3, null));
    expect(unselected?.commands).toEqual([expect.objectContaining({
      kind: "environment",
      request: expect.objectContaining({
        kind: "speech-bubble",
        speakerId: "aster",
        variant: "thought",
        text: "I drift, content.",
      }),
    })]);

    const otherSelected = resolver(frame(
      scene({ momentId: "1:2:single", effectIntents: [thought] }),
      4,
      { kind: "agent", id: "briar" },
    ));
    expect(otherSelected?.commands.length).toBe(1);

    const selfSelected = resolver(frame(
      scene({ momentId: "1:3:single", effectIntents: [thought] }),
      5,
      { kind: "agent", id: "aster" },
    ));
    expect(selfSelected?.commands.length).toBe(1);
  });

  it("stops drawing the superseded offer-token, impact, structure-beat and carried-badge marks, which the one grammar now covers", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const superseded = resolver(frame(scene({
      effectIntents: [
        { kind: "bond-token", sourceId: "aster", targetId: "briar", tokenState: "forming" },
        { kind: "impact", sourceId: "briar", targetId: "aster", polarity: "damage", label: "-30" },
        { kind: "structure-beat", sourceId: null, targetId: "hearth", structureIcon: "hearth", label: "warm" },
        { kind: "carried-badge", sourceId: "aster", targetId: null, icon: "materials" },
      ],
    })));

    expect(superseded?.commands).toEqual([]);
  });

  it("opens a gather above the actor at the enter beat, then resolves it into the mapped mark at consequence", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const execution = {
      sceneToken: 7,
      programId: "choreography:1:1:single:resource_changed",
      eventType: "resource_changed" as const,
    };

    const enter = resolver(frame(scene({
      phase: "enter",
      execution,
      actorIntents: [{ actorId: "aster", kind: "gather", target: { x: 64, y: 64 }, marker: null }],
    })));
    expect(enter?.commands).toContainEqual(expect.objectContaining({
      kind: "environment",
      request: { kind: "event-gather", at: { x: 64, y: 64 }, ownerId: "aster" },
    }));

    const consequence = resolver(frame(scene({
      phase: "consequence",
      execution,
      actorIntents: [{ actorId: "aster", kind: "gather", target: { x: 64, y: 64 }, marker: null }],
    })));
    expect(consequence?.commands).toContainEqual(expect.objectContaining({
      kind: "environment",
      request: expect.objectContaining({
        kind: "event-mark", ownerId: "aster", glyph: "gather", family: "exchange", tier: "beat",
      }),
    }));
  });

  it("marks the striker and bursts on the victim for an attack, carrying the attacker's exact cost as its micro", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const execution = {
      sceneToken: 7, programId: "choreography:1:1:single:attack", eventType: "attack" as const,
    };
    resolver(frame(scene({
      phase: "hold",
      execution,
      actorIntents: [{ actorId: "briar", kind: "hurt", target: null, marker: null }],
      effectIntents: [
        { kind: "impact", sourceId: "briar", targetId: "aster", polarity: "damage", label: "-30" },
        { kind: "impact", sourceId: "aster", targetId: "briar", polarity: "cost", label: "-5" },
      ],
    })));
    const batch = resolver(frame(scene({ phase: "consequence", execution })));

    expect(batch?.commands).toContainEqual(expect.objectContaining({
      request: expect.objectContaining({
        kind: "event-burst", at: { x: 96, y: 64 }, glyph: "strike", family: "harm",
      }),
    }));
    expect(batch?.commands).toContainEqual(expect.objectContaining({
      request: expect.objectContaining({
        kind: "event-mark", ownerId: "aster", glyph: "strike", tier: "strike", micro: "-5",
      }),
    }));
  });

  it("never lets a receiving pose claim the actor role -- the fell mark goes on the killer, the ink knell on the body", () => {
    // The victim's own `dead` pose appears at the ENTER phase, long before the
    // consequence beat names the killer. Letting it fall through the last-resort
    // actor fallback silently swapped the roles: the mark landed on the corpse
    // and the ink knell on the survivor.
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const execution = {
      sceneToken: 7, programId: "choreography:1:1:single:agent_died", eventType: "agent_died" as const,
    };
    resolver(frame(scene({
      phase: "enter",
      execution,
      actorIntents: [{ actorId: "briar", kind: "dead", target: null, marker: null }],
    })));
    resolver(frame(scene({
      phase: "hold",
      execution,
      actorIntents: [{ actorId: "briar", kind: "dead", target: null, marker: null }],
      effectIntents: [{ kind: "camera-impulse", sourceId: "aster", targetId: "briar" }],
    }), 4));
    const batch = resolver(frame(scene({ phase: "consequence", execution }), 5));

    expect(batch?.commands).toContainEqual(expect.objectContaining({
      request: expect.objectContaining({ kind: "event-mark", ownerId: "aster", glyph: "fell" }),
    }));
    expect(batch?.commands).toContainEqual(expect.objectContaining({
      request: { kind: "event-burst", at: { x: 96, y: 64 }, glyph: "fell", family: "harm", invert: true },
    }));
  });

  it("inverts the field for a death and anchors the burst on the body, not above a head", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const execution = {
      sceneToken: 7, programId: "choreography:1:1:single:agent_died", eventType: "agent_died" as const,
    };
    resolver(frame(scene({
      phase: "hold",
      execution,
      actorIntents: [{ actorId: "briar", kind: "dead", target: null, marker: null }],
      effectIntents: [{ kind: "camera-impulse", sourceId: "aster", targetId: "briar" }],
    })));
    const batch = resolver(frame(scene({ phase: "consequence", execution })));

    expect(batch?.commands).toContainEqual(expect.objectContaining({
      request: {
        kind: "event-burst", at: { x: 96, y: 64 }, glyph: "fell", family: "harm", invert: true,
      },
    }));
  });

  it("anchors a home-subject mark on the structure's own door, never on a being", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(frame(scene({
      phase: "consequence",
      execution: {
        sceneToken: 7, programId: "choreography:1:1:single:home_colonized", eventType: "home_colonized",
      },
      focus: { kind: "home", id: "hearth" },
    })));

    expect(batch?.commands).toContainEqual(expect.objectContaining({
      request: expect.objectContaining({
        kind: "event-mark", at: { x: 128, y: 96 }, ownerId: "hearth", glyph: "claim", family: "dwell",
      }),
    }));
  });

  it("keeps a home-anchored beat visible through the being on its doorstep when the ledger has no door yet", () => {
    // PlacementLedger only learns a home's door from an exact checkpoint, so a
    // live run regularly resolves with `placement.homes` empty. Every
    // home-subject beat routes its actor to that door, so the actor's own live
    // point IS the doorstep -- real data, not an invented structure position.
    const ledgerWithoutHomes: PlacementLedgerSnapshot = { ...placement(), homes: new Map() };
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => ledgerWithoutHomes });
    const batch = resolver(frame(scene({
      phase: "consequence",
      execution: {
        sceneToken: 7, programId: "choreography:1:1:single:home_started_hoarding", eventType: "home_started_hoarding",
      },
      focus: { kind: "home", id: "hearth" },
      actorIntents: [{ actorId: "aster", kind: "kneel", target: { x: 128, y: 96 }, marker: null }],
    })));

    expect(batch?.commands).toContainEqual(expect.objectContaining({
      request: expect.objectContaining({
        kind: "event-mark", ownerId: "hearth", glyph: "hoard", family: "dwell",
        at: { x: 64, y: 64 },
      }),
    }));
  });

  it("draws nothing rather than guessing when a scene never names the being an overlay would hang on", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(frame(scene({
      phase: "consequence",
      focus: { kind: "system", regionId: "meadow" },
      execution: {
        sceneToken: 7, programId: "choreography:1:1:single:simulation_started", eventType: "simulation_started",
      },
    })));

    expect(batch?.commands).toEqual([]);
  });

  it("resolves each mapped event exactly once, however many times its consequence phase is re-resolved", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const execution = {
      sceneToken: 7, programId: "choreography:1:1:single:home_built", eventType: "home_built" as const,
    };
    const view = scene({
      phase: "consequence",
      execution,
      actorIntents: [{ actorId: "aster", kind: "work", target: { x: 128, y: 96 }, marker: null }],
    });

    const first = resolver(frame(view));
    const second = resolver(frame(view, 4));
    expect(first?.commands.some(({ kind }) => kind === "environment")).toBe(true);
    expect(second?.commands.some(({ kind }) => kind === "environment")).toBe(false);
  });



  it("carries current-event ruin depletion into the transient home command", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(frame(scene({
      homeIntents: [{
        homeId: "hearth",
        kind: "scavenge",
        marker: "ruins_scavenged:contact",
        remnantMaterialsAfter: 0,
      }],
    })));

    expect(batch?.commands).toEqual([expect.objectContaining({
      kind: "home",
      homeId: "hearth",
      command: {
        kind: "scavenge",
        durationMs: 900,
        remnantMaterialsAfter: 0,
      },
    })]);
  });

  it("rejects frames without exact execution identity and omits unrenderable targets", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const missingExecution = scene({});
    delete (missingExecution as { execution?: unknown }).execution;
    expect(resolver(frame(missingExecution))).toBeNull();
    expect(resolver(frame(scene({
      actorIntents: [{ actorId: "missing", kind: "move", target: null, marker: null }],
    })))?.commands).toEqual([]);
  });

  it("rejects an invalid phase that would issue move and work to one actor together", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    expect(resolver(frame(scene({
      actorIntents: [
        {
          actorId: "aster", kind: "move", target: { x: 128, y: 64 },
          waypoints: [{ x: 96, y: 64 }, { x: 128, y: 64 }], marker: "arrive",
        },
        { actorId: "aster", kind: "work", target: { x: 128, y: 64 }, marker: "work" },
      ],
    })))).toBeNull();
  });

  it("omits physical reach/work when the actor has no local target or local placement", () => {
    const basePlacement = placement();
    const remotePlacement: PlacementLedgerSnapshot = {
      ...basePlacement,
      agents: new Map(basePlacement.agents).set("remote-briar", {
        regionId: "distant",
        point: { x: 96, y: 64 },
        anchorKind: "staging",
      }),
    };
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => remotePlacement });
    const batch = resolver(frame(scene({
      actorIntents: [
        { actorId: "aster", kind: "reach", target: null, marker: "missing-target" },
        { actorId: "missing", kind: "work", target: { x: 96, y: 64 }, marker: "missing-placement" },
        { actorId: "remote-briar", kind: "work", target: { x: 96, y: 64 }, marker: "wrong-region" },
      ],
    })));

    expect(batch?.commands).toEqual([]);
  });

  it.each(["kneel", "gather"] as const)(
    "resolves a local %s intent to its matching play-body pose",
    (kind) => {
      const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
      const batch = resolver(frame(scene({
        actorIntents: [{ actorId: "aster", kind, target: { x: 64, y: 64 }, marker: "contact" }],
      })));

      expect(batch?.commands).toEqual([expect.objectContaining({
        kind: "actor",
        actorId: "aster",
        command: { kind: "play-body", action: kind },
      })]);
    },
  );

  it.each(["kneel", "gather"] as const)(
    "omits a %s intent when the actor has no local target or local placement",
    (kind) => {
      const basePlacement = placement();
      const remotePlacement: PlacementLedgerSnapshot = {
        ...basePlacement,
        agents: new Map(basePlacement.agents).set("remote-briar", {
          regionId: "distant",
          point: { x: 96, y: 64 },
          anchorKind: "staging",
        }),
      };
      const resolver = createProductionSceneCommandResolver({ getPlacement: () => remotePlacement });
      const batch = resolver(frame(scene({
        actorIntents: [
          { actorId: "aster", kind, target: null, marker: "missing-target" },
          { actorId: "missing", kind, target: { x: 96, y: 64 }, marker: "missing-placement" },
          { actorId: "remote-briar", kind, target: { x: 96, y: 64 }, marker: "wrong-region" },
        ],
      })));

      expect(batch?.commands).toEqual([]);
    },
  );

  it.each(["kneel", "gather"] as const)(
    "rejects an invalid phase that would issue move and %s to one actor together",
    (kind) => {
      const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
      expect(resolver(frame(scene({
        actorIntents: [
          {
            actorId: "aster", kind: "move", target: { x: 128, y: 64 },
            waypoints: [{ x: 96, y: 64 }, { x: 128, y: 64 }], marker: "arrive",
          },
          { actorId: "aster", kind, target: { x: 128, y: 64 }, marker: "contact" },
        ],
      })))).toBeNull();
    },
  );

  it("emits one clear-scene batch when a retained scene settles to null", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    resolver(frame(scene({})));
    const settled = resolver(frame(null, 4));

    expect(settled).toMatchObject({
      identity: { revision: 4 },
      sceneToken: 7,
      commands: [{ kind: "clear-scene", commandId: expect.stringContaining("clear-scene") }],
    });
    expect(resolver(frame(null, 5))).toBeNull();
  });

  it("translates legal knockback to a scene-local offset and clears it on recovery", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const hurt = resolver(frame(scene({
      actorIntents: [{
        actorId: "briar", kind: "hurt", target: { x: 102, y: 64 }, marker: "hit-contact",
      }],
    })));
    const recover = resolver(frame(scene({
      phase: "recover",
      actorIntents: [{
        actorId: "briar", kind: "recover", target: { x: 96, y: 64 }, marker: "safe",
      }],
    }), 4));

    expect(hurt?.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "actor", command: { kind: "play-body", action: "hurt-fall" } }),
      expect.objectContaining({ kind: "actor", command: { kind: "set-offset", offset: { x: 6, y: 0 } } }),
    ]));
    expect(recover?.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "actor", command: { kind: "set-offset", offset: { x: 0, y: 0 } } }),
      expect.objectContaining({ kind: "actor", command: { kind: "recover" } }),
    ]));
    expect(placement().agents.get("briar")?.point).toEqual({ x: 96, y: 64 });
  });

  it("RED residual: resolves remote portrait and atlas motifs to scene-owned transients without actor movement", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(frame(scene({
      actorIntents: [],
      effectIntents: [
        { kind: "portrait", sourceId: "aster", targetId: "remote-briar" },
        { kind: "atlas-transition", sourceId: "meadow", targetId: "distant" },
      ],
    })));

    expect(batch?.commands).toEqual([
      expect.objectContaining({
        kind: "remote-transient",
        motif: "portrait",
        sourceId: "aster",
        targetId: "remote-briar",
        at: { x: 64, y: 64 },
      }),
      expect.objectContaining({
        kind: "remote-transient",
        motif: "atlas",
        sourceId: "meadow",
        targetId: "distant",
        at: null,
      }),
    ]);
    expect(batch?.commands.some((command) => command.kind === "actor")).toBe(false);
  });

  it("RED residual: emits a one-use authoritative birth placement hint only at consequence", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const programId = "choreography:1:1:single:agent_born";
    resolver(frame(scene({
      phase: "enter",
      execution: { sceneToken: 8, programId },
      actorIntents: [{ actorId: "acceptor", kind: "orient", target: null, marker: "birth-ready" }],
    })));
    const hold = resolver(frame(scene({
      phase: "hold",
      execution: { sceneToken: 8, programId },
      actorIntents: [{ actorId: "acceptor", kind: "reach", target: null, marker: "birth-ready" }],
    }), 4));
    const consequenceFrame = frame(scene({
      phase: "consequence",
      execution: { sceneToken: 8, programId },
      actorIntents: [{ actorId: "child", kind: "idle", target: null, marker: "birth-commit" }],
    }), 5);
    (consequenceFrame.world as unknown as {
      agents: PresentedObserverFrame["world"]["agents"];
    }).agents = [
      { completeness: "exact", value: { id: "acceptor", position: "meadow", status: "alive" } },
      { completeness: "projected-partial", value: { id: "child", position: "meadow", status: "alive" } },
    ];
    const consequence = resolver(consequenceFrame);

    expect(hold?.commands.some((command) => command.kind === "placement-hint")).toBe(false);
    expect(consequence?.commands).toContainEqual(expect.objectContaining({
      kind: "placement-hint",
      agentId: "child",
      context: {
        kind: "birth",
        acceptorId: "acceptor",
        authoritativeColocation: true,
      },
    }));
  });

  it("RED residual: retains a traveller then emits exact directed arrival hint at consequence", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const programId = "choreography:1:2:travel:agent_entered_region";
    const enterFrame = frame(scene({
      phase: "enter",
      execution: { sceneToken: 9, programId },
      actorIntents: [{
        actorId: "aster",
        kind: "move",
        target: { x: 32, y: 16 },
        waypoints: [{ x: 64, y: 64 }, { x: 32, y: 64 }, { x: 32, y: 16 }],
        marker: "departure",
      }],
    }));
    (enterFrame.world as { agents: PresentedObserverFrame["world"]["agents"] }).agents = [{
      completeness: "exact",
      value: { id: "aster", position: "distant", status: "alive" },
    }];
    const enter = resolver(enterFrame);
    resolver(frame(scene({
      phase: "hold",
      execution: { sceneToken: 9, programId },
      effectIntents: [{ kind: "atlas-transition", sourceId: "meadow", targetId: "distant" }],
    }), 4));
    const consequence = resolver(frame(scene({
      phase: "consequence",
      regionId: "distant",
      execution: { sceneToken: 9, programId },
      actorIntents: [{
        actorId: "aster",
        kind: "move",
        target: { x: 96, y: 96 },
        waypoints: [{ x: 16, y: 32 }, { x: 48, y: 32 }, { x: 80, y: 32 }, { x: 96, y: 96 }],
        marker: "arrival",
      }],
    }), 5));

    expect(enter?.commands).toContainEqual(expect.objectContaining({
      kind: "retain-traveler",
      actorId: "aster",
      fromRegion: "meadow",
      toRegion: "distant",
    }));
    expect(consequence?.commands).toContainEqual(expect.objectContaining({
      kind: "placement-hint",
      agentId: "aster",
      context: { kind: "arrival", fromRegion: "meadow" },
      arrivalGate: { x: 16, y: 32 },
      requestedFinal: { x: 96, y: 96 },
    }));
  });

  it("emits arrival staging only for the typed entered-region destination hold", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const programId = "choreography:1:2:travel:agent_entered_region";
    const execution = {
      sceneToken: 11,
      programId,
      eventType: "agent_entered_region",
    } as never;
    const enterFrame = frame(scene({
      momentId: "1:2:travel",
      regionId: "meadow",
      phase: "enter",
      execution,
      actorIntents: [{
        actorId: "aster",
        kind: "move",
        target: { x: 32, y: 16 },
        waypoints: [{ x: 64, y: 64 }, { x: 32, y: 16 }],
        marker: "departure-gate-reached",
      }],
    }));
    (enterFrame.world as { agents: PresentedObserverFrame["world"]["agents"] }).agents = [{
      completeness: "exact",
      value: { id: "aster", position: "meadow", status: "alive" },
    }];
    const enter = resolver(enterFrame);
    const hold = resolver(frame(scene({
      momentId: "1:2:travel",
      regionId: "distant",
      phase: "hold",
      execution,
      effectIntents: [{ kind: "atlas-transition", sourceId: "meadow", targetId: "distant" }],
    }), 4));
    const consequence = resolver(frame(scene({
      momentId: "1:2:travel",
      regionId: "distant",
      phase: "consequence",
      execution,
      actorIntents: [{
        actorId: "aster",
        kind: "move",
        target: { x: 96, y: 96 },
        waypoints: [{ x: 16, y: 32 }, { x: 96, y: 96 }],
        marker: "arrival-commit",
      }],
    }), 5));

    expect(enter?.commands.some(({ kind }) => kind === ("stage-arrival" as never))).toBe(false);
    expect(hold?.commands).toContainEqual({
      kind: "stage-arrival",
      commandId: `${programId}:stage-arrival:aster`,
      actorId: "aster",
      fromRegion: "meadow",
      toRegion: "distant",
      eventType: "agent_entered_region",
      phase: "hold",
      momentId: "1:2:travel",
      programId,
    });
    expect(consequence?.commands.some(({ kind }) => kind === ("stage-arrival" as never))).toBe(false);
  });

  it("infers a grouped entered-region trip from durable source truth before destination adoption", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const enterFrame = frame(scene({
      regionId: "distant",
      phase: "enter",
      execution: {
        sceneToken: 10,
        programId: "choreography:1:2:travel:agent_entered_region",
      },
      actorIntents: [{
        actorId: "aster",
        kind: "move",
        target: { x: 32, y: 16 },
        waypoints: [{ x: 64, y: 64 }, { x: 32, y: 64 }, { x: 32, y: 16 }],
        marker: "departure-gate-reached",
      }],
    }));
    (enterFrame.world as { agents: PresentedObserverFrame["world"]["agents"] }).agents = [{
      completeness: "exact",
      value: { id: "aster", position: "meadow", status: "alive" },
    }];

    expect(resolver(enterFrame)?.commands).toContainEqual(expect.objectContaining({
      kind: "retain-traveler",
      actorId: "aster",
      fromRegion: "meadow",
      toRegion: "distant",
    }));
  });

  it("retains one traveler across separate left and entered singleton executions", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const leftProgram = "choreography:1:1:single:agent_left_region";
    resolver(frame(scene({
      phase: "enter",
      execution: { sceneToken: 20, programId: leftProgram },
      actorIntents: [{
        actorId: "aster",
        kind: "move",
        target: { x: 160, y: 64 },
        waypoints: [{ x: 128, y: 64 }, { x: 160, y: 64 }],
        marker: "departure-gate-reached",
      }],
    }), 20));
    const leftHold = resolver(frame(scene({
      phase: "hold",
      execution: { sceneToken: 20, programId: leftProgram },
      effectIntents: [{ kind: "atlas-transition", sourceId: "meadow", targetId: "distant" }],
    }), 21));
    const clear = resolver(frame(null, 22));

    const enteredProgram = "choreography:2:2:single:agent_entered_region";
    resolver(frame(scene({
      phase: "enter",
      regionId: "distant",
      execution: { sceneToken: 21, programId: enteredProgram },
      focus: { kind: "agent", id: "aster" },
    }), 23));
    resolver(frame(scene({
      phase: "hold",
      regionId: "distant",
      execution: { sceneToken: 21, programId: enteredProgram },
      effectIntents: [{ kind: "atlas-transition", sourceId: "meadow", targetId: "distant" }],
    }), 24));
    const arrival = resolver(frame(scene({
      phase: "consequence",
      regionId: "distant",
      execution: { sceneToken: 21, programId: enteredProgram },
      actorIntents: [{
        actorId: "aster",
        kind: "move",
        target: { x: 96, y: 96 },
        waypoints: [{ x: 16, y: 32 }, { x: 48, y: 32 }, { x: 96, y: 96 }],
        marker: "arrival-commit",
      }],
    }), 25));

    expect(leftHold?.commands).toContainEqual(expect.objectContaining({
      kind: "retain-traveler",
      actorId: "aster",
      fromRegion: "meadow",
      toRegion: "distant",
    }));
    expect(clear?.commands).toContainEqual(expect.objectContaining({ kind: "clear-scene" }));
    expect(arrival?.commands).toContainEqual(expect.objectContaining({
      kind: "placement-hint",
      agentId: "aster",
      context: { kind: "arrival", fromRegion: "meadow" },
      arrivalGate: { x: 16, y: 32 },
      requestedFinal: { x: 96, y: 96 },
    }));
  });

  it("RED residual: preserves authoritative facing after reduced reposition", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const batch = resolver(frame(scene({
      reducedMotion: true,
      actorIntents: [{
        actorId: "aster",
        kind: "fade-reposition",
        target: { x: 128, y: 96 },
        facing: "north",
        marker: "arrival",
      }],
    })));

    expect(batch?.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "actor", actorId: "aster", command: {
        kind: "reposition", position: { x: 128, y: 96 }, reason: "reduced-motion",
      } }),
      expect.objectContaining({ kind: "actor", actorId: "aster", command: {
        kind: "orient", facing: "north",
      } }),
    ]));
  });

  it("RED residual: keeps one-pixel camera impulse distinct from hit-stop and omits both when reduced", () => {
    const resolver = createProductionSceneCommandResolver({ getPlacement: () => placement() });
    const normal = resolver(frame(scene({
      effectIntents: [{ kind: "camera-impulse", sourceId: "aster", targetId: "briar" }],
    })));
    const reduced = resolver(frame(scene({
      phase: "recover",
      reducedMotion: true,
      effectIntents: [{ kind: "camera-impulse", sourceId: "aster", targetId: "briar" }],
    }), 4));

    expect(normal?.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "hit-stop", durationMs: 80 }),
      expect.objectContaining({ kind: "camera-impulse", offset: { x: 1, y: 0 }, durationMs: 80 }),
    ]));
    expect(reduced?.commands.filter((command) => (
      command.kind === "hit-stop" || command.kind === "camera-impulse"
    ))).toEqual([]);
  });
});

function lastWaypoint(command: unknown): unknown {
  if (
    typeof command !== "object" || command === null
    || !("kind" in command) || (command as { kind: unknown }).kind !== "actor"
  ) return undefined;
  const actorCommand = (command as unknown as { command: { kind: string; waypoints?: readonly unknown[] } }).command;
  if (actorCommand.kind !== "move" || actorCommand.waypoints === undefined) return undefined;
  return actorCommand.waypoints[actorCommand.waypoints.length - 1];
}

/** A fully-open `NavigationGrid` of the given size, with `blocked` tiles marked collision. */
function openGrid(
  columns: number,
  rows: number,
  blocked: ReadonlyArray<{ column: number; row: number }> = [],
): NavigationGrid {
  const collision = new Uint8Array(columns * rows);
  for (const tile of blocked) collision[tile.row * columns + tile.column] = 1;
  return { columns, rows, collision };
}

function placement(): PlacementLedgerSnapshot {
  return {
    revision: 1,
    agents: new Map([
      ["aster", { regionId: "meadow", point: { x: 64, y: 64 }, anchorKind: "staging" }],
      ["briar", { regionId: "meadow", point: { x: 96, y: 64 }, anchorKind: "staging" }],
    ]),
    homes: new Map([
      ["hearth", { regionId: "meadow", plotId: "plot-1", door: { x: 128, y: 96 } }],
    ]),
    districtsByRegion: new Map(),
  };
}

function scene(overrides: Partial<PresentedSceneView>): PresentedSceneView {
  return {
    momentId: "1:1:single",
    regionId: "meadow",
    phase: "hold",
    focus: { kind: "agent", id: "aster" },
    dialogue: null,
    actorIntents: [],
    homeIntents: [],
    effectIntents: [],
    safeCancelMarkers: ["safe"],
    reducedMotion: false,
    execution: { sceneToken: 7, programId: "choreography:1:1:single:speak" },
    ...overrides,
  };
}

/** `frame`, with two named beings on the world record and optional overlay beats. */
function namedFrame(
  sceneValue: PresentedSceneView | null,
  overrides: Partial<Pick<PresentedObserverFrame, "utterances" | "staging">> = {},
  revision = 3,
): PresentedObserverFrame {
  const base = frame(sceneValue, revision);
  const agent = (id: string, name: string) => ({
    completeness: "exact" as const,
    value: {
      id,
      name,
      persona: "patient",
      position: "worn",
      energy: 50,
      materials: 20,
      status: "alive" as const,
      last_mated_at: null,
      offspring_count: 0,
      died_at: null,
      home_id: null,
      is_hoarding: false,
    },
  });
  return {
    ...base,
    world: { ...base.world, agents: [agent("aster", "Mae"), agent("briar", "Joe")] },
    ...overrides,
  };
}

function frame(
  sceneValue: PresentedSceneView | null,
  revision = 3,
  selection: PresentedObserverFrame["selection"] = null,
): PresentedObserverFrame {
  return {
    runId: "run-a",
    sourceKey: "live:run-a",
    revision,
    firstCursor: 1,
    lastCursor: 1,
    source: "live",
    ingestedCursor: 1,
    presentedCursor: 0,
    world: {
      exactBaseCursor: 0,
      projectedThroughCursor: 0,
      worldTime: 0,
      agents: [],
      regions: [],
      homes: [],
      ruins: [],
      pendingProposals: [],
    },
    scene: sceneValue,
    selection,
    backlog: { pendingMoments: 0, firstPendingCursor: null, lastPendingCursor: null, state: "behind", label: "Behind" },
    transport: { connection: "live", ingestedCursor: 1, retryable: false },
  };
}
