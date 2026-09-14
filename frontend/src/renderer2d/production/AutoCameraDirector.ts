/**
 * Deterministic region-selection policy for the observer's automatic camera.
 *
 * The renderer supplies its monotonic frame time and the currently staged activity. This module
 * never reads wall-clock time, touches the canvas, or changes camera ownership; it only decides
 * whether Auto should keep the mounted region or request a different one.
 */

/** Roughly one useful scene before Auto considers a cross-region cut. */
export const AUTO_CAMERA_DWELL_MS = 30_000;
/** A region with no fresh activity is a natural break for changing the view. */
export const AUTO_CAMERA_QUIET_MS = 8_000;
/** A short early window still lets an important remote event break a quiet scene. */
export const AUTO_CAMERA_IMPORTANT_EARLY_DWELL_MS = 8_000;
/** Prevents an immediate return to the region Auto just left. */
export const AUTO_CAMERA_RETURN_COOLDOWN_MS = 45_000;
/** Do not revive an activity candidate after it has stopped being a useful live suggestion. */
export const AUTO_CAMERA_ACTIVITY_MEMORY_MS = 120_000;

type AutoCameraScenePhase = "enter" | "hold" | "consequence" | "recover" | "exit";

/** One public presentation activity that Auto can use as a regional signal. */
export interface AutoCameraActivity {
  readonly regionId: string | null;
  readonly momentId: string | null;
  readonly eventType: string | null;
  readonly phase: AutoCameraScenePhase;
  /** The focused traveler when a movement scene has one. */
  readonly subjectId?: string | null;
}

interface RegionActivity {
  readonly eventType: string | null;
  readonly important: boolean;
  readonly observedAtMs: number;
}

interface RegionAction {
  readonly momentId: string;
  readonly eventType: string | null;
  readonly subjectId: string | null;
  readonly completed: boolean;
  readonly observedAtMs: number;
}

/** Immutable state carried from one presented frame to the next. */
export interface AutoCameraDirectorState {
  readonly lineageKey: string | null;
  readonly activeRegionId: string | null;
  readonly enteredAtMs: number;
  readonly pendingRegionId: string | null;
  readonly lastActivityByRegion: ReadonlyMap<string, RegionActivity>;
  readonly actionByRegion: ReadonlyMap<string, RegionAction>;
  readonly departedAtByRegion: ReadonlyMap<string, number>;
}

/** Why Auto retained or changed the requested region on this tick. */
export type AutoCameraDecisionReason =
  | "initial"
  | "settling"
  | "arrival"
  | "dwell"
  | "action"
  | "local-activity"
  | "cooldown"
  | "important"
  | "quiet"
  | "no-candidate";

/** The region Auto wants the renderer to mount for this presented frame. */
export interface AutoCameraDecision {
  readonly regionId: string | null;
  readonly switchRequested: boolean;
  readonly reason: AutoCameraDecisionReason;
}

/** Result of one deterministic Auto-policy step. */
export interface ResolveAutoCameraResult {
  readonly next: AutoCameraDirectorState;
  readonly decision: AutoCameraDecision;
}

interface Candidate {
  readonly regionId: string;
  readonly important: boolean;
  readonly observedAtMs: number;
}

const IMPORTANT_EVENT_TYPES = new Set<string>([
  "agent_born",
  "agent_died",
  "home_built",
]);

/** Creates the empty state for a newly mounted observer renderer. */
export function createAutoCameraDirectorState(): AutoCameraDirectorState {
  return {
    lineageKey: null,
    activeRegionId: null,
    enteredAtMs: 0,
    pendingRegionId: null,
    lastActivityByRegion: new Map(),
    actionByRegion: new Map(),
    departedAtByRegion: new Map(),
  };
}

/**
 * Re-centres Auto on a region after an explicit viewer-owned mode ends.
 *
 * It deliberately discards stale event suggestions so returning from Follow or Free starts a new
 * quiet, stable Auto interval rather than jumping to activity from before the viewer took over.
 */
export function rebaseAutoCameraDirector(
  state: AutoCameraDirectorState,
  regionId: string | null,
  nowMs: number,
): AutoCameraDirectorState {
  return {
    lineageKey: state.lineageKey,
    activeRegionId: regionId,
    enteredAtMs: nowMs,
    pendingRegionId: null,
    lastActivityByRegion: new Map(),
    actionByRegion: new Map(),
    departedAtByRegion: new Map(),
  };
}

/**
 * Records one frame of public presentation state and selects Auto's desired region.
 *
 * The caller must provide a monotonic timestamp. A requested switch remains pending until the
 * renderer reports that region as mounted, preventing a newer event from stealing a move mid-load.
 */
export function resolveAutoCamera(
  previous: AutoCameraDirectorState,
  input: Readonly<{
    lineageKey: string;
    nowMs: number;
    currentRegionId: string | null;
    activity: AutoCameraActivity | null;
  }>,
): ResolveAutoCameraResult {
  const startsLineage = input.lineageKey !== previous.lineageKey;
  let state = !startsLineage
    ? cloneState(previous)
    : { ...createAutoCameraDirectorState(), lineageKey: input.lineageKey };

  // A stale terrain can be mounted before the first typed scene reaches Auto. Establish that
  // scene's region before beginning dwell; otherwise an arbitrary bootstrap region would hold
  // the journey source offscreen and leave its arrival without a coherent presentation path.
  if (state.activeRegionId === null && state.pendingRegionId === null
    && input.activity !== null && validActivity(input.activity)
    && input.activity.regionId !== input.currentRegionId) {
    state = recordActivity(state, input.activity, input.nowMs);
    return result(
      { ...state, pendingRegionId: input.activity.regionId },
      input.activity.regionId,
      true,
      "initial",
    );
  }

  state = alignMountedRegion(state, input.currentRegionId, input.nowMs);
  if (input.activity !== null && validActivity(input.activity)) {
    state = recordActivity(state, input.activity, input.nowMs);
  }

  const currentRegionId = state.activeRegionId;
  if (state.pendingRegionId !== null && state.pendingRegionId !== currentRegionId) {
    return result(state, state.pendingRegionId, true, "settling");
  }

  if (currentRegionId === null) {
    const initial = chooseCandidate(state, input.nowMs).candidate;
    if (initial === null) return result(state, null, false, "no-candidate");
    return result({ ...state, pendingRegionId: initial.regionId }, initial.regionId, true, "initial");
  }

  const localAction = state.actionByRegion.get(currentRegionId);
  if (completesMountedArrival(localAction, input.activity, currentRegionId)) {
    return result(
      { ...state, pendingRegionId: input.activity.regionId },
      input.activity.regionId,
      true,
      "arrival",
    );
  }

  const candidates = chooseCandidate(state, input.nowMs);
  if (candidates.candidate === null) {
    return result(state, currentRegionId, false, candidates.blockedByCooldown ? "cooldown" : "no-candidate");
  }

  const candidate = candidates.candidate;
  const action = state.actionByRegion.get(currentRegionId);
  const naturalBreak = action === undefined
    || action.completed
    || input.nowMs - action.observedAtMs >= AUTO_CAMERA_QUIET_MS;
  if (!naturalBreak) return result(state, currentRegionId, false, "action");

  const dwelledMs = input.nowMs - state.enteredAtMs;
  const canMakeEarlyImportantCut = candidate.important
    && dwelledMs >= AUTO_CAMERA_IMPORTANT_EARLY_DWELL_MS;
  if (!canMakeEarlyImportantCut && dwelledMs < AUTO_CAMERA_DWELL_MS) {
    return result(state, currentRegionId, false, "dwell");
  }

  if (!candidate.important) {
    const localActivity = state.lastActivityByRegion.get(currentRegionId);
    if (localActivity !== undefined && input.nowMs - localActivity.observedAtMs < AUTO_CAMERA_QUIET_MS) {
      return result(state, currentRegionId, false, "local-activity");
    }
  }

  return result(
    { ...state, pendingRegionId: candidate.regionId },
    candidate.regionId,
    true,
    candidate.important ? "important" : "quiet",
  );
}

function cloneState(state: AutoCameraDirectorState): AutoCameraDirectorState {
  return {
    ...state,
    lastActivityByRegion: new Map(state.lastActivityByRegion),
    actionByRegion: new Map(state.actionByRegion),
    departedAtByRegion: new Map(state.departedAtByRegion),
  };
}

function alignMountedRegion(
  state: AutoCameraDirectorState,
  currentRegionId: string | null,
  nowMs: number,
): AutoCameraDirectorState {
  // The first directed scene can request a replacement while bootstrap terrain is still mounted.
  // Do not mistake that stale terrain for the newly active region: retain the request until the
  // renderer reports its destination as mounted.
  if (state.pendingRegionId !== null && state.pendingRegionId !== currentRegionId) return state;
  if (currentRegionId === null || currentRegionId === state.activeRegionId) return state;
  const departedAtByRegion = new Map(state.departedAtByRegion);
  if (state.activeRegionId !== null) departedAtByRegion.set(state.activeRegionId, nowMs);
  return {
    ...state,
    activeRegionId: currentRegionId,
    enteredAtMs: nowMs,
    pendingRegionId: null,
    departedAtByRegion,
  };
}

function recordActivity(
  state: AutoCameraDirectorState,
  activity: AutoCameraActivity,
  nowMs: number,
): AutoCameraDirectorState {
  const regionId = activity.regionId!;
  const momentId = activity.momentId!;
  const lastActivityByRegion = new Map(state.lastActivityByRegion);
  const actionByRegion = new Map(state.actionByRegion);
  const priorAction = actionByRegion.get(regionId);
  lastActivityByRegion.set(regionId, {
    eventType: activity.eventType,
    important: activity.eventType !== null && IMPORTANT_EVENT_TYPES.has(activity.eventType),
    observedAtMs: nowMs,
  });
  actionByRegion.set(regionId, {
    momentId,
    eventType: activity.eventType,
    subjectId: activity.subjectId ?? null,
    completed: activity.phase === "exit" || (priorAction?.momentId === momentId && priorAction.completed),
    observedAtMs: nowMs,
  });
  return { ...state, lastActivityByRegion, actionByRegion };
}

/**
 * A journey may cross the view only when Auto was already presenting its own source beat.
 * This finishes that one action at its typed arrival boundary; arbitrary remote arrivals still
 * remain ordinary candidates subject to dwell and cooldown.
 */
function completesMountedArrival(
  currentAction: RegionAction | undefined,
  activity: AutoCameraActivity | null,
  currentRegionId: string,
): activity is AutoCameraActivity & { readonly regionId: string } {
  return currentAction?.eventType === "agent_entered_region"
    && currentAction.subjectId !== null
    && activity?.eventType === "agent_entered_region"
    && activity.subjectId === currentAction.subjectId
    && activity.momentId === currentAction.momentId
    && (activity.phase === "hold" || activity.phase === "consequence")
    && typeof activity.regionId === "string"
    && activity.regionId.length > 0
    && activity.regionId !== currentRegionId;
}

function chooseCandidate(
  state: AutoCameraDirectorState,
  nowMs: number,
): Readonly<{ candidate: Candidate | null; blockedByCooldown: boolean }> {
  const candidates: Candidate[] = [];
  let blockedByCooldown = false;
  for (const [regionId, activity] of state.lastActivityByRegion) {
    if (regionId === state.activeRegionId) continue;
    const ageMs = nowMs - activity.observedAtMs;
    if (ageMs < 0 || ageMs > AUTO_CAMERA_ACTIVITY_MEMORY_MS) continue;
    const departedAtMs = state.departedAtByRegion.get(regionId);
    if (departedAtMs !== undefined && nowMs - departedAtMs < AUTO_CAMERA_RETURN_COOLDOWN_MS) {
      blockedByCooldown = true;
      continue;
    }
    candidates.push({ regionId, important: activity.important, observedAtMs: activity.observedAtMs });
  }
  candidates.sort((left, right) => (
    Number(right.important) - Number(left.important)
    || right.observedAtMs - left.observedAtMs
    || left.regionId.localeCompare(right.regionId)
  ));
  return { candidate: candidates[0] ?? null, blockedByCooldown };
}

function validActivity(activity: AutoCameraActivity): activity is AutoCameraActivity & {
  readonly regionId: string;
  readonly momentId: string;
} {
  return activity.regionId !== null && activity.regionId.length > 0
    && activity.momentId !== null && activity.momentId.length > 0;
}

function result(
  next: AutoCameraDirectorState,
  regionId: string | null,
  switchRequested: boolean,
  reason: AutoCameraDecisionReason,
): ResolveAutoCameraResult {
  return { next, decision: { regionId, switchRequested, reason } };
}
