/**
 * Compact click-to-follow cards for the observer dock.
 *
 * The cards subscribe directly to the renderer semantic store so they update
 * with the same visible subjects as the Canvas. Remote cards are admitted by
 * the pure automatic-follow selector from recent stream participants. A card
 * keeps its identity while hovered or focused, and its callback is revalidated
 * against the current roster and semantic snapshot immediately before firing.
 */

import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type ReactElement,
} from "react";

import type { StreamEvent } from "./chronicleStream/streamEvent";
import type { FollowRosterView } from "./followSubject";
import type { FrameIdentity } from "../../presentation/contracts";
import {
  deriveAutoFollowSlots,
  MAX_AUTO_FOLLOW_SLOTS,
  type AutoFollowShortcut,
} from "./autoFollowShortcuts";
import { sameFrameIdentity, type SemanticWorldStore } from "./semanticWorld";
import "./FollowShortcuts.css";

/** Props for the observer dock's automatic-follow shortcuts. */
export interface FollowShortcutsProps {
  readonly store: SemanticWorldStore;
  readonly resolveAgentKey: (token: string) => string | null;
  readonly roster: FollowRosterView;
  readonly events: readonly StreamEvent[];
  readonly followedKey: string | null;
  readonly observedRegionKey: string | null;
  /** Feed clock used to age remote activity; defaults to the newest event time. */
  readonly nowMs?: number;
  /** Accepted renderer frame; stale semantic rows are withheld until it matches. */
  readonly frameIdentity?: FrameIdentity | null;
  readonly onFollow: (key: string) => void;
}

/**
 * Renders the current 3–4 automatic follow shortcuts.
 *
 * Side effects: subscribes to the semantic world store through
 * useSyncExternalStore; invoking a card's button may call onFollow after
 * the living/reachable revalidation succeeds.
 *
 * @param props Store, roster, stream, current follow, and callback inputs.
 * @returns The compact shortcut section, or null while no eligible card exists.
 */
export const FollowShortcuts = memo(function FollowShortcuts({
  store,
  resolveAgentKey,
  roster,
  events,
  followedKey,
  observedRegionKey,
  nowMs,
  frameIdentity,
  onFollow,
}: FollowShortcutsProps): ReactElement | null {
  const view = useSyncExternalStore(store.subscribeCurrent ?? store.subscribe, store.getCurrent, store.getCurrent);
  const previousSlotsRef = useRef<readonly AutoFollowShortcut[]>([]);
  const pointerKeysRef = useRef<Set<string>>(new Set());
  const focusKeysRef = useRef<Set<string>>(new Set());
  const protectedKeysRef = useRef<Set<string>>(new Set());
  const heldSlotsRef = useRef<Map<string, HeldUnavailableShortcut>>(new Map());
  const [interactionRevision, setInteractionRevision] = useState(0);
  const [heldRevision, setHeldRevision] = useState(0);
  const slots = useMemo(() => deriveAutoFollowSlots({
      view,
      resolveAgentKey,
      roster,
      events,
      followedKey,
      observedRegionKey,
      frameIdentity,
      previousSlots: previousSlotsRef.current,
      protectedKeys: protectedKeysRef.current,
      ...(nowMs === undefined ? {} : { nowMs }),
    }), [
      events,
      followedKey,
      nowMs,
      observedRegionKey,
      resolveAgentKey,
      roster,
      view,
      frameIdentity,
      // Pointer/focus changes affect which existing card may be replaced.
      heldRevision,
      interactionRevision,
    ]);
  useLayoutEffect(() => {
    const previous = previousSlotsRef.current;
    const nextKeys = new Set(slots.map((slot) => slot.key));
    let changed = false;
    for (const [key] of heldSlotsRef.current) {
      if (protectedKeysRef.current.has(key) && !nextKeys.has(key)) continue;
      heldSlotsRef.current.delete(key);
      changed = true;
    }
    for (const [index, slot] of previous.entries()) {
      if (nextKeys.has(slot.key) || !protectedKeysRef.current.has(slot.key)) continue;
      const existing = heldSlotsRef.current.get(slot.key);
      if (existing?.index === index && existing.slot === slot) continue;
      heldSlotsRef.current.set(slot.key, { slot, index });
      changed = true;
    }
    // Keep the last valid order as the anchor while an unavailable protected
    // card occupies a slot. Once all holds are released, the latest selector
    // order becomes the new stable baseline.
    if (heldSlotsRef.current.size === 0) previousSlotsRef.current = slots;
    if (changed) setHeldRevision((revision) => revision + 1);
  }, [slots, view, roster, resolveAgentKey, frameIdentity, heldRevision]);

  const renderSlots = useMemo(
    () => mergeRenderedSlots(
      slots,
      previousSlotsRef.current,
      heldSlotsRef.current,
      protectedKeysRef.current,
    ),
    [heldRevision, interactionRevision, slots],
  );

  const protectWith = (key: string, source: "pointer" | "focus"): void => {
    if (source === "pointer") pointerKeysRef.current.add(key);
    else focusKeysRef.current.add(key);
    protectedKeysRef.current.add(key);
    setInteractionRevision((revision) => revision + 1);
  };
  const releaseWith = (key: string, source: "pointer" | "focus"): void => {
    if (source === "pointer") pointerKeysRef.current.delete(key);
    else focusKeysRef.current.delete(key);
    if (!pointerKeysRef.current.has(key) && !focusKeysRef.current.has(key)) {
      protectedKeysRef.current.delete(key);
    }
    setInteractionRevision((revision) => revision + 1);
  };
  const handleFollow = (slot: AutoFollowShortcut): void => {
    const fact = roster.byKey.get(slot.key);
    if (fact === undefined || !fact.living || fact.dead || !fact.reachable
      || fact.regionKey === null || !roster.candidates.some(
        (candidate) => candidate.key === slot.key,
      )) return;
    if (slot.visible) {
      const current = store.getCurrent();
      if (frameIdentity !== undefined && frameIdentity !== null
        && (current === null || !sameFrameIdentity(current.frameIdentity, frameIdentity))) return;
      const stillVisible = current?.subjects.some((subject) => (
        subject.kind === "agent"
          && subject.canFollow
          && resolveAgentKey(subject.token) === slot.key
      )) ?? false;
      if (!stillVisible) return;
    }
    onFollow(slot.key);
  };

  if (renderSlots.length === 0) return null;
  return (
    <section className="follow-shortcuts" aria-label="Quick follow">
      <div className="follow-shortcuts__header">
        <span className="follow-shortcuts__label">Click to follow</span>
        <span className="follow-shortcuts__count" aria-hidden="true">{slots.length}</span>
      </div>
      <div className="follow-shortcuts__list" role="list">
        {renderSlots.map((renderSlot, index) => renderSlot === null
          ? <span key={"empty-" + index} className="follow-shortcuts__empty-slot"
              aria-hidden="true" />
          : <FollowShortcutCard
              key={renderSlot.slot.key}
              slot={renderSlot.slot}
              unavailable={renderSlot.unavailable}
              onFollow={renderSlot.unavailable
                ? undefined
                : () => handleFollow(renderSlot.slot)}
              onPointerEnter={() => protectWith(renderSlot.slot.key, "pointer")}
              onPointerLeave={() => releaseWith(renderSlot.slot.key, "pointer")}
              onFocus={() => protectWith(renderSlot.slot.key, "focus")}
              onBlur={(event) => {
                const nextTarget = event.relatedTarget;
                if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                releaseWith(renderSlot.slot.key, "focus");
              }}
            />)}
      </div>
    </section>
  );
});

interface FollowShortcutCardProps {
  readonly slot: AutoFollowShortcut;
  readonly unavailable: boolean;
  readonly onFollow?: () => void;
  readonly onPointerEnter: () => void;
  readonly onPointerLeave: () => void;
  readonly onFocus: () => void;
  readonly onBlur: (event: FocusEvent<HTMLButtonElement>) => void;
}

interface HeldUnavailableShortcut {
  readonly slot: AutoFollowShortcut;
  readonly index: number;
}

interface RenderedShortcut {
  readonly slot: AutoFollowShortcut;
  readonly unavailable: boolean;
}

function mergeRenderedSlots(
  next: readonly AutoFollowShortcut[],
  previous: readonly AutoFollowShortcut[],
  held: ReadonlyMap<string, HeldUnavailableShortcut>,
  protectedKeys: ReadonlySet<string>,
): readonly (RenderedShortcut | null)[] {
  const nextByKey = new Map(next.map((slot) => [slot.key, slot] as const));
  const heldByKey = new Set(held.keys());
  const inferredHeld = previous
    .map((slot, index) => ({ slot, index }))
    .filter((entry) => (
      !heldByKey.has(entry.slot.key)
        && protectedKeys.has(entry.slot.key)
        && !nextByKey.has(entry.slot.key)
    ));
  const activeHeld = [...held.values(), ...inferredHeld]
    .filter((entry) => protectedKeys.has(entry.slot.key) && !nextByKey.has(entry.slot.key))
    .sort((left, right) => left.index - right.index);
  if (activeHeld.length === 0) {
    return next.map((slot) => ({ slot, unavailable: false }));
  }

  const result: Array<RenderedShortcut | null> = Array.from(
    { length: MAX_AUTO_FOLLOW_SLOTS },
    () => null,
  );
  const used = new Set<string>();
  for (const entry of activeHeld) {
    const index = Math.max(0, Math.min(MAX_AUTO_FOLLOW_SLOTS - 1, entry.index));
    if (result[index] !== null) continue;
    result[index] = { slot: entry.slot, unavailable: true };
    used.add(entry.slot.key);
  }
  for (const [index, prior] of previous.entries()) {
    const candidate = nextByKey.get(prior.key);
    if (candidate === undefined || used.has(candidate.key) || result[index] !== null) continue;
    result[index] = { slot: candidate, unavailable: false };
    used.add(candidate.key);
  }
  for (const candidate of next) {
    if (used.has(candidate.key)) continue;
    const index = result.findIndex((entry) => entry === null);
    if (index === -1) break;
    result[index] = { slot: candidate, unavailable: false };
    used.add(candidate.key);
  }
  let length = result.length;
  while (length > 0 && result[length - 1] === null) length -= 1;
  return result.slice(0, length);
}

const FollowShortcutCard = memo(function FollowShortcutCard({
  slot,
  unavailable,
  onFollow,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
}: FollowShortcutCardProps): ReactElement {
  const region = slot.remote ? " Remote region: " + slot.regionLabel + "." : "";
  const label = unavailable
    ? slot.name + " is no longer available."
    : "Follow " + slot.name + ". " + slot.action + "." + region;
  return (
    <div className="follow-shortcuts__slot"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}>
      <button
        type="button"
        className={"follow-shortcuts__card"
          + (unavailable ? " follow-shortcuts__card--unavailable" : "")}
        data-follow-shortcut
        data-follow-remote={slot.remote ? "true" : "false"}
        data-follow-unavailable={unavailable ? "true" : "false"}
        aria-label={label}
        aria-pressed={unavailable ? false : slot.active}
        aria-disabled={unavailable ? "true" : undefined}
        title={label}
        disabled={unavailable}
        onClick={unavailable ? undefined : onFollow}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <span className="follow-shortcuts__medallion" aria-hidden="true"
          style={{ backgroundColor: slot.hue }}>{slot.initials}</span>
        <span className="follow-shortcuts__copy">
          <strong className="follow-shortcuts__name">{slot.name}</strong>
          <span className="follow-shortcuts__action">
            {unavailable ? "No longer available" : slot.action}
          </span>
          {!unavailable && slot.remote
            && <span className="follow-shortcuts__region">{slot.regionLabel}</span>}
        </span>
        {!unavailable && slot.active
          && <span className="observer-visually-hidden">Following</span>}
      </button>
    </div>
  );
});
