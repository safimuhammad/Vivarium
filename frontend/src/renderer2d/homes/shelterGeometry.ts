import type { Rect, Vec2 } from "../contracts";
import type { ShelterComponentState, ShelterSnapshot2D } from "./ShelterActor";

export const SHELTER_FRAME_SIZE = 128;
export const SHELTER_FRAME_ORIGIN = { x: -64, y: -96 } as const;
export const SHELTER_DOOR_OFFSET_X = -28;
/** Reviewed atlas alpha reaches source row 122 inclusive; rect height is therefore 123. */
export const SHELTER_OCCUPIED_LAST_ROW = 122;
export const SHELTER_OCCUPIED_HEIGHT = SHELTER_OCCUPIED_LAST_ROW + 1;

/** Returns the exact native destination rectangle used for one shelter atlas cell. */
export function shelterFrameDestination(snapshot: ShelterSnapshot2D, offset: Vec2): Rect {
  return {
    x: Math.round(snapshot.plot.x + SHELTER_FRAME_ORIGIN.x + offset.x),
    y: Math.round(snapshot.plot.y + SHELTER_FRAME_ORIGIN.y + offset.y),
    width: SHELTER_FRAME_SIZE,
    height: SHELTER_FRAME_SIZE,
  };
}

/** Returns the reviewed occupied envelope within a native shelter cell. */
export function shelterOccupiedDestination(snapshot: ShelterSnapshot2D, offset: Vec2): Rect {
  return { ...shelterFrameDestination(snapshot, offset), height: SHELTER_OCCUPIED_HEIGHT };
}

/** Adds the authored horizontal placement for the door cell. */
export function shelterComponentOffset(component: ShelterComponentState): Vec2 {
  return {
    x: component.offset.x + (component.id === "door" ? SHELTER_DOOR_OFFSET_X : 0),
    y: component.offset.y,
  };
}

function enclosingRect(rectangles: readonly Rect[]): Rect {
  const left = Math.min(...rectangles.map(({ x }) => x));
  const top = Math.min(...rectangles.map(({ y }) => y));
  const right = Math.max(...rectangles.map(({ x, width }) => x + width));
  const bottom = Math.max(...rectangles.map(({ y, height }) => y + height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Returns the phase-aware envelope shared by drawing, focus, selection, and hit testing. */
export function shelterVisualBounds(snapshot: ShelterSnapshot2D): Rect | null {
  if (snapshot.phase === "absent") return null;
  const base = shelterOccupiedDestination(snapshot, { x: 0, y: 0 });
  if (snapshot.phase === "ruin") return base;
  const placements = snapshot.components
    .filter(({ visibility }) => visibility === 1)
    .map((component) => shelterOccupiedDestination(snapshot, shelterComponentOffset(component)));
  if (snapshot.visual.dust.intensity > 0) placements.push(base);
  return enclosingRect(placements.length > 0 ? placements : [base]);
}

/** Keeps Y-sort anchored to the authored ground-contact baseline. */
export function shelterFeetY(snapshot: ShelterSnapshot2D): number {
  return snapshot.plot.y;
}
