/**
 * THE WAY TO END A RUN — the control that was missing entirely.
 *
 * `POST /api/run/stop` has existed since the gateway was built and nothing in
 * the live view ever reached it, so the only way to stop a world was to kill the
 * server process by hand (owner direction, Safi, asked twice; built 2026-08-22).
 *
 * Three properties, all of them because this is irreversible:
 *
 * 1. **It asks first.** Ending a run cannot be undone and cannot be restarted
 *    into the same world, so the button opens a confirmation that says exactly
 *    that. The confirmation is a real modal — it takes focus, it returns focus,
 *    and Escape dismisses it without touching anything else on screen.
 * 2. **It reports the run, not the request.** The label after a stop comes from
 *    `GET /api/run` (see `runStopController.ts`), never from the local fact that a
 *    button was pressed. A run that has been asked to stop reads "Ending…"; only
 *    a run the server has *reported* stopped reads "Ended".
 * 3. **It fails loudly.** A stop that could not be sent says so and puts the
 *    control back, because a silently-ignored quit is worse than no quit.
 */

import { useEffect, useRef, useState, type JSX } from "react";

import type { RunLifecycleStatus } from "../gateway/runConfig";

export interface RunStopControlProps {
  /** The honest status of the run, or `null` while it is not yet known. */
  readonly status: RunLifecycleStatus | null;
  /** True from the moment a stop is sent until the server confirms an ending. */
  readonly requested: boolean;
  /** Why the last stop attempt failed, if it did. */
  readonly error: string | null;
  /** Sends the stop. Called only from the confirmation. */
  readonly onStop: () => void;
}

const HEADING_ID = "observer-run-stop-heading";
const BODY_ID = "observer-run-stop-body";

/** What the control reads, given the run's own status and the pending request. */
export function runStopLabel(
  status: RunLifecycleStatus | null,
  requested: boolean,
): Readonly<{ text: string; detail: string; actionable: boolean }> {
  if (status === "stopped" || status === "failed") {
    return Object.freeze({
      text: "Ended",
      detail: status === "failed"
        ? "This run ended on its own. Nothing more will arrive."
        : "This run has ended. Nothing more will arrive.",
      actionable: false,
    });
  }
  if (status === "stopping" || requested) {
    return Object.freeze({
      text: "Ending…",
      detail: "The beings are finishing their last breaths and the world is being written down.",
      actionable: false,
    });
  }
  return Object.freeze({
    text: "End run",
    detail: "Stop this world. It cannot be started again.",
    actionable: true,
  });
}

/** The HUD's run-lifecycle control, with its confirmation. */
export function RunStopControl({
  status,
  requested,
  error,
  onStop,
}: RunStopControlProps): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const label = runStopLabel(status, requested);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  // A run that ended while the question was open has answered it.
  useEffect(() => {
    if (!label.actionable) setConfirming(false);
  }, [label.actionable]);

  const dismiss = (): void => {
    setConfirming(false);
    triggerRef.current?.focus();
  };

  return (
    <span className="observer-hud__run" data-run-status={status ?? "unknown"}>
      <button
        ref={triggerRef}
        type="button"
        className="observer-hud__stop"
        data-actionable={label.actionable ? "true" : "false"}
        disabled={!label.actionable}
        aria-haspopup="dialog"
        aria-expanded={confirming}
        aria-label={`${label.text}. ${label.detail}`}
        title={label.detail}
        onClick={() => setConfirming(true)}
      >{label.text}</button>
      {error === null ? null : (
        <span className="observer-hud__run-error" role="alert">{error}</span>
      )}
      {confirming ? (
        <div
          ref={dialogRef}
          className="observer-run-confirm observer-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby={HEADING_ID}
          aria-describedby={BODY_ID}
          onKeyDown={(event) => {
            // Escape is owned here, and MARKED handled, so dismissing the
            // question cannot also close a drawer or leave the region behind it
            // (both of those yield on `defaultPrevented`).
            if (event.key === "Escape") {
              event.preventDefault();
              dismiss();
              return;
            }
            // `aria-modal` is a promise, so Tab keeps its word: while an
            // irreversible question is open, focus cannot wander onto the world
            // behind it and answer something else by accident.
            if (event.key !== "Tab" || event.defaultPrevented) return;
            const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
              "button:not([disabled])",
            ) ?? [])];
            if (focusable.length === 0) return;
            const first = focusable[0]!;
            const last = focusable.at(-1)!;
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          <strong id={HEADING_ID}>End this run?</strong>
          <p id={BODY_ID}>
            The beings stop breathing and this world will not start again. What has
            already happened stays in the chronicle. This cannot be undone.
          </p>
          <span className="observer-run-confirm__actions">
            <button
              ref={confirmRef}
              type="button"
              className="observer-run-confirm__go"
              onClick={() => {
                setConfirming(false);
                onStop();
              }}
            >End the run</button>
            <button type="button" onClick={dismiss}>Keep watching</button>
          </span>
        </div>
      ) : null}
    </span>
  );
}
