import { useId } from "react";

import { SavedBeingPortrait } from "./SavedBeingPortrait";
import type { SavedRunSummary } from "./savedRunsClient";

import "./SavedRunsScreen.css";

export interface SavedRunsScreenProps {
  /** Locally stored run summaries, ordered by the caller for presentation. */
  readonly runs: readonly SavedRunSummary[];
  /** True while the local catalogue is being read or refreshed. */
  readonly loading: boolean;
  /** A user-safe catalogue failure, or null when the read succeeded. */
  readonly error: string | null;
  /** Returns to the gateway home screen. */
  readonly onBack: () => void;
  /** Requests a fresh local catalogue read. */
  readonly onRefresh: () => void;
  /** Opens the selected run's locally stored replay. */
  readonly onWatch: (run: SavedRunSummary) => void;
}

type StatusTone = "recording" | "saved" | "error" | "unknown";

interface StatusPresentation {
  readonly label: string;
  readonly tone: StatusTone;
  readonly note: string;
}

const MAX_PORTRAITS = 6;

const KNOWN_REGION_NAMES: Readonly<Record<string, string>> = Object.freeze({
  nirvana: "Nirvana",
  nirvana_east: "Nirvana East",
  nirvana_west: "Nirvana West",
  warm_springs: "Warm Springs",
});

/** Renders the local saved-run library. */
export function SavedRunsScreen({
  runs,
  loading,
  error,
  onBack,
  onRefresh,
  onWatch,
}: SavedRunsScreenProps) {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;

  return (
    <main className="saved-runs-screen" aria-labelledby={headingId}>
      <div className="saved-runs-screen__inner">
        <header className="saved-runs-screen__header">
          <div className="saved-runs-screen__heading-group">
            <button type="button" className="saved-runs-screen__back" onClick={onBack}>
              <span aria-hidden="true">←</span> Back to home
            </button>
            <p className="saved-runs-screen__eyebrow">Stored on this device</p>
            <h1 id={headingId}>Saved Runs</h1>
            <p className="saved-runs-screen__lede">
              Autosaved locally as each world unfolds. Pick a run to revisit the
              snapshots and beings already kept here.
            </p>
          </div>
          <div className="saved-runs-screen__header-actions">
            <span className="saved-runs-screen__local-mark" aria-hidden="true">✦</span>
            <button
              type="button"
              className="saved-runs-screen__refresh"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Refresh saved runs"
            >
              {loading ? "Reading…" : "Refresh"}
            </button>
          </div>
        </header>

        {loading ? (
          <section className="saved-runs-screen__state" aria-busy="true" aria-live="polite">
            <p className="saved-runs-screen__state-kicker">Local library</p>
            <h2>Reading saved runs…</h2>
            <p>The stored catalogue is opening on this device.</p>
          </section>
        ) : error !== null ? (
          <section className="saved-runs-screen__state saved-runs-screen__state--error" role="alert">
            <p className="saved-runs-screen__state-kicker">Local library</p>
            <h2>Saved runs are unavailable.</h2>
            <p>{error.trim() || "The saved-run catalogue could not be read."}</p>
            <button type="button" className="saved-runs-screen__state-action" onClick={onRefresh}>
              Try again
            </button>
          </section>
        ) : runs.length === 0 ? (
          <section className="saved-runs-screen__state" aria-live="polite">
            <p className="saved-runs-screen__state-kicker">Local library</p>
            <h2>No saved runs yet.</h2>
            <p>
              Start a world and it will appear here as snapshots are autosaved.
              There is nothing to replay on this Mac yet.
            </p>
            <button type="button" className="saved-runs-screen__state-action" onClick={onRefresh}>
              Refresh library
            </button>
          </section>
        ) : (
          <section className="saved-runs-screen__catalogue" aria-label="Saved run library">
            <div className="saved-runs-screen__catalogue-intro">
              <p className="saved-runs-screen__catalogue-kicker">Your local shelf</p>
              <p className="saved-runs-screen__catalogue-count">
                {formatCount(runs.length, "saved run", "saved runs")}
              </p>
            </div>
            <div className="saved-runs-screen__grid">
              {runs.map((run, index) => (
                <SavedRunCard
                  key={run.id}
                  run={run}
                  slot={index + 1}
                  idPrefix={`${idPrefix}-run-${index}`}
                  onWatch={onWatch}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

interface SavedRunCardProps {
  readonly run: SavedRunSummary;
  readonly slot: number;
  readonly idPrefix: string;
  readonly onWatch: (run: SavedRunSummary) => void;
}

function SavedRunCard({ run, slot, idPrefix, onWatch }: SavedRunCardProps) {
  const runName = displayRunName(run.name);
  const status = presentStatus(run.status);
  const roster = run.agents.slice(0, MAX_PORTRAITS);
  const remainingAgents = Math.max(0, Math.floor(run.agent_count) - roster.length);
  const titleId = `${idPrefix}-title`;
  const rosterId = `${idPrefix}-roster`;

  return (
    <article className="saved-run-card" data-status={status.tone} aria-labelledby={titleId}>
      <div className="saved-run-card__scene">
        <div className="saved-run-card__scene-topline">
          <span className="saved-run-card__slot">Slot {String(slot).padStart(2, "0")}</span>
          <span className={`saved-run-card__status saved-run-card__status--${status.tone}`}>
            {status.label}
          </span>
        </div>
        <span className="saved-run-card__scene-glyph" aria-hidden="true">✦</span>
      </div>

      <div className="saved-run-card__body">
        <header className="saved-run-card__header">
          <p className="saved-run-card__eyebrow">Saved world</p>
          <h2 id={titleId}>{runName}</h2>
          <p className="saved-run-card__model">
            <span>Model</span>
            <strong>{displayModel(run.model)}</strong>
          </p>
          <p className="saved-run-card__status-note">{status.note}</p>
        </header>

        <section className="saved-run-card__roster" aria-labelledby={rosterId}>
          <div className="saved-run-card__section-heading">
            <h3 id={rosterId}>Saved beings</h3>
            <span>{formatCount(run.living_count, "living", "living")}</span>
          </div>
          {roster.length === 0 ? (
            <p className="saved-run-card__empty-roster">No saved beings were recorded.</p>
          ) : (
            <div className="saved-run-card__roster-grid">
              {roster.map((being) => (
                <div className="saved-run-card__being" key={being.id}>
                  <span className="saved-run-card__portrait">
                    <SavedBeingPortrait id={being.id} persona={being.persona} />
                  </span>
                  <span className="saved-run-card__being-copy">
                    <strong>{displayBeingName(being.name)}</strong>
                    {being.region === null || being.region.trim() === "" ? null : (
                      <small>{displayRegionName(being.region)}</small>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {remainingAgents > 0 ? (
            <p className="saved-run-card__roster-more">
              + {remainingAgents} more saved {remainingAgents === 1 ? "being" : "beings"}
            </p>
          ) : null}
        </section>

        <dl className="saved-run-card__stats">
          <div>
            <dt>Started</dt>
            <dd>{formatStartedAt(run.started_at)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(run.duration_seconds)}</dd>
          </div>
          <div>
            <dt>Events</dt>
            <dd>{formatCount(run.event_count, "event", "events")}</dd>
          </div>
          <div>
            <dt>Regions</dt>
            <dd>{regionSummary(run)}</dd>
          </div>
        </dl>

        <div className="saved-run-card__footer">
          <button
            type="button"
            className="saved-run-card__watch"
            aria-label={`Watch replay for ${runName}`}
            aria-describedby={titleId}
            onClick={() => onWatch(run)}
          >
            Watch replay
          </button>
        </div>
      </div>
    </article>
  );
}

function displayRunName(name: string): string {
  return name.trim() || "Unnamed saved run";
}

function displayBeingName(name: string): string {
  return name.trim() || "Unnamed being";
}

function displayModel(model: string | null): string {
  return model === null || model.trim() === "" ? "Not recorded" : model;
}

function presentStatus(status: string): StatusPresentation {
  const clean = status.trim();
  const normalized = clean.toLowerCase().replace(/[\s-]+/gu, "_");
  if (["starting", "running", "recording", "active", "queued", "in_progress"].includes(normalized)) {
    return {
      label: "Recording",
      tone: "recording",
      note: "Replay includes data saved through the latest snapshot.",
    };
  }
  if (["complete", "completed", "finished", "stopped", "ended", "succeeded", "success"].includes(normalized)) {
    return { label: "Saved", tone: "saved", note: "Replay from the snapshots stored on this device." };
  }
  if (["failed", "error", "errored", "aborted"].includes(normalized)) {
    return { label: "Ended with an error", tone: "error", note: "Replay uses whatever data was saved." };
  }
  if (clean === "") {
    return { label: "Status unavailable", tone: "unknown", note: "Replay availability was not recorded." };
  }
  return { label: clean, tone: "unknown", note: "Replay uses saved data only." };
}

function formatStartedAt(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return "Start date unavailable";
  const milliseconds = value >= 100_000_000_000 ? value : value * 1_000;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return "Start date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "Duration unavailable";
  const seconds = Math.floor(value);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

function formatCount(value: number, singular: string, plural: string): string {
  if (!Number.isFinite(value) || value < 0) return `${plural} unavailable`;
  const count = Math.floor(value);
  return `${count} ${count === 1 ? singular : plural}`;
}

function displayRegionName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  const knownName = KNOWN_REGION_NAMES[trimmed];
  if (knownName !== undefined) return knownName;
  if (!trimmed.includes("_") && !trimmed.includes("-")) return trimmed;
  return trimmed
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .split(" ")
    .map((word) => word.length === 0
      ? word
      : `${word[0]!.toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function regionSummary(run: SavedRunSummary): string {
  const count = formatCount(run.region_count, "region", "regions");
  const names = run.regions
    .map((region) => displayRegionName(region.name))
    .filter((name) => name.length > 0)
    .join(" · ");
  return names.length === 0 ? count : `${count} · ${names}`;
}
