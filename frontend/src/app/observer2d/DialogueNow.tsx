import type { DialogueNowView } from "./publicViewModels";

export interface DialogueNowProps {
  readonly view: DialogueNowView | null;
  readonly onFocusSpeaker: (speakerKey: string) => void;
  readonly onFocusTarget: (targetKey: string) => void;
}

/** Bottom reading surface for the exact active dialogue slice. */
export function DialogueNow({ view, onFocusSpeaker, onFocusTarget }: DialogueNowProps) {
  if (view === null) return null;
  return (
    <section className="observer-panel dialogue-now" aria-label="Now">
      <header className="dialogue-now__attribution">
        <button type="button" data-dialogue-speaker aria-label={`Focus ${view.speakerName}`}
          onClick={() => onFocusSpeaker(view.speakerKey)}>{view.speakerName}</button>
        {view.targetName !== null && <>
          <span data-dialogue-direction aria-hidden="true">→</span>
          {view.targetKey === null
            ? <span data-dialogue-target>{view.targetName}</span>
            : <button type="button" data-dialogue-target aria-label={`Focus ${view.targetName}`}
              onClick={() => onFocusTarget(view.targetKey!)}>{view.targetName}</button>}
        </>}
        {view.remote && <span className="dialogue-now__remote">Across the atlas</span>}
        {view.regionName !== null && <span>{view.regionName}</span>}
      </header>
      <p className="observer-copy--selectable" data-dialogue-copy>{view.visibleText}</p>
    </section>
  );
}
