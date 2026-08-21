/**
 * Zooms (and, for paired/group beats, widens) the production world canvas around
 * the guided tour's current beat, by dispatching the exact same synthetic "+"/"-"
 * keydowns a real reviewer's keypress would send to the canvas (see
 * `handleCanvasKey` in `renderer2d/production/PresentationWorldStage.tsx`). This
 * rides the production keyboard-zoom path unmodified rather than reaching into the
 * renderer/camera internals, so it works without any production-file changes.
 *
 * A single focused entity is all the production camera's story-mode framing can
 * center on (`camera.requestFocus()` takes one `{kind, id}` selection — there is no
 * "fit this bounding box" primitive on the QA-reachable observer API). So instead
 * of always maxing zoom on the one focused actor, this driver reads every named
 * participant's *live* tile position from the accessible "World subjects" panel
 * (`SemanticWorldMirror.tsx` — a production, not QA, component; reading its DOM is
 * the same non-invasive technique already used to find the canvas) and computes a
 * zoom level that keeps everyone in frame around whichever one entity the camera is
 * actually centered on (see `fitToBounds.ts` for the geometry). A single
 * participant still gets the original MAX_ZOOM framing — behavior for the ordinary
 * single-actor beat is unchanged.
 *
 * Camera2D clamps zoom to `[MIN_ZOOM, MAX_ZOOM]` and each "+"/"-" press multiplies
 * the current zoom by 1.25/0.8 (exact inverses). Because a beat's zoom persists
 * into the next one (`preferredZoom`), and this driver only ever gets to *press
 * keys*, not read the camera's actual current zoom, every call first resets to the
 * known `MIN_ZOOM` floor (enough "-" presses to clamp there from even `MAX_ZOOM`)
 * and then steps "+" a computed number of times from that known baseline — this is
 * deterministic and correct regardless of whatever zoom the previous beat left
 * behind. `TILE_SIZE_PX` mirrors the same constant hardcoded in both
 * `renderer2d/production/CanvasPresentationRenderer.ts` and
 * `app/observer2d/semanticWorld.ts` (neither exports it).
 */

import type { GuidedTourBeat } from "./guidedTourBeats";
import type { GuidedTourZoomDriver, GuidedTourZoomResult } from "./guidedTourController";
import { computeFitZoom, computeZoomPressPlan, type TilePosition } from "./fitToBounds";

/** Mirrors `Camera2D.ts`'s exported zoom range (not imported to avoid a load-bearing runtime dependency on renderer internals from QA-only code). */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
/** Mirrors `PresentationWorldStage.tsx`'s keyboard zoom step factor for "+". "-" is its exact inverse (1.25 * 0.8 = 1). */
const ZOOM_IN_FACTOR = 1.25;
/** Presses of "+" guaranteed to clamp to MAX_ZOOM from even MIN_ZOOM (1.25^7 ≈ 4.77 > 4). */
const ZOOM_IN_OVERSHOOT_PRESSES = 7;
/** Presses of "-" guaranteed to clamp to MIN_ZOOM from even MAX_ZOOM (0.8^10 ≈ 0.107 < 0.125 = MIN_ZOOM/MAX_ZOOM). */
const ZOOM_OUT_RESET_PRESSES = 10;
/** Mirrors `CanvasPresentationRenderer.ts`'s/`semanticWorld.ts`'s own (unexported) tile size constant. */
const TILE_SIZE_PX = 32;
/** Extra tiles of breathing room padded around the fitted bounding box. */
const PADDING_TILES = 2;

export interface GuidedTourZoomDriverConfig {
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly zoomInFactor?: number;
  readonly zoomInOvershootPresses?: number;
  readonly zoomOutResetPresses?: number;
  readonly tileSizePx?: number;
  readonly paddingTiles?: number;
}

/**
 * Creates a zoom driver that dispatches keyboard zoom presses at a found canvas,
 * fitting every one of `beat.participantNames` in frame when there's more than
 * one — `findParticipantsRoot` locates the container to search for the
 * accessible "World subjects" rows (in real usage, the same route container
 * `findCanvas` searches for the canvas within).
 */
export function createDomGuidedTourZoomDriver(
  findCanvas: () => HTMLCanvasElement | null,
  findParticipantsRoot: () => HTMLElement | null,
  config: GuidedTourZoomDriverConfig = {},
): GuidedTourZoomDriver {
  const minZoom = config.minZoom ?? MIN_ZOOM;
  const maxZoom = config.maxZoom ?? MAX_ZOOM;
  const zoomInFactor = config.zoomInFactor ?? ZOOM_IN_FACTOR;
  const zoomInOvershootPresses = config.zoomInOvershootPresses ?? ZOOM_IN_OVERSHOOT_PRESSES;
  const zoomOutResetPresses = config.zoomOutResetPresses ?? ZOOM_OUT_RESET_PRESSES;
  const tileSizePx = config.tileSizePx ?? TILE_SIZE_PX;
  const paddingTiles = config.paddingTiles ?? PADDING_TILES;

  return {
    zoomToTarget(beat: GuidedTourBeat): GuidedTourZoomResult {
      const canvas = findCanvas();
      if (canvas === null) return { fits: true };

      const root = findParticipantsRoot();
      const positions = root === null
        ? []
        : resolveParticipantTilePositions(root, beat.participantNames);
      const bounds = canvas.getBoundingClientRect();
      const fit = computeFitZoom({
        positions,
        viewportWidthPx: bounds.width,
        viewportHeightPx: bounds.height,
        tileSizePx,
        minZoom,
        maxZoom,
        paddingTiles,
      });
      const plan = computeZoomPressPlan({
        targetZoom: fit.zoom,
        minZoom,
        maxZoom,
        zoomInFactor,
        resetPresses: zoomOutResetPresses,
        maxZoomOvershootPresses: zoomInOvershootPresses,
      });

      for (let step = 0; step < plan.resetPresses; step += 1) dispatchZoomKey(canvas, "-");
      for (let step = 0; step < plan.zoomInPresses; step += 1) dispatchZoomKey(canvas, "+");

      return { fits: fit.fits };
    },
  };
}

function dispatchZoomKey(canvas: HTMLCanvasElement, key: "+" | "-"): void {
  canvas.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));
}

/**
 * Reads every resolvable participant's live tile position from the accessible
 * "World subjects" panel (production's `SemanticWorldMirror.tsx`), matched by
 * display name. Participants not currently listed there (not in the observed
 * region, or the panel hasn't updated yet) are simply omitted — `computeFitZoom`
 * degrades gracefully to fewer positions (and to `maxZoom` for 0 or 1).
 */
function resolveParticipantTilePositions(
  root: HTMLElement,
  participantNames: readonly string[],
): readonly TilePosition[] {
  const subjects = root.querySelectorAll<HTMLElement>("[data-subject-token]");
  const positions: TilePosition[] = [];
  for (const name of participantNames) {
    const position = findSubjectTilePosition(subjects, name);
    if (position !== null) positions.push(position);
  }
  return positions;
}

const TILE_POSITION_PATTERN = /column\s+(-?\d+),\s*row\s+(-?\d+)/i;

function findSubjectTilePosition(
  subjects: NodeListOf<HTMLElement>,
  name: string,
): TilePosition | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namePattern = new RegExp(`^${escaped}\\b`);
  for (const subject of subjects) {
    const label = subject.getAttribute("aria-label") ?? "";
    if (!namePattern.test(label)) continue;
    const match = TILE_POSITION_PATTERN.exec(label);
    if (match === null) continue;
    const column = Number(match[1]);
    const row = Number(match[2]);
    if (!Number.isFinite(column) || !Number.isFinite(row)) continue;
    return { column, row };
  }
  return null;
}

/** Finds the production world canvas rendered anywhere inside `container`. */
export function findPresentationWorldCanvas(
  container: HTMLElement | null,
): HTMLCanvasElement | null {
  return container?.querySelector<HTMLCanvasElement>(
    ".presentation-world-stage__canvas",
  ) ?? null;
}
