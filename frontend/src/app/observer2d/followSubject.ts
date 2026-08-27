/**
 * WHO THE CAMERA IS FOLLOWING — chosen by the viewer, and honest about losing them.
 *
 * The observer camera has had a `follow` mode since the first 2D renderer, but it
 * was reachable only by (a) clicking a being on the canvas and then (b) pressing
 * `F`, or opening the World drawer and pressing `Follow`. Nothing named the being
 * it had latched onto, so a viewer watching a followed camera could not tell WHO
 * it was following, or that it was following at all rather than merely sitting
 * still (owner direction, Safi, 2026-08-22: *"In follow mode I don't even know
 * how it follows or who it follows"*).
 *
 * This module owns the two things the renderer cannot own:
 *
 * 1. **The roster.** The camera can only latch onto a being the scene graph is
 *    currently rendering, which is one region's worth. The presented frame,
 *    however, carries EVERY region's beings (`frame.world.agents` — the Atlas
 *    counts per-region by filtering that one global array), so the shell is the
 *    only layer that can offer the whole world to choose from.
 * 2. **The pursuit.** A being chosen from another region is not followable until
 *    that region's art is mounted and the being is actually in the scene. That is
 *    an asynchronous, several-step affair with three honest failure endings — the
 *    being dies, the being walks somewhere this build has no art for, or the
 *    mount never completes. {@link advanceFollow} is that state machine, kept
 *    pure so every ending is a test rather than a live-run anecdote.
 *
 * The camera's own behaviour is untouched. A pursuit only ever asks the shell to
 * observe a region and then to latch the stage onto one subject — it computes no
 * geometry, and it knows nothing about how the camera frames what it is given.
 */

import type {
  CameraMode,
  ObserverSelection,
  PresentedObserverFrame,
} from "../../presentation/contracts";
import { frameEntityIdDenylist, safePublicEntityName } from "./publicCopy";
import type { SemanticSubjectView } from "./semanticWorld";

/**
 * How long a chosen being has to come into view before the pursuit is abandoned.
 *
 * Long enough to cover a region change that must rasterise fresh terrain and lease
 * a fresh atlas on a cold machine; short enough that a viewer is never left
 * watching a HUD that claims to be following someone it never reached.
 */
export const FOLLOW_ARRIVAL_TIMEOUT_MS = 12_000;

/** One being the viewer may hand the camera to. */
export interface FollowCandidateView {
  /** Opaque callback key. Never render this value. */
  readonly key: string;
  readonly name: string;
  /** Opaque region key. Never render this value. */
  readonly regionKey: string;
  readonly regionDisplayName: string;
}

/** Everything the follow machine needs to know about one being in the world. */
export interface FollowAgentFact {
  readonly name: string;
  /** Opaque region key, or `null` when the frame does not place this being. */
  readonly regionKey: string | null;
  /** Alive or paralyzed — a being the camera may pursue. */
  readonly living: boolean;
  /** Known dead, as opposed to merely absent. The two get different endings. */
  readonly dead: boolean;
  /** False when this build has no art mounted for `regionKey`. */
  readonly reachable: boolean;
}

export interface FollowRosterView {
  /** Living, reachable beings, ordered by region and then by name. */
  readonly candidates: readonly FollowCandidateView[];
  /** Every being the frame carries, living or not — the machine's ground truth. */
  readonly byKey: ReadonlyMap<string, FollowAgentFact>;
}

/**
 * Living includes PARALYZED.
 *
 * Every other count in the shell does the same (`selectPresentedHud`,
 * `countLivingAgentsInRegion`): a paralyzed being is still in the world, still
 * rendered, and still the most interesting thing a viewer could be watching.
 */
function isLivingStatus(status: string | undefined): boolean {
  return status === "alive" || status === "paralyzed";
}

/**
 * Projects the whole-world roster of beings the camera could be handed to.
 *
 * Names come from {@link safePublicEntityName} against the frame's own id
 * denylist, so an opaque `agent_*` identifier can never reach the dropdown; ids
 * travel only as opaque callback keys. A being whose status the projection has
 * not resolved yet is offered to nobody — the shell counts it as unresolved
 * rather than as living, and the camera must not be sent chasing a maybe.
 *
 * Side effects: none.
 *
 * @param frame The presented frame; `frame.world.agents` spans every region.
 * @param regionDisplayNames Region key to public name, as the Atlas already
 *   resolves them for the same frame.
 * @param hasRegionArt Whether this build can mount the named region's art.
 */
export function projectFollowRoster(
  frame: PresentedObserverFrame,
  regionDisplayNames: ReadonlyMap<string, string>,
  hasRegionArt: (regionKey: string) => boolean,
): FollowRosterView {
  const deniedIds = frameEntityIdDenylist(frame);
  const byKey = new Map<string, FollowAgentFact>();
  const candidates: FollowCandidateView[] = [];
  for (const record of frame.world.agents) {
    const { id, name, position, status } = record.value;
    if (typeof id !== "string" || id.trim() === "") continue;
    const regionKey = typeof position === "string" && position.trim() !== "" ? position : null;
    const reachable = regionKey !== null && hasRegionArt(regionKey);
    const fact: FollowAgentFact = {
      name: safePublicEntityName(deniedIds, name),
      regionKey,
      living: isLivingStatus(status),
      dead: status === "dead",
      reachable,
    };
    byKey.set(id, fact);
    if (!fact.living || regionKey === null || !reachable) continue;
    candidates.push({
      key: id,
      name: fact.name,
      regionKey,
      regionDisplayName: regionDisplayNames.get(regionKey) ?? "Unknown region",
    });
  }
  candidates.sort((left, right) => (
    left.regionDisplayName.localeCompare(right.regionDisplayName)
      || left.name.localeCompare(right.name)
      || left.key.localeCompare(right.key)
  ));
  return { candidates, byKey };
}

/**
 * The agent keys the renderer is currently rendering AND will accept a follow on.
 *
 * The semantic mirror is the one public statement of what the scene graph holds:
 * it is region-scoped by construction, and its `canFollow` is the renderer's own
 * answer to "can the camera latch onto this". Reading it is how the shell knows a
 * pursuit has arrived instead of guessing from a region id that changes the
 * instant it is asked for, long before any art is mounted.
 *
 * Side effects: none.
 */
export function followableAgentKeys(
  subjects: readonly SemanticSubjectView[],
  selectionFor: (token: string) => Exclude<ObserverSelection, null> | null,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const subject of subjects) {
    if (subject.kind !== "agent" || !subject.canFollow) continue;
    const selection = selectionFor(subject.token);
    if (selection?.kind === "agent") keys.add(selection.id);
  }
  return keys;
}

/** Where a pursuit stands. */
export type FollowState =
  | {
      readonly kind: "off";
      /**
       * Whether a `follow` the shell did not ask for may be ADOPTED.
       *
       * False for exactly as long as the camera is still nominally in `follow`
       * after a pursuit deliberately ended — a release, or a being lost. Without
       * it the adoption below would immediately re-adopt the selection the
       * release just walked away from, and the two would take turns forever.
       */
      readonly adoptable: boolean;
    }
  | {
      /** Chosen, but not yet in view: the region is being brought up around them. */
      readonly kind: "waiting";
      readonly agentKey: string;
      readonly name: string;
      readonly regionKey: string;
      readonly deadlineMs: number;
      /**
       * True once this region has been ASKED for.
       *
       * The request is idempotent downstream, but re-issuing it every tick would
       * mint a fresh state object every tick, and the shell ticks this from a
       * render — which is a spin. Asked once; the deadline is the backstop.
       */
      readonly asked: boolean;
      /**
       * True while this pursuit is still taking the camera BACK from a viewer
       * who was already holding it when they chose this being.
       *
       * `free` means "the viewer is driving". A `free` that ARRIVES during a
       * pursuit is a pan, and ends it silently — the viewer chose that. A `free`
       * that PRE-DATES the choice is not a pan away from anything: it is merely
       * the state the world happened to be in when they picked from the
       * dropdown. Vetoing on it dropped every pick made after a canvas drag, an
       * arrow key, the Free button, or an Atlas island click (which requests
       * Free by design, because choosing a PLACE is a viewer movement) — dropped
       * with no effect, no request to the renderer and no notice, so the control
       * snapped straight back to `Automatic` and stayed there for the rest of
       * the session. Owner report, Safi, 2026-08-27: *"the follow doesnt work
       * well it stays on auto"*.
       *
       * Cleared the moment the camera mode is seen to be anything but `free` —
       * the pursuit has taken the camera — after which a pan ends it exactly as
       * before.
       */
      readonly claimingCamera: boolean;
    }
  | {
      readonly kind: "following";
      readonly agentKey: string;
      readonly name: string;
      readonly regionKey: string;
      /** True once the renderer has ACCEPTED `follow`, not merely been asked. */
      readonly confirmed: boolean;
      /** See the `waiting` variant: a stale `free` is not a pan. */
      readonly claimingCamera: boolean;
    };

/** A pursuit that is under way: chosen, and not yet ended one way or the other. */
export type FollowPursuit = Extract<FollowState, { kind: "waiting" | "following" }>;

export const FOLLOW_OFF: FollowState = Object.freeze({ kind: "off", adoptable: true });

/**
 * Not following, and not about to adopt whatever the camera is still latched to.
 *
 * The state a deliberate ending leaves behind, until the camera has actually
 * left `follow` mode.
 */
export const FOLLOW_RELEASED: FollowState = Object.freeze({ kind: "off", adoptable: false });

/** What the shell must do about the transition it was just handed. */
export type FollowEffect =
  | { readonly kind: "none" }
  /** Bring this region's art up; the pursuit continues once the being is in it. */
  | { readonly kind: "observe-region"; readonly regionKey: string }
  /** Latch the camera onto this being; it is in view and the camera can reach it. */
  | { readonly kind: "engage"; readonly agentKey: string }
  /** Give the camera back to the director, and SAY why. */
  | { readonly kind: "abandon"; readonly notice: string };

export interface FollowOutcome {
  readonly state: FollowState;
  readonly effect: FollowEffect;
}

export interface FollowTickInput {
  readonly roster: FollowRosterView;
  /** The region the shell has asked to observe, which the pursuit steers. */
  readonly observedRegionKey: string | null;
  /** Beings the renderer is rendering right now; see {@link followableAgentKeys}. */
  readonly followableKeys: ReadonlySet<string>;
  /** The camera mode the renderer has ACCEPTED. */
  readonly cameraMode: CameraMode;
  /**
   * The frame's current selection, when it is something the camera can latch to.
   *
   * Regions and moments are `null` here, deliberately: the renderer re-latches a
   * live follow only on a being or a home (`CanvasPresentationRenderer`'s
   * `setSelection`), so those are the only two selections that can move the
   * camera off the being this control is naming.
   */
  readonly selectedSubject: Readonly<{ kind: "agent" | "home"; id: string }> | null;
  readonly nowMs: number;
}

const NO_EFFECT: FollowEffect = Object.freeze({ kind: "none" });

/**
 * The selected being this module may take over from, or `null`.
 *
 * Applies the SAME admission rules a chosen pursuit does: taking on a being the
 * very next tick would have to abandon is how an adoption and an ending come to
 * take turns forever.
 */
function adoptableSubject(input: FollowTickInput): Readonly<{
  agentKey: string;
  regionKey: string;
  fact: FollowAgentFact;
}> | null {
  const selected = input.selectedSubject;
  if (selected === null || selected.kind !== "agent") return null;
  const fact = input.roster.byKey.get(selected.id);
  if (fact === undefined || !fact.living || fact.dead
    || fact.regionKey === null || !fact.reachable) return null;
  return { agentKey: selected.id, regionKey: fact.regionKey, fact };
}

function outcome(state: FollowState, effect: FollowEffect = NO_EFFECT): FollowOutcome {
  return { state, effect };
}

/**
 * Re-reads a live pursuit's camera claim against the mode the world is now in.
 *
 * Returns the IDENTICAL state object unless the claim actually changed, because
 * the shell ticks {@link advanceFollow} from a render: a fresh object on every
 * tick is a spin, not a pursuit. The claim only ever falls (true to false, the
 * once), so this settles after a single transition and is stable thereafter.
 *
 * Side effects: none.
 */
function withCameraClaim(state: FollowPursuit, claiming: boolean): FollowPursuit {
  if (state.claimingCamera === claiming) return state;
  return { ...state, claimingCamera: claiming };
}

function abandon(name: string, because: string): FollowOutcome {
  return outcome(FOLLOW_RELEASED, {
    kind: "abandon",
    notice: `${name} ${because} Story framing resumed.`,
  });
}

/**
 * The viewer chose a being. Begins the pursuit; {@link advanceFollow} finishes it.
 *
 * Side effects: none — returns the next state and the one thing to do about it.
 */
export function requestFollow(
  agentKey: string,
  input: FollowTickInput,
): FollowOutcome {
  const fact = input.roster.byKey.get(agentKey);
  if (fact === undefined) {
    return outcome(FOLLOW_RELEASED, {
      kind: "abandon",
      notice: "That being is no longer in the world. Story framing resumed.",
    });
  }
  if (!fact.living) return abandon(fact.name, "is no longer living.");
  if (fact.regionKey === null) return abandon(fact.name, "is not anywhere the view can reach.");
  if (!fact.reachable) return abandon(fact.name, "is somewhere this view has no art for.");
  return advanceFollow({
    kind: "waiting",
    agentKey,
    name: fact.name,
    regionKey: fact.regionKey,
    deadlineMs: input.nowMs + FOLLOW_ARRIVAL_TIMEOUT_MS,
    asked: false,
    // The viewer may well have been holding the camera when they chose: an
    // Atlas island click leaves the camera Free by design, and so does any pan.
    // Choosing a being is them handing it back, not a pan away from the choice
    // they are making in the same gesture.
    claimingCamera: input.cameraMode === "free",
  }, input);
}

/**
 * Advances (or ends) a pursuit against the world as it now is.
 *
 * Called on every render, on every semantic publication, and once more when a
 * pursuit's deadline falls due. Idempotent: given an unchanged world it returns
 * the IDENTICAL state object and no effect, which is what lets the shell call it
 * freely without looping.
 *
 * The endings, in the order they are checked, are all the ways a followed being
 * can be lost — none of them silently re-aims the camera at somebody else:
 * gone from the world, dead, unplaced, in a region with no art, never arrived.
 *
 * Side effects: none.
 */
export function advanceFollow(state: FollowState, input: FollowTickInput): FollowOutcome {
  if (state.kind === "off") {
    // The camera can also enter `follow` without this module: clicking a being
    // and pressing `F`, or the World drawer's Follow button. Adopting that being
    // is what keeps the HUD's reading true for the path that already existed.
    if (input.cameraMode !== "follow") {
      return outcome(state.adoptable ? state : FOLLOW_OFF);
    }
    if (!state.adoptable) return outcome(state);
    const adopted = adoptableSubject(input);
    if (adopted === null) return outcome(state);
    return outcome({
      kind: "following",
      agentKey: adopted.agentKey,
      name: adopted.fact.name,
      regionKey: adopted.regionKey,
      confirmed: true,
      claimingCamera: false,
    });
  }

  // Whether this pursuit is still taking the camera back from the viewer, read
  // fresh against the mode the world is in NOW. Everything below works from
  // `pursuit` rather than `state` so the claim is settled exactly once.
  const pursuit = withCameraClaim(state, state.claimingCamera && input.cameraMode === "free");

  // The viewer re-aimed the live follow by hand, by clicking someone else.
  //
  // `CanvasPresentationRenderer.setSelection` re-latches the camera on the spot
  // while the mode is `follow`, and nothing tells this module. Left unheard, the
  // HUD would go on naming the being the camera walked away from — the exact lie
  // this control exists to end.
  if (pursuit.kind === "following" && input.cameraMode === "follow"
    && input.selectedSubject !== null && input.selectedSubject.id !== pursuit.agentKey) {
    if (input.selectedSubject.kind === "home") {
      // A home is not on a roster of BEINGS. Standing down lets the shell name it
      // as a subject this control did not choose, rather than claiming a being.
      return outcome(FOLLOW_OFF);
    }
    const retargeted = adoptableSubject(input);
    if (retargeted !== null) {
      return outcome({
        kind: "following",
        agentKey: retargeted.agentKey,
        name: retargeted.fact.name,
        regionKey: retargeted.regionKey,
        confirmed: true,
        claimingCamera: false,
      });
    }
  }

  const fact = input.roster.byKey.get(pursuit.agentKey);
  if (fact === undefined) return abandon(pursuit.name, "is no longer in the world.");
  if (fact.dead) return abandon(fact.name, "has died.");
  if (!fact.living) return abandon(fact.name, "is no longer living.");
  if (fact.regionKey === null) return abandon(fact.name, "is not anywhere the view can reach.");
  if (!fact.reachable) return abandon(fact.name, "moved somewhere this view has no art for.");

  // The viewer took the camera back by hand, so the pursuit ends WITHOUT a notice
  // telling them what they just did.
  //
  // `free` is a PAN, and ends a pursuit at any stage — including one still on its
  // way, which would otherwise snatch the camera back the moment it arrived.
  // UNLESS the pursuit is still claiming the camera, in which case that `free` is
  // the state the viewer chose FROM and not a pan away from their own choice; see
  // `claimingCamera`. Anything else only counts once the camera has actually been
  // following: while a pursuit is still in flight the mode is legitimately
  // `story`, because the director has not been asked to let go yet.
  if (input.cameraMode === "free"
    ? !pursuit.claimingCamera
    : (pursuit.kind === "following" && pursuit.confirmed && input.cameraMode !== "follow")) {
    return outcome(FOLLOW_OFF);
  }


  if (input.observedRegionKey !== fact.regionKey) {
    // Either the chosen being was somewhere else to begin with, or they have just
    // walked out of the region on screen. Same move: bring their region up.
    //
    // Asked ONCE. Re-issuing it every tick would both re-enter the shell for no
    // reason and, because each re-issue would mint a new state object, spin the
    // render that ticks this. If the region never arrives, the deadline below is
    // what ends the pursuit -- honestly, and out loud.
    if (pursuit.kind === "waiting" && pursuit.asked && pursuit.regionKey === fact.regionKey
      && pursuit.name === fact.name) {
      return input.nowMs >= pursuit.deadlineMs
        ? abandon(fact.name, "could not be brought into view.")
        : outcome(pursuit);
    }
    const next: FollowState = {
      kind: "waiting",
      agentKey: pursuit.agentKey,
      name: fact.name,
      regionKey: fact.regionKey,
      deadlineMs: pursuit.kind === "waiting" && pursuit.regionKey === fact.regionKey
        ? pursuit.deadlineMs
        : input.nowMs + FOLLOW_ARRIVAL_TIMEOUT_MS,
      asked: true,
      claimingCamera: pursuit.claimingCamera,
    };
    return outcome(next, { kind: "observe-region", regionKey: fact.regionKey });
  }

  if (!input.followableKeys.has(pursuit.agentKey)) {
    if (pursuit.kind === "following" && !pursuit.confirmed) {
      // Asked but not yet accepted, and the being has slipped out of the scene:
      // fall back to waiting so the deadline can end this honestly.
      return outcome({
        kind: "waiting",
        agentKey: pursuit.agentKey,
        name: fact.name,
        regionKey: fact.regionKey,
        deadlineMs: input.nowMs + FOLLOW_ARRIVAL_TIMEOUT_MS,
        asked: false,
        claimingCamera: pursuit.claimingCamera,
      });
    }
    if (pursuit.kind === "waiting" && input.nowMs >= pursuit.deadlineMs) {
      return abandon(fact.name, "could not be brought into view.");
    }
    if (pursuit.kind === "following") {
      return outcome({
        kind: "waiting",
        agentKey: pursuit.agentKey,
        name: fact.name,
        regionKey: fact.regionKey,
        deadlineMs: input.nowMs + FOLLOW_ARRIVAL_TIMEOUT_MS,
        asked: false,
        claimingCamera: pursuit.claimingCamera,
      });
    }
    return outcome(pursuit);
  }

  if (pursuit.kind === "waiting") {
    return outcome({
      kind: "following",
      agentKey: pursuit.agentKey,
      name: fact.name,
      regionKey: fact.regionKey,
      confirmed: input.cameraMode === "follow",
      claimingCamera: pursuit.claimingCamera,
    }, { kind: "engage", agentKey: pursuit.agentKey });
  }

  const confirmed = pursuit.confirmed || input.cameraMode === "follow";
  if (confirmed === pursuit.confirmed && fact.name === pursuit.name) return outcome(pursuit);
  return outcome({ ...pursuit, name: fact.name, confirmed });
}

/** What the HUD says about the pursuit right now. */
export interface FollowSubjectReading {
  /** Opaque callback key of the followed being, or `null` for director framing. */
  readonly key: string | null;
  readonly name: string | null;
  /** True while the camera is on its way to them rather than with them. */
  readonly pending: boolean;
}

/** Reduces a {@link FollowState} to the reading the HUD renders. */
export function readFollowSubject(state: FollowState): FollowSubjectReading {
  if (state.kind === "off") return { key: null, name: null, pending: false };
  return {
    key: state.agentKey,
    name: state.name,
    pending: state.kind === "waiting" || !state.confirmed,
  };
}
