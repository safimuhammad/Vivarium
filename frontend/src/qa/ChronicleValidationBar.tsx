import { useSyncExternalStore, type ChangeEvent, type ReactElement } from "react";

import { CHRONICLE_IDS, type ChronicleId } from "../presentation/fixtures/chronicleCatalog";
import type {
  ChroniclePlaybackSpeed,
} from "./chronicleValidationModel";
import type {
  ChronicleScenarioControl,
  ChronicleValidationRuntime,
  ChronicleValidationSnapshot,
} from "./chronicleValidationRuntime";

import "./chronicleValidation.css";

export interface ChronicleValidationBarProps {
  readonly runtime: ChronicleValidationRuntime;
  readonly copyText?: (value: string) => Promise<void>;
  readonly readViewport?: () => Readonly<{ width: number; height: number }>;
}

/** Accessible responsive controls for deterministic human Chronicle review. */
export function ChronicleValidationBar({
  runtime,
  copyText = copyToClipboard,
  readViewport = browserViewport,
}: ChronicleValidationBarProps): ReactElement {
  const snapshot = useSyncExternalStore(
    (listener) => runtime.subscribe(listener),
    () => runtime.getSnapshot(),
    () => runtime.getSnapshot(),
  );
  const active = snapshot.status === "ready";
  const playLabel = snapshot.playing
    ? "Pause Chronicle"
    : active
      ? "Resume Chronicle"
      : "Play Chronicle";
  const marker = snapshot.marker;
  const previousMarker = snapshot.chronicle.markers[snapshot.markerIndex - 1] ?? null;
  const nextMarker = snapshot.chronicle.markers[snapshot.markerIndex + 1] ?? null;

  const onChronicle = (event: ChangeEvent<HTMLSelectElement>): void => {
    void runtime.selectChronicle(event.currentTarget.value as ChronicleId);
  };
  const onSpeed = (event: ChangeEvent<HTMLSelectElement>): void => {
    runtime.setSpeed(Number(event.currentTarget.value) as ChroniclePlaybackSpeed);
  };

  return (
    <aside className="chronicle-validation-bar" aria-label="Chronicle validation controls">
      <div className="chronicle-validation-bar__identity">
        <strong>{snapshot.chronicle.id}</strong>
        <span>{statusLabel(snapshot)}</span>
        <span>Generation {snapshot.generation}</span>
      </div>
      <label>
        <span>Chronicle</span>
        <select aria-label="Chronicle" value={snapshot.chronicle.id} onChange={onChronicle}>
          {CHRONICLE_IDS.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      <div className="chronicle-validation-bar__buttons">
        <button
          type="button"
          aria-label={playLabel}
          disabled={!active && !snapshot.playing}
          onClick={() => snapshot.playing ? runtime.pause() : runtime.resume()}
        >
          {playLabel}
        </button>
        <button
          type="button"
          aria-label="Restart Chronicle"
          disabled={snapshot.status === "loading" || snapshot.status === "disposed"}
          onClick={() => { void runtime.restart(); }}
        >Restart Chronicle</button>
        <button
          type="button"
          aria-label="Previous review marker"
          disabled={snapshot.status === "loading" || snapshot.markerIndex <= 0}
          onClick={() => { void runtime.previousMarker(); }}
        >{previousMarker === null ? "Previous review marker" : `Previous: ${previousMarker.label}`}</button>
        <button
          type="button"
          aria-label="Next review marker"
          disabled={
            snapshot.status === "loading"
            || snapshot.markerIndex >= snapshot.chronicle.markers.length - 1
          }
          onClick={() => { void runtime.nextMarker(); }}
        >{nextMarker === null ? "Next review marker" : `Next: ${nextMarker.label}`}</button>
      </div>
      <label>
        <span>Speed</span>
        <select aria-label="Playback speed" value={snapshot.speed} onChange={onSpeed}>
          {[0.5, 1, 1.5, 2].map((speed) => (
            <option key={speed} value={speed}>{speed}x</option>
          ))}
        </select>
      </label>
      <div className="chronicle-validation-bar__readout" aria-live="polite">
        <span>Cursor {snapshot.presentedCursor}</span>
        <span>{snapshot.presentedTime}</span>
        {marker === null ? null : <span>{marker.label}</span>}
      </div>
      {snapshot.scenario === null ? null : (
        <div className="chronicle-validation-bar__scenario" aria-label={`${snapshot.scenario.kind} scenario controls`}>
          {snapshot.scenario.controls.map((control) => (
            <ScenarioButton key={control.id} control={control} runtime={runtime} />
          ))}
        </div>
      )}
      <button
        type="button"
        aria-label="Copy failure token"
        disabled={snapshot.status === "loading" || snapshot.status === "disposed"}
        onClick={() => {
          const token = runtime.copyFailureToken(readViewport());
          void copyText(token);
        }}
      >Copy failure token</button>
      {snapshot.error === null
        ? null
        : <p className="chronicle-validation-bar__error" role="alert">{snapshot.error}</p>}
    </aside>
  );
}

function ScenarioButton({
  control,
  runtime,
}: Readonly<{
  control: ChronicleScenarioControl;
  runtime: ChronicleValidationRuntime;
}>): ReactElement {
  return (
    <button
      type="button"
      disabled={!control.enabled}
      onClick={() => { void runtime.runScenarioPhase(control.id); }}
    >{control.label}</button>
  );
}

function statusLabel(snapshot: ChronicleValidationSnapshot): string {
  switch (snapshot.status) {
    case "loading": return "Loading";
    case "ready": return snapshot.playing ? "Playing" : "Paused";
    case "complete": return "Complete";
    case "error": return "Error";
    case "disposed": return "Disposed";
  }
}

async function copyToClipboard(value: string): Promise<void> {
  if (globalThis.navigator?.clipboard === undefined) {
    throw new Error("Clipboard access is unavailable");
  }
  await globalThis.navigator.clipboard.writeText(value);
}

function browserViewport(): Readonly<{ width: number; height: number }> {
  return Object.freeze({ width: globalThis.innerWidth, height: globalThis.innerHeight });
}
