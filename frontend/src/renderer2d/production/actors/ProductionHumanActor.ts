/**
 * @fileoverview Scene-graph-facing interface for a production human actor.
 *
 * `ProductionSceneGraph.ts` is written against this surface only, not
 * against any concrete actor class. `LayeredHumanActor` implements it today;
 * an alternate implementation (e.g. a sprite-sheet actor) can be swapped in
 * behind `ProductionSceneFactories.createActor` without any scene-graph
 * change. Member signatures are copied verbatim from `LayeredHumanActor`'s
 * public surface so the swap is behavior-neutral.
 */

import type { Vec2 } from "../../contracts";
import type {
  HumanPrimitiveCommand,
  LayeredHumanSnapshot,
  ProductionActorSignal,
} from "./LayeredHumanActor";

/**
 * Detached, immutable snapshot of one human actor's current visual and
 * semantic state, as read by the scene graph for draw ordering, camera
 * framing, semantic-snapshot construction, and reconciliation checks.
 *
 * Re-exported alias of `LayeredHumanSnapshot` so actor implementations and
 * their consumers can depend on the interface's name instead of importing
 * from the concrete `LayeredHumanActor` module.
 */
export type ProductionHumanActorSnapshot = LayeredHumanSnapshot;

/**
 * Scene-graph-facing contract for one human actor instance.
 *
 * This is the entire surface `ProductionSceneGraph.ts` calls on an actor.
 * Any implementation accepted by `ProductionSceneFactories.createActor` must
 * satisfy it exactly; no other actor methods are reachable from the scene
 * graph.
 */
export interface ProductionHumanActor {
  /**
   * Apply one prepared primitive command, mutating internal state and
   * advancing local bookkeeping (e.g. the blink schedule) to `nowMs`.
   *
   * @param command - The primitive command to apply.
   * @param nowMs - Absolute scene clock time in milliseconds; must be finite
   *   and monotonically non-decreasing across calls to `apply`/`advance`.
   * @throws {RangeError} If `nowMs` is not finite or precedes the actor's
   *   last observed time.
   */
  apply(command: HumanPrimitiveCommand, nowMs: number): void;

  /**
   * Atomically adopt a prepared scene position, discarding any in-flight
   * route, turn, or presentation-fallback state, and return a cancel handle
   * for that staging.
   *
   * Fade contract: the returned handle is the actor's commitment for this
   * one staged transaction — calling it restores the actor's transient
   * state (position, route, in-flight reposition fade, etc.) to exactly
   * what it was immediately before this call, idempotently, as long as the
   * actor has not since been disposed. It is the transaction-scoped sibling
   * of {@link cancelFallbackReposition}, which instead unconditionally
   * cancels whatever presentation-fallback fade is active regardless of
   * which call started it. Callers use the returned handle to unwind a
   * specific staging that a later step in the same transaction rejected;
   * they use `cancelFallbackReposition` to abandon an in-flight fade
   * outright when no specific staging transaction is being unwound.
   *
   * @param position - The finite scene position to adopt immediately.
   * @returns A zero-argument, idempotent cancel handle, or `null` when the
   *   actor is disposed, terminal, or not currently alive (nothing was
   *   staged).
   * @throws {TypeError} If `position` is not finite.
   */
  stagePosition(position: Vec2): (() => void) | null;

  /**
   * Apply an ordered batch of commands as one transaction: run each command
   * through {@link apply}, in order, at `nowMs`. Returns an idempotent
   * rollback restoring all state the batch mutated. If any command throws,
   * the batch is rolled back automatically before the error propagates.
   *
   * @param commands - The ordered commands to apply.
   * @param nowMs - Absolute scene clock time in milliseconds, forwarded to
   *   every {@link apply} call in the batch.
   * @returns A zero-argument, idempotent rollback callback.
   */
  stageCommands(commands: readonly HumanPrimitiveCommand[], nowMs: number): () => void;

  /**
   * Advance simulated/animated time by `deltaSeconds` and return the
   * signals (arrival, fallback repositioning, animation markers) produced
   * while doing so, in emission order.
   *
   * @param deltaSeconds - Non-negative elapsed time, in seconds.
   * @param nowMs - Absolute scene clock time in milliseconds after this
   *   advance; must be finite and monotonically non-decreasing.
   * @returns The signals emitted while advancing.
   * @throws {RangeError} If `deltaSeconds` is negative or non-finite, or if
   *   `nowMs` is non-finite or precedes the actor's last observed time.
   */
  advance(deltaSeconds: number, nowMs: number): readonly ProductionActorSignal[];

  /**
   * Paint the actor's current visual state onto a 2D canvas context.
   *
   * @param context - The destination canvas rendering context.
   */
  draw(context: CanvasRenderingContext2D): void;

  /**
   * Return a detached, immutable snapshot of the actor's current state.
   *
   * @returns The current {@link ProductionHumanActorSnapshot}.
   */
  snapshot(): ProductionHumanActorSnapshot;

  /**
   * Scheduling contract: return the next absolute time — in the same clock
   * as the `nowMs` most recently passed to `apply`/`advance` — at which
   * this actor's visual state will next change on its own (mid-clip frame
   * boundary, blink, in-flight fade, etc.), or `null` when nothing is
   * scheduled. The scene graph polls this once per actor per frame to
   * decide whether to keep scheduling redraws for it: while an actor is
   * still visually animating, this method MUST return a time strictly
   * greater than that last observed `nowMs`, or the scene graph will stop
   * redrawing it and the animation will visibly stall.
   *
   * @returns The next deadline in milliseconds, or `null` when the actor is
   *   idle, disposed, or otherwise has nothing scheduled.
   */
  nextDeadlineMs(): number | null;

  /**
   * Cancel a presentation-only fallback-reposition fade in flight,
   * restoring the actor to its pre-fade visual origin. See
   * {@link stagePosition} for how this relates to that method's returned
   * cancel handle. A no-op when no fallback reposition is active.
   */
  cancelFallbackReposition(): void;

  /**
   * Begin fading this being to fully invisible in place (no position
   * change), holding at zero opacity indefinitely — unlike an ordinary
   * `"reposition"`/`"fallback"` command's fade, this does not auto-reveal
   * itself after a fixed duration — until {@link beginPresenceReveal} is
   * called or an ordinary command supersedes it (e.g. `stageCommands`
   * applying a fresh `"move"`/`"orient"`/`"set-status"`).
   *
   * Backs the door-anchored home-interaction motion contract driven by
   * `ProductionSceneGraph.ts`'s `"presence-fade"` scene command (see
   * `SpatialDirector.ts`'s file header): a being walks to a structure's
   * door on an ordinary `"move"` command, then this call is what makes it
   * read as having gone inside, purely as presentation — no occupancy
   * state is invented anywhere in the simulation model.
   *
   * A no-op when disposed, terminal, or not currently alive.
   */
  beginPresenceVanish(): void;

  /**
   * Begin fading a {@link beginPresenceVanish}-held being back to fully
   * visible, in place. A no-op when the being is not currently held
   * invisible by a sustained presence-fade.
   */
  beginPresenceReveal(): void;

  /**
   * Release any resources this actor owns (e.g. atlas leases) and make it
   * permanently inert. Idempotent.
   */
  dispose(): void;
}
